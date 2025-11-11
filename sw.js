const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : Date.now().toString();
const CACHE_VERSION = `qplay-resources-${BUILD_ID}`;
const PRECACHE_URLS = [
  `/tessdata/eng.traineddata.gz?v=${BUILD_ID}`,
  `/tessdata/kor.traineddata.gz?v=${BUILD_ID}`,
  `/indexes/questions.json?v=${BUILD_ID}`,
  `/indexes/metadata.json?v=${BUILD_ID}`
];
const IMMUTABLE_PATH_PREFIXES = ['/tessdata/', '/indexes/'];

let isReady = false;

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => {
        isReady = true;
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('Service Worker 설치 실패:', error);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(cacheName => cacheName !== CACHE_VERSION)
            .map(cacheName => caches.delete(cacheName))
        )
      )
      .then(() => {
        return self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({ type: 'sw-ready', cacheVersion: CACHE_VERSION });
          });
        });
      })
      .then(() => self.clients.claim())
      .catch(error => {
        console.error('Service Worker 활성화 실패:', error);
      })
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (!shouldHandle(url)) {
    return;
  }

  event.respondWith(cacheFirstImmutable(request));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'skip-waiting') {
    self.skipWaiting();
  }
});

async function cacheFirstImmutable(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    return withImmutableHeaders(cached);
  }

  try {
    const response = await fetch(request);
    if (!response || response.status !== 200) {
      return response;
    }

    const cloned = response.clone();
    await cache.put(request, cloned);
    return withImmutableHeaders(response);
  } catch (error) {
    console.error('캐시 fetch 실패:', error);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) {
      return withImmutableHeaders(cached);
    }
    throw error;
  }
}

function shouldHandle(url) {
  return IMMUTABLE_PATH_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

function withImmutableHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}


