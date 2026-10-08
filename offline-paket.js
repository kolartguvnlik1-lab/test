/* KOLART: girişten bağımsız, sessiz çevrimdışı paket yöneticisi. */
(() => {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const META = 'kolart-offline-meta-1';
  const POINTER = 'kolart_offline_son_kullanici';
  const profile = (u) => ({ username: u.username, name: u.name || u.username,
    type: u.type, uid: u.uid, isActive: u.isActive });
  const safe = (v) => JSON.parse(JSON.stringify(v));
  let context, bundle, unsubscribe = [], running = false, lastJob = 0;
  const registration = 'serviceWorker' in navigator && window.isSecureContext
    ? navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname })
    : Promise.reject(new Error('HTTPS ve Service Worker gerekli'));
  registration.catch(e => console.warn('[Offline paket]', e.message));
  const manifestURL = (s, u) => new URL(`__kolart_paket/${encodeURIComponent(s)}/${encodeURIComponent(u)}`, base).href;
  const dynamicKey = (s, u) => `kolart_dinamik_${s}_${u}`;
  const snapshot = (value) => ({ exists: () => value !== null && value !== undefined, val: () => value ?? null });
  function values() {
    if (!bundle) return {};
    try {
      const data = JSON.parse(localStorage.getItem(dynamicKey(bundle.siteID, bundle.username)) || '{}');
      const times = data.__kolart_times || {};
      return Object.fromEntries(Object.entries(data).filter(([path]) => path !== '__kolart_times' &&
        (times[path] || 0) >= (bundle.dataCapturedAt || bundle.createdAt)));
    }
    catch (_) { return {}; }
  }
  function remember(path, value) {
    if (!bundle) return;
    try {
      const data = JSON.parse(localStorage.getItem(dynamicKey(bundle.siteID, bundle.username)) || '{}');
      data.__kolart_times ||= {}; data.__kolart_times[path] = Date.now();
      data[path] = safe(value ?? null);
      for (const key of Object.keys(data)) if (key.startsWith(path + '/')) { delete data[key]; delete data.__kolart_times[key]; }
      localStorage.setItem(dynamicKey(bundle.siteID, bundle.username), JSON.stringify(data));
    } catch (e) { console.warn('[Offline veri saklanamadı]', e.message); }
  }
  function valueAt(path) {
    const merged = { ...bundle.data, ...values() };
    const descendants = Object.keys(merged).filter(k => k.startsWith(path + '/'));
    if (Object.hasOwn(merged, path) || descendants.length) {
      let value = Object.hasOwn(merged, path) ? safe(merged[path]) : {};
      if (descendants.length) {
        if (!value || typeof value !== 'object') value = {};
        for (const key of descendants) {
          const parts = key.slice(path.length+1).split('/'); let node = value;
          for (const part of parts.slice(0,-1)) { node[part] ||= {}; node = node[part]; }
          node[parts.at(-1)] = safe(merged[key]);
        }
      }
      return value;
    }
    const parent = Object.keys(merged).filter(k => path.startsWith(k + '/')).sort((a,b) => b.length-a.length)[0];
    if (parent) return path.slice(parent.length + 1).split('/').reduce((v,k) => v?.[k], merged[parent]) ?? null;
    // Yeni vardiyada henüz cihazda kayıt yoksa liste boş başlar; diğer kişiler canlı doğrulanamaz.
    if (path.startsWith('tamamlananDevriyeSaatleri/')) return null;
    throw new Error('Çevrimdışı pakette veri eksik: ' + path);
  }
  async function load(siteID, username) {
    bundle = null;
    if (!siteID || !username || !('caches' in window)) return null;
    const cache = await caches.open(META);
    const response = await cache.match(manifestURL(siteID, username));
    if (!response) return null;
    const candidate = await response.json();
    if (!candidate.complete || candidate.schema !== 1 || candidate.siteID !== siteID || candidate.username !== username) return null;
    if (!await caches.has(candidate.assetCache)) return null;
    const assets = await caches.open(candidate.assetCache);
    for (const url of candidate.requiredAssets) if (!await assets.match(url)) return null;
    bundle = candidate;
    return bundle;
  }
  async function last() {
    try {
      const p = JSON.parse(localStorage.getItem(POINTER) || 'null');
      if (!p || p.siteID !== localStorage.getItem('siteID')) return null;
      return await load(p.siteID, p.username);
    } catch (_) { return null; }
  }
  async function worker() {
    const reg = await registration;
    if (reg.active) return reg.active;
    const candidate = reg.installing || reg.waiting;
    if (!candidate) throw new Error('Paket servisi hazır değil');
    await new Promise((resolve, reject) => {
      const check = () => { if (candidate.state === 'activated') resolve();
        else if (candidate.state === 'redundant') reject(new Error('Paket servisi etkinleştirilemedi')); };
      candidate.addEventListener('statechange', check); check();
    });
    return reg.active || candidate;
  }
  async function request() {
    if (!context || !navigator.onLine || running) return;
    running = true;
    try {
      const { auth, siteID, username } = context;
      if (!auth.currentUser) return;
      const token = await auth.currentUser.getIdToken();
      const target = await worker();
      target.postMessage({ type: 'KOLART_PREPARE', siteID, username, uid: auth.currentUser.uid,
        databaseURL: context.databaseURL, token });
      lastJob = Date.now();
    } catch (e) { console.warn('[Offline paket]', e.message); }
    finally { running = false; }
  }
  async function start(c) {
    context = c;
    unsubscribe.forEach(fn => fn()); unsubscribe = [];
    // Kullanıcı işaretçisi paket tamamlandı anlamına gelmez; bayrak worker'daki complete kaydıdır.
    localStorage.setItem(POINTER, JSON.stringify({siteID:c.siteID, username:c.username}));
    void request();
    await load(c.siteID, c.username);
    // Sürüm değişikliği sayfa açıkken canlı gelir. Paket Firebase bağlantısında değil, cihazda saklanır.
    if (c.onValue && c.ref) {
      unsubscribe.push(c.onValue(c.ref(c.db, 'offlineversiyon/' + c.username), () => void request(),
        e => console.warn('[offlineversiyon erişimi]', e.code || e.message)));
    }
  }
  function watchDynamic(c) {
    if (!c.onValue || !c.ref) return;
    const day = new Date(); if (day.getHours() < 8) day.setDate(day.getDate()-1);
    const date = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
    ['nobetRecords', 'activeDevriye/' + c.username, 'telefon/' + c.username,
      'settings/allowPointChange', 'tamamlananDevriyeSaatleri/' + date].forEach(path => {
      unsubscribe.push(c.onValue(c.ref(c.db, path), snap => {
        let data = snap.val();
        if (path === 'nobetRecords') data = Object.fromEntries(Object.entries(data || {}).filter(([,r]) =>
          r.startBy === c.username || r.startBy === (bundle?.user.name || c.username)));
        remember(path, data);
      }, e => console.warn('[Offline canlı veri]', path, e.code || e.message)));
    });
  }
  navigator.serviceWorker?.addEventListener('message', async e => {
    const m = e.data;
    if (m?.type === 'KOLART_PACKAGE_READY' && context && m.siteID === context.siteID && m.username === context.username) {
      await load(m.siteID, m.username);
      if (!bundle) return;
      localStorage.setItem(POINTER, JSON.stringify({siteID:m.siteID, username:m.username}));
      window.dispatchEvent(new CustomEvent('kolart-package-ready', {detail: {version: bundle.version}}));
    }
    if (m?.type === 'KOLART_PACKAGE_ERROR') console.warn('[Offline paket hazırlanamadı]', m.message);
  });
  window.addEventListener('online', () => void request());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now()-lastJob > 15000) void request();
  });
  window.KolartOffline = { start, load, last, remember, watchDynamic, profile,
    get bundle() { return bundle; },
    read(path) { if (!bundle) throw new Error('Önce internetli girişte paket hazırlanmalıdır'); return snapshot(valueAt(path)); },
    request,
    async get(reference, firebaseGet) {
      const path = decodeURIComponent(new URL(reference.toString()).pathname).replace(/^\//,'');
      if (!navigator.onLine) return this.read(path);
      const snap = await firebaseGet(reference);
      // QR ve plan ayarları sürümlü pakete aittir. Yalnız canlı durum ayrı saklanır.
      if (/^(activeDevriye|telefon|nobetRecords|tamamlananDevriyeSaatleri)(\/|$)/.test(path)) {
        let data = snap.val();
        if (path === 'nobetRecords') data = Object.fromEntries(Object.entries(data || {}).filter(([,r]) =>
          r.startBy === bundle?.username || r.startBy === bundle?.user.name));
        remember(path, data);
      }
      return snap;
    }
  };
})();
