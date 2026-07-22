const CACHE = 'getlos-v2';
const ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Install — cache leaflet assets only (not dashboard HTML, data changes daily)
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

// Fetch — cache leaflet CDN, network-first for everything else
self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  // Only handle leaflet CDN requests — cache-first
  if (url.includes('unpkg.com/leaflet')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }
  
  // All other requests (dashboard HTML, data JSON) — network-first, no caching
  // The lazy-load fetch handles data freshness separately
});
