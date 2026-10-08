/* KOLART: kalıcı çevrimdışı kuyruk ve index ekranında onaylı gönderim. */
(() => {
  'use strict';
  const BUILD = '20261008-2050';
  const databaseName = 'kolart-offline-kayitlar-2';
  let opened, saving = Promise.resolve(), indexContext, pendingSync, pendingKey;
  const clone = v => structuredClone(v);
  function open() {
    if (!opened) opened = new Promise((resolve,reject) => {
      const request = indexedDB.open(databaseName,2);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['reports','active','leases','packages'])
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {request.result.close();opened=null;};
        resolve(request.result);
      };
      request.onerror = () => { opened = null; reject(request.error); };
      request.onblocked = () => reject(new Error('Telefon kayıt deposu başka bir sekmede güncelleniyor'));
    });
    return opened;
  }
  const scope = m => `${encodeURIComponent(m.siteID)}|${encodeURIComponent(m.uid)}`;
  const idFor = (m,p) => `${scope(m)}|${p}`;
  async function transaction(stores,mode,fn) {
    const db = await open();
    return new Promise((resolve,reject) => {
      let tx; try {tx=db.transaction(stores,mode,{durability:'strict'});} catch (_) {tx=db.transaction(stores,mode);}
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Telefon kaydı yazılamadı'));
      tx.onabort = () => reject(tx.error || new Error('Telefon kaydı iptal edildi'));
      try { fn(tx,v=>result=v); } catch(e) { tx.abort(); reject(e); }
    });
  }
  async function list(siteID,uid) {
    const all = await transaction(['reports'],'readonly',(tx,done) => {
      const r=tx.objectStore('reports').getAll();r.onsuccess=()=>done(r.result);
    });
    return all.filter(r=>r.meta.siteID===siteID && (!uid || r.meta.uid===uid)).sort((a,b)=>a.log.timestamp-b.log.timestamp);
  }
  async function packages(siteID) {
    const all = await transaction(['packages'],'readonly',(tx,done)=>{
      const request=tx.objectStore('packages').getAll();request.onsuccess=()=>done(request.result);
    });
    return all.filter(p=>p.siteID===siteID);
  }
  async function putPackage(data) {
    await transaction(['packages'],'readwrite',tx=>{
      const store=tx.objectStore('packages'), request=store.getAll();
      request.onsuccess=()=>{
        for(const p of request.result) if(p.siteID===data.siteID && p.username===data.username && p.uid!==data.uid) store.delete(p.id);
        store.put(clone(data));
      };
    });
  }
  async function active(meta) {
    return transaction(['active'],'readonly',(tx,done) => {
      const r=tx.objectStore('active').get(scope(meta));r.onsuccess=()=>done(r.result?.data || null);
    });
  }
  function saveActive(meta,data) {
    const copy=clone(data);
    saving=saving.catch(()=>{}).then(()=>transaction(['active'],'readwrite',tx => {
      tx.objectStore('active').put({id:scope(meta),meta:clone(meta),data:copy});
    }));
    return saving;
  }
  async function enqueue(log,meta) {
    if (!meta.siteID || !meta.uid || !meta.username || !log.patrolId || meta.username !== log.user) throw new Error('Devriye kimliği eksik');
    await saving;
    const record={id:idFor(meta,log.patrolId),meta:clone(meta),log:clone(log),savedAt:Date.now()};
    await transaction(['reports','active'],'readwrite',tx => {
      tx.objectStore('reports').put(record);
      tx.objectStore('active').delete(scope(meta));
    });
    return record;
  }
  async function put(record) { await transaction(['reports'],'readwrite',tx=>tx.objectStore('reports').put(clone(record))); }
  async function remove(id) { await transaction(['reports'],'readwrite',tx=>tx.objectStore('reports').delete(id)); }
  async function lease(meta,owner) {
    return transaction(['leases'],'readwrite',(tx,done) => {
      const store=tx.objectStore('leases'),r=store.get(scope(meta));
      r.onsuccess=()=>{
        if(r.result && r.result.expires>Date.now() && r.result.owner!==owner) {done(false);return;}
        store.put({id:scope(meta),owner,expires:Date.now()+90000});done(true);
      };
    });
  }
  async function release(meta,owner) {
    await transaction(['leases'],'readwrite',tx => {
      const store=tx.objectStore('leases'),r=store.get(scope(meta));
      r.onsuccess=()=>{if(r.result?.owner===owner)store.delete(scope(meta));};
    });
  }
  async function locked(meta,fn) {
    if (navigator.locks) return navigator.locks.request('kolart-offline-sync-'+scope(meta),fn);
    const owner=crypto.randomUUID();
    if(!await lease(meta,owner)) throw new Error('Kayıtlar diğer açık sekmede yükleniyor. Biraz sonra tekrar deneyin.');
    const heartbeat=setInterval(()=>void lease(meta,owner).catch(e=>console.warn('[Gönderim kilidi]',e.message)),25000);
    try {return await fn();} finally {clearInterval(heartbeat);await release(meta,owner);}
  }
  let dialog, ui;
  function modal() {
    if(dialog)return ui;
    const style=document.createElement('style');
    style.textContent=`#kolartSyncModal{position:fixed;inset:0;z-index:2147483646;display:none;place-items:center;background:rgba(3,9,19,.82);backdrop-filter:blur(14px);padding:20px;box-sizing:border-box;font-family:Inter,Arial,sans-serif;color:#f5f9ff}
    #kolartSyncModal .ks-card{width:min(100%,430px);box-sizing:border-box;background:linear-gradient(145deg,#13223a,#081321);border:1px solid #294361;border-radius:28px;padding:28px;box-shadow:0 30px 100px #0009}
    #kolartSyncModal .ks-tag{font-size:10px;letter-spacing:2px;color:#8caccf;font-weight:700;margin-bottom:18px}
    #kolartSyncModal .ks-icon{width:58px;height:58px;display:grid;place-items:center;border-radius:19px;background:#1e395a;color:#7cc7ff;font-size:29px;margin-bottom:19px}
    #kolartSyncModal h2{font-size:23px;line-height:1.2;margin:0 0 12px;letter-spacing:-.5px;color:#fff}
    #kolartSyncModal .ks-text{font-size:13px;line-height:1.65;color:#b9c9dd;margin:0 0 18px}
    #kolartSyncModal .ks-dates{font-size:12px;line-height:1.7;color:#e4effc;background:#ffffff08;padding:12px 15px;border-radius:13px;max-height:105px;overflow:auto;margin-bottom:18px;white-space:pre-line}
    #kolartSyncModal .ks-track{height:10px;border-radius:20px;background:#23354d;overflow:hidden}
    #kolartSyncModal .ks-bar{height:100%;width:0;background:linear-gradient(90deg,#489aff,#54ddc0);border-radius:20px;transition:width .25s ease}
    #kolartSyncModal .ks-row{display:flex;justify-content:space-between;font-size:11px;color:#a9bdd5;margin-top:10px;gap:12px}
    #kolartSyncModal .ks-actions{display:flex;gap:10px;margin-top:22px}
    #kolartSyncModal button{cursor:pointer;border:0;border-radius:13px;padding:13px 17px;font-weight:700;font-size:12px;background:#3e99f8;color:#041626;flex:1}
    #kolartSyncModal button.ks-secondary{background:#24354c;color:#dae8f7}
    #kolartSyncModal button[hidden]{display:none}`;
    document.head.appendChild(style);
    dialog=document.createElement('div');dialog.id='kolartSyncModal';dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','ks-title');
    dialog.innerHTML='<div class="ks-card"><div class="ks-tag">KOLART · ÇEVRİMDIŞI KAYITLAR</div><div class="ks-icon" id="ks-icon">↑</div><h2 id="ks-title">Devriyeleriniz yükleniyor</h2><p class="ks-text" id="ks-text"></p><div class="ks-dates" id="ks-dates"></div><div class="ks-track" id="ks-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="ks-bar" id="ks-bar"></div></div><div class="ks-row"><span id="ks-step"></span><strong id="ks-percent">%0</strong></div><div class="ks-actions"><button id="ks-retry" hidden>Tekrar dene</button><button id="ks-close" class="ks-secondary" hidden>Giriş ekranına dön</button></div></div>';
    document.body.appendChild(dialog);
    ui=Object.fromEntries(['icon','title','text','dates','track','bar','step','percent','retry','close'].map(id=>[id,document.getElementById('ks-'+id)]));
    ui.close.onclick=()=>{dialog.style.display='none';};
    return ui;
  }
  function show(records,title='Devriyeleriniz yükleniyor') {
    const v=modal();dialog.style.display='grid';v.title.textContent=title;v.icon.textContent='↑';
    const dates=[...new Set(records.map(r=>r.log.dateKey))].map(d=>{
      const parts=String(d).split('-');return parts.length===3?`${parts[2]}.${parts[1]}.${parts[0]}`:String(d);
    });
    v.dates.textContent=dates.map(d=>d+' tarihli devriye kayıtlarınız').join('\n');
    v.text.textContent=`Telefonda saklanan ${records.length} devriye kaydı Firebase'e aktarılıyor. Lütfen bu ekranı açık tutun.`;
    v.retry.hidden=true;v.close.hidden=true;progress(0,'Gönderim hazırlanıyor');
  }
  function progress(percent,step) {
    const v=modal(),p=Math.max(0,Math.min(100,Math.floor(percent)));
    v.bar.style.width=p+'%';v.percent.textContent='%'+p;v.track.setAttribute('aria-valuenow',p);v.step.textContent=step;
    window.dispatchEvent(new CustomEvent('kolart-sync-progress',{detail:{percent:p,step}}));
  }
  function explain(error) {
    const code=error.code || '', message=error.message || String(error);
    if(/permission|unauthorized/i.test(code+' '+message)) return 'Firebase erişim izni reddedildi. Kayıtlar telefonda korunuyor.';
    if(code==='AUTH_REQUIRED')return 'Kayıtları göndermek için aynı güvenlik hesabıyla giriş yapın. Girişten sonra yükleme otomatik başlayacak.';
    return 'Gönderim tamamlanamadı. Kayıtlar telefonda korunuyor. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  }
  function failed(error,retry) {
    const v=modal();v.title.textContent='Kayıtlarınız güvende';v.icon.textContent='!';v.text.textContent=explain(error);
    v.step.textContent=error.code==='AUTH_REQUIRED'?'Giriş bekleniyor':'Gönderim tamamlanmadı';
    if(error.code!=='AUTH_REQUIRED')v.text.textContent+=' ('+(error.code || error.message)+')';
    v.close.hidden=false;v.retry.hidden=error.code==='AUTH_REQUIRED';v.retry.onclick=retry;
  }
  function timeout(promise,ms=40000) {
    let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Gönderim zaman aşımı')),ms))])
      .finally(()=>clearTimeout(timer));
  }
  function toBlob(data) {
    const split=data.indexOf(',');if(split<0)throw new Error('Fotoğraf verisi hatalı');
    const header=data.slice(0,split), binary=atob(data.slice(split+1)),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Blob([bytes],{type:(header.match(/^data:([^;]+)/)||[])[1] || 'image/jpeg'});
  }
  async function photo(record,index,c,onProgress) {
    const point=record.log.points[index];
    if(!point.offlineBase64 || point.photoUrl)return;
    const blob=toBlob(point.offlineBase64), storage=c.getStorage(c.app);
    const file=`devriye_fotolari/${record.log.dateKey}/${record.meta.siteID}/${record.meta.uid}_${record.log.patrolId}_${index}.jpg`;
    const task=c.uploadBytesResumable(c.sRef(storage,file),blob,{contentType:blob.type});
    const completed=new Promise((resolve,reject)=>task.on('state_changed',snap=>onProgress(snap.totalBytes ? snap.bytesTransferred/snap.totalBytes:0),reject,resolve));
    try {await timeout(completed,90000);}catch(e){task.cancel();throw e;}
    point.photoUrl=await timeout(c.getDownloadURL(task.snapshot.ref));
    point.offlineBase64=null;
    await put(record); // Fotoğraf bağlantısı, rapor yazımı kesilse de yeniden kullanılabilir.
  }
  async function uploadRecord(record,c,onProgress) {
    if(c.auth.currentUser?.uid!==record.meta.uid || record.meta.siteID!==c.siteID)throw Object.assign(new Error('Aynı hesaba giriş gerekiyor'),{code:'AUTH_REQUIRED'});
    const points=record.log.points || [], count=points.filter(p=>p.offlineBase64&&!p.photoUrl).length;
    let sent=0;
    for(let i=0;i<points.length;i++)if(points[i].offlineBase64&&!points[i].photoUrl){
      await photo(record,i,c,fraction=>onProgress(.8*(sent+fraction)/Math.max(1,count),'Fotoğraflar yükleniyor'));
      sent++;
    }
    const {startISO,...historyLog}=record.log;
    const cleanLog={...historyLog,points:points.map(({offlineBase64,...point})=>point)};
    onProgress(.85,'Devriye raporu kaydediliyor');
    if(c.auth.currentUser?.uid!==record.meta.uid)throw Object.assign(new Error('Oturum değişti'),{code:'AUTH_REQUIRED'});
    const writes = {[`devriyeHistory/${cleanLog.dateKey}/${cleanLog.user}/${cleanLog.patrolId}`]:cleanLog};
    if(cleanLog.hedefSaat && cleanLog.hedefSaat!=='Belirtilmedi' && cleanLog.okunanSayi>0) {
      const m=record.meta;
      const path=`tamamlananDevriyeSaatleri/${m.shiftDate}/${m.saatModu==='blok'?cleanLog.bolge+'/':''}${cleanLog.hedefSaat}`;
      writes[path]=(cleanLog.name || cleanLog.user)+(cleanLog.status==='Eksik Devriye'?' - Eksik Devriye':'');
    }
    // Tek atomik RTDB güncellemesi: rapor ve saat birlikte onaylanır.
    // Aynı patrolId yeniden denense bile ikinci rapor oluşmaz.
    await timeout(c.update(c.ref(c.db),writes));
    await confirmRecord(record,writes); // Tüm gerekli Firebase cevapları başarılı olmadan kuyruktan silinmez.
    onProgress(1,'Kaydedildi');
  }
  async function confirmRecord(record,writes) {
    await transaction(['reports','packages'],'readwrite',tx=>{
      const store=tx.objectStore('packages'), request=store.get(record.meta.siteID+'|'+record.meta.uid);
      request.onsuccess=()=>{
        const pack=request.result;
        if(pack) {
          for(const [path,value] of Object.entries(writes)) if(path.startsWith('tamamlananDevriyeSaatleri/')) {
            const parts=path.split('/'), parent=parts.slice(0,2).join('/');
            let node=pack.data[parent] ||= {};
            for(const part of parts.slice(2,-1)) node=node[part] ||= {};
            node[parts.at(-1)]=value;
          }
          store.put(pack);
        }
        tx.objectStore('reports').delete(record.id);
      };
    });
  }
  async function doSync(c) {
    if(!navigator.onLine)return false;
    const current=c.auth.currentUser;
    if(!current) {
      const records=await list(c.siteID);
      if(records.length){show(records,'Devriye kayıtlarınız bekliyor');failed(Object.assign(new Error('Giriş gerekli'),{code:'AUTH_REQUIRED'}),()=>{});return false;}
      return true;
    }
    return locked({siteID:c.siteID,uid:current.uid},async()=>{
      const records=await list(c.siteID,current.uid);
      if(!records.length)return true;
      show(records);
      try {
        for(let i=0;i<records.length;i++){
          if(!navigator.onLine)throw new Error('İnternet kesildi');
          await uploadRecord(records[i],c,(fraction,step)=>progress(Math.min(99,100*(i+fraction)/records.length),`${i+1}/${records.length} · ${step}`));
        }
        // Yeni kayıtlar başka sekmede eklenmişse ayrıca gösterilir; mevcut grubun tamamı onaylandı.
        progress(100,`${records.length} devriye başarıyla yüklendi`);
        ui.title.textContent='Devriyeleriniz kaydedildi';ui.icon.textContent='✓';
        ui.text.textContent='Tüm gösterilen devriye kayıtları Firebase’e başarıyla ulaştı.';
        await new Promise(resolve=>setTimeout(resolve,900));dialog.style.display='none';
        return true;
      } catch(error) {console.warn('[Çevrimdışı kayıt gönderimi]',error.code || error.message);failed(error,()=>void sync(c));return false;}
    });
  }
  async function sync(c=indexContext) {
    if(!c)return false;
    const key=c.siteID+'/'+(c.auth.currentUser?.uid || '');
    if(pendingSync) {
      if(pendingKey===key)return pendingSync;
      return pendingSync.then(()=>sync(c));
    }
    pendingKey=key;
    pendingSync=doSync(c).catch(async error=>{
      const records=await list(c.siteID,c.auth.currentUser?.uid);if(records.length)show(records,'Devriye kayıtlarınız bekliyor');
      if(records.length)failed(error,()=>void sync(c));console.warn('[Kayıt kuyruğu]',error.message);return false;
    }).finally(()=>{pendingSync=null;pendingKey=null;});
    return pendingSync;
  }
  let detach;
  function attach(c) {
    if(detach)detach();
    indexContext=c;
    const run=()=>{if(navigator.onLine)void sync(indexContext);};
    const offAuth=c.onAuthStateChanged(c.auth,run);
    window.addEventListener('online',run);

    const visible=()=>{if(!document.hidden)run();};
    document.addEventListener('visibilitychange',visible);
    detach=()=>{offAuth();window.removeEventListener('online',run);document.removeEventListener('visibilitychange',visible);};
    // İlk callback Firebase'in kalıcı oturumu geri yüklemesini bekler.
  }
  async function isOnline() {
    if(!navigator.onLine)return false;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
    try {
      const response=await fetch(new URL('index.html',location.href),{method:'HEAD',cache:'no-store',signal:controller.signal});
      return response.ok;
    } catch(_){return false;}finally{clearTimeout(timer);}
  }
  window.KolartOfflineSync={BUILD,open,list,active,saveActive,enqueue,sync,attach,isOnline,packages,putPackage};
  // HTTP önbelleğinden eski index dönse bile internet yokken Auth ekranında kalma.
  function routeOfflineEntry() {
    const page=location.pathname.split('/').pop();
    if(!navigator.onLine && (!page || page==='index.html'))location.replace(new URL('offline-devriye.html',location.href));
  }
  routeOfflineEntry();
  window.addEventListener('offline',routeOfflineEntry);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)routeOfflineEntry();});
})();
