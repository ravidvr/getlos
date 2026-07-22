const CACHE = 'getlos-v1';
const ASSETS = [
  '/getlos/dashboard.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

// Fetch — serve from cache, fallback to network
self.addEventListener('fetch', e => {
  // Only cache same-origin + leaflet CDN requests
  if (!e.request.url.startsWith(self.location.origin) && 
      !e.request.url.includes('unpkg.com/leaflet')) return;
  
  e.respondWith(
    caches.match(e.request).then(cached => {
      // Return cached version, then update cache in background
      const fetchPromise = fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});
