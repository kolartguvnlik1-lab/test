/* KOLART offline v4 — PWA çevrimdışıyken de index açılır. */
'use strict';

const BUILD = '20261008-2050';
const REVISION = '20261008-2311';

const BASE = new URL('./', self.location.href);

const SHELL =
  'kolart-offline-shell-v4-' + BUILD + '-' + REVISION;

const MARKER = new URL('__kolart_shell_v4', BASE).href;

const FILES = [
  'index.html',
  'offline-devriye.html',
  'offline-devriye.js',
  'offline-paket.js',
  'offline-sync.js',
  'vendor/html5-qrcode.min.js'
];

const INDEX_FILES = [
  'index.html',
  'offline-paket.js',
  'offline-sync.js'
];

const OPTIONAL_FILES = [
  'logo.png',
  'manifest.json',
  'icon-192.png',
  'icon-512.png'
];

let preparing;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // Giriş ekranı ilk çevrimiçi ziyarette saklanır.
    // Güvenlik paketi girişten sonra hazırlanır.
    await prepareIndex().catch(error => {
      console.warn('[Index önbelleği]', error.message);
    });

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

async function fetchTimed(request, milliseconds = 15000) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    milliseconds
  );

  try {
    return await fetch(request, {
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function shellReady() {
  const cache = await caches.open(SHELL);
  const marker = await cache.match(MARKER);

  if (!marker) return false;

  for (const file of FILES) {
    if (!await cache.match(new URL(file, BASE).href)) {
      return false;
    }
  }

  return true;
}

async function asset(file) {
  let response;

  try {
    response = await fetchTimed(
      new URL(file, BASE).href,
      25000
    );
  } catch (_) {
    throw new Error(
      file +
      ' indirilemedi. Bağlantıyı ve dosyanın sunucuda bulunduğunu kontrol edin.'
    );
  }

  if (!response.ok) {
    throw new Error(
      file + ' indirilemedi (HTTP ' + response.status + ').'
    );
  }

  const type = response.headers.get('Content-Type') || '';

  if (
    file.endsWith('.js') &&
    !/javascript|ecmascript|text\/plain/i.test(type)
  ) {
    throw new Error(
      file + ' yerine JavaScript olmayan bir dosya döndü.'
    );
  }

  if (
    file === 'offline-devriye.html' &&
    !(await response.clone().text()).includes(
      'kolart-build:' + BUILD
    )
  ) {
    throw new Error(
      'offline-devriye.html uyumlu sürüm değil. Mevcut devriye dosyalarını kontrol edin.'
    );
  }

  if (
    file === 'index.html' &&
    !(await response.clone().text()).includes(
      'id="offlineModeBtn"'
    )
  ) {
    throw new Error(
      'index.html eski sürüm. Verilen üç dosyayı birlikte yükleyin.'
    );
  }

  if (
    file === 'offline-paket.js' &&
    !(await response.clone().text()).includes(
      "const REVISION = '" + REVISION + "'"
    )
  ) {
    throw new Error(
      'offline-paket.js eski sürüm. Verilen üç dosyayı birlikte yükleyin.'
    );
  }

  return response;
}

async function prepareIndex() {
  const cache = await caches.open(SHELL);

  const results = await Promise.allSettled(
    INDEX_FILES.map(async file => [
      file,
      await asset(file)
    ])
  );

  const failure = results.find(
    r => r.status === 'rejected'
  );

  if (failure) throw failure.reason;

  for (const { value: [file, response] } of results) {
    await cache.put(
      new URL(file, BASE).href,
      response
    );
  }

  await optionalAssets(cache);
}

async function optionalAssets(cache) {
  await Promise.allSettled(
    OPTIONAL_FILES.map(async file => {
      if (await cache.match(new URL(file, BASE).href)) return;

      const response = await fetchTimed(
        new URL(file, BASE).href,
        5000
      );

      if (response.ok) {
        await cache.put(
          new URL(file, BASE).href,
          response
        );
      }
    })
  );
}

async function prepareShell(progress, refresh = false) {
  const cache = await caches.open(SHELL);

  if (!refresh && await shellReady()) {
    return {
      build: BUILD,
      revision: REVISION,
      cacheName: SHELL,
      files: FILES
    };
  }

  // HTML ve tarayıcı dosyaları aynı sürüm tamamlanmadan hazır sayılmaz.
  const results = await Promise.allSettled(
    FILES.map(async (file, index) => {
      progress({
        file,
        done: index,
        total: FILES.length
      });

      return [
        file,
        await asset(file)
      ];
    })
  );

  const failure = results.find(
    r => r.status === 'rejected'
  );

  if (failure) throw failure.reason;

  // İndirme başarısızsa önceki dosyalar yerinde kalır.
  await cache.delete(MARKER);

  for (const { value: [file, response] } of results) {
    await cache.put(
      new URL(file, BASE).href,
      response
    );
  }

  await optionalAssets(cache);

  await cache.put(
    MARKER,
    new Response(
      JSON.stringify({
        build: BUILD,
        files: FILES
      }),
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  );

  return {
    build: BUILD,
    revision: REVISION,
    cacheName: SHELL,
    files: FILES
  };
}

self.addEventListener('message', e => {
  const message = e.data;

  if (
    !message ||
    ![
      'KOLART_SHELL_PREPARE',
      'KOLART_SHELL_STATUS'
    ].includes(message.type)
  ) {
    return;
  }

  const port = e.ports[0];

  const reply = data => {
    if (port) port.postMessage(data);
  };

  const work = (async () => {
    try {
      if (message.type === 'KOLART_SHELL_STATUS') {
        reply({
          ok: true,
          build: BUILD,
          revision: REVISION,
          ready: await shellReady()
        });

        return;
      }

      await self.clients.claim();

      if (!preparing) {
        preparing = prepareShell(
          p => reply({ progress: p }),
          message.refresh === true
        ).finally(() => {
          preparing = null;
        });
      }

      const shell = await preparing;

      reply({
        ok: true,
        ...shell
      });
    } catch (error) {
      reply({
        ok: false,
        build: BUILD,
        revision: REVISION,
        message: error.message
      });
    }
  })();

  e.waitUntil(work);
});

function unavailable() {
  return new Response(
    '<!doctype html><html lang="tr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#080808;color:#fff;font:16px Arial;padding:40px 24px;text-align:center"><h2>Çevrimdışı hazırlık gerekli</h2><p>İnternet varken giriş yapıp “Çevrimdışı paket hazır” mesajını bekleyin.</p><a href="index.html" style="color:#ccff00">Giriş ekranına dön</a></body></html>',
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8'
      }
    }
  );
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  if (
    url.origin !== BASE.origin ||
    !url.pathname.startsWith(BASE.pathname)
  ) {
    return;
  }

  const relative = url.pathname.slice(BASE.pathname.length);

  // GET dışındaki Firebase/Storage/Auth isteklerine müdahale edilmez.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);

      const offlineURL = new URL(
        'offline-devriye.html',
        BASE
      ).href;

      const indexURL = new URL(
        'index.html',
        BASE
      ).href;

      if (relative === 'offline-devriye.html') {
        const hit = await cache.match(offlineURL);

        if (hit) return hit;

        try {
          return await fetchTimed(e.request, 5000);
        } catch (_) {
          return unavailable();
        }
      }

      // PWA start_url index, klasör adresi veya normal devriye ekranı olabilir.
      const entry = [
        '',
        'index.html',
        'guvenlik.html',
        'devriye.html',
        'offline-index.html'
      ].includes(relative);

      const indexEntry = [
        '',
        'index.html'
      ].includes(relative);

      if (entry && self.navigator.onLine === false) {
        if (relative !== 'index.html') {
          return Response.redirect(indexURL, 302);
        }

        return await cache.match(indexURL) || unavailable();
      }

      try {
        const response = await fetchTimed(
          e.request,
          5000
        );

        if (!response.ok && entry) {
          throw new Error(
            'Giriş ekranı sunucudan alınamadı.'
          );
        }

        if (indexEntry && response.ok) {
          await cache.put(
            indexURL,
            response.clone()
          ).catch(() => {});
        }

        return response;
      } catch (_) {
        if (entry) {
          if (relative !== 'index.html') {
            return Response.redirect(indexURL, 302);
          }

          return await cache.match(indexURL) || unavailable();
        }

        const hit = await cache.match(
          url.href,
          {
            ignoreSearch: true
          }
        );

        return hit || unavailable();
      }
    })());

    return;
  }

  if (
    !FILES.includes(relative) &&
    !OPTIONAL_FILES.includes(relative)
  ) {
    return;
  }

  e.respondWith((async () => {
    const hit = await (
      await caches.open(SHELL)
    ).match(new URL(relative, BASE).href);

    if (hit) return hit;

    const response = await fetch(e.request);

    if (response.ok) {
      await (
        await caches.open(SHELL)
      ).put(
        new URL(relative, BASE).href,
        response.clone()
      ).catch(() => {});
    }

    return response;
  })());
});
