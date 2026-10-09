/* KOLART offline: cihazda kayıt; merkeze gönderim yalnız butona basıldığında. */
/* kolart-offline-access:4hane-v1 */
(() => {
'use strict';
document.body.appendChild(document.getElementById('offlineLogin'));
let currentUser, siteID, patrolMeta, patrolId, activeRoute;
let isPhoneBroken = false, unlocked = false, pointSaving = false;
let loginEpoch = 0, loginSubmitting = false, previewEpoch = 0;
let previewPromise = Promise.resolve(), managerPromptID = '';
const db = {};
const ref = (_,path) => ({path});
const get = async reference => {
  if (devriyeStarted && activeRoute && reference.path === currentBlock+'qrcodes')
    return {exists:()=>true,val:()=>structuredClone(activeRoute)};
  return window.KolartOffline.read(reference.path);
};
const escapeHTML = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function stateForSave() {
  return {patrolId,block:currentBlock,startTime:startTime?.toISOString(),readPoints,
    hedefSaat:secilenHedefSaat,equipment:eqStatus,meta:patrolMeta,routePoints:activeRoute};
}
const REMEMBER_PREFIX='kolart_offline_hatirla_v1|';
const rememberKey=()=>REMEMBER_PREFIX+encodeURIComponent(localStorage.getItem('siteID') || '');
function rememberedPreference() {
  try{return JSON.parse(localStorage.getItem(rememberKey()) || 'null');}catch(_){return null;}
}
function remembered(candidate) {
  const r=rememberedPreference();
  return !!(r && candidate && r.id===candidate.id && r.siteID===candidate.siteID && r.uid===candidate.uid &&
    r.version===candidate.version && r.createdAt===candidate.createdAt &&
    r.profileHash===candidate.verifier?.hash && r.managerHash===candidate.managerVerifier?.hash &&
    !window.KolartOffline.requiresManagerPassword(candidate));
}
function saveRememberPreference(candidate,enabled) {
  if(!enabled){localStorage.removeItem(rememberKey());return;}
  localStorage.setItem(rememberKey(),JSON.stringify({id:candidate.id,siteID:candidate.siteID,uid:candidate.uid,
    username:candidate.username,version:candidate.version,createdAt:candidate.createdAt,
    profileHash:candidate.verifier.hash,managerHash:candidate.managerVerifier.hash}));
}
async function unlockCandidate(candidate,epoch) {
  await restorePatrol(candidate);
  if(epoch!==loginEpoch)return false;
  unlocked=true;
  document.querySelector('.app-container').inert=false;
  document.getElementById('offlineLogin').style.display='none';
  document.getElementById('offlinePassword').value='';
  document.getElementById('offlinePassword').type='password';
  document.getElementById('offlinePasswordToggle').setAttribute('aria-pressed','false');
  document.getElementById('offlinePasswordToggle').setAttribute('aria-label','Şifreyi göster');
  document.getElementById('offlineManagerPassword').value='';
  renderManagerPrompt(candidate);
  document.getElementById('offlineLoginMessage').textContent='';
  return true;
}
async function completedSnapshot(path) {
  const parts=path.split('/'),mode=window.KolartOffline.read('sistemAyarlari/saatModu').val() || 'tekli';
  const hours=await window.KolartOfflineSync.localCompleted({siteID,uid:currentUser.uid,shiftDate:parts[1],saatModu:mode},currentBlock);
  const value=Object.fromEntries(hours.map(hour=>[hour,true]));
  // Pakete alınan sunucu tamamlanma listesi burada kullanılmaz.
  return {exists:()=>hours.length>0,val:()=>value};
}
async function refreshQueueLabel() {
  const user=currentUser;
  const pending=user ? await window.KolartOfflineSync.count(siteID,user.uid) : 0;
  if(user!==currentUser)return;
  const name=user?.name || user?.username || 'Devriye hesabı';
  document.getElementById('offlineUserName').textContent=name;
  document.getElementById('offlineUserAvatar').textContent=name.split(/\s+/).filter(Boolean).slice(0,2).map(n=>n[0]).join('').toLocaleUpperCase('tr-TR');
  document.getElementById('offlineUserLabel').textContent=pending
    ? `${pending} devriye gönderilmeyi bekliyor` : 'Devriye kayıtların bu cihazda saklanır';
  document.getElementById('patrolDateLabel').textContent=new Date().toLocaleDateString('tr-TR',{day:'numeric',month:'long'});
  const upload=document.getElementById('offlineUploadBtn');
  upload.hidden=!navigator.onLine;
  upload.disabled=!pending || isSyncOutboxRunning;
  document.getElementById('offlineUploadCount').textContent=String(pending);
}
function stopPosition() {
  if(countdownInterval) {clearInterval(countdownInterval);countdownInterval=null;}
  if(watchId) {navigator.geolocation.clearWatch(watchId);watchId=null;}
  document.getElementById('securityOverlay').style.display='none';
}
function renderManagerPrompt(candidate) {
  const gate=document.getElementById('offlineManagerGate');
  const input=document.getElementById('offlineManagerPassword');
  const hint=document.getElementById('offlineManagerHint');
  const identity=candidate
    ? `${candidate.id}|${candidate.version}|${candidate.managerVerifier?.hash}` : '';
  const required=!!candidate && window.KolartOffline.requiresManagerPassword(candidate);
  if(identity!==managerPromptID || !required)input.value='';
  managerPromptID=identity;
  gate.hidden=!required;input.required=required;input.disabled=!required;
  hint.textContent=candidate
    ? (required
      ? `${candidate.version} paketi için yönetici onayı gerekli.`
      : `${candidate.version} · Yönetici onayı tamamlandı.`)
    : '';
}
function showLockedLogin() {
  loginEpoch++;previewEpoch++;unlocked=false;
  document.querySelector('.app-container').inert=true;
  document.getElementById('offlineLogin').style.display='grid';
  document.getElementById('offlinePassword').value='';
  document.getElementById('offlineManagerPassword').value='';
  document.getElementById('offlineRemember').checked=!!rememberedPreference();
  const candidate=window.KolartOffline.bundle;
  renderManagerPrompt(candidate);
  document.getElementById('offlineLoginMessage').textContent=
    candidate && window.KolartOffline.requiresManagerPassword(candidate)
      ? 'Yöneticinizden 4 haneli şifre alın ve profil şifrenizle giriş yapın.'
      : 'Devriyeye devam etmek için profil şifrenizi tekrar girin.';
}
function readAttempts(key) {
  try {
    const value=JSON.parse(localStorage.getItem(key)||'{}');
    return value && typeof value==='object' ? value : {};
  } catch(_){return {};}
}
function checkAttempts(key, label) {
  const attempts=readAttempts(key);
  if(attempts.until>Date.now())throw new Error(
    label+' için '+Math.ceil((attempts.until-Date.now())/1000)+' saniye bekleyin.'
  );
}
function failedAttempt(key) {
  const attempts=readAttempts(key);
  attempts.count=(attempts.count||0)+1;
  if(attempts.count>=5){attempts.until=Date.now()+30000;attempts.count=0;}
  try{localStorage.setItem(key,JSON.stringify(attempts));}catch(_){}
}
async function lockScreen() {
  if(pointSaving || isFinalizing) {showAppModal('LÜTFEN BEKLEYİN','Telefon kaydı tamamlanıyor.','hourglass_empty');return;}
  showLockedLogin();
  await window.closeScanner();stopPosition();
}
async function restorePatrol(candidate) {
  currentUser=structuredClone(candidate.user);siteID=candidate.siteID;
  isPhoneBroken=candidate.data['telefon/'+candidate.username]===true;
  const data=await window.KolartOfflineSync.active({siteID,uid:currentUser.uid});
  if(data?.patrolId && data.meta?.uid===currentUser.uid && data.startTime) {
    patrolId=data.patrolId;patrolMeta=data.meta;currentBlock=data.block;
    startTime=new Date(data.startTime);readPoints=data.readPoints || [];
    secilenHedefSaat=data.hedefSaat;eqStatus=data.equipment || {gps:true,fener:true,yelek:true};
    activeRoute=data.routePoints || candidate.data[currentBlock+'qrcodes'];
    if(!activeRoute || !Number.isFinite(startTime.getTime()))throw new Error('Devam eden devriyenin cihaz verisi eksik.');
    devriyeStarted=true;isFinalizing=false;uiStartMode();startTimerLoop();
  } else {
    devriyeStarted=false;isFinalizing=false;currentBlock=candidate.block;
    readPoints=[];startTime=null;secilenHedefSaat=null;activeRoute=null;uiReadyMode();
  }
  await loadQRInterface();
  document.getElementById('eliteSelectBadge').style.display='block';
  await refreshQueueLabel();
}
async function bootLogin() {
  showLockedLogin();
  const epoch=loginEpoch;
  const submit=document.getElementById('offlineLoginBtn'),message=document.getElementById('offlineLoginMessage');
  submit.disabled=true;message.dataset.error='false';
  try {
    await window.KolartOfflineSync.open();
    const preference=rememberedPreference();
    let candidate=preference?.username
      ? await window.KolartOffline.load(localStorage.getItem('siteID'),preference.username) : null;
    if(!candidate)candidate=await window.KolartOffline.last();
    if(epoch!==loginEpoch)return;
    if(!candidate) {
      message.textContent='Hazır telefon paketi bulunamadı. İnternet varken ana giriş ekranından giriş yapıp paket hazırlığını tamamla.';
      return;
    }
    document.getElementById('offlineUsername').value=candidate.username;
    renderManagerPrompt(candidate);
    if(remembered(candidate)) {
      loginSubmitting=true;
      message.textContent='Devriye hesabın açılıyor…';
      try {await unlockCandidate(candidate,epoch);}finally{loginSubmitting=false;}
      return;
    }
    if(preference)localStorage.removeItem(rememberKey());
    document.getElementById('offlineRemember').checked=false;
    message.textContent=window.KolartOffline.requiresManagerPassword(candidate)
      ? 'Yönetici kodunu ve kendi profil şifreni gir.'
      : 'Profil şifrenle devam edebilirsin.';
  } catch(error) {
    if(epoch===loginEpoch){message.dataset.error='true';message.textContent='Telefon paketi açılamadı: '+error.message;}
  } finally {if(epoch===loginEpoch)submit.disabled=!window.KolartOffline.bundle;}
}
document.getElementById('offlineUsername').addEventListener('input',()=>{
  if(loginSubmitting)return;
  const sequence=++previewEpoch;
  const username=document.getElementById('offlineUsername').value.trim().toLocaleUpperCase('tr-TR');
  const submit=document.getElementById('offlineLoginBtn'),message=document.getElementById('offlineLoginMessage');
  document.getElementById('offlinePassword').value='';
  renderManagerPrompt(null);
  submit.disabled=true;
  message.textContent='Kullanıcının telefon paketi kontrol ediliyor…';
  previewPromise=(async()=>{
    const packages=await window.KolartOfflineSync.packages(localStorage.getItem('siteID'));
    const candidate=packages
      .filter(p=>p.username.trim().toLocaleUpperCase('tr-TR')===username)
      .sort((a,b)=>b.createdAt-a.createdAt)[0];
    const ready=await window.KolartOffline.intact(candidate);
    if(sequence!==previewEpoch || loginSubmitting)return;
    renderManagerPrompt(ready ? candidate : null);
    document.getElementById('offlineRemember').checked=ready && remembered(candidate);
    submit.disabled=!ready;
    message.textContent=!ready
      ? 'Bu kullanıcı için tamamlanmış cihaz paketi bulunamadı. İnternet varken index’te giriş yapın.'
      : (window.KolartOffline.requiresManagerPassword(candidate)
        ? 'Yöneticinizden 4 haneli şifre alın ve kendi profil şifrenizi girin.'
        : 'Devriye için profil şifrenizi girin.');
  })().catch(error=>{
    if(sequence===previewEpoch && !loginSubmitting)message.textContent=error.message;
  });
});
document.getElementById('offlineManagerPassword').addEventListener('input',event=>{
  event.target.value=event.target.value.replace(/\D/g,'').slice(0,4);
});
document.getElementById('offlineLoginForm').onsubmit=async event=>{
  event.preventDefault();
  const button=document.getElementById('offlineLoginBtn'),message=document.getElementById('offlineLoginMessage');
  if(button.disabled || loginSubmitting)return;
  button.disabled=true;loginSubmitting=true;message.dataset.error='false';
  const epoch=++loginEpoch;
  const inputs=['offlineUsername','offlinePassword','offlineManagerPassword'].map(id=>document.getElementById(id));
  inputs.forEach(input=>input.readOnly=true);
  try {
    await previewPromise;
    if(epoch!==loginEpoch)return;
    const username=document.getElementById('offlineUsername').value.trim();
    const password=document.getElementById('offlinePassword').value.trim();
    if(!username || !password)throw new Error('Kullanıcı adı ve şifre gerekli.');
    const candidate=await window.KolartOffline.load(localStorage.getItem('siteID'),username);
    if(epoch!==loginEpoch)return;
    if(!candidate)throw new Error('Bu kullanıcı için tamamlanmış cihaz paketi bulunamadı.');
    renderManagerPrompt(candidate);
    const attemptsKey='kolart_offline_deneme_'+candidate.id;
    checkAttempts(attemptsKey,'Profil şifresi denemesi');
    message.textContent='Profil şifreniz cihazda doğrulanıyor…';
    const profileOK=await window.KolartOffline.verify(candidate,password);
    if(epoch!==loginEpoch)return;
    if(!profileOK) {
      failedAttempt(attemptsKey);
      throw new Error('Kullanıcı adı veya şifre hatalı.');
    }
    localStorage.removeItem(attemptsKey);
    if(window.KolartOffline.requiresManagerPassword(candidate)) {
      const managerPassword=document.getElementById('offlineManagerPassword').value.trim();
      if(!/^\d{4}$/.test(managerPassword)) {
        document.getElementById('offlineManagerPassword').focus();
        throw new Error('Yöneticinizden 4 haneli şifre alın ve bu alana girin.');
      }
      const managerAttemptsKey='kolart_offline_yonetici_deneme_'+candidate.id+'|'+candidate.version+'|'+candidate.managerVerifier.hash;
      checkAttempts(managerAttemptsKey,'Yönetici şifresi denemesi');
      message.textContent='Yöneticinin 4 haneli şifresi cihazda doğrulanıyor…';
      const managerOK=await window.KolartOffline.approveManagerPassword(candidate,managerPassword);
      if(epoch!==loginEpoch)return;
      if(!managerOK) {
        failedAttempt(managerAttemptsKey);
        throw new Error('Yöneticinin 4 haneli şifresi hatalı.');
      }
      localStorage.removeItem(managerAttemptsKey);
    }
    const rememberEnabled=document.getElementById('offlineRemember').checked;
    await unlockCandidate(candidate,epoch);
    if(epoch!==loginEpoch)return;
    try{saveRememberPreference(candidate,rememberEnabled);}catch(_) {
      showAppModal('Hatırlama kaydedilemedi','Bu cihazda tercih kaydedilemedi. Sonraki girişte şifren yeniden istenecek.','info');
    }
    // Tarayıcı destekliyorsa cihaz kayıtlarının kalıcı tutulmasını talep et.
    if(navigator.storage?.persist)void navigator.storage.persist().catch(()=>{});
  } catch(error){if(epoch===loginEpoch){message.dataset.error='true';message.textContent=error.message;}}
  finally {
    loginSubmitting=false;inputs.forEach(input=>input.readOnly=false);
    button.disabled=false;
  }
};

let devriyeStarted = false;
let secilenHedefSaat = null;
let isFinalizing = false;       // ARKA PLAN RESİM/SENKRONİZASYON KİLİDİ
let isSyncOutboxRunning = false; // ÇİFT RAPOR GÖNDERİM KİLİDİ
let eqStatus = { gps: null, fener: null, yelek: null };
let startTime = null;
let readPoints = [];
let qrScanner = null;
let currentBlock = "BÖLGE";
let isFlashOn = false;
let bestLocation = null;
let watchId = null;
let countdownInterval = null;
let btnCountdownInterval = null;
let mainTimerInterval = null;    // TIMER SIZINTISINI ÖNLEMEK İÇİN KÜRESEL YAPILDI
window.showAppModal = (title, text, icon = "info") => {
    document.getElementById('appModalTitle').innerText = title;
    document.getElementById('appModalText').innerHTML = text; // <-- innerText yerine innerHTML yapıldı
    document.getElementById('appModalIcon').innerText = icon;
    document.getElementById('appModal').style.display = 'flex';
};
window.closeAppModal = () => { document.getElementById('appModal').style.display = 'none'; };
window.checkEq = (tip, cevap) => {
    eqStatus[tip] = cevap;
    const evetBtn = document.getElementById(tip + 'Evet');
    const hayirBtn = document.getElementById(tip + 'Hayir');

    if(cevap) {
        evetBtn.style.background = "var(--primary)"; evetBtn.style.color = "#000";
        hayirBtn.style.background = "none"; hayirBtn.style.color = "#fff";
    } else {
        hayirBtn.style.background = "#ff3b30"; hayirBtn.style.color = "#fff";
        evetBtn.style.background = "none"; evetBtn.style.color = "#fff";
    }

    const allAnswered = eqStatus.gps !== null && eqStatus.fener !== null && eqStatus.yelek !== null;
    if(allAnswered) {
        const btn = document.getElementById('finalStartBtn');
        btn.style.opacity = "1";
        btn.style.pointerEvents = "auto";
    }
};
function uiStartMode() {
    document.getElementById('backHomeBtn').style.display = "flex";
    document.getElementById('startBtn').style.display = "none";
    document.getElementById('endBtn').style.display = "flex";
    document.getElementById('incidentBtn').style.display = "none"; 
    document.getElementById('statusLabel').innerText = "Devam ediyor";
    document.getElementById('selectedHourStatus').textContent=(secilenHedefSaat || '')+' devriyesi';
}
function uiReadyMode() {
    document.getElementById('backHomeBtn').style.display = "flex";
    document.getElementById('startBtn').style.display = "flex";
    document.getElementById('endBtn').style.display = "none";
    document.getElementById('incidentBtn').style.display = "none"; 
    document.getElementById('statusLabel').innerText = "Hazır";
    document.getElementById('selectedHourStatus').textContent='Saat seçerek başlat';
    document.getElementById('timerDisplay').innerText = "00:00:00";
}async function loadQRInterface() {
    // --- EKLENEN KISIM: Veri çekilmeden önce "Yükleniyor" veya "İnternet bekleniyor" mesajı ---
    const loadingContainer = document.getElementById('qrListContainer');
    if (loadingContainer) {
        loadingContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #f39c12; font-weight: bold; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined" style="font-size: 32px; animation: spin 2s linear infinite;">hourglass_empty</span>
                <span>Kontrol noktaları hazırlanıyor…</span>
            </div>
        `;
    }
    // ------------------------------------------------------------------------------------------

    try {
        document.getElementById('routeName').innerText = currentBlock.toUpperCase() + "";
        const qrSnap = await get(ref(db, `${currentBlock}qrcodes`));
        const container = document.getElementById('qrListContainer');
        if (qrSnap.exists()) {
            container.innerHTML = ''; // Yükleniyor mesajı burada otomatik olarak temizlenir
            const points = Object.values(qrSnap.val());
            refreshStats(points.length);
            points.forEach(point => {
                const isRead = readPoints.some(rp => rp.name.trim().toLocaleLowerCase('tr-TR') === point.name.trim().toLocaleLowerCase('tr-TR'));
                const div = document.createElement('div');
                div.className = 'qr-card';div.tabIndex=0;div.setAttribute('role','button');div.setAttribute('aria-label',point.name);
                div.onkeydown=event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();div.click();}};
                div.innerHTML = `
                    <div class="qr-icon-side" style="${isRead ? 'background:#86d7b221;color:#86d7b2;border-color:#86d7b240' : ''}">
                        <span class="material-symbols-outlined">${isRead ? 'verified' : (isPhoneBroken ? 'touch_app' : 'qr_code_scanner')}</span>
                    </div>
                    <div class="qr-info">
                        <h3>${escapeHTML(point.name)}</h3>
                        <p class="${isRead ? 'completed' : 'waiting'}">
                            ${isRead ? 'Nokta doğrulandı' : (isPhoneBroken ? 'Dokun ve doğrula' : 'QR kodu okut')}
                        </p>
                    </div><span class="point-arrow" aria-hidden="true">›</span>
                `;

                div.onclick = () => { 
                    const suAnOkunmusMu = readPoints.some(rp => rp.name === point.name);
                    if(suAnOkunmusMu) { 
                        showAppModal("TAMAMLANDI", "Bu noktayı zaten başarıyla doğruladınız.", "verified"); 
                        return; 
                    }
                    
                    if(devriyeStarted && !isFinalizing) {
                        if (isPhoneBroken) {
                            launchSecurityOverlay(point.name);
                        } else {
                            openQRScanner(point.qrId, point.name); 
                        }
                    } else if (isFinalizing) {
                        showAppModal("UYARI", "Devriye kapatılıyor, işlem yapılamaz.", "warning");
                    } else {
                        showAppModal("UYARI", "Önce devriyeyi başlatmalısınız!", "play_circle");
                    }
                };
                container.appendChild(div);
            });
        } else {
            // Veri bulunamazsa yükleniyor mesajını "Bulunamadı" ile değiştir
            if (container) container.innerHTML = '<div style="text-align: center; padding: 20px; color: #7f8c8d;">Bu bölgeye ait kayıtlı nokta bulunamadı.</div>';
        }

        // --- EKLENEN KISIM: Veriler başarıyla çekildikten hemen sonra butonu parlatıp kilidini açar ---
        const baslatBtn = document.getElementById('startBtn');
        if (baslatBtn) {
            baslatBtn.disabled = false;
            baslatBtn.style.opacity = "1";
            baslatBtn.style.cursor = "pointer";
            baslatBtn.style.pointerEvents = "auto";
        }
        // ---------------------------------------------------------------------------------------------

    } catch (e) { 
        console.error("Arayüz yükleme hatası:", e); 
        
        // --- EKLENEN KISIM: Hata veya internet kopması durumunda kullanıcıyı bilgilendir ---
        const errorContainer = document.getElementById('qrListContainer');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div style="text-align: center; padding: 20px; color: #e74c3c; font-weight: bold;">
                    <span class="material-symbols-outlined" style="font-size: 32px;">wifi_off</span><br>
                    Cihazdaki kontrol noktaları okunamadı. Tekrar deneyin.
                </div>
            `;
        }
        // ---------------------------------------------------------------------------------
    }
}
function refreshStats(totalCount = null) {
    const total = totalCount || document.querySelectorAll('.qr-card').length;
    const current = readPoints.length;
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    document.getElementById('percentText').innerText = `%${percent} tamamlandı`;
    document.getElementById('progressFill').style.width=Math.min(100,percent)+'%';
    document.getElementById('patrolProgress').setAttribute('aria-valuenow',String(Math.min(100,percent)));
    document.getElementById('counterDisplay').innerText = `${current}/${total}`;
}
function updateUIVisually(pointName) {
    const cards = document.querySelectorAll('.qr-card');
    cards.forEach(card => {
        const kartIsmi = card.querySelector('h3').innerText.trim().toLocaleLowerCase('tr-TR');
        const gelenIsim = pointName.trim().toLocaleLowerCase('tr-TR');

        if(kartIsmi === gelenIsim) {
            card.querySelector('.qr-icon-side').style.background = '#86d7b221';
            card.querySelector('.qr-icon-side').style.color = '#86d7b2';
            card.querySelector('.material-symbols-outlined').innerText = 'verified';
            const p = card.querySelector('.qr-info p');
            p.innerText = 'Nokta doğrulandı';
            p.className = 'completed';
            
            card.onclick = () => { 
                showAppModal("TAMAMLANDI", "Bu noktayı zaten başarıyla doğruladınız.", "verified"); 
            };
            card.style.cursor = "default";
        }
    });
    refreshStats(); 
}
function captureCameraFrame() {
    try {
        const video = document.querySelector("#reader video");
        if (!video) return null;
        const canvas = document.createElement("canvas");
        const width=video.videoWidth || 640,height=video.videoHeight || 480;
        const scale=Math.min(1,720/Math.max(width,height));
        canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.48);
    } catch (e) { return null; }
}
async function openQRScanner(targetId, pointName) {
    if(!unlocked || !devriyeStarted || isFinalizing || pointSaving || qrScanner || countdownInterval)return;
    document.getElementById('qrScannerModal').style.display = 'flex';
    qrScanner = new Html5Qrcode("reader", { useBarCodeDetectorIfSupported: false });
    
    let scanHandled = false;
    try {
        await qrScanner.start({ facingMode: "environment" }, { fps: 20, qrbox: 250 }, async (txt) => {
            if (scanHandled) return; scanHandled = true;
            if (txt.trim() === String(targetId).trim()) {
                const capturedPhoto = captureCameraFrame();
                await closeScanner();
                launchSecurityOverlay(pointName, capturedPhoto);
            } else {
                await closeScanner();
                showAppModal("YANLIŞ NOKTA", `Okuttuğunuz kod bu noktaya (${escapeHTML(pointName)}) ait değil!`, "cancel");
            }
        });
    } catch (e) { showAppModal("HATA", "QR okuyucu açılamadı. Tarayıcı izinlerini kontrol edip tekrar dene."); }

    document.getElementById('flashBtn').onclick = async () => {
        isFlashOn = !isFlashOn;
        try { await qrScanner.applyVideoConstraints({ advanced: [{ torch: isFlashOn }] }); } catch(e){}
    };
}
window.closeScanner = async () => {
    if (qrScanner) {
        try { await qrScanner.stop(); } catch(e){}
        qrScanner = null;
    }
    document.getElementById('qrScannerModal').style.display = 'none';
    isFlashOn = false;
};
function launchSecurityOverlay(name, photo = null) {
    if (!unlocked || !devriyeStarted || isFinalizing) return;
    const overlay = document.getElementById('securityOverlay');
    const num = document.getElementById('countdownNumber');
    overlay.style.display = 'flex';   
    if (countdownInterval) clearInterval(countdownInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    let left = 10;
    num.innerText = left;
    bestLocation = null;
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            if (isFinalizing) { if (watchId) navigator.geolocation.clearWatch(watchId); return; }
            const acc = pos.coords.accuracy;
            if (!bestLocation || acc < bestLocation.acc) {
                bestLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: acc };
                if (acc <= 10) finalizeGpsSearch(name, photo);
            }
        },
        (e) => console.warn("GPS Hatası:", e.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    countdownInterval = setInterval(() => {
        left--; 
        num.innerText = left;
        if (left <= 0) finalizeGpsSearch(name, photo);
    }, 1000);
}
function finalizeGpsSearch(name, photo = null) {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    document.getElementById('securityOverlay').style.display = 'none';    
    if (isFinalizing) return;
    if (bestLocation) {
        pushPoint(name, bestLocation.lat, bestLocation.lng, bestLocation.acc, photo);
    } else {
        saveFinalAttempt(name, photo);
    }
}
function saveFinalAttempt(name, photo = null) {
    if (isFinalizing) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if (isFinalizing) return;
            pushPoint(name, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, photo);
        },
        () => {
            if (isFinalizing) return;
            pushPoint(name, 0, 0, 0, photo);
        },
        { enableHighAccuracy: true, timeout: 3000 }
    );
}
async function pushPoint(name, lat, lng, acc, base64Photo = null) {
    if (pointSaving || isFinalizing || !devriyeStarted || readPoints.some(p => p.name === name)) return;
    pointSaving=true;
    const yeniNokta = {block:currentBlock,name,time:new Date().toLocaleTimeString('tr-TR'),
      lat,lng,acc,photoUrl:null,offlineBase64:base64Photo || null};
    const nextPoints = [...readPoints,yeniNokta];
    try {
      await window.KolartOfflineSync.saveActive(patrolMeta,{...stateForSave(),readPoints:nextPoints});
      readPoints=nextPoints;
      updateUIVisually(name);
    } catch(error) {
      showAppModal('KAYIT YAPILAMADI','Nokta telefon hafızasına kaydedilemedi. Lütfen tekrar okutun.','error');
    } finally {pointSaving=false;}
}
function startTimerLoop() {
    if (mainTimerInterval) clearInterval(mainTimerInterval);
    mainTimerInterval = setInterval(() => {
        if(!devriyeStarted || isFinalizing) { clearInterval(mainTimerInterval); return; }
        const diff = Math.floor((new Date() - startTime) / 1000);
        const h = String(Math.floor(diff / 3600)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const s = String(diff % 60).padStart(2, '0');
        document.getElementById('timerDisplay').innerText = `${h}:${m}:${s}`;
    }, 1000);
}
window.openHourSelectModal = async () => {
  if(!unlocked || devriyeStarted || isFinalizing)return;
  const modal=document.getElementById('hourSelectModal'),area=document.getElementById('hourListArea');
  modal.style.display='flex';area.innerHTML='<div class="hour-empty">Devriye saatleri hazırlanıyor…</div>';
  const shiftDate=new Date();
  if(shiftDate.getHours()<8)shiftDate.setDate(shiftDate.getDate()-1);
  const vardiyaTarihi=window.KolartOffline.shiftKey(new Date()),isSunday=shiftDate.getDay()===0;
  document.getElementById('hourDateLabel').textContent=shiftDate.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric'})+' · '+(isSunday?'Pazar planı':'Normal plan');
  try {
    const pazarSnap=isSunday ? await get(ref(db,'sistemAyarlari/pazarSaatleri')) : null;
    const plan=pazarSnap?.exists() ? pazarSnap.val() : (await get(ref(db,'sistemAyarlari/planliSaatler'))).val();
    const tumSaatler=Array.isArray(plan) ? [...new Set(plan)] : [];
    const mode=(await get(ref(db,'sistemAyarlari/saatModu'))).val() || 'tekli';
    const path='tamamlananDevriyeSaatleri/'+vardiyaTarihi+(mode==='blok'?'/'+currentBlock:'');
    const bitenSaatler=(await completedSnapshot(path)).val();
    const weight=saat=>{const [h,m]=saat.split(':').map(Number);return (h<8?h+24:h)*60+m;};
    const secilebilirSaatler=tumSaatler.filter(saat=>/^([01]\d|2[0-3]):[0-5]\d$/.test(saat) && !bitenSaatler[saat]).sort((a,b)=>weight(a)-weight(b));
    area.replaceChildren();
    if(!secilebilirSaatler.length) {
      const empty=document.createElement('div');empty.className='hour-empty';
      empty.textContent=tumSaatler.length ? 'Bu vardiyanın tüm saatleri bu cihazda kaydedildi. Yeni vardiyada saatler yeniden görünecek.' : 'Bu güne ait planlı devriye saati bulunmuyor.';
      area.appendChild(empty);return;
    }
    for(const saat of secilebilirSaatler) {
      const button=document.createElement('button');button.type='button';button.className='hour-choice';
      const title=document.createElement('strong');title.textContent=saat;
      const label=document.createElement('span');label.textContent='Devriye için seç';button.append(title,label);
      // Offline modda paketteki tüm saatler seçilebilir; eski zaman penceresi uygulanmaz.
      button.onclick=()=>{
        document.getElementById('confirmPatrolText').innerHTML=`<span class="confirm-hour">${saat}</span>Bu saat için devriyeye başlayacaksın.`;
        const confirm=document.getElementById('confirmPatrolModal');confirm.style.display='flex';
        document.getElementById('btnConfirmCancel').onclick=()=>{confirm.style.display='none';};
        document.getElementById('btnConfirmOk').onclick=()=>{
          confirm.style.display='none';modal.style.display='none';secilenHedefSaat=saat;
          document.getElementById('equipmentModal').style.display='flex';
        };
      };
      area.appendChild(button);
    }
  } catch(error) {
    area.innerHTML='<div class="hour-empty">Devriye saatleri cihazdan okunamadı. Tekrar deneyin.</div>';
    console.warn('[Devriye saatleri]',error.message);
  }
};

document.getElementById('startBtn').onclick=()=>{
  if(!unlocked || devriyeStarted || isFinalizing)return;
  eqStatus={gps:null,fener:null,yelek:null};
  for(const t of ['gps','fener','yelek'])for(const answer of ['Evet','Hayir']) {
    const b=document.getElementById(t+answer);b.style.background='none';b.style.color='#fff';
  }
  const finalButton=document.getElementById('finalStartBtn');finalButton.style.opacity='.3';finalButton.style.pointerEvents='none';
  window.openHourSelectModal();
};
document.getElementById('finalStartBtn').onclick=async()=>{
  if(!unlocked || devriyeStarted || isFinalizing)return;
  if(!eqStatus.gps || !eqStatus.fener || !eqStatus.yelek) {
    showAppModal('EKSİK KONTROL','GPS, Fener ve Yelek onayı olmadan devriye başlatılamaz!','warning');return;
  }
  if(!secilenHedefSaat)return;
  const button=document.getElementById('finalStartBtn');button.disabled=true;
  try {
    startTime=new Date();readPoints=[];
    patrolId='P_'+Date.now()+'_'+crypto.randomUUID().replace(/-/g,'').slice(0,12);
    patrolMeta={siteID,uid:currentUser.uid,username:currentUser.username,
      shiftDate:window.KolartOffline.shiftKey(startTime),
      saatModu:window.KolartOffline.read('sistemAyarlari/saatModu').val() || 'tekli'};
    activeRoute=window.KolartOffline.read(currentBlock+'qrcodes').val();
    await window.KolartOfflineSync.saveActive(patrolMeta,stateForSave());
    devriyeStarted=true;isFinalizing=false;
    document.getElementById('equipmentModal').style.display='none';
    uiStartMode();startTimerLoop();await loadQRInterface();
  } catch(error) {
    devriyeStarted=false;startTime=null;
    showAppModal('KAYIT YAPILAMADI','Devriye telefon hafızasına kaydedilemedi: '+escapeHTML(error.message),'error');
  } finally {button.disabled=false;}
};
function missingPoints() {
  return Object.values(activeRoute || {}).filter(p=>!readPoints.some(r=>r.name.trim().toLocaleLowerCase('tr-TR')===p.name.trim().toLocaleLowerCase('tr-TR'))).map(p=>p.name);
}
document.getElementById('endBtn').onclick=()=>{
  if(!unlocked || isFinalizing || !devriyeStarted)return;
  if(pointSaving || countdownInterval || qrScanner){showAppModal('DOĞRULAMA SÜRÜYOR','Nokta doğrulamasının bitmesini bekleyin.','hourglass_empty');return;}
  const missed=missingPoints();
  if(!missed.length){void finalizeOffline('Eksiksiz tamamlandı.',[]);return;}
  const note=document.getElementById('incidentNote'),submit=document.getElementById('forceFinishBtn');
  note.value='';submit.disabled=true;submit.style.pointerEvents='auto';submit.style.opacity='1';
  document.getElementById('charWarning').textContent='En az 15 karakter açıklama yazın.';
  document.getElementById('confirmModal').style.display='flex';
  note.oninput=()=>{
    const length=note.value.trim().length;submit.disabled=length<15;
    document.getElementById('charWarning').textContent=length>=15?'Yeterli açıklama yazıldı ✓':`En az ${15-length} karakter daha…`;
  };
  submit.onclick=()=>{
    if(note.value.trim().length<15 || isFinalizing)return;
    document.getElementById('confirmModal').style.display='none';
    void finalizeOffline(note.value.trim(),missed);
  };
};
async function finalizeOffline(note,missed) {
  if(isFinalizing || !devriyeStarted)return;
  isFinalizing=true;
  const button=document.getElementById('endBtn');button.disabled=true;button.textContent='TELEFONA KAYDEDİLİYOR…';
  if(mainTimerInterval)clearInterval(mainTimerInterval);stopPosition();
  const dateKey=`${startTime.getFullYear()}-${String(startTime.getMonth()+1).padStart(2,'0')}-${String(startTime.getDate()).padStart(2,'0')}`;
  const log={patrolId,user:currentUser.username,name:currentUser.name || currentUser.username,
    bolge:currentBlock,hedefSaat:secilenHedefSaat || 'Belirtilmedi',
    start:startTime.toLocaleTimeString('tr-TR'),end:new Date().toLocaleTimeString('tr-TR'),
    startISO:startTime.toISOString(),points:structuredClone(readPoints),missedPoints:missed,
    ekipmanlar:{...eqStatus},status:missed.length?'Eksik Devriye':'TAM DEVRİYE',
    eksikNotu:note,okunanSayi:readPoints.length,toplamNokta:Object.keys(activeRoute || {}).length,
    timestamp:Date.now(),dateKey,'kayıt':'offline devriye'};
  try {
    await window.KolartOfflineSync.enqueue(log,patrolMeta);
    // IndexedDB işlemi tamamlanmadan ekran ve aktif devriye temizlenmez.
    devriyeStarted=false;isFinalizing=false;readPoints=[];startTime=null;secilenHedefSaat=null;activeRoute=null;
    uiReadyMode();await loadQRInterface();await refreshQueueLabel();
    showAppModal('Devriyen kaydedildi','Kayıt telefonunda saklanıyor. Merkeze aktarmak için internet varken “Verileri merkeze gönder” butonuna bas.','check_circle');
  } catch(error) {
    isFinalizing=false;startTimerLoop();
    showAppModal('KAYIT TAMAMLANAMADI','Aktif devriyeniz korunuyor. Tekrar bitirmeyi deneyin: '+escapeHTML(error.message),'error');
  } finally {button.disabled=false;button.textContent='DEVRİYEYİ BİTİR';}
}
window.openBlockModal=async()=>{
  if(!unlocked)return;
  if(devriyeStarted){showAppModal('AKTİF DEVRİYE','Bölge değiştirmeden önce devriyeyi bitirin.','warning');return;}
  const area=document.getElementById('blockListArea');area.replaceChildren();
  for(const block of window.KolartOffline.bundle.blocks) {
    const button=document.createElement('button');button.textContent=block;
    button.type='button';button.className='block-choice';
    button.onclick=async()=>{currentBlock=block;secilenHedefSaat=null;document.getElementById('blockSelectModal').style.display='none';await loadQRInterface();};
    area.appendChild(button);
  }
  document.getElementById('blockSelectModal').style.display='flex';
};
async function toIndex() {
  if(pointSaving || isFinalizing || isSyncOutboxRunning) {
    showAppModal('İşlem sürüyor','Kaydın tamamlanmasını bekle.','hourglass_empty');return;
  }
  // Çıkış yalnız index.html'e yönlendirir. Auth/hatırlama/aktif kayıt silinmez.
  stopPosition();await window.closeScanner();
  location.href=new URL('index.html',window.KolartOffline.base).href;
}
document.getElementById('offlineLoginOnline').onclick=()=>{location.href=new URL('index.html',window.KolartOffline.base).href;};
document.getElementById('backHomeBtn').onclick=()=>void toIndex();
document.getElementById('offlinePasswordToggle').onclick=()=>{
  const input=document.getElementById('offlinePassword'),button=document.getElementById('offlinePasswordToggle');
  const show=input.type==='password';input.type=show?'text':'password';
  button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'Şifreyi gizle':'Şifreyi göster');
};
document.getElementById('offlineRemember').addEventListener('change',event=>{
  if(!event.target.checked)try{localStorage.removeItem(rememberKey());}catch(_){}
});
function within(promise,ms=30000) {
  let timer;return Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Merkez bağlantısı zaman aşımına uğradı. Kayıtların telefonda korunuyor.')),ms))]).finally(()=>clearTimeout(timer));
}
function uploadError(error) {
  if(/network|timeout/i.test(error.code || ''))return 'Merkeze ulaşılamadı. İnternet bağlantını kontrol edip yeniden gönder.';
  if(/invalid-credential|wrong-password|user-not-found|invalid-login-credentials/i.test(error.code || ''))return 'Profil şifren hatalı. Tekrar dene.';
  if(/too-many-requests/i.test(error.code || ''))return 'Çok fazla giriş denemesi yapıldı. Biraz bekleyip yeniden dene.';
  return error.message || 'Gönderim tamamlanamadı. Kayıtların telefonunda korunuyor.';
}
async function requestUploadAuth(modules,connection,candidate) {
  if(!connection.email)throw new Error('Çevrimiçi oturum bulunamadı. İnternet varken ana giriş ekranında aynı kullanıcıyla giriş yap; sonra bu ekranda gönder butonuna bas.');
  window.KolartOfflineSync.hideModal();
  const modal=document.getElementById('uploadAccessModal'),input=document.getElementById('uploadAccessPassword');
  const button=document.getElementById('uploadAccessSubmit'),message=document.getElementById('uploadAccessMessage');
  input.value='';message.textContent='';modal.style.display='flex';input.focus();
  return new Promise(resolve=>{
    let busy=false;
    const finish=value=>{modal.style.display='none';input.value='';button.disabled=false;resolve(value);};
    document.getElementById('uploadAccessCancel').onclick=()=>{if(!busy)finish(null);};
    document.getElementById('uploadAccessForm').onsubmit=async event=>{
      event.preventDefault();if(busy || !navigator.onLine)return;
      busy=true;button.disabled=true;input.readOnly=true;message.textContent='Hesabın doğrulanıyor…';
      try {
        // Ana girişteki oturuma dokunmadan, yalnız bu gönderim için geçici Auth.
        const name='kolart-offline-upload-'+candidate.uid;
        const app=modules.app.getApps().find(a=>a.name===name) || modules.app.initializeApp(connection.options,name);
        let auth;
        try{auth=modules.auth.initializeAuth(app,{persistence:modules.auth.inMemoryPersistence});}catch(_){auth=modules.auth.getAuth(app);}
        const credential=await within(modules.auth.signInWithEmailAndPassword(auth,connection.email,input.value));
        if(credential.user.uid!==candidate.uid)throw new Error('Çevrimiçi hesap ile devriye hesabı eşleşmiyor. Ana giriş ekranında doğru hesabı kullan.');
        finish({app,auth});
      } catch(error){message.textContent=uploadError(error);}
      finally{busy=false;button.disabled=false;input.readOnly=false;}
    };
  });
}
async function manualContext(candidate) {
  const connection=candidate.connection;
  if(!connection?.options?.apiKey || !connection.options.databaseURL)throw new Error('Merkez bağlantısını hazırlamak için internet varken ana giriş ekranında bir kez aynı kullanıcıyla giriş yap. Kayıtların telefonunda korunuyor.');
  const version=/^\d+\.\d+\.\d+$/.test(connection.sdkVersion || '') ? connection.sdkVersion : '10.12.2';
  const base='https://www.gstatic.com/firebasejs/'+version+'/';
  // İnternet SDK'sı yalnız gönder butonuna basılınca yüklenir.
  const [appModule,authModule,databaseModule,storageModule]=await within(Promise.all([
    import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-database.js'),import(base+'firebase-storage.js')
  ]));
  const modules={app:appModule,auth:authModule};
  const appName=connection.appName || '[DEFAULT]';
  let app=appModule.getApps().find(a=>a.name===appName && a.options.projectId===connection.options.projectId)
    || appModule.initializeApp(connection.options,appName);
  let auth=authModule.getAuth(app);
  if(typeof auth.authStateReady==='function')await within(auth.authStateReady());
  else await within(new Promise(resolve=>{const stop=authModule.onAuthStateChanged(auth,()=>{stop();resolve();});}));
  if(auth.currentUser?.uid!==candidate.uid) {
    const session=await requestUploadAuth(modules,connection,candidate);if(!session)return null;
    ({app,auth}=session);
  }
  await within(auth.currentUser.getIdToken());
  if(auth.currentUser?.uid!==candidate.uid)throw new Error('Devriye hesabını doğrulayarak yeniden gönder.');
  return {siteID:candidate.siteID,app,auth,db:databaseModule.getDatabase(app),
    ref:databaseModule.ref,update:databaseModule.update,getStorage:storageModule.getStorage,
    sRef:storageModule.ref,uploadBytesResumable:storageModule.uploadBytesResumable,getDownloadURL:storageModule.getDownloadURL};
}
document.getElementById('offlineUploadBtn').onclick=async()=>{
  if(!unlocked || !navigator.onLine || isSyncOutboxRunning)return;
  if(pointSaving || isFinalizing || countdownInterval || qrScanner) {
    showAppModal('Doğrulama sürüyor','Nokta kaydının tamamlanmasını bekle.','hourglass_empty');return;
  }
  isSyncOutboxRunning=true;
  try {
    await refreshQueueLabel();
    const records=await window.KolartOfflineSync.queueSummary(siteID,currentUser.uid);
    if(!records.length){showAppModal('Kayıtların güncel','Gönderilmeyi bekleyen devriye kaydın bulunmuyor.','check_circle');return;}
    window.KolartOfflineSync.prepareManual(records);
    const context=await manualContext(window.KolartOffline.bundle);
    if(context)await window.KolartOfflineSync.sync(context,{userInitiated:true});
  } catch(error) {
    window.KolartOfflineSync.hideModal();
    showAppModal('Gönderim tamamlanamadı',escapeHTML(uploadError(error)),'info');
  } finally {isSyncOutboxRunning=false;await refreshQueueLabel();}
};
document.getElementById('incidentBtn').style.display='none';
window.addEventListener('online',()=>void refreshQueueLabel());
window.addEventListener('offline',()=>void refreshQueueLabel());
window.addEventListener('kolart-queue-change',()=>void refreshQueueLabel());
window.addEventListener('pagehide',()=>{
  showLockedLogin();stopPosition();void window.closeScanner();
});
window.addEventListener('pageshow',event=>{if(event.persisted)void bootLogin();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden && (unlocked || loginSubmitting)) {
    // Hatırlanan girişte şifre isteme; çalışan nokta okuyucusunu kapat.
    if(!remembered(window.KolartOffline.bundle) && !isSyncOutboxRunning)showLockedLogin();
    stopPosition();void window.closeScanner();
  } else if(!document.hidden) {
    if(!unlocked && !loginSubmitting)void bootLogin();
    else void refreshQueueLabel();
  }
});
// Dosya fonta veya başka bir CDN'e ihtiyaç duymaz.
const icons={shield:'◆',verified:'✓',touch_app:'☝',qr_code_scanner:'▣',hourglass_empty:'⌛',
  play_circle:'▶',warning:'⚠',info:'ⓘ',error:'!',security:'◆',flashlight_on:'☀',
  cancel:'✕',check_circle:'✓',wifi_off:'⌁',timer_off:'⏱',timer:'⏱',arrow_back:'←',
  report:'!',sync:'↻',close:'✕',cloud_upload:'↑',cloud_sync:'↻',cloud_off:'⌁',
  logout:'→',home:'⌂',location_on:'◎',flag:'⚑',stop_circle:'■',notifications_active:'!',
  send_and_archive:'↓',fmd_bad:'◎',campaign:'!',gpp_good:'◆',check:'✓',play_arrow:'▶',stop:'■',report_problem:'!'};
const updateIcons=()=>document.querySelectorAll('.material-symbols-outlined').forEach(span=>{
  const glyph=icons[span.textContent.trim()];if(glyph)span.textContent=glyph;
});
new MutationObserver(updateIcons).observe(document.body,{childList:true,subtree:true,characterData:true});updateIcons();
void bootLogin();
})();
