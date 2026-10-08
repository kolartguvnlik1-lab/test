/* KOLART OFFLINE PAKET - v6 */
(() => {
    'use strict';

    const BUILD = '20261008-2135-v6';

    const DB_NAME = 'kolart_offline_db';
    const DB_VERSION = 1;
    const STORE = 'bundles';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);

            req.onupgradeneeded = () => {
                const db = req.result;

                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function save(siteID, username, bundle) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);

            store.put(bundle, makeKey(siteID, username));

            tx.oncomplete = () => {
                db.close();
                resolve(true);
            };

            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        });
    }

    async function load(siteID, username) {
        const db = await openDB();

        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const req = store.get(makeKey(siteID, username));

            req.onsuccess = () => {
                const result = req.result || null;
                db.close();
                resolve(result);
            };

            req.onerror = () => {
                db.close();
                reject(req.error);
            };
        });
    }

    function makeKey(siteID, username) {
        return `${String(siteID || '').trim()}__${String(username || '').trim().toLocaleUpperCase('tr-TR')}`;
    }

    function getLocalVersion(bundle) {
        return String(bundle?.offlineVersion || '').trim();
    }

    async function intact(bundle) {
        if (!bundle) return false;

        if (!bundle.siteID) return false;
        if (!bundle.username) return false;
        if (!bundle.offlineVersion) return false;

        if (!bundle.createdAt) return false;

        return true;
    }

    function progress(percent, message) {
        try {
            window.dispatchEvent(
                new CustomEvent('kolart-offline-progress', {
                    detail: {
                        percent,
                        message
                    }
                })
            );
        } catch (_) {}

        console.log(`[KOLART OFFLINE] %${percent} - ${message}`);
    }

    function getServiceWorker() {
        if (!navigator.serviceWorker) {
            throw new Error('Tarayıcı Service Worker desteklemiyor.');
        }

        return navigator.serviceWorker.ready;
    }

    async function prepareShell() {
        progress(52, 'Offline sistem hazırlanıyor...');

        const registration = await getServiceWorker();

        const worker =
            registration.active ||
            registration.waiting ||
            registration.installing;

        if (!worker) {
            throw new Error('Service Worker aktif değil.');
        }

        progress(55, 'Offline dosyaları hazırlanıyor...');

        return new Promise((resolve, reject) => {
            let finished = false;

            const timeout = setTimeout(() => {
                if (finished) return;

                finished = true;
                navigator.serviceWorker.removeEventListener(
                    'message',
                    onMessage
                );

                reject(
                    new Error(
                        'Service Worker offline hazırlığı zaman aşımına uğradı.'
                    )
                );
            }, 90000);

            function cleanup() {
                clearTimeout(timeout);

                navigator.serviceWorker.removeEventListener(
                    'message',
                    onMessage
                );
            }

            function onMessage(event) {
                const data = event.data || {};

                if (data.type !== 'KOLART_SHELL_PROGRESS') {
                    return;
                }

                if (data.build && data.build !== BUILD) {
                    finished = true;
                    cleanup();

                    reject(
                        new Error(
                            `Service Worker sürümü uyuşmuyor. Beklenen: ${BUILD}, Gelen: ${data.build}`
                        )
                    );

                    return;
                }

                if (typeof data.percent === 'number') {
                    progress(
                        Math.min(80, Math.max(55, data.percent)),
                        data.message || 'Offline dosyaları hazırlanıyor...'
                    );
                }

                if (data.done) {
                    finished = true;
                    cleanup();

                    if (data.ok === false) {
                        reject(
                            new Error(
                                data.error ||
                                'Service Worker offline hazırlığını tamamlayamadı.'
                            )
                        );

                        return;
                    }

                    resolve(data);
                }
            }

            navigator.serviceWorker.addEventListener(
                'message',
                onMessage
            );

            try {
                worker.postMessage({
                    type: 'KOLART_SHELL_PREPARE',
                    build: BUILD
                });
            } catch (err) {
                finished = true;
                cleanup();
                reject(err);
            }
        });
    }

    async function start(options) {
        const {
            app,
            db,
            auth,
            siteID,
            username,
            password,
            get,
            ref,
            offlineVersion
        } = options || {};

        if (!siteID) {
            throw new Error('siteID bulunamadı.');
        }

        if (!username) {
            throw new Error('Kullanıcı adı bulunamadı.');
        }

        const packageVersion =
            String(offlineVersion || '').trim();

        if (!packageVersion) {
            throw new Error(
                'Firebase offlineversiyon değeri boş. Paket sürümü okunamadı.'
            );
        }

        try {
            progress(45, 'Offline paket hazırlanıyor...');

            /*
             * Önce Service Worker shell dosyalarını hazırla.
             * Buradaki eski sistem %50 civarında takılabiliyordu.
             */
            await prepareShell();

            progress(82, 'Offline kullanıcı paketi oluşturuluyor...');

            const bundle = {
                build: BUILD,

                siteID: String(siteID).trim(),

                username:
                    String(username)
                        .trim()
                        .toLocaleUpperCase('tr-TR'),

                password: password || '',

                offlineVersion: packageVersion,

                createdAt: Date.now(),

                /*
                 * Gerekirse ileride Firebase'den alınan
                 * ek offline veriler buraya eklenebilir.
                 */
                meta: {
                    build: BUILD,
                    version: packageVersion
                }
            };

            progress(87, 'Offline paket kaydediliyor...');

            /*
             * Yeni paket tamamen hazırlandıktan sonra kaydediyoruz.
             * Böylece yeni paket yarıda kalırsa eski paket silinmez.
             */
            await save(siteID, username, bundle);

            progress(95, 'Offline paket doğrulanıyor...');

            const saved = await load(siteID, username);

            if (!saved) {
                throw new Error(
                    'Offline paket kaydedildi fakat tekrar okunamadı.'
                );
            }

            if (
                String(saved.offlineVersion || '').trim() !==
                packageVersion
            ) {
                throw new Error(
                    `Offline paket sürümü doğrulanamadı. Beklenen ${packageVersion}, kayıtlı ${saved.offlineVersion}`
                );
            }

            progress(100, 'Offline paket hazır.');

            return true;

        } catch (error) {
            console.error(
                '[KOLART OFFLINE] Paket hazırlama hatası:',
                error
            );

            progress(
                0,
                error?.message ||
                'Offline paket hazırlanamadı.'
            );

            return false;
        }
    }

    window.KolartOffline = {
        BUILD,

        start,

        load,

        save,

        intact,

        getLocalVersion,

        makeKey
    };
})();
