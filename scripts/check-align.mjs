// 자동 맞추기 점검용: mp3를 풀어서 앱과 같은 align() 을 돌리고 결과를 출력한다.
//   node scripts/check-align.mjs            → 전체 구절 요약
//   node scripts/check-align.mjs s1-02      → 한 구절의 어절별 시간
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MPEGDecoder } from 'mpg123-decoder'
import { tokenize } from '../src/lib/text.js'
import { detectSpeech, alignWords } from '../src/lib/align.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/passages.json'), 'utf8'))
const all = data.stages.flatMap(s => s.passages)
const only = process.argv[2]

for (const p of all) {
  if (only && p.id !== only) continue
  if (!p.audio) { console.log(p.id, '(녹음 없음)'); continue }
  const decoder = new MPEGDecoder()
  await decoder.ready
  const { channelData, sampleRate } = decoder.decode(new Uint8Array(fs.readFileSync(path.join(root, p.audio))))
  decoder.free()
  const samples = channelData[0]
  const words = tokenize(p.verses)
  const t0 = performance.now()
  const segs = detectSpeech(samples, sampleRate)
  const times = alignWords(words, segs)
  const ms = (performance.now() - t0).toFixed(0)
  const dur = samples.length / sampleRate
  if (!times) { console.log(p.id, '정렬 실패'); continue }

  // 절별: 시작 시각, 음절당 속도 (속도가 들쭉날쭉하면 정렬이 의심스러움)
  const verses = p.verses.map((v, vi) => {
    const ws = words.map((w, i) => [w, times[i]]).filter(([w]) => w.verseIndex === vi)
    const start = ws[0][1].start
    const end = ws[ws.length - 1][1].end
    const syl = ws.reduce((a, [w]) => a + w.syl, 0)
    return { n: v.n, start, end, rate: (end - start) / syl }
  })
  const rates = verses.map(v => v.rate)
  const spread = Math.max(...rates) / Math.min(...rates)
  console.log(`${p.id} ${p.ref.padEnd(14)} ${dur.toFixed(1)}s  쉼 ${segs.length - 1}개  어절 ${words.length}  ${ms}ms  ` +
    `절 시작: ${verses.map(v => `${v.n}:${v.start.toFixed(1)}`).join(' ')}  속도편차 x${spread.toFixed(2)}`)

  if (only) {
    words.forEach((w, i) => {
      const inPause = segs.some(([a]) => Math.abs(a - times[i].start) < 0.02)
      console.log(`  ${times[i].start.toFixed(2).padStart(6)}–${times[i].end.toFixed(2).padStart(6)} ${inPause ? '│' : ' '} ${w.verseEnd ? w.text + ' ⏎' : w.text}`)
    })
    console.log('  segments:', segs.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join(' '))
  }
}
