// Zeilrace — service worker. Alleen voor systeemmeldingen (GPS-alarm);
// er wordt bewust niets gecachet, zodat je altijd de nieuwste versie hebt.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(vensters => {
    for (const v of vensters) if (v.url.includes('tracker') && 'focus' in v) return v.focus();
    return self.clients.openWindow('tracker.html');
  }));
});
