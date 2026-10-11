/* KOLART / CGA — mevcut PWA + çevrimdışı devriye, birleşik SW. */
'use strict';

// SW değiştiğinde VERSION değerini artırın.
// Diğer üç değer offline dosyalarla eşleşir.
const VERSION = 'v126';
const BUILD = '20261008-2050';
const REVISION = '20261009-0030';
const UI_REVISION = '20261009-elit-1';

const BASE = new URL('./', self.location.href);
const SCOPE = encodeURIComponent(BASE.pathname);

const CACHE_NAME = 'cga-pwa-' + VERSION + '-' + SCOPE;

const SHELL =
  'kolart-offline-shell-v6-' +
  VERSION + '-' +
  BUILD + '-' +
  REVISION + '-' +
  UI_REVISION + '-' +
  SCOPE;

const MARKER = new URL('__kolart_shell_v4', BASE).href;
const INDEX_URL = new URL('index.html', BASE).href;

// Baştaki / kaldırıldı:
// Alan adı kökünde ve GitHub /proje/ klasöründe çalışır.
const CORE_FILES = [
  'index.html',
  'ara.html',
  'bildirimgor.html',
  'guvenlik.html',
  'kargog.html',
  'amir.html',
  'kayit.html',
  'cizelge.html',
  'devriye.html',
  'gecmis.html',
  'mesai.html',
  'nobet.html',
  'olay.html',
  'olaylar.html',
  'takip.html',
  'tamam.html',
  'tumkayit.html',
  'mesajj.html',
  'egitim.html',

  'manifest.json',
  'CNAME',
  'logo.png',
  'main.js',
  'nav.js',

  'icon-180.png',
  'icon-192.png',
  'icon-512.png',

  'apple-icon.png',
  'apple-icon-57x57.png',
  'apple-icon-60x60.png',
  'apple-icon-72x72.png',
  'apple-icon-76x76.png',
  'apple-icon-114x114.png',
  'apple-icon-120x120.png',
  'apple-icon-144x144.png',
  'apple-icon-152x152.png',
  'apple-icon-180x180.png',
  'apple-icon-precomposed.png',

  'android-icon-36x36.png',
  'android-icon-48x48.png',
  'android-icon-72x72.png',
  'android-icon-96x96.png',
  'android-icon-144x144.png',
  'android-icon-192x192.png',

  'ms-icon-70x70.png',
  'ms-icon-144x144.png',
  'ms-icon-150x150.png',
  'ms-icon-310x310.png',

  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-96x96.png',
  'favicon.ico'
];

// Offline devriye için zorunlu yerel dosyalar.
const FILES = [
  'index.html',
  'offline-devriye.html',
  'offline-paket.js',
  'offline-sync.js',
  'vendor/html5-qrcode.min.js'
];

const SHELL_FILES = new Set([
  ...FILES,
  'offline-devriye.js'
]);

const STATIC_EXT =
  /\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot)$/i;

const ENTRY_FILES = new Set([
  '',
  'index.html',
  'guvenlik.html',
  'devriye.html',
  'offline-index.html'
]);

let preparing = null;
let lastProgress = null;

const progressListeners = new Set();

function fileURL(file) {
  return new URL(file, BASE).href;
}

function relativeFile(url) {
  return (
    url.origin === BASE.origin &&
    url.pathname.startsWith(BASE.pathname)
  )
    ? url.pathname.slice(BASE.pathname.length)
    : null;
}

function liveRequest(url) {
  // Firebase verisi, Auth, Storage ve uygulama API'leri
  // tarayıcı önbelleğine alınmaz.
  return (
    /(?:^|\.)(?:firebaseio\.com|firebasedatabase\.app)$/.test(
      url.hostname
    ) ||
    /^(?:firestore|firebasestorage|identitytoolkit|securetoken|firebaseinstallations|storage)\.googleapis\.com$/.test(
      url.hostname
    ) ||
    /\/(?:api|token|services)(?:\/|$)/i.test(url.pathname) ||
    (
      url.pathname.endsWith('.json') &&
      !url.pathname.endsWith('/manifest.json')
    )
  );
}

