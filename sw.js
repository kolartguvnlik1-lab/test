/* =========================================================
   KOLART PWA SERVICE WORKER
   v5 - INDEX HER ZAMAN AÇILIR
   ========================================================= */

'use strict';

const BUILD = '20261008-2050-v5';

const BASE = new URL('./', self.location.href);

/* Offline paket cache'i */
const SHELL = 'kolart-offline-shell-v5-' + BUILD;

/* Paket hazır işareti */
const MARKER = new URL('__kolart_shell_v5', BASE).href;

/*
 * Offline çalışması gereken dosyalar.
 * index.html özellikle burada:
 * PWA internet yokken de index.html açabilsin.
 */
const FILES = [
    'index.html',
    'offline-devriye.html',
    'offline-devriye.js',
    'offline-paket.js',
    'offline-sync.js',
    'vendor/html5-qrcode.min.js',
    'logo.png'
];


/* =========================================================
   INSTALL
   ========================================================= */

self.addEventListener('install', event => {
    event.waitUntil(
        self.skipWaiting()
    );
});


/* =========================================================
   ACTIVATE
   ========================================================= */

self.addEventListener('activate', event => {
    event.waitUntil(
        (async () => {

            await self.clients.claim();

            /*
             * Eski shell cache'lerini temizle.
             * Yeni sürüm kendi cache'ini kullanır.
             */
            const keys = await caches.keys();

            await Promise.all(
                keys
                    .filter(key =>
                        key.startsWith('kolart-offline-shell-') &&
                        key !== SHELL
                    )
                    .map(key => caches.delete(key))
            );

        })()
    );
});


/* =========================================================
   YARDIMCI FONKSİYONLAR
   ========================================================= */

async function fetchTimed(request, timeout = 5000) {

    return await Promise.race([

        fetch(request),

        new Promise((_, reject) => {

            setTimeout(() => {
                reject(new Error('Network timeout'));
            }, timeout);

        })

    ]);

}


/* =========================================================
   OFFLINE PAKET HAZIR MI?
   ========================================================= */

async function shellReady() {

    const cache = await caches.open(SHELL);

    const marker = await cache.match(MARKER);

    if (!marker) {
        return false;
    }

    for (const file of FILES) {

        const url = new URL(file, BASE).href;

        const response = await cache.match(url);

        if (!response) {
            return false;
        }

    }

    return true;
}


/* =========================================================
   OFFLINE PAKET HAZIRLAMA
   ========================================================= */

async function prepareShell() {

    const cache = await caches.open(SHELL);

    /*
     * Dosyaları tek tek indiriyoruz.
     * Bir dosya indirilemezse paket başarısız kabul edilir.
     */

    for (const file of FILES) {

        const url = new URL(file, BASE);

        const response = await fetchTimed(url, 15000);

        if (!response.ok) {
            throw new Error(
                'Offline dosyası indirilemedi: ' + file
            );
        }

        await cache.put(url.href, response.clone());

    }


    /*
     * Paket tamamen hazır olduktan sonra marker yazılır.
     */

    await cache.put(
        MARKER,
        new Response(
            JSON.stringify({
                version: BUILD,
                preparedAt: new Date().toISOString()
            }),
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        )
    );

    return true;
}


/* =========================================================
   MESSAGE
   ========================================================= */

