// Service worker minimal untuk kebolehpasangan PWA (installable).
// Network passthrough — TIADA caching, jadi kandungan sentiasa terkini.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Tiada respondWith → pelayar guna rangkaian biasa (tiada cache, tiada kandungan basi).
});
