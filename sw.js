/* KOLART SERVICE WORKER - v6 */

'use strict';

const BUILD = '20261008-2135-v6';

const CACHE_NAME =
    'kolart-offline-shell-v6-' + BUILD;

const BASE =
    self.registration.scope;

const MARKER =
    new URL(
        '__kolart_shell_v6',
        BASE
    ).href;

const FILES = [
    'index.html',
    'offline-devriye.html',
    'offline-devriye.js',
    'offline-paket.js',
    'offline-sync.js',
    'vendor/html5-qrcode.min.js',
    'logo.png'
];

self.addEventListener(
    'install',
    event => {

        /*
         * Yeni Service Worker hemen aktif olsun.
         */
        self.skipWaiting();

        /*
         * Shell kurulumu burada zorunlu değil.
         * Ana sayfa KOLART_SHELL_PREPARE mesajı
         * gönderdiğinde hazırlanacak.
         */
    }
);

self.addEventListener(
    'activate',
    event => {

        event.waitUntil(
            (async () => {

                /*
                 * Eski KOLART cache'lerini temizle.
                 */
                const keys =
                    await caches.keys();

                await Promise.all(
                    keys
                        .filter(
                            key =>
                                key.startsWith(
                                    'kolart-offline-shell-'
                                ) &&
                                key !== CACHE_NAME
                        )
                        .map(
                            key =>
                                caches.delete(key)
                        )
                );

                await self.clients.claim();

            })()
        );
    }
);


/*
 * Tek dosya indirme fonksiyonu.
 */
async function fetchWithTimeout(
    url,
    timeout = 30000
) {

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () => controller.abort(),
            timeout
        );

    try {

        const response =
            await fetch(
                url,
                {
                    cache: 'no-store',
                    signal: controller.signal
                }
            );

        if (!response.ok) {
            throw new Error(
                `${response.status} ${response.statusText}`
            );
        }

        return response;

    } finally {

        clearTimeout(timer);
    }
}


/*
 * Offline shell hazırlanıyor.
 */
async function prepareShell(
    requestedBuild
) {

    if (
        requestedBuild &&
        requestedBuild !== BUILD
    ) {

        throw new Error(
            `Build uyuşmuyor. SW=${BUILD}, İstenen=${requestedBuild}`
        );
    }

    const cache =
        await caches.open(CACHE_NAME);

    const total =
        FILES.length;

    let completed = 0;

    for (const file of FILES) {

        const url =
            new URL(
                file,
                BASE
            ).href;

        try {

            const response =
                await fetchWithTimeout(
                    url,
                    30000
                );

            await cache.put(
                url,
                response.clone()
            );

            completed++;

            const percent =
                55 +
                Math.round(
                    (completed / total) * 25
                );

            await broadcast({
                type:
                    'KOLART_SHELL_PROGRESS',

                build:
                    BUILD,

                percent,

                message:
                    `Offline dosyası hazırlanıyor: ${file}`,

                file,

                completed,

                total
            });

        } catch (error) {

            console.error(
                '[KOLART SW] Dosya alınamadı:',
                file,
                error
            );

            /*
             * logo.png gibi opsiyonel dosyalarda
             * tüm offline sistemi çökertme.
             */
            if (
                file === 'logo.png'
            ) {

                completed++;

                await broadcast({
                    type:
                        'KOLART_SHELL_PROGRESS',

                    build:
                        BUILD,

                    percent:
                        55 +
                        Math.round(
                            (completed / total) * 25
                        ),

                    message:
                        `Opsiyonel dosya atlandı: ${file}`,

                    file,

                    completed,

                    total
                });

                continue;
            }

            throw new Error(
                `Offline dosyası alınamadı: ${file}`
            );
        }
    }

    /*
     * Marker oluştur.
     * Böylece shell gerçekten hazırlanmış oluyor.
     */
    await cache.put(
        MARKER,
        new Response(
            JSON.stringify({
                build: BUILD,
                createdAt: Date.now()
            }),
            {
                headers: {
                    'Content-Type':
                        'application/json'
                }
            }
        )
    );

    await broadcast({
        type:
            'KOLART_SHELL_PROGRESS',

        build:
            BUILD,

        percent:
            80,

        message:
            'Offline dosyaları hazır.',

        done:
            false
    });

    return {
        ok: true,
        build: BUILD
    };
}


