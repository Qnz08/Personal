self.addEventListener("install", event => {
  event.waitUntil(
    caches.open("pfa-cache").then(cache =>
      cache.addAll([
        "./",
        "./index.html",
        "./style.css",
        "./app.js",
        "./engine.js",
        "./storage.js"
      ])
    )
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(resp => {
      return resp || fetch(event.request);
    })
  );
});