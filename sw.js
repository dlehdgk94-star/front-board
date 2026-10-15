/* 행사보드 서비스워커 — "앱 설치"가 가능하게 해주는 최소한의 파일
   · 항상 인터넷에서 최신 화면을 먼저 받아옴 (수정 사항이 바로 반영되도록)
   · 인터넷이 끊겼을 때만 마지막으로 본 화면을 보여줌
   · 행사·검토 데이터(Supabase)는 저장하지 않음 — 다른 사이트 요청은 건드리지 않음 */
const CACHE = 'frontboard-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