async function fetchTimed(
  request,
  milliseconds = 15000,
  options = {}
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    milliseconds
  );

  try {
    return await fetch(request, {
      ...options,
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function cacheable(response, opaque = false) {
  return !!response && (
    (
      response.ok &&
      response.type !== 'opaqueredirect'
    ) ||
    (
      opaque &&
      response.type === 'opaque'
    )
  );
}

async function asset(file) {
  let response;

  try {
    response = await fetchTimed(
      fileURL(file),
      25000
    );
  } catch (_) {
    throw new Error(
      file +
      ' indirilemedi. Bağlantıyı ve dosya yolunu kontrol edin.'
    );
  }

  if (!response.ok) {
    throw new Error(
      file +
      ' indirilemedi (HTTP ' +
      response.status +
      ').'
    );
  }

  const type =
    response.headers.get('Content-Type') || '';

  if (
    /\.(?:js|mjs)$/i.test(file) &&
    !/javascript|ecmascript|text\/plain/i.test(type)
  ) {
    throw new Error(
      file +
      ' yerine JavaScript olmayan bir dosya döndü.'
    );
  }

  const text = /\.(?:html|js)$/i.test(file)
    ? await response.clone().text()
    : '';

  if (
    file === 'offline-devriye.html' &&
    !text.includes('kolart-build:' + BUILD)
  ) {
    throw new Error(
      'offline-devriye.html uyumlu BUILD sürümünde değil.'
    );
  }

  if (
    [
      'offline-devriye.html',
      'offline-devriye.js'
    ].includes(file) &&
    !text.includes('kolart-offline-access:4hane-v1')
  ) {
    throw new Error(
      file +
      ' dört haneli yönetici kodunu destekleyen sürümde değil.'
    );
  }

  if (
    file === 'index.html' &&
    !/\bid\s*=\s*(?:["']offlineModeBtn["']|offlineModeBtn(?=[\s>]))/.test(text)
  ) {
    throw new Error(
      'index.html içinde offlineModeBtn bulunamadı. ' +
      'Offline özellikli index dosyasını yükleyin.'
    );
  }

  if (
    file === 'offline-paket.js' &&
    !new RegExp(
      '\\bconst\\s+REVISION\\s*=\\s*(["\'])' +
      REVISION +
      '\\1'
    ).test(text)
  ) {
    throw new Error(
      'offline-paket.js REVISION değeri SW ile eşleşmiyor.'
    );
  }

  return response;
}

function linkedAssets(html, pageURL) {
  const assets = new Set();

  const cleanHTML = html.replace(
    /<!--[\s\S]*?-->/g,
    ''
  );

  for (
    const match of cleanHTML.matchAll(
      /<(script|link)\b[^>]*>/gi
    )
  ) {
    const tag = match[0];

    const rel = tag.match(
      /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
    );

    const relValue =
      rel && (rel[1] ?? rel[2] ?? rel[3]) || '';

    if (
      match[1].toLowerCase() === 'link' &&
      !/\b(?:stylesheet|modulepreload)\b/i.test(relValue)
    ) {
      continue;
    }

    const path = tag.match(
      /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i
    );

    if (!path) continue;

    try {
      const pathValue =
        path[1] ?? path[2] ?? path[3];

      const url = new URL(
        pathValue.replace(/&amp;/g, '&'),
        pageURL
      );

      if (
        /^https?:$/.test(url.protocol) &&
        STATIC_EXT.test(url.pathname) &&
        !liveRequest(url) &&
        url.href !== self.location.href
      ) {
        assets.add(url.href);
      }
    } catch (_) {
      // Geçersiz bağlantı önbelleğe eklenmez.
    }
  }

  return [...assets];
}

async function shellManifest() {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(MARKER);

  if (!hit) return null;

  try {
    const data = await hit.json();

    return (
      data.build === BUILD &&
      data.revision === REVISION &&
      typeof data.cacheName === 'string' &&
      data.cacheName.startsWith(SHELL + '-data-') &&
      Array.isArray(data.files) &&
      FILES.every(file => data.files.includes(file))
    )
      ? data
      : null;
  } catch (_) {
    return null;
  }
}

async function shellReady() {
  const data = await shellManifest();

  if (
    !data ||
    !(await caches.keys()).includes(data.cacheName)
  ) {
    return false;
  }

  const cache = await caches.open(data.cacheName);

  for (const file of data.files) {
    if (!await cache.match(fileURL(file))) {
      return false;
    }
  }

  return true;
}

async function previousShell() {
  // Eski bir kullanıcı paketi hâlâ önceki hazır dosyalara bağlı olabilir.
  // Bu önbellekler silinmez; yeni paket hazırlanırken offline erişim sürer.
  const names = (await caches.keys()).filter(name => (
    name.startsWith('kolart-offline-shell-') &&
    !name.startsWith(SHELL)
  )).reverse();
  for (const cacheName of names) {
    const cache = await caches.open(cacheName);
    const responses = await Promise.all(FILES.map(file => cache.match(fileURL(file))));
    if (!responses.every(Boolean)) continue;
    const html = await responses[FILES.indexOf('offline-devriye.html')].text();
    if (!html.includes('kolart-build:' + BUILD) || !html.includes('kolart-offline-access:4hane-v1')) continue;
    const localFiles = linkedAssets(html, fileURL('offline-devriye.html'))
      .map(href => relativeFile(new URL(href))).filter(file => file !== null);
    const required = [...new Set([...FILES, ...localFiles])];
    const complete = await Promise.all(required.map(file => cache.match(fileURL(file))));
    if (complete.every(Boolean)) return { cacheName, files: required };
  }
  return null;
}

function progress(data) {
  lastProgress = data;

  for (const listener of progressListeners) {
    try {
      listener(data);
    } catch (_) {
      // Kapanan sekme indirmeyi durdurmaz.
    }
  }
}

async function buildShell(refresh) {
  if (!refresh && await shellReady()) {
    return shellManifest();
  }

  progress({
    file: 'offline-devriye.html',
    done: 0,
    total: FILES.length
  });

  const offlineHTML = await asset(
    'offline-devriye.html'
  );

  const html = await offlineHTML.clone().text();

  // Kod HTML'e gömülüyse offline-devriye.js aranmaz.
  // Dışarıdan çağrılıyorsa zorunlu dosya olarak indirilir.
  const localScripts = linkedAssets(
    html,
    fileURL('offline-devriye.html')
  )
    .map(href => relativeFile(new URL(href)))
    .filter(file => file !== null);

  const files = [
    ...new Set([
      ...FILES,
      ...localScripts
    ])
  ];

  let done = 1;

  progress({
    file: 'offline-devriye.html',
    done,
    total: files.length
  });

  const results = await Promise.allSettled(
    files
      .filter(file => file !== 'offline-devriye.html')
      .map(async file => {
        const response = await asset(file);

        progress({
          file,
          done: ++done,
          total: files.length
        });

        return [file, response];
      })
  );

  const failed = results.find(
    result => result.status === 'rejected'
  );

  if (failed) throw failed.reason;

  // Ayrı kopyaya yazılır.
  // İndirme/yazma başarısızsa önceki hazır paket değişmez.
  const cacheName =
    SHELL +
    '-data-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10);

  try {
    const cache = await caches.open(cacheName);

    await cache.put(
      fileURL('offline-devriye.html'),
      offlineHTML
    );

    for (const result of results) {
      await cache.put(
        fileURL(result.value[0]),
        result.value[1]
      );
    }

    const data = {
      build: BUILD,
      revision: REVISION,
      uiRevision: UI_REVISION,
      cacheName,
      files
    };

    const metadataCache = await caches.open(SHELL);

    await metadataCache.put(
      MARKER,
      new Response(
        JSON.stringify(data),
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    return data;
  } catch (error) {
    await caches.delete(cacheName).catch(() => {});
    throw error;
  }
}

function prepareShell(
  listener = () => {},
  refresh = false
) {
  progressListeners.add(listener);

  if (!preparing) {
    lastProgress = null;

    preparing = buildShell(refresh).finally(() => {
      preparing = null;
      lastProgress = null;
    });
  } else if (lastProgress) {
    try {
      listener(lastProgress);
    } catch (_) {
      // İlerleme bildirimi isteğe bağlıdır.
    }
  }

  return preparing.finally(() => {
    progressListeners.delete(listener);
  });
}

async function pool(
  items,
  worker,
  concurrency = 6
) {
  let next = 0;

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          items.length
        )
      },
      async () => {
        while (next < items.length) {
          const item = items[next++];
          await worker(item);
        }
      }
    )
  );
}

async function prepareCore(shell) {
  const cache = await caches.open(CACHE_NAME);
  const ready = await caches.open(shell.cacheName);

  const index = await ready.match(INDEX_URL);

  await cache.put(
    INDEX_URL,
    index.clone()
  );

  await cache.put(
    BASE.href,
    index.clone()
  );

  const dependencies = new Set(
    linkedAssets(
      await index.text(),
      INDEX_URL
    )
  );

  // Eksik CNAME/ikon/sayfa normal PWA'nın ve
  // tamamlanan offline paketin kurulumunu bozmaz.
  await pool(
    CORE_FILES.filter(file => file !== 'index.html'),
    async file => {
      try {
        const response = await fetchTimed(
          fileURL(file),
          8000
        );

        if (!cacheable(response)) return;

        if (
          file.endsWith('.js') &&
          /text\/html/i.test(
            response.headers.get('Content-Type') || ''
          )
        ) {
          return;
        }

        if (file.endsWith('.html')) {
          const html = await response.clone().text();

          for (
            const href of linkedAssets(
              html,
              fileURL(file)
            )
          ) {
            dependencies.add(href);
          }
        }

        await cache.put(
          fileURL(file),
          response
        );
      } catch (_) {
        // Dosya varsa daha sonraki ziyaretinde de
        // önbelleğe alınır.
      }
    }
  );

  await pool(
    [...dependencies],
    async href => {
      try {
        const localFile = relativeFile(new URL(href));
        const key = localFile !== null && (CORE_FILES.includes(localFile) || SHELL_FILES.has(localFile))
          ? fileURL(localFile) : href;
        if (await cache.match(key)) return;

        const external =
          new URL(href).origin !== BASE.origin;

        let response;

        try {
          response = await fetchTimed(
            href,
            8000,
            {
              mode: 'cors',
              credentials: external
                ? 'omit'
                : 'same-origin'
            }
          );
        } catch (error) {
          if (!external) throw error;

          response = await fetchTimed(
            href,
            5000,
            {
              mode: 'no-cors',
              credentials: 'omit'
            }
          );
        }

        if (cacheable(response, external)) {
          await cache.put(
            key,
            response
          );
        }
      } catch (_) {
        // CDN'nin erişilememesi yerel offline paketi bozmaz.
      }
    }
  );
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // SW kaydı ile kullanıcıya ait offline paketin hazırlanması ayrı adımlardır.
    // Offline dosya hatası, servis kaydını boş bırakıp update() hatasına dönüşmez.
    const cache = await caches.open(CACHE_NAME);
    await cache.put(INDEX_URL, await asset('index.html'));
    await prepareCore({ cacheName: CACHE_NAME }).catch(error => {
      console.warn('PWA yardımcı dosyaları tamamlanamadı:', error.message);
    });

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    const old = keys.filter(key => (
      key !== CACHE_NAME &&
      /^cga-pwa-v\d+-/.test(key) &&
      key.endsWith('-' + SCOPE)
    ));

    // Bir önceki arayüz kopyası yedek kalır.
    // Legacy, offline ve başka uygulama cache'leri korunur.
    const previous = old.sort((a, b) => (
      Number(b.match(/cga-pwa-v(\d+)/)[1]) -
      Number(a.match(/cga-pwa-v(\d+)/)[1])
    ));

    for (const key of previous.slice(1)) {
      await caches.delete(key);
    }

    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const message = event.data;

  if (
    !message ||
    ![
      'KOLART_SHELL_PREPARE',
      'KOLART_SHELL_STATUS',
      'SKIP_WAITING'
    ].includes(message.type)
  ) {
    return;
  }

  const port = event.ports && event.ports[0];

  const reply = data => {
    try {
      if (port) port.postMessage(data);
    } catch (_) {}
  };

  event.waitUntil((async () => {
    try {
      if (message.type === 'SKIP_WAITING') {
        await self.skipWaiting();
        return;
      }

      if (message.type === 'KOLART_SHELL_STATUS') {
        reply({
          ok: true,
          build: BUILD,
          revision: REVISION,
          ready: await shellReady()
        });

        return;
      }

      const shell = await prepareShell(
        data => reply({
          progress: data
        }),
        message.refresh === true
      );

      reply({
        ok: true,
        ...shell
      });
    } catch (error) {
      reply({
        ok: false,
        build: BUILD,
        revision: REVISION,
        message: error.message || String(error)
      });
    }
  })());
});

async function cachedPage(url) {
  const href = url.origin + url.pathname;

  const current = await (
    await caches.open(CACHE_NAME)
  ).match(href);

  if (current) return current;

  const shell = await shellManifest();

  if (shell) {
    const hit = await (
      await caches.open(shell.cacheName)
    ).match(href);

    if (hit) return hit;
  }

  const keys = await caches.keys();

  const old = keys
    .filter(key => (
      key !== CACHE_NAME &&
      (
        /^cga-pwa-v\d+$/.test(key) ||
        (
          /^cga-pwa-v\d+-/.test(key) &&
          key.endsWith('-' + SCOPE)
        )
      )
    ))
    .sort((a, b) => (
      Number(b.match(/cga-pwa-v(\d+)/)[1]) -
      Number(a.match(/cga-pwa-v(\d+)/)[1])
    ));

  for (const key of old) {
    const hit = await (
      await caches.open(key)
    ).match(href, {
      ignoreSearch: true
    });

    if (hit) return hit;
  }

  return null;
}

function unavailable() {
  return new Response(
    '<!doctype html>' +
    '<html lang="tr">' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>KOLART</title>' +
    '<body style="background:#080808;color:#fff;font:16px Arial;padding:40px 24px;text-align:center">' +
    '<h2>Bu ekran henüz cihaza kaydedilmedi</h2>' +
    '<p>İnternet varken uygulamayı açıp çevrimdışı hazırlığın tamamlanmasını bekleyin.</p>' +
    '<a href="' + INDEX_URL + '" style="color:#ccff00">Giriş ekranına dön</a>' +
    '</body></html>',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    }
  );
}

async function navigation(
  request,
  url,
  relative
) {
  if (relative === 'offline-devriye.html') {
    const shell = await shellManifest();

    let hit = shell && await (
      await caches.open(shell.cacheName)
    ).match(fileURL(relative));

    if (!hit) {
      const backup = await previousShell();
      if (backup) hit = await (await caches.open(backup.cacheName)).match(fileURL(relative));
    }

    if (hit) return hit;

    try {
      return await fetchTimed(
        request,
        4000
      );
    } catch (_) {
      return unavailable();
    }
  }

  try {
    const response = await fetchTimed(
      request,
      4000
    );

    if (
      !response.ok &&
      (
        ENTRY_FILES.has(relative) ||
        CORE_FILES.includes(relative)
      )
    ) {
      throw new Error('Ekran alınamadı.');
    }

    if (
      response.ok &&
      (
        CORE_FILES.includes(relative) ||
        relative === ''
      )
    ) {
      const key = (
        relative === '' ||
        relative === 'index.html'
      )
        ? INDEX_URL
        : url.origin + url.pathname;

      await (
        await caches.open(CACHE_NAME)
      ).put(
        key,
        response.clone()
      ).catch(() => {});
    }

    return response;
  } catch (_) {
    const hit = await cachedPage(
      relative === ''
        ? new URL(INDEX_URL)
        : url
    );

    // Yalnızca istenen ekran yoksa giriş ekranını getirir.
    // Offline devriyeye yönlendirme yapmaz.
    return (
      hit ||
      (
        ENTRY_FILES.has(relative) &&
        await cachedPage(new URL(INDEX_URL))
      ) ||
      unavailable()
    );
  }
}

async function staticAsset(
  request,
  url,
  relative
) {
  const shell = await shellManifest();

  if (
    shell &&
    (
      SHELL_FILES.has(relative) ||
      shell.files.includes(relative)
    )
  ) {
    const hit = await (
      await caches.open(shell.cacheName)
    ).match(fileURL(relative));

    if (hit) return hit;
  }

  const cache = await caches.open(CACHE_NAME);

  const key = (
    relative !== null &&
    (CORE_FILES.includes(relative) || SHELL_FILES.has(relative))
  )
    ? fileURL(relative)
    : request;

  const hit = await cache.match(key);

  if (hit) return hit;

  // Güncel PWA scripti önce kullanılır; eski shell yalnız dosya yedeğidir.
  if (SHELL_FILES.has(relative)) {
    const previous = await previousShell();
    if (previous) {
      const backup = await (await caches.open(previous.cacheName)).match(fileURL(relative));
      if (backup) return backup;
    }
  }

  try {
    const response = await fetchTimed(
      request,
      10000
    );

    const external =
      url.origin !== BASE.origin;

    const htmlForScript = (
      /\.(?:js|mjs|css)$/i.test(url.pathname) &&
      /text\/html/i.test(
        response.headers.get('Content-Type') || ''
      )
    );

    if (
      cacheable(response, external) &&
      !htmlForScript
    ) {
      await cache.put(
        key,
        response.clone()
      ).catch(() => {});
    }

    return response;
  } catch (_) {
    const keys = await caches.keys();

    const previousNames = keys
      .filter(name => (
        /^cga-pwa-v\d+$/.test(name) ||
        (
          /^cga-pwa-v\d+-/.test(name) &&
          name.endsWith('-' + SCOPE)
        )
      ))
      .reverse();

    for (const name of previousNames) {
      const previous = await (
        await caches.open(name)
      ).match(key);

      if (previous) return previous;
    }

    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  if (
    event.request.method !== 'GET' ||
    event.request.headers.has('range')
  ) {
    return;
  }

  const url = new URL(event.request.url);

  if (
    !/^https?:$/.test(url.protocol) ||
    liveRequest(url)
  ) {
    return;
  }

  const relative = relativeFile(url);

  // SW dosyasının güncelleme kontrolü
  // daima tarayıcı/ağ üzerinden ilerler.
  if (
    url.href === self.location.href ||
    relative === 'sw.js'
  ) {
    return;
  }

  if (event.request.mode === 'navigate') {
    if (relative !== null) {
      event.respondWith(
        navigation(
          event.request,
          url,
          relative
        )
      );
    }

    return;
  }

  if (
    url.origin === BASE.origin &&
    relative === null
  ) {
    return;
  }

  const staticFile = (
    relative !== null &&
    (
      CORE_FILES.includes(relative) ||
      SHELL_FILES.has(relative)
    )
  ) || (
    STATIC_EXT.test(url.pathname) &&
    (
      relative !== null ||
      [
        'script',
        'style',
        'image',
        'font'
      ].includes(event.request.destination)
    )
  );

  if (staticFile) {
    event.respondWith(
      staticAsset(
        event.request,
        url,
        relative
      )
    );
  }

  // Diğer canlı GET istekleri normal ağ akışında bırakılır.
});
