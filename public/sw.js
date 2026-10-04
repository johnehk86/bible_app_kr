// 말씀암송 서비스 워커 — 오프라인 지원 (한 번 열어 본 구절은 비행기 모드에서도 재생)
// 캐시 구조를 바꾸면 버전을 올릴 것 (이전 캐시는 activate 때 삭제됨)
const VERSION = 'v1'
const DATA_CACHE = `data-${VERSION}`   // data/passages.json
const APP_CACHE = `app-${VERSION}`     // index.html, JS/CSS 번들, 아이콘
const AUDIO_CACHE = `audio-${VERSION}` // 암송 mp3
const FONT_CACHE = `font-${VERSION}`   // Google Fonts

const PRECACHE = [
  './',
  './manifest.webmanifest',
  './data/passages.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
]

self.addEventListener('install', (event) => {
  // addAll 대신 하나씩 저장: 서버가 Vary 헤더를 붙이면 addAll 이 "Entry already exists"로 실패하고,
  // 파일 하나만 실패해도 서비스 워커 설치 전체가 취소되기 때문
  event.waitUntil(
    caches.open(APP_CACHE).then((c) =>
      Promise.allSettled(
        PRECACHE.map((path) =>
          fetch(path, { cache: 'reload' }).then((res) => res.ok && c.put(path, res))
        )
      )
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  const keep = [APP_CACHE, AUDIO_CACHE, FONT_CACHE, DATA_CACHE]
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// 응답을 캐시에 저장 (정상 응답만)
function put(cacheName, request, response) {
  if (response && (response.ok || response.type === 'opaque')) {
    const clone = response.clone()
    caches.open(cacheName).then((c) => c.put(request, clone))
  }
  return response
}

// mp3 응답 — 전체 파일을 캐시해 두고, Range 요청이면 206 부분 응답을 직접 만든다.
// (iOS Safari는 서비스 워커가 Range 요청에 200 전체 응답을 주면 오디오 재생/탐색이 실패함)
async function audioResponse(request, path) {
  let res = await caches.match(path)
  if (!res) {
    res = await fetch(path) // Range 헤더 없이 전체 파일 요청
    if (!res.ok) return res
    const cache = await caches.open(AUDIO_CACHE)
    await cache.put(path, res.clone())
  }

  const range = request.headers.get('range')
  if (!range) return res

  const buf = await res.arrayBuffer()
  const size = buf.byteLength
  const m = /bytes=(\d*)-(\d*)/.exec(range)
  let start = m && m[1] ? Number(m[1]) : 0
  let end = m && m[2] ? Number(m[2]) : size - 1
  if (m && !m[1] && m[2]) { start = size - Number(m[2]); end = size - 1 } // bytes=-N
  end = Math.min(end, size - 1)
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }

  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // 1) 페이지 이동: 네트워크 우선 → 오프라인이면 캐시된 앱 셸
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => put(APP_CACHE, './', res))
        .catch(() => caches.match('./'))
    )
    return
  }

  // 2) Google Fonts: 캐시 우선 (한 번 받으면 오프라인에서도 폰트 유지)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => put(FONT_CACHE, request, res)))
    )
    return
  }

  if (url.origin !== self.location.origin) return

  // 3) 본문 데이터: 네트워크 우선 (오타 수정이 바로 반영되게) → 오프라인이면 캐시
  if (url.pathname.endsWith('/data/passages.json')) {
    event.respondWith(
      fetch(request)
        .then((res) => put(DATA_CACHE, url.pathname, res))
        .catch(() => caches.match(url.pathname).then((c) => c || caches.match('./data/passages.json')))
    )
    return
  }

  // 4) mp3: 캐시 우선 (한 번 들은 구절은 오프라인 재생 가능)
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(audioResponse(request, url.pathname))
    return
  }

  // 5) 해시가 붙은 빌드 파일(assets/index-xxxx.js/css) 및 아이콘: 캐시 우선
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((res) => put(APP_CACHE, request, res)))
  )
})