/*
 * Tüm client'lara mesaj gönder.
 */
async function broadcast(
    message
) {

    const clients =
        await self.clients.matchAll({
            includeUncontrolled: true,
            type: 'window'
        });

    for (const client of clients) {

        client.postMessage(
            message
        );
    }
}


/*
 * Ana sayfa ile mesajlaşma.
 */
self.addEventListener(
    'message',
    event => {

        const data =
            event.data || {};

        if (
            data.type !==
            'KOLART_SHELL_PREPARE'
        ) {
            return;
        }

        event.waitUntil(
            (async () => {

                try {

                    const result =
                        await prepareShell(
                            data.build
                        );

                    await broadcast({

                        type:
                            'KOLART_SHELL_PROGRESS',

                        build:
                            BUILD,

                        percent:
                            80,

                        message:
                            'Offline shell hazır.',

                        done:
                            true,

                        ok:
                            true
                    });

                    /*
                     * Mesajı gönderen client'a
                     * ayrıca cevap ver.
                     */
                    if (
                        event.source
                    ) {

                        event.source.postMessage({

                            type:
                                'KOLART_SHELL_PROGRESS',

                            build:
                                BUILD,

                            percent:
                                80,

                            message:
                                'Offline shell hazır.',

                            done:
                                true,

                            ok:
                                true
                        });
                    }

                } catch (error) {

                    console.error(
                        '[KOLART SW] Shell hazırlama hatası:',
                        error
                    );

                    const payload = {

                        type:
                            'KOLART_SHELL_PROGRESS',

                        build:
                            BUILD,

                        percent:
                            0,

                        message:
                            error?.message ||
                            'Offline shell hazırlanamadı.',

                        done:
                            true,

                        ok:
                            false,

                        error:
                            error?.message ||
                            'Bilinmeyen hata'
                    };

                    await broadcast(
                        payload
                    );

                    if (
                        event.source
                    ) {
                        event.source.postMessage(
                            payload
                        );
                    }
                }

            })()
        );
    }
);


/*
 * FETCH
 *
 * Online:
 *   Önce internetten güncel dosyayı alır.
 *
 * Offline:
 *   Cache'den ilgili dosyayı verir.
 */
self.addEventListener(
    'fetch',
    event => {

        const request =
            event.request;

        if (
            request.method !==
            'GET'
        ) {
            return;
        }

        const url =
            new URL(
                request.url
            );

        /*
         * Sadece kendi origin'imiz.
         */
        if (
            url.origin !==
            self.location.origin
        ) {
            return;
        }

        /*
         * Service Worker kendi özel marker'ını
         * network'e gönderme.
         */
        if (
            url.href === MARKER
        ) {
            event.respondWith(
                caches.match(
                    url.href,
                    {
                        cacheName:
                            CACHE_NAME
                    }
                )
            );

            return;
        }

        event.respondWith(
            handleFetch(request)
        );
    }
);


async function handleFetch(
    request
) {

    /*
     * Önce network.
     */
    try {

        const response =
            await fetch(
                request
            );

        /*
         * Başarılı network cevabını
         * cache'e yaz.
         */
        if (
            response &&
            response.ok
        ) {

            const cache =
                await caches.open(
                    CACHE_NAME
                );

            await cache.put(
                request,
                response.clone()
            );
        }

        return response;

    } catch (_) {

        /*
         * Network yoksa cache.
         */
        const cached =
            await caches.match(
                request,
                {
                    cacheName:
                        CACHE_NAME
                }
            );

        if (cached) {
            return cached;
        }

        /*
         * Navigation isteğinde index.html
         * son çare olarak kullanılır.
         */
        if (
            request.mode ===
            'navigate'
        ) {

            const index =
                await caches.match(
                    new URL(
                        'index.html',
                        BASE
                    ).href,
                    {
                        cacheName:
                            CACHE_NAME
                    }
                );

            if (index) {
                return index;
            }
        }

        /*
         * Hiçbir şey yoksa basit offline cevap.
         */
        return new Response(
            'Offline içerik bulunamadı.',
            {
                status: 503,
                statusText:
                    'Service Unavailable',
                headers: {
                    'Content-Type':
                        'text/plain; charset=utf-8'
                }
            }
        );
    }
);
