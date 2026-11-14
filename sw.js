/* ZainMed Service Worker — app internet ke baghair bhi khulti hai (offline shell) */
const V = "zainmed-shell-v6";
const SHELL = ["/", "/index.html", "/master.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/login-bg.jpg", "/login-bg.jpg.jpeg"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    for (const u of SHELL) { try { const r = await fetch(u, { cache: "reload" }); if (r && r.ok) await c.put(u, r); } catch (x) {} }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== V) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  /* PDF libraries (html2canvas / jsPDF) pehli dafa internet se, phir offline bhi chalti hain */
  if (url.origin === "https://cdnjs.cloudflare.com" && /html2canvas|jspdf/i.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(V);
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;          /* data hamesha app ka offline layer sambhalta hai */
  e.respondWith((async () => {
    const cache = await caches.open(V);
    try {
      /* network-first (naya version milta rahe), 4 second mein na aaye to cache */
      const res = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 4000))
      ]);
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate" && url.pathname === "/master.html") {
        const m = await cache.match("/master.html");
        if (m) return m;
      }
      if (req.mode === "navigate") {
        const idx = (await cache.match("/index.html")) || (await cache.match("/"));
        if (idx) return idx;
      }
      return new Response("Offline — page cache mein nahi hai. Ek dafa internet se kholein.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
