// 녹음 WAV → 앱용 mp3 (기존 녹음과 같은 형식: 모노 32kHz 48kbps, 앞뒤 무음 정리, 음량 맞춤)
//   node scripts/wav2mp3.mjs <입력.wav> <출력.mp3>
//   예) node scripts/wav2mp3.mjs ../data/1_12.wav public/audio/s1-12.mp3
import fs from 'node:fs'
import { Mp3Encoder } from '@breezystack/lamejs'

const [, , input, output] = process.argv
if (!input || !output) {
  console.log('사용법: node scripts/wav2mp3.mjs <입력.wav> <출력.mp3>')
  process.exit(1)
}

const OUT_RATE = 32000
const KBPS = 48
const TARGET_P95_DB = -15 // 기존 녹음들의 말소리 음량 (10ms 구간 상위 5%)
const PEAK_LIMIT = 0.95
const PAD = 0.15 // 앞뒤에 남길 무음 (초)

// ── WAV 읽기 (PCM 16/24bit, float32) ──
function readWav(buf) {
  let o = 12
  let fmt = null
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4)
    const size = buf.readUInt32LE(o + 4)
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(o + 8),
        channels: buf.readUInt16LE(o + 10),
        rate: buf.readUInt32LE(o + 12),
        bits: buf.readUInt16LE(o + 22),
      }
    } else if (id === 'data') {
      const { channels, bits, format } = fmt
      const bytes = bits / 8
      const frames = Math.floor(size / (bytes * channels))
      const mono = new Float32Array(frames)
      for (let f = 0; f < frames; f++) {
        let sum = 0
        for (let c = 0; c < channels; c++) {
          const p = o + 8 + (f * channels + c) * bytes
          if (format === 3) sum += buf.readFloatLE(p)
          else if (bits === 16) sum += buf.readInt16LE(p) / 32768
          else if (bits === 24) sum += buf.readIntLE(p, 3) / 8388608
          else throw new Error(`지원하지 않는 형식: ${bits}bit`)
        }
        mono[f] = sum / channels
      }
      return { samples: mono, rate: fmt.rate }
    }
    o += 8 + size + (size % 2)
  }
  throw new Error('WAV data 청크가 없음')
}

// ── 리샘플 (windowed-sinc) ──
function resample(x, from, to) {
  if (from === to) return x
  const ratio = from / to
  const n = Math.floor(x.length / ratio)
  const y = new Float32Array(n)
  const cutoff = Math.min(1, to / from) * 0.92
  const R = 16
  for (let i = 0; i < n; i++) {
    const c = i * ratio
    const c0 = Math.floor(c)
    let acc = 0
    let wsum = 0
    for (let k = c0 - R + 1; k <= c0 + R; k++) {
      if (k < 0 || k >= x.length) continue
      const d = k - c
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * cutoff * d) / (Math.PI * cutoff * d)
      const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / R)
      const w = sinc * win
      acc += x[k] * w
      wsum += w
    }
    y[i] = acc / wsum
  }
  return y
}

function frameDb(x, rate) {
  const hop = Math.round(rate / 100)
  const dbs = []
  for (let o = 0; o + hop <= x.length; o += hop) {
    let s = 0
    for (let i = 0; i < hop; i++) s += x[o + i] * x[o + i]
    dbs.push(10 * Math.log10(s / hop + 1e-10))
  }
  return dbs
}

const wav = readWav(fs.readFileSync(input))
let x = resample(wav.samples, wav.rate, OUT_RATE)

// 직류 성분 제거
const mean = x.reduce((a, v) => a + v, 0) / x.length
x = x.map(v => v - mean)

// 앞뒤 무음 정리
const dbs = frameDb(x, OUT_RATE)
const sorted = [...dbs].sort((a, b) => a - b)
const thr = Math.max(sorted[Math.floor(sorted.length * 0.05)] + 10, sorted[Math.floor(sorted.length * 0.95)] - 35)
const first = dbs.findIndex(d => d > thr)
const last = dbs.length - 1 - [...dbs].reverse().findIndex(d => d > thr)
const hop = OUT_RATE / 100
const a = Math.max(0, first * hop - PAD * OUT_RATE)
const b = Math.min(x.length, (last + 1) * hop + PAD * OUT_RATE)
x = x.slice(a, b)

// 음량 맞춤 (말소리 크기를 기존 녹음에 맞추고, 최대값은 넘지 않게)
const dbs2 = frameDb(x, OUT_RATE).sort((p, q) => p - q)
const p95 = dbs2[Math.floor(dbs2.length * 0.95)]
let gain = Math.pow(10, (TARGET_P95_DB - p95) / 20)
const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
gain = Math.min(gain, PEAK_LIMIT / peak)

// 페이드 인/아웃 10ms (잘린 자리의 딸깍 소리 방지)
const fade = Math.round(OUT_RATE * 0.01)
const pcm = new Int16Array(x.length)
for (let i = 0; i < x.length; i++) {
  let v = x[i] * gain
  if (i < fade) v *= i / fade
  if (i > x.length - fade) v *= (x.length - i) / fade
  pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)))
}

// mp3 인코딩
const enc = new Mp3Encoder(1, OUT_RATE, KBPS)
const chunks = []
for (let i = 0; i < pcm.length; i += 1152) {
  const out = enc.encodeBuffer(pcm.subarray(i, i + 1152))
  if (out.length) chunks.push(Buffer.from(out))
}
const tail = enc.flush()
if (tail.length) chunks.push(Buffer.from(tail))
fs.writeFileSync(output, Buffer.concat(chunks))

console.log(`${input} → ${output}`)
console.log(`  ${(wav.samples.length / wav.rate).toFixed(1)}s → ${(pcm.length / OUT_RATE).toFixed(1)}s, ` +
  `음량 ${(20 * Math.log10(gain)).toFixed(1)}dB, ${(Buffer.concat(chunks).length / 1024).toFixed(0)}KB`)
