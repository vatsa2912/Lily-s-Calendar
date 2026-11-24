const cacheName = 'lily-care-v1';
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(['./','./style.css','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png']))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  const data=event.data?.json()||{title:'Lily’s Calendar',body:'A care reminder is due.',url:'./'};
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag,icon:'./icon-192.png',badge:'./icon-192.png',data:{url:data.url||'./'},renotify:true}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{const existing=list.find(client=>'focus' in client);return existing?existing.focus():clients.openWindow(event.notification.data?.url||'./');}));
});
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(match => match || (event.request.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
