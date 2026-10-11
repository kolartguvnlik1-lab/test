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
