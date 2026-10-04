import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Karaoke from '../components/Karaoke.jsx'
import Player from '../components/Player.jsx'
import Segmented from '../components/Segmented.jsx'
import { Looper } from '../lib/looper.js'
import { tokenize } from '../lib/text.js'
import { analyze, autoWordTimes, applyMarks, verseStartsOf, snapToOnset } from '../lib/timing.js'
import { maskedSet, MASK_LEVELS } from '../lib/mask.js'
import { load, save, KEYS, loadSettings } from '../lib/storage.js'
import { fmt } from '../lib/format.js'
import styles from './PassageScreen.module.css'

const REPEAT_OPTIONS = [
  { value: 0, label: '∞' },
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
  { value: 10, label: '10' },
]
const GAP_OPTIONS = [0, 1, 2, 3].map(v => ({ value: v, label: v ? `${v}초` : '없음' }))
const RATE_OPTIONS = [0.75, 1, 1.25].map(v => ({ value: v, label: `${v}×` }))
const MIN_RANGE = 0.3

const round1 = (t) => Math.round(t * 10) / 10

function validRange(r) {
  return r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start >= MIN_RANGE ? r : null
}

export default function PassageScreen({ passage, prev, next, done, onToggleDone, onGo, onBack }) {
  const audioRef = useRef(null)
  const [looper, setLooper] = useState(null)
  const [snap, setSnap] = useState({ mode: 'stopped', count: 0, repeat: 0, duration: 0, time: 0 })
  const [settings, setSettings] = useState(loadSettings)
  const [range, setRange] = useState(() => validRange(load(KEYS.ab(passage.id), null)))
  const [maskLevel, setMaskLevel] = useState(() => load(KEYS.mask(passage.id), 0))
  const [analysis, setAnalysis] = useState(null) // { segs, duration, auto } | { error }
  const [marks, setMarks] = useState(() => {
    const m = load(KEYS.marks(passage.id), null)
    return Array.isArray(m) && m.length === passage.verses.length ? m : null
  })
  const [marking, setMarking] = useState(null) // 타이밍 맞추기 중: { marks: [...], savedRange }
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(0)

  const hasAudio = !!passage.audio
  const words = useMemo(() => tokenize(passage.verses), [passage])
  const masked = useMemo(() => maskedSet(passage.id, words.length, maskLevel), [passage.id, words.length, maskLevel])

  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  // ── 재생기 ──
  useEffect(() => {
    if (!hasAudio) return
    const l = new Looper(audioRef.current)
    const s = loadSettings()
    l.setOptions({ repeat: s.repeat, gap: s.gap, rate: s.rate })
    l.setRange(validRange(load(KEYS.ab(passage.id), null)))
    const update = () => setSnap({ mode: l.mode, count: l.count, repeat: l.repeat, duration: l.duration, time: l.time })
    const unsub = l.subscribe(update)
    update()
    setLooper(l)
    return () => { unsub(); l.destroy(); setLooper(null) }
  }, [passage.id, hasAudio])

  // ── 녹음 분석 → 어절별 시간 ──
  useEffect(() => {
    if (!hasAudio) return
    let alive = true
    analyze(passage.audio)
      .then(a => { if (alive) setAnalysis({ ...a, auto: autoWordTimes(words, a) }) })
      .catch(() => { if (alive) setAnalysis({ error: true }) })
    return () => { alive = false }
  }, [passage.audio, hasAudio, words])

  const times = useMemo(() => {
    if (!analysis?.auto) return null
    return applyMarks(words, analysis.auto, marks, analysis.duration)
  }, [analysis, marks, words])
  const verseStarts = useMemo(() => (times ? verseStartsOf(words, times, passage.verses.length) : null), [times, words, passage])
  const duration = snap.duration || analysis?.duration || 0

  // 절 a~b 의 구간 (앞은 말소리가 잘리지 않게 살짝 여유, 끝은 다음 절 시작 직전까지)
  const verseRange = useCallback((a, b) => {
    const start = Math.max(0, verseStarts[a] - 0.12)
    const lastEnd = times[times.length - 1].end
    const end = b + 1 < verseStarts.length ? verseStarts[b + 1] - 0.08 : Math.min(duration || Infinity, lastEnd + 0.35)
    return { start: round1(start), end: round1(end) }
  }, [verseStarts, times, duration])

  // ── 구간 ──
  const commitRange = useCallback((r) => {
    if (!r) {
      setRange(null)
      save(KEYS.ab(passage.id), null)
      looper?.setRange(null)
      return
    }
    let start = round1(Math.max(0, r.start))
    let end = round1(duration ? Math.min(duration, r.end) : r.end)
    if (start > end) {
      ;[start, end] = [end, start]
      showToast('시작이 끝보다 늦어서 서로 바꿨어요')
    }
    if (end - start < MIN_RANGE) {
      showToast('구간이 너무 짧아요')
      return
    }
    const next = { start, end }
    // 전체와 같으면 구간 없음으로
    if (start <= 0.05 && duration && end >= duration - 0.05) {
      commitRange(null)
      return
    }
    setRange(next)
    save(KEYS.ab(passage.id), next)
    looper?.setRange(next)
  }, [duration, looper, passage.id, showToast])

  const setStartHere = () => {
    if (!looper) return
    commitRange({ start: looper.time, end: range ? range.end : duration })
  }
  const setEndHere = () => {
    if (!looper) return
    commitRange({ start: range ? range.start : 0, end: looper.time })
  }
  const nudge = (which, delta) => {
    const base = range || { start: 0, end: duration }
    commitRange({ ...base, [which]: base[which] + delta })
  }

  // 절 번호 누르기: 그 절만 반복 (같은 절을 한 번 더 누르면 구간 해제)
  const onVerseTap = useCallback((vi) => {
    if (!times || !looper) return
    const r = verseRange(vi, vi)
    if (range && Math.abs(range.start - r.start) < 0.05 && Math.abs(range.end - r.end) < 0.05) {
      commitRange(null)
      showToast('구간을 지웠어요 — 전체를 반복해요')
      return
    }
    commitRange(r)
    looper.playFrom(r.start)
    showToast(`${passage.verses[vi].n}절만 반복해요`)
  }, [times, looper, verseRange, range, commitRange, passage, showToast])

  // 단어 누르기: 거기서부터 재생
  const onWordTap = useCallback((i) => {
    if (!times || !looper || marking) return
    looper.playFrom(Math.max(0, times[i].start - 0.08))
  }, [times, looper, marking])

  // 절로 고르기 (선택 상자)
  const selected = useMemo(() => {
    if (!verseStarts) return { a: '', b: '' }
    const last = verseStarts.length - 1
    if (!range) return { a: 0, b: last }
    let a = ''
    let b = ''
    for (let v = 0; v <= last; v++) {
      const r = verseRange(v, v)
      if (Math.abs(r.start - range.start) < 0.15) a = v
      if (Math.abs(r.end - range.end) < 0.15) b = v
    }
    return { a, b }
  }, [range, verseStarts, verseRange])

  const pickVerses = (a, b) => {
    const last = verseStarts.length - 1
    a = a === '' ? 0 : Number(a)
    b = b === '' ? last : Number(b)
    if (a > b) [a, b] = [b, a]
    if (a === 0 && b === last) commitRange(null)
    else commitRange(verseRange(a, b))
  }

  // ── 설정 ──
  const changeSetting = (key, value) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    save(KEYS.settings, { ...loadSettings(), [key]: value })
    looper?.setOptions({ [key]: value })
  }

  const changeMask = (level) => {
    setMaskLevel(level)
    save(KEYS.mask(passage.id), level || null)
  }

  // ── 타이밍 맞추기 (절 경계 직접 표시) ──
  const startMarking = () => {
    if (!looper || !analysis?.segs) return
    const first = analysis.segs[0]?.[0] ?? 0
    setMarking({ marks: [round1(Math.max(0, first))], savedRange: range })
    looper.stop()
    looper.setRange(null)
    looper.setOptions({ repeat: 1, gap: 0 })
    looper.playFrom(0)
  }
  const endMarking = (finalMarks) => {
    const saved = marking?.savedRange ?? null
    setMarking(null)
    looper.stop()
    looper.setOptions({ repeat: settings.repeat, gap: settings.gap })
    looper.setRange(saved)
    if (finalMarks) {
      setMarks(finalMarks)
      save(KEYS.marks(passage.id), finalMarks)
      showToast('절 타이밍을 저장했어요')
    }
  }
  const tapMark = () => {
    const t = looper.time
    const prevMark = marking.marks[marking.marks.length - 1]
    let m = snapToOnset(t, analysis.segs)
    if (m <= prevMark + 0.3) m = Math.max(prevMark + 0.3, t - 0.2)
    const nextMarks = [...marking.marks, round1(m)]
    if (nextMarks.length === passage.verses.length) endMarking(nextMarks)
    else setMarking({ ...marking, marks: nextMarks })
  }
  const restartMarking = () => {
    setMarking({ ...marking, marks: marking.marks.slice(0, 1) })
    looper.playFrom(0)
  }
  const resetMarks = () => {
    setMarks(null)
    save(KEYS.marks(passage.id), null)
    showToast('자동 맞춤으로 되돌렸어요')
  }

  // ── 잠금화면·이어폰 버튼 (Media Session) ──
  useEffect(() => {
    if (!looper || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    try {
      ms.metadata = new MediaMetadata({
        title: passage.ref,
        artist: '말씀암송',
        album: `${passage.stage}단계`,
        artwork: [{ src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      })
      ms.setActionHandler('play', () => looper.play())
      ms.setActionHandler('pause', () => looper.pause())
      ms.setActionHandler('stop', () => looper.stop())
    } catch {}
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('stop', null)
      } catch {}
    }
  }, [looper, passage])

  // ── 키보드: Space 재생/멈춤, [ 여기부터, ] 여기까지, Esc 정지 ──
  useEffect(() => {
    if (!looper) return
    const onKey = (e) => {
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'SUMMARY') { e.preventDefault(); looper.toggle() }
      else if (e.key === '[') setStartHere()
      else if (e.key === ']') setEndHere()
      else if (e.key === 'Escape') looper.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const verses = passage.verses
  const multiVerse = verses.length > 1
  const shownRange = range || (duration ? { start: 0, end: duration } : null)

  return (
    <div className={styles.container}>
      <div className="zenith" aria-hidden="true" />
      {hasAudio && <audio ref={audioRef} src={passage.audio} preload="auto" />}

      <header className={styles.topBar}>
        <button className={styles.iconBtn} onClick={onBack} aria-label="목록으로">
          <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <span className={styles.barTitle}>{passage.stage}단계 · {String(passage.no).padStart(2, '0')}</span>
        <button
          className={`${styles.doneBtn} ${done ? styles.doneOn : ''}`}
          onClick={onToggleDone}
          aria-pressed={done}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {done ? '암송 완료' : '완료 표시'}
        </button>
      </header>

      {/* 타이밍 맞추기 안내 */}
      {marking && (
        <div className={styles.markBanner} role="region" aria-label="타이밍 맞추기">
          <p className={styles.markTitle}>절 타이밍 맞추기</p>
          <p className={styles.markDesc}>
            녹음을 들으며 <b>새 절이 시작되는 순간</b> 아래 버튼을 누르세요. 조금 늦게 눌러도 가까운 말소리 시작점에 맞춰져요.
          </p>
          <button className={styles.markTap} onClick={tapMark}>
            {verses[marking.marks.length].n}절 시작
            <span className={styles.markCount}>{marking.marks.length} / {verses.length}</span>
          </button>
          <div className={styles.markFoot}>
            <button className={styles.linkBtn} onClick={restartMarking}>처음부터 다시</button>
            <button className={styles.linkBtn} onClick={() => endMarking(null)}>취소</button>
          </div>
        </div>
      )}

      <main className={styles.content}>
        <section className={styles.hero}>
          <span className={styles.eyebrow}>{passage.stage}단계 · {verses.length}절</span>
          <h1 className={styles.title}>{passage.ref}</h1>
          {hasAudio && (
            <p className={styles.hint}>
              {analysis?.error
                ? '녹음을 분석하지 못해 글자 색칠은 쉬어요'
                : !times
                  ? '녹음에 맞춰 글자를 준비하는 중…'
                  : multiVerse
                    ? '단어를 누르면 거기서부터, 절 번호를 누르면 그 절만 반복해요'
                    : '단어를 누르면 거기서부터 들려드려요'}
            </p>
          )}
        </section>

        <section className={styles.card} aria-label="본문">
          <Karaoke
            verses={verses}
            words={words}
            times={times}
            looper={looper}
            range={marking ? null : range}
            masked={masked}
            onWordTap={onWordTap}
            onVerseTap={onVerseTap}
          />
        </section>

        {!hasAudio && (
          <section className={`${styles.card} ${styles.notice}`}>
            <p className={styles.noticeTitle}>아직 녹음이 없어요</p>
            <p className={styles.noticeDesc}>녹음 파일이 추가되면 여기서 바로 들을 수 있어요.</p>
          </section>
        )}

        {hasAudio && (
          <>
            {/* 구간 반복 */}
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>구간 반복</h2>
                {range ? (
                  <button className={styles.clearBtn} onClick={() => { commitRange(null); showToast('구간을 지웠어요 — 전체를 반복해요') }}>
                    구간 지우기
                  </button>
                ) : (
                  <span className={styles.cardNote}>지금은 전체 반복</span>
                )}
              </div>

              {verseStarts && multiVerse && (
                <div className={styles.versePick}>
                  <span className={styles.pickLabel}>절로 고르기</span>
                  <select
                    className={styles.select}
                    value={selected.a}
                    onChange={e => pickVerses(e.target.value, selected.b)}
                    aria-label="시작 절"
                  >
                    {selected.a === '' && <option value="">—</option>}
                    {verses.map((v, i) => <option key={v.n} value={i}>{v.n}절</option>)}
                  </select>
                  <span className={styles.pickTilde}>~</span>
                  <select
                    className={styles.select}
                    value={selected.b}
                    onChange={e => pickVerses(selected.a, e.target.value)}
                    aria-label="끝 절"
                  >
                    {selected.b === '' && <option value="">—</option>}
                    {verses.map((v, i) => <option key={v.n} value={i}>{v.n}절</option>)}
                  </select>
                </div>
              )}

              {shownRange && ['start', 'end'].map(which => (
                <div key={which} className={styles.nudgeRow}>
                  <span className={styles.nudgeLabel}>
                    <span className={styles.abIcon}>{which === 'start' ? 'A' : 'B'}</span>
                    {which === 'start' ? '시작' : '끝'}
                  </span>
                  <button className={styles.nudge} onClick={() => nudge(which, -0.5)} aria-label={`${which === 'start' ? '시작' : '끝'} 0.5초 앞으로`}>−0.5</button>
                  <button className={styles.nudge} onClick={() => nudge(which, -0.1)} aria-label={`${which === 'start' ? '시작' : '끝'} 0.1초 앞으로`}>−0.1</button>
                  <span className={styles.nudgeValue}>{fmt(shownRange[which])}</span>
                  <button className={styles.nudge} onClick={() => nudge(which, 0.1)} aria-label={`${which === 'start' ? '시작' : '끝'} 0.1초 뒤로`}>+0.1</button>
                  <button className={styles.nudge} onClick={() => nudge(which, 0.5)} aria-label={`${which === 'start' ? '시작' : '끝'} 0.5초 뒤로`}>+0.5</button>
                </div>
              ))}
              <p className={styles.cardHint}>
                재생하면서 아래 <b>여기부터</b> · <b>여기까지</b>를 누르거나, 진행바의 <b>A</b> · <b>B</b> 손잡이를 끌어도 돼요.
              </p>
            </section>

            {/* 반복 설정 */}
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>반복 설정</h2>
              <div className={styles.settings}>
                <Segmented label="반복 횟수" options={REPEAT_OPTIONS} value={settings.repeat} onChange={v => changeSetting('repeat', v)} />
                <Segmented label="쉬는 시간" options={GAP_OPTIONS} value={settings.gap} onChange={v => changeSetting('gap', v)} />
                <Segmented label="속도" options={RATE_OPTIONS} value={settings.rate} onChange={v => changeSetting('rate', v)} />
              </div>
            </section>
          </>
        )}

        {/* 더보기 */}
        <details className={`${styles.card} ${styles.more}`}>
          <summary className={styles.moreSummary}>
            더보기
            <span className={styles.moreSub}>단어 가리기{hasAudio && multiVerse ? ' · 타이밍 맞추기' : ''}</span>
          </summary>
          <div className={styles.moreBody}>
            <Segmented
              label="단어 가리기"
              options={MASK_LEVELS.map((m, i) => ({ value: i, label: m.label }))}
              value={maskLevel}
              onChange={changeMask}
            />
            <p className={styles.cardHint}>가린 단어는 소리가 그 단어를 읽는 순간 드러나요. 먼저 말해 보고 확인하세요.</p>

            {hasAudio && multiVerse && (
              <div className={styles.timing}>
                <div>
                  <p className={styles.timingTitle}>글자 색칠 타이밍</p>
                  <p className={styles.timingDesc}>
                    {marks ? '직접 맞춘 절 타이밍을 쓰는 중' : '녹음을 분석해 자동으로 맞춘 타이밍'}
                    {marks && <> · <button className={styles.linkBtn} onClick={resetMarks}>자동으로 되돌리기</button></>}
                  </p>
                </div>
                <button className={styles.outlineBtn} onClick={startMarking} disabled={!analysis?.segs || !!marking}>
                  타이밍 맞추기
                </button>
              </div>
            )}
          </div>
        </details>

        {/* 이전 / 다음 */}
        <nav className={styles.pager} aria-label="구절 이동">
          <button className={styles.pageBtn} onClick={() => prev && onGo(prev.id)} disabled={!prev}>
            <span className={styles.pageDir}>‹ 이전</span>
            <span className={styles.pageRef}>{prev ? prev.ref : '처음 구절'}</span>
          </button>
          <button className={`${styles.pageBtn} ${styles.pageNext}`} onClick={() => next && onGo(next.id)} disabled={!next}>
            <span className={styles.pageDir}>다음 ›</span>
            <span className={styles.pageRef}>{next ? `${next.stage !== passage.stage ? `${next.stage}단계 · ` : ''}${next.ref}` : '마지막 구절'}</span>
          </button>
        </nav>
      </main>

      {toast && <div className={styles.toast} role="status">{toast}</div>}

      {hasAudio && looper && (
        <footer className={styles.playerWrap}>
          <Player
            looper={looper}
            state={{ ...snap, duration }}
            range={marking ? null : range}
            verseStarts={verseStarts}
            onRangeChange={commitRange}
            onSetStart={setStartHere}
            onSetEnd={setEndHere}
          />
        </footer>
      )}
    </div>
  )
}
