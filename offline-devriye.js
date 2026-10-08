/* KOLART offline v4 — 20261008-2050. Bu sayfa hiçbir Firebase isteği göndermez. */
(() => {
'use strict';
document.body.appendChild(document.getElementById('offlineLogin'));
let currentUser, siteID, patrolMeta, patrolId, activeRoute;
let isPhoneBroken = false, unlocked = false, pointSaving = false;
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
async function completedSnapshot(path) {
  let value = window.KolartOffline.read(path).val() || {};
  const reports = await window.KolartOfflineSync.list(siteID,currentUser.uid);
  for (const record of reports) {
    if (!record.log.okunanSayi || record.log.hedefSaat==='Belirtilmedi') continue;
    const m=record.meta;
    const prefix=`tamamlananDevriyeSaatleri/${m.shiftDate}${m.saatModu==='blok'?'/'+record.log.bolge:''}`;
    if (prefix===path) value[record.log.hedefSaat]=record.log.name || record.log.user;
  }
  return {exists:()=>Object.keys(value).length>0,val:()=>value};
}
async function refreshQueueLabel() {
  const records = currentUser ? await window.KolartOfflineSync.list(siteID,currentUser.uid) : [];
  document.getElementById('offlineUserLabel').textContent = currentUser
    ? `${currentUser.name} · Telefonda bekleyen ${records.length} devriye` : '';
  document.getElementById('offlineStateText').textContent = navigator.onLine
    ? 'Bağlantı var. Bekleyen devriyeleri göndermek için giriş ekranına dönün.'
    : 'İnternet yok. Devriyeler ve fotoğraflar bu telefona kaydedilir.';
}
function stopPosition() {
  if(countdownInterval) {clearInterval(countdownInterval);countdownInterval=null;}
  if(watchId) {navigator.geolocation.clearWatch(watchId);watchId=null;}
  document.getElementById('securityOverlay').style.display='none';
}
async function lockScreen() {
  if(pointSaving || isFinalizing) {showAppModal('LÜTFEN BEKLEYİN','Telefon kaydı tamamlanıyor.','hourglass_empty');return;}
  await window.closeScanner(); stopPosition(); unlocked=false;
  document.querySelector('.app-container').inert=true;
  document.getElementById('offlineLogin').style.display='grid';
  document.getElementById('offlinePassword').value='';
  document.getElementById('offlineLoginMessage').textContent='Devriyeye devam etmek için şifrenizi girin.';
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
  document.querySelector('.app-container').inert=true;
  const submit=document.getElementById('offlineLoginBtn'),message=document.getElementById('offlineLoginMessage');
  try {
    await window.KolartOfflineSync.open();
    const candidate=await window.KolartOffline.last();
    if(!candidate) {
      submit.disabled=true;
      message.textContent='Bu cihaz için tamamlanmış paket bulunamadı. İnternet varken index’te giriş yapın ve “Çevrimdışı paket hazır” mesajını bekleyin.';
      return;
    }
    document.getElementById('offlineUsername').value=candidate.username;
    message.textContent=`${candidate.blocks.length} bölgenin paketi hazır. Devriye için şifrenizi girin.`;
  } catch(error) {submit.disabled=true;message.textContent='Telefon hafızası açılamadı: '+error.message;}
}
document.getElementById('offlineLoginForm').onsubmit=async event=>{
  event.preventDefault();
  const button=document.getElementById('offlineLoginBtn'),message=document.getElementById('offlineLoginMessage');
  if(button.disabled)return;button.disabled=true;
  try {
    const username=document.getElementById('offlineUsername').value.trim();
    const password=document.getElementById('offlinePassword').value.trim();
    if(!username || !password)throw new Error('Kullanıcı adı ve şifre gerekli.');
    const candidate=await window.KolartOffline.load(localStorage.getItem('siteID'),username);
    if(!candidate)throw new Error('Bu kullanıcı için tamamlanmış cihaz paketi bulunamadı.');
    const attemptsKey='kolart_offline_deneme_'+candidate.id;
    let attempts;try{attempts=JSON.parse(localStorage.getItem(attemptsKey)||'{}');}catch(_){attempts={};}
    if(attempts.until>Date.now())throw new Error('Şifre denemesi için '+Math.ceil((attempts.until-Date.now())/1000)+' saniye bekleyin.');
    message.textContent='Şifre cihazda doğrulanıyor…';
    if(!await window.KolartOffline.verify(candidate,password)) {
      attempts.count=(attempts.count||0)+1;
      if(attempts.count>=5){attempts.until=Date.now()+30000;attempts.count=0;}
      try{localStorage.setItem(attemptsKey,JSON.stringify(attempts));}catch(_){}
      throw new Error('Kullanıcı adı veya şifre hatalı.');
    }
    localStorage.removeItem(attemptsKey);
    await restorePatrol(candidate);unlocked=true;
    document.querySelector('.app-container').inert=false;
    document.getElementById('offlineLogin').style.display='none';
    document.getElementById('offlinePassword').value='';
    message.textContent='';
  } catch(error){message.textContent=error.message;}
  finally {button.disabled=false;}
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
    document.getElementById('backHomeBtn').style.display = "none";
    document.getElementById('startBtn').style.display = "none";
    document.getElementById('endBtn').style.display = "block";
    document.getElementById('incidentBtn').style.display = "none"; 
    document.getElementById('statusLabel').innerText = "AKTİF DEVRİYE";
}
function uiReadyMode() {
    document.getElementById('backHomeBtn').style.display = "block";
    document.getElementById('startBtn').style.display = "block";
    document.getElementById('endBtn').style.display = "none";
    document.getElementById('incidentBtn').style.display = "none"; 
    document.getElementById('statusLabel').innerText = "HAZIR";
    document.getElementById('timerDisplay').innerText = "00:00:00";
}async function loadQRInterface() {
    // --- EKLENEN KISIM: Veri çekilmeden önce "Yükleniyor" veya "İnternet bekleniyor" mesajı ---
    const loadingContainer = document.getElementById('qrListContainer');
    if (loadingContainer) {
        loadingContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #f39c12; font-weight: bold; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                <span class="material-symbols-outlined" style="font-size: 32px; animation: spin 2s linear infinite;">hourglass_empty</span>
                <span>Veriler yükleniyor... İnternet bağlantınız yavaş lütfen bekleyiniz.</span>
            </div>
        `;
    }
    // ------------------------------------------------------------------------------------------

    try {
        document.getElementById('routeName').innerText = currentBlock.toUpperCase() + " ÇEVRESİ";
        const qrSnap = await get(ref(db, `${currentBlock}qrcodes`));
        const container = document.getElementById('qrListContainer');
        if (qrSnap.exists()) {
            container.innerHTML = ''; // Yükleniyor mesajı burada otomatik olarak temizlenir
            const points = Object.values(qrSnap.val());
            refreshStats(points.length);
            points.forEach(point => {
                const isRead = readPoints.some(rp => rp.name.trim().toLocaleLowerCase('tr-TR') === point.name.trim().toLocaleLowerCase('tr-TR'));
                const div = document.createElement('div');
                div.className = 'qr-card';
                div.innerHTML = `
                    <div class="qr-icon-side" style="${isRead ? 'background:#2ecc71' : ''}">
                        <span class="material-symbols-outlined">${isRead ? 'verified' : (isPhoneBroken ? 'touch_app' : 'qr_code_scanner')}</span>
                    </div>
                    <div class="qr-info">
                        <h3>${escapeHTML(point.name)}</h3>
                        <p class="${isRead ? 'completed' : 'waiting'}">
                            ${isRead ? 'NOKTA DOĞRULANDI' : (isPhoneBroken ? 'DOKUN VE DOĞRULA ' : 'TARAMA BEKLENİYOR...')}
                        </p>
                    </div>
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
                    Bağlantı hatası oluştu. Lütfen internetinizi kontrol edip tekrar deneyin.
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
    document.getElementById('percentText').innerText = `%${percent} TAMAMLANDI`;
    document.getElementById('counterDisplay').innerText = `${current}/${total}`;
}
function updateUIVisually(pointName) {
    const cards = document.querySelectorAll('.qr-card');
    cards.forEach(card => {
        const kartIsmi = card.querySelector('h3').innerText.trim().toLocaleLowerCase('tr-TR');
        const gelenIsim = pointName.trim().toLocaleLowerCase('tr-TR');

        if(kartIsmi === gelenIsim) {
            card.querySelector('.qr-icon-side').style.background = '#2ecc71';
            card.querySelector('.material-symbols-outlined').innerText = 'verified';
            const p = card.querySelector('.qr-info p');
            p.innerText = 'NOKTA DOĞRULANDI';
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
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.4);
    } catch (e) { return null; }
}
async function openQRScanner(targetId, pointName) {
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
                showAppModal("YANLIŞ NOKTA", `Okuttuğunuz kod bu noktaya (${pointName}) ait değil!`, "cancel");
            }
        });
    } catch (e) { showAppModal("HATA", "Kamera başlatılamadı."); }

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
    if (isFinalizing) return;
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
    const modal = document.getElementById('hourSelectModal');
    const area = document.getElementById('hourListArea');
    modal.style.display = 'flex';
    area.innerHTML = `<div style="color:#00ffcc; padding:20px; font-weight:bold; text-align:center;">DEVRİYE SAATLERİ YÜKLENİYOR...</div>`;

    // 1. TAM YÜKLENİRKEN ARKA PLANDA SESSİZCE KONTROL EDİLİYOR
    const timeResult = {date:new Date(),isApi:false};
    let d = timeResult.date;

    // EĞER API'DEN CEVAP GELDİYSE VE TELEFONUN TARİH/SAATİ YANLIŞSA ANINDA ENGELLE!
    if (timeResult.isApi) {
        const cihazTarihi = new Date();
        const cihazTarihStr = `${cihazTarihi.getFullYear()}-${cihazTarihi.getMonth()}-${cihazTarihi.getDate()}`;
        const gercekTarihStr = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

        // Tarih eşleşmiyorsa veya Saat farkı 10 dakikadan fazlaysa patlat
        const saatFarkiDk = Math.abs((cihazTarihi.getTime() - d.getTime()) / (1000 * 60));

        if (cihazTarihStr !== gercekTarihStr || saatFarkiDk > 10) {
            modal.style.display = 'none';
            showAppModal(
                "TARİH VE SAAT HATASI!", 
                "Telefonunuzun Tarih ve Saati Yanlıştır!<br><br>Lütfen telefon ayarlarından <b>'Otomatik Tarih ve Saat'</b> seçeneğini aktif edip tekrar deneyiniz.", 
                "error"
            );
            return;
        }
    }

    // Vardiya Günü Hesaplama (Gece 08:00'a kadar olanı dünkü vardiya say)
    let shiftDate = new Date(d);
    if (shiftDate.getHours() < 8) { shiftDate.setDate(shiftDate.getDate() - 1); }
    const vardiyaTarihi = `${shiftDate.getFullYear()}-${String(shiftDate.getMonth() + 1).padStart(2, '0')}-${String(shiftDate.getDate()).padStart(2, '0')}`;

    const isSunday = shiftDate.getDay() === 0;
    let tumSaatler = [];

    try {
        if (isSunday) {
            const pazarSnap = await get(ref(db, 'sistemAyarlari/pazarSaatleri'));
            if (pazarSnap.exists()) {
                tumSaatler = pazarSnap.val();
            } else {
                const planliSnap = await get(ref(db, 'sistemAyarlari/planliSaatler'));
                tumSaatler = planliSnap.exists() ? planliSnap.val() : [];
            }
        } else {
            const planliSnap = await get(ref(db, 'sistemAyarlari/planliSaatler'));
            tumSaatler = planliSnap.exists() ? planliSnap.val() : [];
        }

        const ayarSnap = await get(ref(db, 'sistemAyarlari/saatModu'));
        const saatModu = ayarSnap.exists() ? ayarSnap.val() : 'tekli';
        const tolSnap = await get(ref(db, 'sistemAyarlari/dakikaToleransi'));
        const tolerans = tolSnap.exists() ? parseInt(tolSnap.val(), 10) : 0;

        let tamamlananPath = `tamamlananDevriyeSaatleri/${vardiyaTarihi}`;

        if (saatModu === 'blok') {
            tamamlananPath += `/${currentBlock}`;
        }

        const tamamlananSnap = await completedSnapshot(tamamlananPath);
        const bitenSaatler = tamamlananSnap.exists() ? tamamlananSnap.val() : {};

        const secilebilirSaatler = tumSaatler.filter(saat => !bitenSaatler[saat]);
        secilebilirSaatler.sort((a, b) => {
            const saatA = parseInt(a.split(':')[0], 10);
            const saatB = parseInt(b.split(':')[0], 10);
            const agirlikA = saatA >= 8 ? saatA : saatA + 24;
            const agirlikB = saatB >= 8 ? saatB : saatB + 24;
            return agirlikA - agirlikB;
        });

        if (secilebilirSaatler.length > 0) {
            area.innerHTML = "";
            secilebilirSaatler.forEach(saat => {
                const btn = document.createElement('button');
                btn.style.cssText = "background:#222; color:#fff; border:1px solid #444; padding:15px; border-radius:10px; font-weight:bold; font-size:16px; width:45%; cursor:pointer; transition: 0.2s;";
                btn.innerText = saat;
                
                btn.onmouseover = () => btn.style.borderColor = "#00ffcc";
                btn.onmouseout = () => btn.style.borderColor = "#444";

                btn.onclick = () => {
                    if (!saat || typeof saat !== 'string' || !saat.includes(':')) {
                        showAppModal("SİSTEM HATASI", "Devriye saat bilgisi hatalı!", "error");
                        return;
                    }

                    // Saat hesaplamaları başlangıçta doğrulanan 'd' (veya cihaz) saati üzerinden yapılır
                    const simdi = new Date();
                    const suAnkiToplamDakika = (simdi.getHours() * 60) + simdi.getMinutes();
                    
                    const hedefParcalar = saat.split(':');
                    const hedefToplamDakika = (parseInt(hedefParcalar[0], 10) * 60) + parseInt(hedefParcalar[1], 10);
                    
                    const devriyeBitisDakikasi = hedefToplamDakika + 59 + tolerans; 

                    const bitisSaati = Math.floor((devriyeBitisDakikasi % 1440) / 60);
                    const bitisDk = devriyeBitisDakikasi % 60;
                    const formatliBitis = `${String(bitisSaati).padStart(2, '0')}:${String(bitisDk).padStart(2, '0')}`;

                    let zamanDogruMu = false;
                    if (devriyeBitisDakikasi < 1440) {
                        if (suAnkiToplamDakika >= hedefToplamDakika && suAnkiToplamDakika <= devriyeBitisDakikasi) zamanDogruMu = true;
                    } else {
                        const kalanDakika = devriyeBitisDakikasi - 1440;
                        if (suAnkiToplamDakika >= hedefToplamDakika || suAnkiToplamDakika <= kalanDakika) zamanDogruMu = true;
                    }

                    if (!zamanDogruMu) {
                        showAppModal("GEÇERSİZ ZAMAN!", `${saat} devriyesini sadece ${saat} ile ${formatliBitis} saatleri arasında başlatabilirsiniz!`, "timer_off");
                        return;
                    }

                    // Modal Onay İşlemi
                    const confirmModal = document.getElementById('confirmPatrolModal');
                    document.getElementById('confirmPatrolText').innerHTML = `<span style="color:#00ffcc; font-size:24px; text-shadow: 0 0 5px #00ffcc;">${saat}</span><br><br>Devriyesini başlatacaksınız.<br>Onaylıyor musunuz?`;
                    confirmModal.style.display = 'flex';

                    document.getElementById('btnConfirmOk').onclick = () => {
                        confirmModal.style.display = 'none';
                        secilenHedefSaat = saat;
                        modal.style.display = 'none';
                        document.getElementById('equipmentModal').style.display = 'flex';
                    };

                    document.getElementById('btnConfirmCancel').onclick = () => {
                        confirmModal.style.display = 'none';
                    };
                };
                area.appendChild(btn);
            });
        } else {
            area.innerHTML = `<div style="color:#ff3b30; padding:20px; font-weight:bold;">TÜM DEVRİYELER ATILMIŞ!</div>`;
        }
    } catch(e) {
        area.innerHTML = `<div style="color:#ff3b30; padding:20px;">PAKET VERİSİ OKUNAMADI!</div>`;
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
    timestamp:Date.now(),dateKey};
  try {
    await window.KolartOfflineSync.enqueue(log,patrolMeta);
    // IndexedDB işlemi tamamlanmadan ekran ve aktif devriye temizlenmez.
    devriyeStarted=false;isFinalizing=false;readPoints=[];startTime=null;secilenHedefSaat=null;activeRoute=null;
    uiReadyMode();await loadQRInterface();await refreshQueueLabel();
    showAppModal('✓ TELEFONA KAYDEDİLDİ','Devriyeniz ve fotoğraflarınız telefon hafızasına kaydedildi. İnternet varken giriş ekranını açtığınızda otomatik yüklenecek.','check_circle');
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
    button.style.cssText='background:#222;color:#fff;border:1px solid #444;padding:18px;border-radius:16px;font-weight:bold';
    button.onclick=async()=>{currentBlock=block;secilenHedefSaat=null;document.getElementById('blockSelectModal').style.display='none';await loadQRInterface();};
    area.appendChild(button);
  }
  document.getElementById('blockSelectModal').style.display='flex';
};
const toIndex=()=>{
  if(devriyeStarted){showAppModal('AKTİF DEVRİYE','Önce devriyenizi bitirip telefona kaydedin.','warning');return;}
  if(!navigator.onLine){showAppModal('İNTERNET BAĞLANTISI YOK','Devriyeler telefonda korunuyor. İnternet gelince bu düğmeden giriş ekranını açın.','wifi_off');return;}
  location.href=new URL('index.html',window.KolartOffline.base).href;
};
document.getElementById('offlineUploadBtn').onclick=toIndex;
document.getElementById('offlineLoginOnline').onclick=()=>{location.href=new URL('index.html',window.KolartOffline.base).href;};
document.getElementById('backHomeBtn').onclick=toIndex;
document.getElementById('offlineLockBtn').onclick=()=>void lockScreen();
document.getElementById('incidentBtn').style.display='none';
window.addEventListener('online',()=>void refreshQueueLabel());
window.addEventListener('offline',()=>void refreshQueueLabel());
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
