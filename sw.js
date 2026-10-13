/* 최소 서비스 워커 — 홈 화면 앱 설치(크롬 설치 안내는 fetch 핸들러가 있어야 뜸)와 오프라인 대비용.
 * 원칙: 항상 네트워크 우선. 캐시는 네트워크가 안 될 때만 쓴다 → 식당 데이터(restaurants.json)·화면 코드가
 *       오래된 것으로 보이는 일이 없다. 다른 사이트(카카오 지도·폰트·유튜브 썸네일) 요청은 건드리지 않는다.
 */
const CACHE = "matjip-v1";
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "config.js", "manifest.json",
               "icons/icon-192.png", "data/restaurants.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })                       // 네트워크 우선 (서버에 새 버전이 있는지 항상 확인)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))),
  );
});
