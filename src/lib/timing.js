// 어절별 시간 만들기: 녹음 파일을 브라우저에서 풀어 자동 맞추기(align.js)를 돌리고,
// 사용자가 직접 맞춘 절 시작 시각(verseMarks)이 있으면 그에 맞춰 보정한다.
import { detectSpeech, alignWords, proportionalWords } from './align.js'

const ANALYSIS_RATE = 22050
const cache = new Map() // 오디오 경로 → { segs, duration } (한 번 분석한 녹음은 다시 풀지 않음)

async function decode(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`녹음을 불러오지 못했어요 (${res.status})`)
  const buf = await res.arrayBuffer()
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  let ctx
  try {
    ctx = new Ctx(1, 1, ANALYSIS_RATE)
  } catch {
    ctx = new Ctx(1, 1, 44100) // 낮은 샘플레이트를 못 쓰는 오래된 사파리
  }
  // 옛 사파리는 콜백 방식만 지원
  const audio = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject)
    if (p && p.then) p.then(resolve, reject)
  })
  return audio
}

export async function analyze(url) {
  if (cache.has(url)) return cache.get(url)
  const audio = await decode(url)
  const samples = audio.getChannelData(0)
  const result = { segs: detectSpeech(samples, audio.sampleRate), duration: audio.duration }
  cache.set(url, result)
  return result
}

export function autoWordTimes(words, analysis) {
  return alignWords(words, analysis.segs) || proportionalWords(words, analysis.duration)
}

// 절 시작 시각 (자동 맞추기 결과에서)
export function verseStartsOf(words, times, verseCount) {
  const starts = new Array(verseCount).fill(null)
  words.forEach((w, i) => {
    if (starts[w.verseIndex] == null) starts[w.verseIndex] = times[i].start
  })
  return starts
}

// 직접 맞춘 절 시작(marks)에 맞춰 어절 시간을 절 단위로 늘이고 줄인다.
// 자동으로 찾은 절 구간 [a_v, a_{v+1}) 을 사용자 구간 [u_v, u_{v+1}) 으로 1차 변환.
export function applyMarks(words, times, marks, duration) {
  if (!marks) return times
  const verseCount = marks.length
  const auto = verseStartsOf(words, times, verseCount)
  const lastEnd = times[times.length - 1].end
  const autoEnd = (v) => (v + 1 < verseCount ? auto[v + 1] : lastEnd)
  const userEnd = (v) => {
    if (v + 1 < verseCount) return marks[v + 1]
    // 마지막 절: 자동값과 같은 비율로 (녹음 끝을 넘지 않게)
    return Math.min(duration || Infinity, marks[v] + (lastEnd - auto[v]))
  }
  return times.map((t, i) => {
    const v = words[i].verseIndex
    const a0 = auto[v]
    const a1 = autoEnd(v)
    const u0 = marks[v]
    const u1 = Math.max(u0 + 0.2, userEnd(v))
    const k = a1 > a0 ? (u1 - u0) / (a1 - a0) : 1
    return { start: u0 + (t.start - a0) * k, end: u0 + (t.end - a0) * k }
  })
}

// 사용자가 누른 순간을 근처의 "말소리가 시작되는 지점"에 붙인다.
// 사람은 소리를 듣고 조금 늦게 누르므로 뒤쪽보다 앞쪽을 넓게 본다.
export function snapToOnset(t, segs) {
  let best = null
  for (const [a] of segs) {
    if (a < t - 0.9 || a > t + 0.25) continue
    if (best == null || Math.abs(a - (t - 0.2)) < Math.abs(best - (t - 0.2))) best = a
  }
  return best ?? Math.max(0, t - 0.2)
}

// 지금 재생 위치의 어절 번호 (이분 탐색). 시작 전이면 -1
export function wordAt(times, t) {
  let lo = 0
  let hi = times.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid].start <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}
