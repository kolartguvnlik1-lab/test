/* KOLART offline v4 — kullanıcı sürümü eşleşiyorsa mevcut paket kullanılır. */
(() => {
  'use strict';

  const BUILD = '20261008-2050';

  // BUILD uyumluluğu korunur; yönetici parolası eklenen dosyaların önbelleği yenilenir.
  const REVISION = '20261009-0030';
  const PREVIOUS_REVISION = '20261008-2311';
  const UI_REVISION = '20261009-elit-1';

  const base = new URL('./', document.currentScript.src);
  const POINTER = 'kolart_offline_son_kullanici';
  const FLAG_PREFIX = 'kolart_offlineversiyon|';

  let bundle = null, registration, preparing;

  const copy = value => structuredClone(value);

  const snapshot = value => ({
    exists: () => value !== null && value !== undefined,
    val: () => copy(value ?? null)
  });

  const validPart = value =>
    typeof value === 'string' &&
    value.length > 0 &&
    !/[.#$\[\]\/\u0000-\u001f]/.test(value);

  const normalize = value =>
    String(value || '').trim().toLocaleUpperCase('tr-TR');

  function shiftKey(date = new Date()) {
    const d = new Date(date);

    if (d.getHours() < 8) d.setDate(d.getDate() - 1);

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function within(promise, milliseconds, message) {
    let timer;

    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(message)),
            milliseconds
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function worker() {
    if (
      !('serviceWorker' in navigator) ||
      !window.isSecureContext ||
      !('caches' in window)
    ) {
      throw new Error(
        'Çevrimdışı hazırlık için HTTPS ve desteklenen bir tarayıcı gerekli.'
      );
    }

    if (!registration) {
      registration = navigator.serviceWorker.register(
        new URL('sw.js', base),
        {
          scope: base.pathname,
          updateViaCache: 'none'
        }
      ).catch(e => {
        registration = null;
        throw e;
      });
    }

    const reg = await within(
      registration,
      20000,
      'Çevrimdışı servis kaydedilemedi.'
    );

    await within(
      reg.update(),
      20000,
      'Çevrimdışı servis güncellenemedi.'
    );

    const candidate = reg.installing || reg.waiting;

    if (candidate && candidate.state !== 'activated') {
      await within(
        new Promise((resolve, reject) => {
          const check = () => {
            if (candidate.state === 'activated') {
              candidate.removeEventListener('statechange', check);
              resolve();
            }

            if (candidate.state === 'redundant') {
              candidate.removeEventListener('statechange', check);
              reject(new Error('sw.js etkinleştirilemedi.'));
            }
          };

          candidate.addEventListener('statechange', check);
          check();
        }),
        25000,
        'Çevrimdışı servis etkinleşmedi.'
      );
    }

    const active = reg.active;

    if (!active) {
      throw new Error('Çevrimdışı servis henüz hazır değil.');
    }

    return active;
  }

  async function controlled() {
    if (!navigator.serviceWorker.controller) {
      await within(
        new Promise(resolve => {
          const onChange = () => {
            navigator.serviceWorker.removeEventListener(
              'controllerchange',
              onChange
            );

            resolve();
          };

          navigator.serviceWorker.addEventListener(
            'controllerchange',
            onChange
          );

          if (navigator.serviceWorker.controller) onChange();
        }),
        10000,
        'Çevrimdışı servis bu sayfayı kontrol etmiyor. Sayfayı yenileyip giriş yapın.'
      );
    }
  }

  async function shell(progress) {
    const target = await worker();
    const channel = new MessageChannel();

    try {
      const result = await within(
        new Promise((resolve, reject) => {
          channel.port1.onmessage = e => {
            const m = e.data;

            if (m.progress) {
              progress(
                60,
                'Sayfa ve QR kamera dosyaları telefona indiriliyor…'
              );

              return;
            }

            if (!m.ok) {
              reject(new Error(m.message));
              return;
            }

            if (m.build !== BUILD || m.revision !== REVISION) {
              reject(
                new Error(
                  'sw.js sürümü eski. Güncellenen dosyaları birlikte yükleyin.'
                )
              );

              return;
            }

            resolve(m);
          };

          target.postMessage(
            {
              type: 'KOLART_SHELL_PREPARE',
              refresh: true
            },
            [channel.port2]
          );
        }),
        60000,
        'Sayfa dosyaları indirilemedi. Dosyaları ve bağlantıyı kontrol edin.'
      );

      await controlled();

      return result;
    } finally {
      channel.port1.close();
    }
  }

  function hex(bytes) {
    return Array.from(
      new Uint8Array(bytes),
      b => b.toString(16).padStart(2, '0')
    ).join('');
  }

  async function digest(password, salt, iterations) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const bytes = Uint8Array.from(
      salt.match(/../g),
      h => parseInt(h, 16)
    );

    return hex(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-256',
          salt: bytes,
          iterations
        },
        key,
        256
      )
    );
  }

  async function verifier(password) {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const iterations = 210000;

    return {
      algorithm: 'PBKDF2-SHA256',
      salt,
      iterations,
      hash: await digest(password, salt, iterations)
    };
  }

  function validVerifier(v) {
    return !!(
      v &&
      v.algorithm === 'PBKDF2-SHA256' &&
      /^[0-9a-f]{32}$/.test(v.salt) &&
      /^[0-9a-f]{64}$/.test(v.hash) &&
      Number.isInteger(v.iterations) &&
      v.iterations >= 100000 && v.iterations <= 600000
    );
  }

  async function verify(candidate, password) {
    const v = candidate?.verifier;
    if (!validVerifier(v)) return false;

    const value = await digest(
      String(password).trim(),
      v.salt,
      v.iterations
    );

    let difference = value.length ^ v.hash.length;

    for (let i = 0; i < value.length; i++) {
      difference |= value.charCodeAt(i) ^ v.hash.charCodeAt(i);
    }

    return difference === 0;
  }

  function managerPassword(value) {
    // Firebase sayısı baştaki sıfırı saklamaz; 458 değeri 0458 olarak kullanılır.
    const password = typeof value === 'number' &&
      Number.isInteger(value) && value >= 0 && value <= 9999
      ? String(value).padStart(4, '0')
      : (typeof value === 'string' ? value.trim() : '');

    if (!/^\d{4}$/.test(password)) {
      throw new Error(
        '/offline4hane kaydı 4 rakamdan oluşan bir yönetici parolası olmalı.'
      );
    }

    return password;
  }

  const hasManagerPassword = candidate =>
    validVerifier(candidate?.managerVerifier);

  function requiresManagerPassword(candidate) {
    if (!hasManagerPassword(candidate)) return true;
    const approved = candidate.managerApproval;

    return !(
      approved &&
      approved.siteID === candidate.siteID &&
      approved.uid === candidate.uid &&
      approved.packageID === candidate.id &&
      approved.packageCreatedAt === candidate.createdAt &&
      approved.version === candidate.version &&
      approved.verifierHash === candidate.managerVerifier.hash &&
      Number.isFinite(approved.approvedAt) && approved.approvedAt > 0
    );
  }

  async function verifyManagerPassword(candidate, password) {
    const value = String(password ?? '').trim();
    return /^\d{4}$/.test(value) && hasManagerPassword(candidate) &&
      await verify({ verifier: candidate.managerVerifier }, value);
  }

  async function approveManagerPassword(candidate, password) {
    if (!await verifyManagerPassword(candidate, password)) return false;

    // Başka bir girişte yeni paket yüklenmişse eski paketi üzerine yazma.
    const packages = await window.KolartOfflineSync.packages(candidate.siteID);
    const current = packages.find(p => p.id === candidate.id);
    if (
      !current || current.version !== candidate.version ||
      current.createdAt !== candidate.createdAt ||
      current.managerVerifier?.hash !== candidate.managerVerifier.hash
    ) {
      throw new Error('Paket sürümü değişti. Giriş ekranını yeniden açın.');
    }

    const approved = copy(current);
    approved.managerApproval = {
      siteID: approved.siteID,
      uid: approved.uid,
      packageID: approved.id,
      packageCreatedAt: approved.createdAt,
      version: approved.version,
      verifierHash: approved.managerVerifier.hash,
      approvedAt: Date.now()
    };

    // Onay, telefon kaydı tamamlandıktan sonra geçerli sayılır.
    await window.KolartOfflineSync.putPackage(approved);
    candidate.managerApproval = copy(approved.managerApproval);
    bundle = approved;
    return true;
  }

  async function intact(candidate, allowPreviousRevision = false) {
    if (
      !candidate?.complete ||
      candidate.schema !== 4 ||
      candidate.build !== BUILD ||
      (candidate.revision !== REVISION &&
        !(allowPreviousRevision && candidate.revision === PREVIOUS_REVISION)) ||
      !candidate.verifier ||
      !candidate.blocks?.length
    ) {
      return false;
    }

    if (!allowPreviousRevision && !hasManagerPassword(candidate)) return false;

    if (
      !Array.isArray(candidate.requiredAssets) ||
      !candidate.requiredAssets.includes('index.html')
    ) {
      return false;
    }

    if (!await caches.has(candidate.assetCache)) return false;

    const cache = await caches.open(candidate.assetCache);

    for (const file of candidate.requiredAssets) {
      if (!await cache.match(new URL(file, base).href)) {
        return false;
      }
    }

    return true;
  }

  async function load(siteID, username, { allowPreviousRevision = false } = {}) {
    bundle = null;

    const packages = await window.KolartOfflineSync.packages(siteID);

    const candidate = packages
      .filter(p => normalize(p.username) === normalize(username))
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!await intact(candidate, allowPreviousRevision)) return null;

    bundle = candidate;

    return bundle;
  }

  async function last() {
    const siteID = localStorage.getItem('siteID');

    let pointer;

    try {
      pointer = JSON.parse(
        localStorage.getItem(POINTER) || 'null'
      );
    } catch (_) {
      return null;
    }

    if (!pointer || pointer.siteID !== siteID) return null;

    const candidate = await load(siteID, pointer.username);

    return candidate && (
      !pointer.uid ||
      candidate.uid === pointer.uid
    ) ? candidate : null;
  }

  async function readServer(c, path) {
    try {
      const snap = await within(
        c.get(c.ref(c.db, path)),
        25000,
        path + ' okuması zaman aşımına uğradı.'
      );

      return copy(snap.val() ?? null);
    } catch (e) {
      throw new Error(
        'Paket verisi okunamadı: /' +
        path +
        ' (' +
        (e.code || e.message) +
        ').'
      );
    }
  }

  async function readVersion(c, username) {
    // SDK get() bağlantı hatasında oturum önbelleğine dönebilir.
    // Sürümü doğrudan sunucudan al.
    const path = 'offlineversiyon/' + username;
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      25000
    );

    try {
      const token = await within(
        c.auth.currentUser.getIdToken(),
        20000,
        'Giriş oturumu doğrulanamadı.'
      );

      const url = new URL(
        c.ref(c.db, path).toString() + '.json'
      );

      url.searchParams.set('auth', token);

      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? 'Okuma izni reddedildi'
            : 'HTTP ' + response.status
        );
      }

      return version(await response.json());
    } catch (e) {
      throw new Error(
        '/' +
        path +
        ' sürümü Firebase sunucusundan okunamadı (' +
        e.message +
        ').'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function version(value) {
    if (value === null || value === undefined) return null;

    if (
      typeof value !== 'string' ||
      !/^v[1-9]\d*$/.test(value.trim())
    ) {
      throw new Error(
        'Firebase offlineversiyon kaydı v1, v2, v3 gibi bir metin olmalı.'
      );
    }

    const result = value.trim();

    if (!Number.isSafeInteger(Number(result.slice(1)))) {
      throw new Error('Offline sürüm numarası çok büyük.');
    }

    return result;
  }

  function nextVersion(value) {
    const number = Number(value.slice(1)) + 1;

    if (!Number.isSafeInteger(number)) {
      throw new Error('Offline sürüm numarası artırılamadı.');
    }

    return 'v' + number;
  }

  function flagKey(siteID, username) {
    return FLAG_PREFIX +
      encodeURIComponent(siteID) +
      '|' +
      encodeURIComponent(normalize(username));
  }

  function readFlag(siteID, username) {
    try {
      return JSON.parse(
        localStorage.getItem(flagKey(siteID, username)) || 'null'
      );
    } catch (_) {
      return null;
    }
  }

  function remember(candidate) {
    const flag = {
      siteID: candidate.siteID,
      username: candidate.username,
      uid: candidate.uid,
      version: candidate.version,
      packageID: candidate.id,
      downloadedAt: candidate.createdAt
    };

    localStorage.setItem(
      flagKey(candidate.siteID, candidate.username),
      JSON.stringify(flag)
    );

    localStorage.setItem(
      POINTER,
      JSON.stringify({
        siteID: candidate.siteID,
        username: candidate.username,
        uid: candidate.uid
      })
    );
  }

  function sameSession(c, uid) {
    if (
      !navigator.onLine ||
      c.auth.currentUser?.uid !== uid
    ) {
      throw new Error(
        'Hazırlık sırasında bağlantı veya oturum değişti. Yeniden giriş yapın.'
      );
    }
  }

  async function commitVersion(c, candidate) {
    sameSession(c, candidate.uid);

    const path = 'offlineversiyon/' + candidate.username;

    try {
      const result = await within(
        c.runTransaction(
          c.ref(c.db, path),
          current => {
            const currentVersion = version(current);

            if (currentVersion === candidate.version) {
              return current;
            }

            // İşlem ilk kez yerel boş değerle çağrılabilir.
            // Sunucu uyuşmazlığı tekrar denetletir.
            if (
              currentVersion === candidate.versionBase ||
              currentVersion === null
            ) {
              return candidate.version;
            }

            // Yönetici indirme sırasında sürümü değiştirmişse üzerine yazma.
            return undefined;
          },
          {
            applyLocally: false
          }
        ),
        45000,
        'Firebase sürüm kaydı onaylanmadı. Bağlantıyı kontrol edip tekrar deneyin.'
      );

      if (
        !result.committed ||
        version(result.snapshot.val()) !== candidate.version
      ) {
        throw new Error(
          'Sürüm indirme sırasında değişti. Yeni sürümü almak için tekrar deneyin.'
        );
      }
    } catch (e) {
      throw new Error(
        '/' +
        path +
        ' sürüm kaydı tamamlanamadı (' +
        (e.code || e.message) +
        '). Bu yolda güvenliğin kendi kaydını okuma/yazma izni olmalı.'
      );
    }

    sameSession(c, candidate.uid);

    // Bayrak ancak tüm dosyalar kaydedilip
    // Firebase yazımı onaylandıktan sonra dikilir.
    remember(candidate);

    candidate.versionPending = false;

    await window.KolartOfflineSync.putPackage(candidate);

    bundle = candidate;

    if (navigator.storage?.persist) {
      await navigator.storage.persist().catch(() => false);
    }

    window.dispatchEvent(
      new CustomEvent('kolart-package-ready', {
        detail: {
          siteID: c.siteID,
          username: candidate.username,
          uid: candidate.uid,
          version: candidate.version
        }
      })
    );

    return candidate;
  }

  function connectionFor(c,authUser) {
    // Yalnız herkese açık web uygulaması seçenekleri; parola/token kaydedilmez.
    const app=c.app || c.auth.app, options={};
    for(const key of ['apiKey','authDomain','databaseURL','projectId','storageBucket','messagingSenderId','appId','measurementId'])
      if(typeof app?.options?.[key]==='string')options[key]=app.options[key];
    const scripts=[...document.scripts].map(s=>s.src+' '+s.textContent).join('\n');
    const sdkVersion=scripts.match(/gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\//)?.[1] || '10.12.2';
    return {options,appName:app?.name || '[DEFAULT]',email:authUser.email || null,sdkVersion};
  }

  async function prepare(c, progress = () => {}) {
    if (!navigator.onLine) {
      throw new Error(
        'Paket hazırlanırken internet bağlantısı gerekli.'
      );
    }

    const authUser = c.auth.currentUser;
    const username = normalize(c.username);

    if (!authUser || !validPart(username) || !c.siteID) {
      throw new Error('Başarılı güvenlik girişi gerekli.');
    }

    if (!c.password) {
      throw new Error(
        'Offline şifre doğrulaması için giriş şifresi gerekli.'
      );
    }

    if (typeof c.runTransaction !== 'function') {
      throw new Error(
        'index.html sürümü eski. Güncellenen dosyaları birlikte yükleyin.'
      );
    }

    const profile = await readServer(
      c,
      'users/' + username
    );

    if (
      !profile ||
      profile.type !== 'security' ||
      profile.isActive === false
    ) {
      throw new Error(
        'Offline devriye için etkin güvenlik hesabı gerekli.'
      );
    }

    if (profile.uid && profile.uid !== authUser.uid) {
      throw new Error(
        'Kullanıcı UID kaydı ile giriş UID’si eşleşmiyor.'
      );
    }

    // Parola, Auth token ve diğer kişilerin kullanıcı kayıtları pakete girmez.
    const user = {
      username,
      uid: authUser.uid,
      name: profile.name || username,
      type: profile.type,
      isActive: true
    };

    const remoteVersion = await readVersion(c, username);
    // Eski paket sadece çevrimiçi yükseltmede okunur; offline giriş onaysız açılmaz.
    const candidate = await load(c.siteID, username, { allowPreviousRevision: true });
    const local = candidate?.uid === authUser.uid ? candidate : null;
    const connection=connectionFor(c,authUser);
    if(local) {
      local.connection=connection;
      // Aynı veri sürümünü koruyarak güncel ekran dosyalarını bir kez yenile.
      if(local.revision===REVISION && hasManagerPassword(local) && local.uiRevision!==UI_REVISION) {
        progress(5,'Devriye ekranları güncelleniyor…');
        const assets=await shell(progress);
        local.assetCache=assets.cacheName;local.requiredAssets=assets.files;local.uiRevision=UI_REVISION;
      }
      sameSession(c,authUser.uid);
      await window.KolartOfflineSync.putPackage(local);
    }
    const flag = readFlag(c.siteID, username);

    const hasLocalFlag = !!(
      local &&
      flag &&
      flag.siteID === c.siteID &&
      flag.username === username &&
      flag.uid === authUser.uid &&
      flag.packageID === local.id &&
      flag.version === local.version
    );

    // Bu ekleme için mevcut v1/v2 bayrağını ve devriye verilerini koru.
    // Aynı sürümde yalnız yeni yönetici parolası ve güncel sayfa dosyaları eklenir.
    if (
      local && (local.revision !== REVISION || !hasManagerPassword(local)) &&
      (
        (local.versionPending &&
          (remoteVersion === local.version || remoteVersion === local.versionBase)) ||
        (hasLocalFlag && !local.versionPending && remoteVersion === local.version)
      )
    ) {
      progress(10, local.version + ' paketine yönetici parolası ekleniyor…');
      const pin = managerPassword(await readServer(c, 'offline4hane'));
      const managerVerifier = await verifier(pin);
      const assets = await shell(progress);
      const upgraded = {
        ...copy(local),
        revision: REVISION,
        uiRevision: UI_REVISION,
        connection,
        managerVerifier,
        managerApproval: null,
        assetCache: assets.cacheName,
        requiredAssets: assets.files
      };

      if (!await verify(upgraded, c.password)) {
        upgraded.verifier = await verifier(String(c.password).trim());
      }

      sameSession(c, authUser.uid);
      await window.KolartOfflineSync.putPackage(upgraded);
      if (!await intact(upgraded)) {
        throw new Error('Güncellenen paket telefon hafızasında doğrulanamadı.');
      }

      if (upgraded.versionPending) await commitVersion(c, upgraded);
      else {
        remember(upgraded);
        bundle = upgraded;
      }

      progress(100, upgraded.version + ' paketi hazır. Yönetici parolası eklendi.');
      return upgraded;
    }

    // Kesintiye uğramış Firebase onayını aynı indirilmiş paketle sürdür.
    // Tekrar indirme veya sürüm artırma.
    if (
      local?.versionPending &&
      (
        remoteVersion === local.version ||
        remoteVersion === local.versionBase
      )
    ) {
      progress(
        90,
        local.version + ' paketi telefonda hazır; sürüm kaydı onaylanıyor…'
      );

      if (!await verify(local, c.password)) {
        local.verifier = await verifier(
          String(c.password).trim()
        );
      }

      const result = await commitVersion(c, local);

      progress(
        100,
        result.version + ' paketi hazır.'
      );

      return result;
    }

    if (
      hasLocalFlag &&
      !local.versionPending &&
      remoteVersion === local.version
    ) {
      sameSession(c, authUser.uid);

      // Auth şifresi değişmişse yalnız cihazdaki doğrulayıcı yenilenir.
      // Paket indirilmez.
      if (!await verify(local, c.password)) {
        local.verifier = await verifier(
          String(c.password).trim()
        );

        await window.KolartOfflineSync.putPackage(local);
      }

      sameSession(c, authUser.uid);

      remember(local);
      bundle = local;

      return local;
    }

    // İlk indirme v1.
    // Paket/bayrak kayıpsa mevcut sunucu sürümü bir artırılır.
    // Sağlam yerel paket v1 ve sunucu v2 ise doğrudan v2 indirilir.
    const targetVersion = remoteVersion === null
      ? 'v1'
      : (
          hasLocalFlag || local?.versionPending
            ? remoteVersion
            : nextVersion(remoteVersion)
        );

    progress(
      5,
      !remoteVersion
        ? 'İlk offline paket hazırlanıyor: v1'
        : (
            targetVersion === remoteVersion
              ? 'Yeni offline sürüm indiriliyor: ' + targetVersion
              : 'Telefondaki paket/bayrak eksik. Yeniden hazırlanıyor: ' + targetVersion
          )
    );

    progress(
      15,
      'Bölgeler, nöbet ve devriye ayarları indiriliyor…'
    );

    const paths = [
      'offline4hane',
      'noktaListe',
      'nobetRecords',
      'activeDevriye/' + username,
      'telefon/' + username,
      'sistemAyarlari/saatModu',
      'sistemAyarlari/pazarSaatleri',
      'sistemAyarlari/planliSaatler',
      'sistemAyarlari/dakikaToleransi',
      'tamamlananDevriyeSaatleri/' + shiftKey()
    ];

    const values = await Promise.allSettled(
      paths.map(async path => [
        path,
        await readServer(c, path)
      ])
    );

    const failure = values.find(
      r => r.status === 'rejected'
    );

    if (failure) throw failure.reason;

    const data = Object.fromEntries(
      values.map(r => r.value)
    );

    const pin = managerPassword(data.offline4hane);
    // Parolaların açık metni yerine cihazda doğrulanabilen özetleri saklanır.
    delete data.offline4hane;

    data['users/' + username] = user;

    data.nobetRecords = Object.fromEntries(
      Object.entries(data.nobetRecords || {}).filter(([, r]) =>
        r &&
        (
          r.startBy === username ||
          r.startBy === user.name
        )
      )
    );

    const activeDuty = Object.values(
      data.nobetRecords
    ).find(r => r.status === 'started');

    const initialBlock = String(
      activeDuty?.startPoint || 'BÖLGE'
    ).trim();

    const regionList = Object.keys(
      data.noktaListe || {}
    ).filter(b => data.noktaListe[b] === true);

    if (!regionList.length) regionList.push(initialBlock);

    if (
      activeDuty &&
      !regionList.includes(initialBlock)
    ) {
      regionList.push(initialBlock);
    }

    for (const b of regionList) {
      if (!validPart(b)) {
        throw new Error(
          'Bölge adı Firebase yoluna uygun değil: ' + b
        );
      }
    }

    progress(
      30,
      `${regionList.length} bölgenin tüm QR noktaları indiriliyor…`
    );

    const qrResults = await Promise.allSettled(
      regionList.map(async b => [
        b,
        await readServer(c, b + 'qrcodes')
      ])
    );

    const qrFailure = qrResults.find(
      r => r.status === 'rejected'
    );

    if (qrFailure) throw qrFailure.reason;

    const blocks = [];

    for (const result of qrResults) {
      const [b, points] = result.value;

      if (!points || !Object.keys(points).length) continue;

      for (const point of Object.values(points)) {
        if (
          !point ||
          typeof point.name !== 'string' ||
          !point.name.trim() ||
          point.qrId === undefined ||
          point.qrId === null
        ) {
          throw new Error(
            b + ' bölgesinde QR noktası adı veya qrId eksik.'
          );
        }
      }

      blocks.push(b);
      data[b + 'qrcodes'] = points;
    }

    if (!blocks.length) {
      throw new Error(
        'Paketlenecek bölgelerde QR noktası bulunamadı.'
      );
    }

    // Bölge seçimi sadece başarıyla indirilmiş listedeki bölgelerden yapılır.
    data.noktaListe = Object.fromEntries(
      blocks.map(b => [b, true])
    );

    data['settings/allowPointChange'] = true;

    const hours = data['sistemAyarlari/planliSaatler'];

    if (
      !Array.isArray(hours) ||
      !hours.length ||
      hours.some(h => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))
    ) {
      throw new Error(
        '/sistemAyarlari/planliSaatler geçerli bir saat listesi içermiyor.'
      );
    }

    const sunday = data['sistemAyarlari/pazarSaatleri'];

    if (
      sunday !== null &&
      (
        !Array.isArray(sunday) ||
        sunday.some(h => !/^([01]\d|2[0-3]):[0-5]\d$/.test(h))
      )
    ) {
      throw new Error(
        '/sistemAyarlari/pazarSaatleri geçerli bir saat listesi değil.'
      );
    }

    progress(
      50,
      'Çevrimdışı giriş hazırlanıyor…'
    );

    const passwordVerifier = await verifier(
      String(c.password).trim()
    );
    const managerVerifier = await verifier(pin);

    const assets = await shell(progress);

    progress(
      85,
      'Paket telefon hafızasına kaydediliyor…'
    );

    sameSession(c, authUser.uid);

    const result = {
      id: c.siteID + '|' + authUser.uid,
      schema: 4,
      build: BUILD,
      revision: REVISION,
      uiRevision: UI_REVISION,
      connection,
      complete: true,
      version: targetVersion,
      versionBase: remoteVersion,
      versionPending: true,
      siteID: c.siteID,
      username,
      uid: authUser.uid,
      user,
      blocks,
      block: blocks.includes(initialBlock)
        ? initialBlock
        : blocks[0],
      data,
      verifier: passwordVerifier,
      managerVerifier,
      managerApproval: null,
      createdAt: Date.now(),
      capturedShift: shiftKey(),
      assetCache: assets.cacheName,
      requiredAssets: assets.files
    };

    await window.KolartOfflineSync.putPackage(result);

    if (!await intact(result)) {
      throw new Error(
        'Telefon hafızasında paket dosyaları doğrulanamadı.'
      );
    }

    progress(
      95,
      targetVersion + ' sürümü Firebase ve telefon hafızasında eşleştiriliyor…'
    );

    await commitVersion(c, result);

    progress(
      100,
      `${targetVersion} · ${blocks.length} bölge · ${blocks.reduce((n, b) => n + Object.keys(data[b + 'qrcodes']).length, 0)} QR noktası telefona kaydedildi.`
    );

    return result;
  }

  let dialog, view;

  function modal() {
    if (view) return view;

    const style = document.createElement('style');

    style.textContent = '#kolartPackModal{position:fixed;inset:0;z-index:2147483645;display:none;place-items:center;background:#030913e8;padding:20px;font-family:Arial,sans-serif;color:#f4f8ff;box-sizing:border-box}#kolartPackModal .kp-card{width:min(100%,420px);background:#102034;border:1px solid #294361;border-radius:26px;padding:27px;box-sizing:border-box}#kolartPackModal h2{font-size:23px;line-height:1.25;margin:15px 0}#kolartPackModal p{font-size:13px;line-height:1.7;color:#bed0e5;overflow-wrap:anywhere}#kolartPackModal .kp-track{height:10px;border-radius:10px;background:#283b53;overflow:hidden}#kp-bar{height:100%;width:0;background:linear-gradient(90deg,#4ba6ff,#6be3bd);transition:width .25s}#kolartPackModal button{background:#62b4ff;color:#052039;border:0;border-radius:12px;font-weight:bold;padding:13px;margin:14px 5px 0 0;cursor:pointer}#kolartPackModal button[hidden]{display:none}';

    document.head.appendChild(style);

    dialog = document.createElement('div');
    dialog.id = 'kolartPackModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = '<div class="kp-card"><small>KOLART · TELEFON HAZIRLIĞI</small><h2 id="kp-title">Çevrimdışı paket hazırlanıyor</h2><p id="kp-text">İnternet olmadan devriye atmanız için gerekli bilgiler indiriliyor. Tamamlanana kadar bu ekranı açık tutun.</p><div class="kp-track" id="kp-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="kp-bar"></div></div><p id="kp-step"></p><button id="kp-retry" hidden>Tekrar dene</button><button id="kp-close" hidden>Giriş ekranına dön</button></div>';

    document.body.appendChild(dialog);

    view = Object.fromEntries(
      ['title', 'text', 'track', 'bar', 'step', 'retry', 'close']
        .map(k => [k, document.getElementById('kp-' + k)])
    );

    return view;
  }

  async function start(c) {
    if (preparing) return preparing;

    preparing = (async () => {
      let v;

      const show = () => {
        if (!v) v = modal();

        if (dialog.style.display !== 'grid') {
          dialog.style.display = 'grid';

          v.title.textContent = 'Çevrimdışı paket hazırlanıyor';

          v.text.textContent =
            'Devriye verileri, bölgeler ve kamera dosyaları telefona indiriliyor. Tamamlanana kadar bu ekranı açık tutun.';

          v.retry.hidden = true;
          v.close.hidden = true;
        }

        return v;
      };

      for (;;) {
        if (v) {
          v.title.textContent = 'Çevrimdışı paket hazırlanıyor';
          v.retry.hidden = true;
          v.close.hidden = true;
        }

        try {
          const result = await prepare(c, (p, step) => {
            show();

            v.bar.style.width = p + '%';
            v.track.setAttribute('aria-valuenow', p);
            v.step.textContent = '%' + p + ' · ' + step;
          });

          if (v) {
            v.title.textContent =
              '✓ Çevrimdışı paket hazır · ' + result.version;

            v.text.textContent =
              'Paket ve sürüm bayrağı kaydedildi. Giriş ekranındaki Offline Mod butonuyla devriyeye geçebilirsiniz.';

            await new Promise(resolve => setTimeout(resolve, 900));

            dialog.style.display = 'none';
          }

          return result;
        } catch (error) {
          show();

          v.title.textContent = 'Paket tamamlanamadı';
          v.text.textContent = error.message;

          v.step.textContent =
            'Hazır sayılmadı. Önceki kayıtlarınız korunuyor.';

          v.retry.hidden = false;
          v.close.hidden = false;

          const retry = await new Promise(resolve => {
            v.retry.onclick = () => resolve(true);
            v.close.onclick = () => resolve(false);
          });

          if (!retry) {
            dialog.style.display = 'none';
            return null;
          }
        }
      }
    })().finally(() => {
      preparing = null;
    });

    return preparing;
  }

  function valueAt(path) {
    if (!bundle) {
      throw new Error('Önce cihazdaki paket yüklenmeli.');
    }

    if (Object.hasOwn(bundle.data, path)) {
      return copy(bundle.data[path]);
    }

    const parent = Object.keys(bundle.data)
      .filter(p => path.startsWith(p + '/'))
      .sort((a, b) => b.length - a.length)[0];

    if (parent) {
      return copy(
        path
          .slice(parent.length + 1)
          .split('/')
          .reduce((n, k) => n?.[k], bundle.data[parent]) ?? null
      );
    }

    if (path.startsWith('tamamlananDevriyeSaatleri/')) {
      return null;
    }

    throw new Error('Pakette bulunmayan veri: /' + path);
  }

  window.KolartOffline = {
    BUILD,
    REVISION,
    base,
    start,
    prepare,
    load,
    last,
    verify,
    requiresManagerPassword,
    verifyManagerPassword,
    approveManagerPassword,
    intact,
    shiftKey,

    get bundle() {
      return bundle;
    },

    read(path) {
      return snapshot(valueAt(path));
    }
  };

  // Index internet yokken de açık kalır.
  // Devriyeye yalnız Offline Mod bağlantısı götürür.
})();
