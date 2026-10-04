import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Karaoke from '../components/Karaoke.jsx'
import Segmented from '../components/Segmented.jsx'
import { Looper } from '../lib/looper.js'
import { tokenize } from '../lib/text.js'
import { analyze, autoWordTimes, applyMarks } from '../lib/timing.js'
import { load, save, KEYS } from '../lib/storage.js'
import { fmt } from '../lib/format.js'
import ps from './PassageScreen.module.css'
import pl from '../components/Player.module.css'
import styles from './ContinuousScreen.module.css'

// 연속듣기: 한 단계의 구절을 1번부터 끝까지 차례로 들려주고, 끝나면 다시 1번부터 (계속 반복)
// 재생기 하나(<audio> 하나)의 녹음 파일만 바꿔 가며 이어서 재생한다.

const EACH_OPTIONS = [1, 2, 3].map(v => ({ value: v, label: `${v}번` }))
const GAP_OPTIONS = [0, 1, 2, 3].map(v => ({ value: v, label: v ? `${v}초` : '없음' }))
const RATE_OPTIONS = [0.75, 1, 1.25].map(v => ({ value: v, label: `${v}×` }))
const DEFAULTS = { each: 1, gap: 1, rate: 1 }

export default function ContinuousScreen({ stage, passages, onBack, onOpen }) {
  // 녹음이 있는 구절만 순서대로
  const list = useMemo(() => passages.filter(p => p.audio), [passages])
  const n = list.length

  const audioRef = useRef(null)
  const [looper, setLooper] = useState(null)
  const [mode, setMode] = useState('stopped')
  const [count, setCount] = useState(0)
  const [duration, setDuration] = useState(0)
  const [opts, setOpts] = useState(() => ({ ...DEFAULTS, ...load(KEYS.cont, {}) }))
  const [idx, setIdx] = useState(() => {
    const i = list.findIndex(p => p.id === load(KEYS.contPos(stage), null))
    return i >= 0 ? i : 0
  })
  const [round, setRound] = useState(1) // 몇 바퀴째 (마지막 구절 → 1번으로 돌아갈 때마다 +1)
  const [waiting, setWaiting] = useState(false) // 구절 사이 쉬는 중
  const [analysis, setAnalysis] = useState(null)

  const looperRef = useRef(null)
  const idxRef = useRef(idx)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const waitTimer = useRef(0)
  const fillRef = useRef(null)
  const thumbRef = useRef(null)
  const timeRef = useRef(null)
  const trackRef = useRef(null)

  const passage = list[idx]
  const words = useMemo(() => (passage ? tokenize(passage.verses) : []), [passage])

  // 구절 바꾸기: 녹음 파일 교체 → (autoplay 면) 재생
  const goTo = useCallback((i, { autoplay, wrapped = false, wait = 0 } = {}) => {
    const l = looperRef.current
    if (!l || !n) return
    clearTimeout(waitTimer.current)
    setWaiting(false)
    const next = ((i % n) + n) % n
    idxRef.current = next
    setIdx(next)
    if (wrapped) setRound(r => r + 1)
    save(KEYS.contPos(stage), list[next].id)
    l.stop()
    l.audio.src = list[next].audio
    l.count = 0
    if (!autoplay) return
    if (wait > 0) {
      setWaiting(true)
      waitTimer.current = setTimeout(() => { setWaiting(false); l.play() }, wait * 1000)
    } else {
      l.play()
    }
  }, [n, list, stage])

  // ── 재생기 (화면에 들어올 때 한 번) ──
  useEffect(() => {
    if (!n) return
    const audio = audioRef.current
    audio.src = list[idxRef.current].audio
    const l = new Looper(audio)
    const o = optsRef.current
    l.setOptions({ repeat: o.each, gap: o.gap, rate: o.rate })
    looperRef.current = l
    // 한 구절을 정한 횟수만큼 다 들으면 → 다음 구절 (마지막이면 1번으로)
    l.onDone = () => {
      const cur = idxRef.current
      goTo(cur + 1, { autoplay: true, wrapped: cur + 1 >= n, wait: optsRef.current.gap })
    }
    const update = () => {
      setMode(l.mode)
      setCount(l.count)
      setDuration(l.duration)
    }
    const unsub = l.subscribe(update)
    setLooper(l)
    return () => {
      clearTimeout(waitTimer.current)
      unsub()
      l.destroy()
      looperRef.current = null
      setLooper(null)
    }
  }, [n])

  // ── 지금 구절의 글자 색칠 시간 ──
  useEffect(() => {
    if (!passage) return
    let alive = true
    setAnalysis(null)
    analyze(passage.audio)
      .then(a => {
        if (!alive) return
        const marks = load(KEYS.marks(passage.id), null)
        const auto = autoWordTimes(words, a)
        const valid = Array.isArray(marks) && marks.length === passage.verses.length
        setAnalysis({ times: applyMarks(words, auto, valid ? marks : null, a.duration) })
      })
      .catch(() => { if (alive) setAnalysis({ error: true }) })
    // 구절이 바뀌면 제목부터 보이게
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return () => { alive = false }
  }, [passage, words])

  // ── 진행바 (매 프레임 직접 갱신) ──
  useEffect(() => {
    if (!looper) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const d = looper.duration
      const p = d ? Math.min(100, (looper.time / d) * 100) + '%' : '0%'
      if (fillRef.current) fillRef.current.style.width = p
      if (thumbRef.current) thumbRef.current.style.left = p
      if (timeRef.current) timeRef.current.textContent = fmt(looper.time)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [looper])

  const seekFromPointer = (e) => {
    if (!looper?.duration) return
    const rect = trackRef.current.getBoundingClientRect()
    looper.seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * looper.duration)
  }

  const changeOpt = (key, value) => {
    const next = { ...opts, [key]: value }
    setOpts(next)
    save(KEYS.cont, next)
    looper?.setOptions(key === 'each' ? { repeat: value } : { [key]: value })
  }

  const playing = mode === 'playing' || mode === 'gap' || waiting
  const toggle = () => {
    if (!looper) return
    if (waiting) { clearTimeout(waitTimer.current); setWaiting(false); return }
    looper.toggle()
  }
  const stopAll = () => {
    clearTimeout(waitTimer.current)
    setWaiting(false)
    looper?.stop()
  }

  // ── 잠금화면·이어폰: 재생/멈춤 + 이전/다음 구절 ──
  useEffect(() => {
    if (!looper || !passage || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    try {
      ms.metadata = new MediaMetadata({
        title: passage.ref,
        artist: `${stage}단계 연속듣기 · ${idx + 1}/${n}`,
        album: '말씀암송',
        artwork: [{ src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      })
      ms.setActionHandler('play', () => looper.play())
      ms.setActionHandler('pause', () => looper.pause())
      ms.setActionHandler('stop', stopAll)
      ms.setActionHandler('nexttrack', () => goTo(idxRef.current + 1, { autoplay: true, wrapped: idxRef.current + 1 >= n }))
      ms.setActionHandler('previoustrack', () => goTo(idxRef.current - 1, { autoplay: true }))
    } catch {}
    return () => {
      try {
        for (const a of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack']) ms.setActionHandler(a, null)
      } catch {}
    }
  }, [looper, passage, idx, n, stage, goTo])

  // 키보드: Space 재생/멈춤, ← → 이전/다음 구절
  useEffect(() => {
    if (!looper) return
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === ' ' && tag !== 'BUTTON') { e.preventDefault(); toggle() }
      else if (e.key === 'ArrowRight') goTo(idxRef.current + 1, { autoplay: playing, wrapped: idxRef.current + 1 >= n })
      else if (e.key === 'ArrowLeft') goTo(idxRef.current - 1, { autoplay: playing })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const status = waiting
    ? '다음 구절까지 잠깐 쉬는 중…'
    : mode === 'gap'
      ? '잠깐 쉬고 다시…'
      : mode === 'stopped'
        ? `${n}구절을 차례로 계속 들려드려요`
        : `${round}바퀴째${opts.each > 1 ? ` · 이 구절 ${count + 1}/${opts.each}번` : ''}`

  if (!n) {
    return (
      <div className={ps.container}>
        <p className={styles.empty}>이 단계에는 아직 녹음이 없어요.</p>
      </div>
    )
  }

  return (
    <div className={ps.container}>
      <div className="zenith" aria-hidden="true" />
      <audio ref={audioRef} preload="auto" />

      <header className={ps.topBar}>
        <button className={ps.iconBtn} onClick={onBack} aria-label="목록으로">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className={ps.barTitle}>{stage}단계 연속듣기</span>
        <span className={styles.counter} aria-label={`${n}구절 중 ${idx + 1}번째`}>{idx + 1} / {n}</span>
      </header>

      <main className={ps.content}>
        <section className={ps.hero}>
          <span className={ps.eyebrow}>{stage}단계 · {String(passage.no).padStart(2, '0')}번 · {passage.verses.length}절</span>
          <h1 className={ps.title}>{passage.ref}</h1>
          <button className={styles.openLink} onClick={() => { stopAll(); onOpen(passage.id) }}>
            이 구절만 따로 반복하기 ›
          </button>
        </section>

        <section className={ps.card} aria-label="본문">
          <Karaoke
            key={passage.id}
            verses={passage.verses}
            words={words}
            times={analysis?.times || null}
            looper={looper}
            range={null}
            masked={EMPTY}
            onWordTap={(i) => analysis?.times && looper?.playFrom(Math.max(0, analysis.times[i].start - 0.08))}
          />
        </section>

        <section className={ps.card}>
          <h2 className={ps.cardTitle}>연속듣기 설정</h2>
          <div className={ps.settings}>
            <Segmented label="구절마다" options={EACH_OPTIONS} value={opts.each} onChange={v => changeOpt('each', v)} />
            <Segmented label="쉬는 시간" options={GAP_OPTIONS} value={opts.gap} onChange={v => changeOpt('gap', v)} />
            <Segmented label="속도" options={RATE_OPTIONS} value={opts.rate} onChange={v => changeOpt('rate', v)} />
          </div>
          <p className={ps.cardHint}>마지막 구절이 끝나면 다시 1번부터 계속 들려드려요. 멈출 때는 ■ 정지를 누르세요.</p>
        </section>

        <section className={ps.card}>
          <h2 className={ps.cardTitle}>재생 순서</h2>
          <ol className={styles.queue}>
            {list.map((p, i) => (
              <li key={p.id}>
                <button
                  className={`${styles.qItem} ${i === idx ? styles.qCurrent : ''}`}
                  onClick={() => goTo(i, { autoplay: true })}
                  aria-current={i === idx ? 'true' : undefined}
                >
                  <span className={styles.qNo}>{String(p.no).padStart(2, '0')}</span>
                  <span className={styles.qRef}>{p.ref}</span>
                  {i === idx && playing && <span className={styles.qNow} aria-hidden="true">♪</span>}
                </button>
              </li>
            ))}
          </ol>
          {n < passages.length && (
            <p className={ps.cardHint}>녹음이 없는 구절 {passages.length - n}개는 건너뛰어요.</p>
          )}
        </section>
      </main>

      {/* 하단 플레이어 */}
      <footer className={ps.playerWrap}>
        <div className={pl.player}>
          <div
            className={pl.bar}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); seekFromPointer(e) }}
            onPointerMove={(e) => { if (e.buttons) seekFromPointer(e) }}
            role="slider"
            aria-label="재생 위치"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            tabIndex={0}
          >
            <div className={pl.track} ref={trackRef}>
              <div className={pl.fill} ref={fillRef} />
              <div className={pl.thumb} ref={thumbRef} />
            </div>
          </div>
          <div className={pl.timeRow}>
            <span ref={timeRef}>0:00.0</span>
            <span className={pl.status} aria-live="polite">{status}</span>
            <span>{fmt(duration)}</span>
          </div>

          <div className={pl.controls}>
            <button className={pl.markBtn} onClick={() => goTo(idx - 1, { autoplay: playing })} aria-label="이전 구절">
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 5h2v14H6zM20 5.14v13.72L9.5 12 20 5.14z" /></svg>
              이전
            </button>
            <div className={pl.center}>
              <button className={pl.stopBtn} onClick={stopAll} aria-label="정지" disabled={mode === 'stopped' && !waiting}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              </button>
              <button className={pl.playBtn} onClick={toggle} aria-label={playing ? '일시정지' : '재생'}>
                {playing ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="30" height="30">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="30" height="30"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                )}
              </button>
            </div>
            <button
              className={pl.markBtn}
              onClick={() => goTo(idx + 1, { autoplay: playing, wrapped: idx + 1 >= n })}
              aria-label="다음 구절"
            >
              다음
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M16 5h2v14h-2zM4 5.14v13.72L14.5 12 4 5.14z" /></svg>
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

const EMPTY = new Set()