self.addEventListener('message', event => {

    const data = event.data || {};

    /*
     * INDEX'TEN:
     *
     * KOLART_SHELL_PREPARE
     *
     * mesajı geldiğinde offline paket hazırlanır.
     */

    if (data.type === 'KOLART_SHELL_PREPARE') {

        event.waitUntil(

            (async () => {

                try {

                    await prepareShell();

                    const clients = await self.clients.matchAll({
                        type: 'window',
                        includeUncontrolled: true
                    });

                    for (const client of clients) {

                        client.postMessage({
                            type: 'KOLART_SHELL_READY',
                            version: BUILD,
                            ok: true
                        });

                    }

                } catch (error) {

                    console.error(
                        '[KOLART SW] Offline paket hazırlama hatası:',
                        error
                    );

                    const clients = await self.clients.matchAll({
                        type: 'window',
                        includeUncontrolled: true
                    });

                    for (const client of clients) {

                        client.postMessage({
                            type: 'KOLART_SHELL_READY',
                            version: BUILD,
                            ok: false,
                            error: String(error)
                        });

                    }

                }

            })()

        );

        return;
    }


    /*
     * INDEX'TEN:
     *
     * KOLART_SHELL_STATUS
     *
     * mesajı geldiğinde paket hazır mı kontrol edilir.
     */

    if (data.type === 'KOLART_SHELL_STATUS') {

        event.waitUntil(

            (async () => {

                const ready = await shellReady();

                if (event.source) {

                    event.source.postMessage({

                        type: 'KOLART_SHELL_STATUS_RESULT',

                        ready,

                        version: BUILD

                    });

                }

            })()

        );

    }

});


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener('fetch', event => {

    const request = event.request;

    /*
     * Sadece GET isteklerini ele al.
     *
     * Firebase POST/PUT vs. isteklerine dokunmuyoruz.
     */

    if (request.method !== 'GET') {
        return;
    }


    const url = new URL(request.url);


    /*
     * Firebase / Google servisleri gibi harici istekleri
     * Service Worker cache'ine alma.
     */

    if (
        url.origin !== self.location.origin
    ) {

        return;

    }


    /*
     * Navigasyon isteği:
     *
     * PWA açıldığında ister internet olsun,
     * ister internet olmasın INDEX açılacak.
     */

    if (request.mode === 'navigate') {

        event.respondWith(

            (async () => {

                /*
                 * Önce internetten güncel sayfayı almaya çalış.
                 */

                try {

                    return await fetchTimed(
                        request,
                        5000
                    );

                } catch (error) {

                    /*
                     * İnternet yoksa HER ZAMAN index.html
                     * cache'inden aç.
                     */

                    const cache =
                        await caches.open(SHELL);

                    const indexUrl =
                        new URL(
                            'index.html',
                            BASE
                        ).href;

                    const indexResponse =
                        await cache.match(indexUrl);

                    if (indexResponse) {
                        return indexResponse;
                    }


                    /*
                     * index.html cache'te yoksa,
                     * normal cache'lerde ara.
                     */

                    const fallback =
                        await caches.match(indexUrl);

                    if (fallback) {
                        return fallback;
                    }


                    /*
                     * Hiçbir şey yoksa basit cevap.
                     */

                    return new Response(
                        `
                        <!DOCTYPE html>
                        <html lang="tr">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport"
                                  content="width=device-width,initial-scale=1">
                            <title>KOLART</title>
                        </head>
                        <body>
                            <h2>KOLART</h2>
                            <p>Offline paket henüz hazırlanmadı.</p>
                        </body>
                        </html>
                        `,
                        {
                            status: 503,
                            headers: {
                                'Content-Type':
                                    'text/html; charset=utf-8'
                            }
                        }
                    );

                }

            })()

        );

        return;
    }


    /*
     * Normal dosya istekleri.
     */

    event.respondWith(

        (async () => {

            /*
             * Önce normal internet isteğini dene.
             */

            try {

                const response =
                    await fetchTimed(
                        request,
                        5000
                    );

                /*
                 * Başarılıysa güncel cevabı kullan.
                 */

                if (response && response.ok) {
                    return response;
                }

            } catch (error) {

                /*
                 * İnternet yok.
                 * Aşağıda cache'e geçilecek.
                 */

            }


            /*
             * Offline shell cache.
             */

            const cache =
                await caches.open(SHELL);

            const cached =
                await cache.match(
                    request,
                    {
                        ignoreSearch: true
                    }
                );

            if (cached) {
                return cached;
            }


            /*
             * Genel CacheStorage fallback.
             */

            const fallback =
                await caches.match(
                    request,
                    {
                        ignoreSearch: true
                    }
                );

            if (fallback) {
                return fallback;
            }


            /*
             * Bulunamadı.
             */

            return new Response(
                'Offline içerik bulunamadı.',
                {
                    status: 503,
                    headers: {
                        'Content-Type':
                            'text/plain; charset=utf-8'
                    }
                }
            );

        })()

    );

});
