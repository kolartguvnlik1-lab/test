/* KOLART offline paket. Firebase kimlik belirteci sadece işin belleğinde kullanılır. */
'use strict';
const BASE = new URL('./', self.location.href);
const META = 'kolart-offline-meta-1';
const jobs = new Map();
let packagesMemo = null;
const urlFor = (s,u) => new URL(`__kolart_paket/${encodeURIComponent(s)}/${encodeURIComponent(u)}`, BASE).href;
const receiptFor = (s,u) => new URL(`__kolart_yenileme/${encodeURIComponent(s)}/${encodeURIComponent(u)}`, BASE).href;
const json = v => new Response(JSON.stringify(v), {headers:{'Content-Type':'application/json; charset=utf-8'}});
self.addEventListener('install', e => e.waitUntil(self.skipWaiting()));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
async function broadcast(data) {
  for (const client of await self.clients.matchAll({includeUncontrolled:true, type:'window'})) client.postMessage(data);
}
async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try { return await fetch(url, {...options, signal:controller.signal}); }
  finally { clearTimeout(timer); }
}
function firebaseURL(job, path) {
  const url = new URL(path.split('/').map(encodeURIComponent).join('/') + '.json', job.databaseURL.replace(/\/$/,'') + '/');
  url.searchParams.set('auth', job.token);
  return url.href;
}
async function read(job, path, etag = false) {
  const response = await fetchTimed(firebaseURL(job,path), {cache:'no-store', headers:etag ? {'X-Firebase-ETag':'true'} : {}});
  if (!response.ok) throw new Error(path + ' okunamadı (HTTP ' + response.status + '). Firebase Rules kontrol edilmeli.');
  return {value:await response.json(), etag:response.headers.get('ETag')};
}
function version(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^V[1-9]\d*$/i.test(v.trim())) throw new Error('offlineversiyon değeri V1, V2 gibi olmalı');
  return v.trim().toUpperCase();
}
async function ensureVersion(job, missing, cache) {
  let current = await read(job, 'offlineversiyon/' + job.username, true);
  const receipt = await cache.match(receiptFor(job.siteID,job.username));
  const savedReceipt = receipt ? await receipt.json() : null;
  if (current.value !== null && (!missing || savedReceipt?.version === version(current.value))) return version(current.value);
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = version(current.value);
    const next = previous ? 'V' + (Number(previous.slice(1))+1) : 'V1';
    if (!current.etag) throw new Error('Sürüm işlemi için Firebase ETag alınamadı');
    const response = await fetchTimed(firebaseURL(job,'offlineversiyon/' + job.username), {
      method:'PUT', headers:{'Content-Type':'application/json','If-Match':current.etag}, body:JSON.stringify(next)
    });
    if (response.status === 412) {
      current = await read(job, 'offlineversiyon/' + job.username, true);
      // Başka sekme sürümü değiştirdiyse bu sürümü kullan; tekrar artırma.
      if (version(current.value) !== previous) {
        const v = version(current.value);
        if (v) { await cache.put(receiptFor(job.siteID,job.username),json({version:v})); return v; }
      }
      continue;
    }
    if (!response.ok) throw new Error('offlineversiyon yazılamadı (HTTP ' + response.status + ')');
    await cache.put(receiptFor(job.siteID,job.username),json({version:next}));
    return next;
  }
  throw new Error('Sürüm çakışması; sonraki internetli girişte tekrar denenecek');
}
async function intact(p) {
  if (!p?.complete || p.schema !== 1 || !await caches.has(p.assetCache)) return false;
  const cache = await caches.open(p.assetCache);
  for (const url of p.requiredAssets || []) if (!await cache.match(url)) return false;
  return (p.requiredAssets || []).length > 0;
}
async function assets(cacheName) {
  const cache = await caches.open(cacheName), visited = new Set(), required = [];
  const visit = async (href, mandatory = true) => {
    const url = new URL(href,BASE).href;
    if (visited.has(url)) return; visited.add(url);
    try {
      const response = await fetchTimed(url,{cache:'reload', mode:'cors'});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const type = response.headers.get('content-type') || '';
      const code = /javascript|text\/css|text\/html/.test(type) ? await response.clone().text() : '';
      if (mandatory && url.startsWith(BASE.href) && /\.js$/.test(new URL(url).pathname) && !/javascript/.test(type)) throw new Error('JavaScript yerine HTML döndü');
      await cache.put(url,response.clone());
      required.push(url);
      const children = [];
      if (/javascript/.test(type)) {
        for (const match of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)) {
          if (/^(https?:|\.|\/)/.test(match[1])) children.push([new URL(match[1],response.url || url).href,mandatory]);
        }
      } else if (/text\/html/.test(type)) {
        for (const match of code.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) children.push([new URL(match[1],url).href,true]);
        for (const match of code.matchAll(/(?:from\s*|import\s*)["'](https:\/\/[^"']+)["']/g)) children.push([match[1],true]);
        for (const match of code.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
          if (/stylesheet/i.test(match[0])) children.push([new URL(match[1],url).href,false]);
        }
      } else if (/text\/css/.test(type)) {
        for (const match of code.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) children.push([new URL(match[1],url).href,false]);
      }
      // Gruplar halinde indir; her kaynak bir kez ziyaret edilir.
      for (let i=0; i<children.length; i+=4) await Promise.all(children.slice(i,i+4).map(([u,m]) => visit(u,m)));
    } catch (e) { if (mandatory) throw new Error('Paket dosyası indirilemedi: ' + url + ' (' + e.message + ')'); }
  };
  await Promise.all(['index.html','devriye.html','offline-paket.js'].map(p => visit(new URL(p,BASE).href)));
  return required;
}
function shiftKey() {
  const d = new Date(); if (d.getHours()<8) d.setDate(d.getDate()-1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
async function validateUser(job) {
  const profile = (await read(job,'users/' + job.username)).value;
  if (!profile || profile.isActive === false || profile.type !== 'security') throw new Error('Etkin güvenlik kullanıcısı gerekli');
  if (profile.uid && profile.uid !== job.uid) throw new Error('Kullanıcı UID eşleşmiyor');
  return profile;
}
async function dataFor(job, profile) {
  const dataCapturedAt = Date.now();
  const user = {username:job.username,name:profile.name || job.username,type:profile.type,uid:job.uid,isActive:profile.isActive !== false};
  const paths = ['settings/siteName','settings/allowPointChange','telefon/' + job.username,
    'nobetRecords','activeDevriye/' + job.username,'noktaListe','sistemAyarlari/saatModu',
    'sistemAyarlari/pazarSaatleri','sistemAyarlari/planliSaatler','sistemAyarlari/dakikaToleransi',
    'tamamlananDevriyeSaatleri/' + shiftKey()];
  const pairs = await Promise.all(paths.map(async p => [p,(await read(job,p)).value]));
  const data = Object.fromEntries(pairs);
  data['users/' + job.username] = user;
  data.nobetRecords = Object.fromEntries(Object.entries(data.nobetRecords || {}).filter(([,r]) => r.startBy === user.name || r.startBy === user.username));
  const active = Object.values(data.nobetRecords).find(r => r.status === 'started');
  const block = (active?.startPoint || 'BÖLGE').trim();
  const blocks = new Set([block,'BÖLGE', ...Object.entries(data.noktaListe || {}).filter(([,v])=>v===true).map(([k])=>k)]);
  const qr = await Promise.all([...blocks].map(async b => [b + 'qrcodes',(await read(job,b + 'qrcodes')).value]));
  Object.assign(data,Object.fromEntries(qr));
  if (!data[block + 'qrcodes'] || !Object.keys(data[block + 'qrcodes']).length) throw new Error('Aktif bölgede QR noktası bulunamadı');
  return {user,block,data,dataCapturedAt};
}
async function prepare(job) {
  if (!job.databaseURL || !/^https:\/\/[\w.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(job.databaseURL)) throw new Error('Firebase adresi geçersiz');
  if (!job.username || /[.#$\[\]\/]/.test(job.username) || !job.siteID || !job.uid || !job.token) throw new Error('Paket kimliği eksik');
  const meta = await caches.open(META), key = urlFor(job.siteID,job.username);
  const previousResponse = await meta.match(key), previous = previousResponse ? await previousResponse.json() : null;
  const valid = await intact(previous) && previous.uid === job.uid;
  const profile = await validateUser(job);
  let target = await ensureVersion(job,!valid,meta);
  if (valid && previous.uid === job.uid && previous.version === target) {
    await broadcast({type:'KOLART_PACKAGE_READY',siteID:job.siteID,username:job.username,version:target}); return;
  }
  for (let attempt=0;attempt<3;attempt++) {
    const cacheName = 'kolart-paket-' + job.siteID + '-' + job.uid + '-' + target + '-' + Date.now();
    try {
      const [data,requiredAssets] = await Promise.all([dataFor(job,profile),assets(cacheName)]);
      const latest = version((await read(job,'offlineversiyon/' + job.username)).value);
      if (latest !== target) { await caches.delete(cacheName); target = latest || await ensureVersion(job,false,meta); continue; }
      const payload = {schema:1,complete:true,siteID:job.siteID,username:job.username,uid:job.uid,version:target,
        assetCache:cacheName,requiredAssets,createdAt:Date.now(),...data};
      // Bayrak en son: yarım paket tamamlanmış kabul edilmez. Eski paket başarılı değişime kadar kalır.
      await meta.put(key,json(payload));
      packagesMemo = null;
      await meta.delete(receiptFor(job.siteID,job.username));
      if (previous?.assetCache && previous.assetCache !== cacheName) await caches.delete(previous.assetCache);
      await broadcast({type:'KOLART_PACKAGE_READY',siteID:job.siteID,username:job.username,version:target}); return;
    } catch (e) { await caches.delete(cacheName); throw e; }
  }
  throw new Error('Sürüm indirme sırasında tekrar değişti; yeniden denenecek');
}
self.addEventListener('message', e => {
  const job = e.data;
  if (job?.type !== 'KOLART_PREPARE') return;
  const key = job.siteID + '/' + job.username;
  if (jobs.has(key)) return;
  const work = prepare(job).catch(error => broadcast({type:'KOLART_PACKAGE_ERROR',message:error.message}))
    .finally(() => jobs.delete(key));
  jobs.set(key,work); e.waitUntil(work);
});
async function packageList() {
  if (packagesMemo) return packagesMemo;
  const meta = await caches.open(META), result = [];
  for (const key of await meta.keys()) {
    if (!new URL(key.url).pathname.includes('/__kolart_paket/')) continue;
    try { const p = await (await meta.match(key)).json(); if (p.complete) result.push(p); } catch (_) {}
  }
  packagesMemo = result.sort((a,b)=>b.createdAt-a.createdAt);
  return packagesMemo;
}
async function cached(request, packages) {
  for (const p of packages) {
    const cache = await caches.open(p.assetCache), hit = await cache.match(request);
    if (hit) return hit;
  }
}
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) || /identitytoolkit|securetoken/.test(url.hostname)) return;
  if (e.request.mode === 'navigate' && url.origin === BASE.origin && url.pathname.startsWith(BASE.pathname)) {
    e.respondWith((async () => {
      try { return await fetch(e.request); }
      catch (_) {
        const packages = await packageList();
        const isEntry = [BASE.pathname,BASE.pathname+'index.html',BASE.pathname+'guvenlik.html'].includes(url.pathname);
        // Offline PWA açılışında normal Auth giriş ekranı yerine hazırlanan devriye çalışır.
        const hit = isEntry ? await cached(new URL('devriye.html',BASE).href,packages) : await cached(e.request,packages);
        return hit || new Response('Bu cihazda çevrimdışı paket yok. İnternet bağlantısıyla bir kez giriş yapın.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
    })()); return;
  }
  // Firebase JSON istekleri cache'e alınmaz. Yalnız paket listesinde yer alan statik kaynaklar kullanılır.
  e.respondWith((async () => {
    const hit = await cached(e.request,await packageList());
    return hit || fetch(e.request);
  })());
});
