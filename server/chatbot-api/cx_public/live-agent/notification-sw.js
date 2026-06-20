/* Live agent desk — show handoff alerts when the tab is in the background (mobile Chrome). */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  var d = event.data || {};
  if (d.type !== 'SHOW_HANDOFF') return;
  var title = d.title || 'Visitor waiting';
  var body = d.body || 'Waiting for an agent.';
  var tag = d.tag || 'live-agent-handoff';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: tag,
      renotify: true,
      data: { conversationId: d.conversationId || '' },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = self.location.origin + '/live-agent/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf('/live-agent') >= 0 && 'focus' in c) {
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
