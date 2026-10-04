// 녹음과 본문 자동 맞추기 (절·어절별 시간 추정)
//
// 1) 소리 크기를 10ms 단위로 재서 "쉼"(짧은 무음)을 찾는다 → 녹음이 말소리 덩어리 여러 개로 나뉜다.
// 2) 말소리 덩어리들을 어절들에 순서대로 짝지운다 (동적 계획법).
//    덩어리 길이 ≈ 발화 속도 × 그 어절들의 음절 수 가 되도록, 그리고 긴 쉼은 절 끝·쉼표 뒤에 오도록.
//    잡음 때문에 생긴 가짜 쉼은 앞뒤 덩어리를 합쳐서 무시할 수 있다.
// 3) 한 덩어리 안의 어절들은 음절 수에 비례해 시간을 나눈다.
//
// 결과는 어절마다 { start, end } (초). 정확한 음성 인식이 아니라 추정이므로
// 화면의 "타이밍 맞추기"로 절 경계를 사람이 고칠 수 있게 한다.

const HOP = 0.01 // 10ms
const MIN_PAUSE = 0.14 // 이보다 짧은 무음은 쉼으로 보지 않음
const MIN_SPEECH = 0.06 // 이보다 짧은 소리는 잡음으로 봄
const MAX_MERGE = 4 // 한 묶음에 합칠 수 있는 말소리 덩어리 수
const MAX_WORDS = 60 // 한 묶음에 들어갈 수 있는 어절 수

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

// 말소리 구간 찾기 → [[start, end], ...] (초)
export function detectSpeech(samples, sampleRate) {
  const hop = Math.round(sampleRate * HOP)
  const win = hop * 2
  const n = Math.max(1, Math.floor((samples.length - win) / hop))
  const db = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    const o = f * hop
    for (let i = 0; i < win; i++) sum += samples[o + i] * samples[o + i]
    db[f] = 10 * Math.log10(sum / win + 1e-10)
  }
  const sorted = Float32Array.from(db).sort()
  const thr = Math.max(percentile(sorted, 0.05) + 8, percentile(sorted, 0.95) - 32)

  // 소리 있음/없음 → 구간
  let segs = []
  let s = -1
  for (let f = 0; f < n; f++) {
    const on = db[f] > thr
    if (on && s < 0) s = f
    if (!on && s >= 0) { segs.push([s * HOP, f * HOP]); s = -1 }
  }
  if (s >= 0) segs.push([s * HOP, n * HOP])

  // 짧은 쉼은 메우고, 짧은 소리는 버림
  const merged = []
  for (const g of segs) {
    const last = merged[merged.length - 1]
    if (last && g[0] - last[1] < MIN_PAUSE) last[1] = g[1]
    else merged.push([...g])
  }
  segs = merged.filter(([a, b]) => b - a >= MIN_SPEECH)
  return segs
}

// words: tokenize() 결과, segs: detectSpeech() 결과 → [{start, end}] (어절별)
export function alignWords(words, segs) {
  const n = words.length
  const m = segs.length
  if (!n) return []
  if (!m) return null

  const segDur = segs.map(([a, b]) => b - a)
  const pauseAfter = segs.map((g, j) => (j + 1 < m ? segs[j + 1][0] - g[1] : 0))
  const totalSpeech = segDur.reduce((a, b) => a + b, 0)
  const totalSyl = words.reduce((a, w) => a + w.syl, 0)
  const rate = totalSpeech / totalSyl // 음절당 초

  // 누적합 (구간 합을 O(1)로)
  const sylCum = [0]
  for (const w of words) sylCum.push(sylCum[sylCum.length - 1] + w.syl)
  const durCum = [0]
  for (const d of segDur) durCum.push(durCum[durCum.length - 1] + d)

  // 어절 i 다음 자리에 쉼 L 이 올 때의 비용 (절 끝·쉼표 뒤의 쉼은 자연스러움)
  const gapCost = (i, L) => {
    const w = words[i]
    const l = Math.min(L, 2)
    if (w.verseEnd) return -0.9 * l
    if (w.punct) return -0.5 * l
    // "네 / 이 / 그 / 또" 같은 한 음절 꾸밈말 뒤에서는 잘 쉬지 않음 (뒷말에 붙여 읽음)
    if (w.syl <= 1) return 0.5 * l
    return 0.15 * Math.max(0, l - 0.5) // 문장 중간의 긴 쉼은 약간 어색함
  }

  const INF = 1e18
  // dp[j][i]: 덩어리 j개, 어절 i개까지 짝지었을 때 최소 비용
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(INF))
  const from = Array.from({ length: m + 1 }, () => new Int32Array((n + 1) * 2).fill(-1))
  dp[0][0] = 0

  for (let j = 1; j <= m; j++) {
    for (let j0 = Math.max(0, j - MAX_MERGE); j0 < j; j0++) {
      const D = durCum[j] - durCum[j0]
      // 합친 덩어리 사이의 쉼은 무시하는 셈 → 길수록 비쌈
      let mergeCost = 0
      for (let k = j0; k < j - 1; k++) mergeCost += 0.4 + 1.2 * Math.min(pauseAfter[k], 1.5)
      const row0 = dp[j0]
      for (let i = 1; i <= n; i++) {
        const iLo = Math.max(0, i - MAX_WORDS)
        for (let i0 = iLo; i0 < i; i0++) {
          const prev = row0[i0]
          if (prev >= INF) continue
          const E = rate * (sylCum[i] - sylCum[i0])
          const diff = D - E
          let c = prev + (diff * diff) / (E + 0.3) + mergeCost
          if (j < m && i < n) c += gapCost(i - 1, pauseAfter[j - 1])
          if ((j === m) !== (i === n)) continue // 마지막 덩어리 = 마지막 어절
          if (c < dp[j][i]) {
            dp[j][i] = c
            from[j][i * 2] = j0
            from[j][i * 2 + 1] = i0
          }
        }
      }
    }
  }
  if (dp[m][n] >= INF) return null

  // 역추적 → 묶음 목록
  const groups = []
  for (let j = m, i = n; j > 0;) {
    const j0 = from[j][i * 2]
    const i0 = from[j][i * 2 + 1]
    groups.push({ j0, j, i0, i })
    j = j0
    i = i0
  }
  groups.reverse()

  // 묶음 안: 말소리 구간(합친 쉼 제외)에 음절 비례로 어절 배치
  const out = new Array(n)
  for (const g of groups) {
    const parts = segs.slice(g.j0, g.j)
    const speech = durCum[g.j] - durCum[g.j0]
    const syl = sylCum[g.i] - sylCum[g.i0]
    const at = (frac) => {
      let t = frac * speech
      for (const [a, b] of parts) {
        if (t <= b - a) return a + t
        t -= b - a
      }
      return parts[parts.length - 1][1]
    }
    for (let i = g.i0; i < g.i; i++) {
      out[i] = {
        start: at((sylCum[i] - sylCum[g.i0]) / syl),
        end: at((sylCum[i + 1] - sylCum[g.i0]) / syl),
      }
    }
  }
  return out
}

// 녹음이 없거나 분석이 실패했을 때: 전체 길이를 음절 수로 나눔
export function proportionalWords(words, duration) {
  const total = words.reduce((a, w) => a + w.syl, 0)
  let acc = 0
  return words.map(w => {
    const start = (acc / total) * duration
    acc += w.syl
    return { start, end: (acc / total) * duration }
  })
}

export function align(samples, sampleRate, words) {
  const segs = detectSpeech(samples, sampleRate)
  const duration = samples.length / sampleRate
  return alignWords(words, segs) || proportionalWords(words, duration)
}
