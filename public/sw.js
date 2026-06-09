// Agent Platform Console — service worker.
// HTML: never cached (network-only, with offline fallback)
// /api/*: network-first with short cache
// Other GET assets: stale-while-revalidate

const SHELL_CACHE = "agent-console-shell-v10";
const API_CACHE   = "agent-console-api-v10";

const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Use { cache: "reload" } so install never reads from HTTP cache.
      await cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== API_CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
      // Tell all open pages a new SW took over; they can hard-reload to pick up new shell.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) c.postMessage({ type: "sw-updated" });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Always-fresh HTML navigations — no cached shell.
  if (req.mode === "navigate" || (req.destination === "document")) {
    event.respondWith(networkOnlyDocument(req));
    return;
  }

  // /api/* — network first, falls back to short cache, then offline JSON.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(req, API_CACHE, 4000));
    return;
  }

  // /grafana/* — never cached. Panels must be fresh; the proxy sets
  // Cache-Control: no-store on /grafana/d-solo/* anyway, but the SW
  // would still hold a stale copy with stale-while-revalidate.
  if (url.pathname.startsWith("/grafana/")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

  // Other GETs (CSS/JS/images/icons, including /v2/*) — stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
});

async function networkOnlyDocument(req) {
  try {
    const res = await fetch(req, { cache: "no-store" });
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match("/offline.html")) || new Response("offline", { status: 503 });
  }
}

async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  try {
    const network = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    if (network && network.ok) {
      cache.put(req, network.clone()).catch(() => {});
      return network;
    }
    if (cached) return cached;
    return network;
  } catch (err) {
    if (cached) return cached;
    return new Response(JSON.stringify({ ok: false, offline: true, error: String(err) }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response("offline", { status: 503 });
}
