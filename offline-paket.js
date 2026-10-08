/* KOLART offline v4 — 20261008-2050. Paket index'te, başarılı girişten sonra tamamlanır. */
(() => {
  'use strict';
  const BUILD = '20261008-2050';
  const base = new URL('./', document.currentScript.src);
  const POINTER = 'kolart_offline_son_kullanici';
  let bundle = null, registration, preparing;
  const copy = value => structuredClone(value);
  const snapshot = value => ({ exists: () => value !== null && value !== undefined, val: () => copy(value ?? null) });
  const validPart = value => typeof value === 'string' && value.length > 0 && !/[.#$\[\]\/\u0000-\u001f]/.test(value);
  const normalize = value => String(value || '').trim().toLocaleUpperCase('tr-TR');
  function shiftKey(date = new Date()) {
    const d = new Date(date); if (d.getHours() < 8) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  async function within(promise, milliseconds, message) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
    finally { clearTimeout(timer); }
  }
  async function worker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || !('caches' in window))
      throw new Error('Çevrimdışı hazırlık için HTTPS ve desteklenen bir tarayıcı gerekli.');
    if (!registration) registration = navigator.serviceWorker.register(new URL('sw.js', base),
      { scope: base.pathname, updateViaCache: 'none' }).catch(e => { registration = null; throw e; });
    const reg = await within(registration, 20000, 'Çevrimdışı servis kaydedilemedi.');
    await within(reg.update(), 20000, 'Çevrimdışı servis güncellenemedi.');
    const candidate = reg.installing || reg.waiting;
    if (candidate && candidate.state !== 'activated') await within(new Promise((resolve, reject) => {
      const check = () => {
        if (candidate.state === 'activated') { candidate.removeEventListener('statechange', check); resolve(); }
        if (candidate.state === 'redundant') { candidate.removeEventListener('statechange', check); reject(new Error('sw.js etkinleştirilemedi.')); }
      };
      candidate.addEventListener('statechange', check); check();
    }), 25000, 'Çevrimdışı servis etkinleşmedi.');
    const active = reg.active;
    if (!active) throw new Error('Çevrimdışı servis henüz hazır değil.');
    return active;
  }
  async function controlled() {
    if (!navigator.serviceWorker.controller) await within(new Promise(resolve => {
      const onChange = () => { navigator.serviceWorker.removeEventListener('controllerchange', onChange); resolve(); };
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
      if (navigator.serviceWorker.controller) onChange();
    }), 10000, 'Çevrimdışı servis bu sayfayı kontrol etmiyor. Sayfayı yenileyip giriş yapın.');
  }
  async function shell(progress) {
    const target = await worker(), channel = new MessageChannel();
    try {
      const result = await within(new Promise((resolve, reject) => {
        channel.port1.onmessage = e => {
          const m = e.data;
          if (m.progress) { progress(60, 'Sayfa ve QR kamera dosyaları telefona indiriliyor…'); return; }
          if (!m.ok) { reject(new Error(m.message)); return; }
          if (m.build !== BUILD) { reject(new Error('sw.js sürümü eski. ZIP içindeki dosyaları birlikte yükleyin.')); return; }
          resolve(m);
        };
        target.postMessage({ type: 'KOLART_SHELL_PREPARE' }, [channel.port2]);
      }), 60000, 'Sayfa dosyaları indirilemedi. Dosyaları ve bağlantıyı kontrol edin.');
      await controlled();
      return result;
    } finally { channel.port1.close(); }
  }
  function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join(''); }
  async function digest(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bytes = Uint8Array.from(salt.match(/../g), h => parseInt(h,16));
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations }, key, 256));
  }
  async function verifier(password) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16))), iterations = 210000;
    return { algorithm: 'PBKDF2-SHA256', salt, iterations, hash: await digest(password, salt, iterations) };
  }
  async function verify(candidate, password) {
    const v = candidate?.verifier;
    if (!v || v.algorithm !== 'PBKDF2-SHA256' || !/^[0-9a-f]{32}$/.test(v.salt) || !/^[0-9a-f]{64}$/.test(v.hash)) return false;
    if (v.iterations < 100000 || v.iterations > 600000) return false;
    const value = await digest(String(password).trim(), v.salt, v.iterations);
    let difference = value.length ^ v.hash.length;
    for (let i=0; i<value.length; i++) difference |= value.charCodeAt(i) ^ v.hash.charCodeAt(i);
    return difference === 0;
  }
  async function intact(candidate) {
    if (!candidate?.complete || candidate.schema !== 4 || candidate.build !== BUILD || !candidate.verifier || !candidate.blocks?.length) return false;
    if (!await caches.has(candidate.assetCache)) return false;
    const cache = await caches.open(candidate.assetCache);
    for (const file of candidate.requiredAssets) if (!await cache.match(new URL(file, base).href)) return false;
    return true;
  }
  async function load(siteID, username) {
    bundle = null;
    const packages = await window.KolartOfflineSync.packages(siteID);
    const candidate = packages.filter(p => normalize(p.username) === normalize(username)).sort((a,b) => b.createdAt-a.createdAt)[0];
    if (!await intact(candidate)) return null;
    bundle = candidate; return bundle;
  }
  async function last() {
    const siteID = localStorage.getItem('siteID');
    let pointer; try { pointer = JSON.parse(localStorage.getItem(POINTER) || 'null'); } catch (_) { return null; }
    if (!pointer || pointer.siteID !== siteID) return null;
    const candidate = await load(siteID, pointer.username);
    return candidate && (!pointer.uid || candidate.uid === pointer.uid) ? candidate : null;
  }
  async function readServer(c, path) {
    try {
      const snap = await within(c.get(c.ref(c.db, path)), 25000, path + ' okuması zaman aşımına uğradı.');
      return copy(snap.val() ?? null);
    } catch (e) { throw new Error('Paket verisi okunamadı: /' + path + ' (' + (e.code || e.message) + ').'); }
  }
  async function prepare(c, progress = () => {}) {
    if (!navigator.onLine) throw new Error('Paket hazırlanırken internet bağlantısı gerekli.');
    const authUser = c.auth.currentUser, username = normalize(c.username);
    if (!authUser || !validPart(username) || !c.siteID) throw new Error('Başarılı güvenlik girişi gerekli.');
    if (!c.password) throw new Error('Offline şifre doğrulaması için giriş şifresi gerekli.');
    progress(5, 'Güvenlik hesabınız doğrulanıyor…');
    const profile = await readServer(c, 'users/' + username);
    if (!profile || profile.type !== 'security' || profile.isActive === false) throw new Error('Offline devriye için etkin güvenlik hesabı gerekli.');
    if (profile.uid && profile.uid !== authUser.uid) throw new Error('Kullanıcı UID kaydı ile giriş UID’si eşleşmiyor.');
    // Parola, Auth token ve diğer kişilerin kullanıcı kayıtları pakete girmez.
    const user = { username, uid: authUser.uid, name: profile.name || username, type: profile.type, isActive: true };
    progress(15, 'Bölgeler, nöbet ve devriye ayarları indiriliyor…');
    const paths = ['noktaListe', 'nobetRecords', 'activeDevriye/' + username, 'telefon/' + username,
      'sistemAyarlari/saatModu', 'sistemAyarlari/pazarSaatleri', 'sistemAyarlari/planliSaatler',
      'sistemAyarlari/dakikaToleransi', 'tamamlananDevriyeSaatleri/' + shiftKey()];
    const values = await Promise.allSettled(paths.map(async path => [path, await readServer(c,path)]));
    const failure = values.find(r => r.status === 'rejected'); if (failure) throw failure.reason;
    const data = Object.fromEntries(values.map(r => r.value));
    data['users/' + username] = user;
    data.nobetRecords = Object.fromEntries(Object.entries(data.nobetRecords || {}).filter(([,r]) =>
      r && (r.startBy === username || r.startBy === user.name)));
    const activeDuty = Object.values(data.nobetRecords).find(r => r.status === 'started');
    const initialBlock = String(activeDuty?.startPoint || 'BÖLGE').trim();
    const regionList = Object.keys(data.noktaListe || {}).filter(b => data.noktaListe[b] === true);
    if (!regionList.length) regionList.push(initialBlock);
    if (activeDuty && !regionList.includes(initialBlock)) regionList.push(initialBlock);
    for (const b of regionList) if (!validPart(b)) throw new Error('Bölge adı Firebase yoluna uygun değil: ' + b);
    progress(30, `${regionList.length} bölgenin tüm QR noktaları indiriliyor…`);
    const qrResults = await Promise.allSettled(regionList.map(async b => [b, await readServer(c,b + 'qrcodes')]));
    const qrFailure = qrResults.find(r => r.status === 'rejected'); if (qrFailure) throw qrFailure.reason;
    const blocks = [];
    for (const result of qrResults) {
      const [b, points] = result.value;
      if (!points || !Object.keys(points).length) continue;
      for (const point of Object.values(points)) {
        if (!point || typeof point.name !== 'string' || !point.name.trim() || point.qrId === undefined || point.qrId === null)
          throw new Error(b + ' bölgesinde QR noktası adı veya qrId eksik.');
      }
      blocks.push(b); data[b + 'qrcodes'] = points;
    }
    if (!blocks.length) throw new Error('Paketlenecek bölgelerde QR noktası bulunamadı.');
    // Bölge seçimi sadece başarıyla indirilmiş listedeki bölgelerden yapılır.
    data.noktaListe = Object.fromEntries(blocks.map(b => [b,true]));
    data['settings/allowPointChange'] = true;
    const hours = data['sistemAyarlari/planliSaatler'];
    if (!Array.isArray(hours) || !hours.length || hours.some(h => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)))
      throw new Error('/sistemAyarlari/planliSaatler geçerli bir saat listesi içermiyor.');
    const sunday = data['sistemAyarlari/pazarSaatleri'];
    if (sunday !== null && (!Array.isArray(sunday) || sunday.some(h => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))))
      throw new Error('/sistemAyarlari/pazarSaatleri geçerli bir saat listesi değil.');
    progress(50, 'Çevrimdışı giriş hazırlanıyor…');
    const passwordVerifier = await verifier(String(c.password).trim());
    const assets = await shell(progress);
    progress(85, 'Paket telefon hafızasına kaydediliyor…');
    if (!navigator.onLine || c.auth.currentUser?.uid !== authUser.uid) throw new Error('Hazırlık sırasında bağlantı veya oturum değişti. Yeniden giriş yapın.');
    const result = { id: c.siteID + '|' + authUser.uid, schema: 4, build: BUILD, complete: true,
      siteID: c.siteID, username, uid: authUser.uid, user, blocks,
      block: blocks.includes(initialBlock) ? initialBlock : blocks[0], data,
      verifier: passwordVerifier, createdAt: Date.now(), capturedShift: shiftKey(),
      assetCache: assets.cacheName, requiredAssets: assets.files };
    await window.KolartOfflineSync.putPackage(result);
    if (!await intact(result)) throw new Error('Telefon hafızasında paket dosyaları doğrulanamadı.');
    bundle = result;
    localStorage.setItem(POINTER, JSON.stringify({siteID:c.siteID, username, uid:authUser.uid}));
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    progress(100, `${blocks.length} bölge · ${blocks.reduce((n,b) => n + Object.keys(data[b+'qrcodes']).length,0)} QR noktası telefona kaydedildi.`);
    window.dispatchEvent(new CustomEvent('kolart-package-ready', {detail:{siteID:c.siteID,username,uid:authUser.uid}}));
    return result;
  }
  let dialog, view;
  function modal() {
    if (view) return view;
    const style = document.createElement('style');
    style.textContent = '#kolartPackModal{position:fixed;inset:0;z-index:2147483645;display:none;place-items:center;background:#030913e8;padding:20px;font-family:Arial,sans-serif;color:#f4f8ff;box-sizing:border-box}#kolartPackModal .kp-card{width:min(100%,420px);background:#102034;border:1px solid #294361;border-radius:26px;padding:27px;box-sizing:border-box}#kolartPackModal h2{font-size:23px;line-height:1.25;margin:15px 0}#kolartPackModal p{font-size:13px;line-height:1.7;color:#bed0e5;overflow-wrap:anywhere}#kolartPackModal .kp-track{height:10px;border-radius:10px;background:#283b53;overflow:hidden}#kp-bar{height:100%;width:0;background:linear-gradient(90deg,#4ba6ff,#6be3bd);transition:width .25s}#kolartPackModal button{background:#62b4ff;color:#052039;border:0;border-radius:12px;font-weight:bold;padding:13px;margin:14px 5px 0 0;cursor:pointer}#kolartPackModal button[hidden]{display:none}';
    document.head.appendChild(style);
    dialog = document.createElement('div'); dialog.id = 'kolartPackModal'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true');
    dialog.innerHTML = '<div class="kp-card"><small>KOLART · TELEFON HAZIRLIĞI</small><h2 id="kp-title">Çevrimdışı paket hazırlanıyor</h2><p id="kp-text">İnternet olmadan devriye atmanız için gerekli bilgiler indiriliyor. Tamamlanana kadar bu ekranı açık tutun.</p><div class="kp-track" id="kp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="kp-bar"></div></div><p id="kp-step"></p><button id="kp-retry" hidden>Tekrar dene</button><button id="kp-close" hidden>Giriş ekranına dön</button></div>';
    document.body.appendChild(dialog);
    view = Object.fromEntries(['title','text','track','bar','step','retry','close'].map(k => [k,document.getElementById('kp-'+k)]));
    return view;
  }
  async function start(c) {
    if (preparing) return preparing;
    preparing = (async () => {
      const v = modal(); dialog.style.display = 'grid';
      for (;;) {
        v.title.textContent = 'Çevrimdışı paket hazırlanıyor';
        v.text.textContent = 'Devriye verileri, bölgeler ve kamera dosyaları telefona indiriliyor. Tamamlanana kadar bu ekranı açık tutun.';
        v.retry.hidden = true; v.close.hidden = true;
        try {
          const result = await prepare(c, (p,step) => {
            v.bar.style.width = p + '%'; v.track.setAttribute('aria-valuenow',p); v.step.textContent = '%' + p + ' · ' + step;
          });
          v.title.textContent = '✓ Çevrimdışı paket hazır';
          v.text.textContent = 'Artık internet olmadan PWA’yı açıp şifrenizle devriye atabilirsiniz.';
          await new Promise(resolve => setTimeout(resolve,900)); dialog.style.display = 'none'; return result;
        } catch (error) {
          v.title.textContent = 'Paket tamamlanamadı'; v.text.textContent = error.message;
          v.step.textContent = 'Hazır sayılmadı. Önceki kayıtlarınız korunuyor.';
          v.retry.hidden = false; v.close.hidden = false;
          const retry = await new Promise(resolve => {v.retry.onclick = () => resolve(true); v.close.onclick = () => resolve(false);});
          if (!retry) { dialog.style.display = 'none'; return null; }
        }
      }
    })().finally(() => { preparing = null; });
    return preparing;
  }
  function valueAt(path) {
    if (!bundle) throw new Error('Önce cihazdaki paket yüklenmeli.');
    if (Object.hasOwn(bundle.data,path)) return copy(bundle.data[path]);
    const parent = Object.keys(bundle.data).filter(p => path.startsWith(p+'/')).sort((a,b) => b.length-a.length)[0];
    if (parent) return copy(path.slice(parent.length+1).split('/').reduce((n,k) => n?.[k],bundle.data[parent]) ?? null);
    if (path.startsWith('tamamlananDevriyeSaatleri/')) return null;
    throw new Error('Pakette bulunmayan veri: /' + path);
  }
  window.KolartOffline = {BUILD,base,start,prepare,load,last,verify,intact,shiftKey,
    get bundle() {return bundle;}, read(path) {return snapshot(valueAt(path));}};
  const entry = ['', 'index.html'].includes(location.pathname.split('/').pop());
  const route = () => { if (entry && !navigator.onLine) location.replace(new URL('offline-devriye.html',base)); };
  route(); window.addEventListener('offline',route);
  document.addEventListener('visibilitychange',()=>{if (!document.hidden) route();});
})();
