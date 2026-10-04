import { useEffect, useRef, useState } from 'react'
import { fmt } from '../lib/format.js'
import styles from './Player.module.css'

// 하단 고정 플레이어
//  - 진행바: 전체 길이 중 현재 위치, 반복 구간(금색 띠), 절 경계(눈금)
//  - 구간의 양 끝 손잡이를 끌어서 시작/끝 조절
//  - [여기부터] [정지] [재생] [여기까지]
export default function Player({ looper, state, range, verseStarts, onRangeChange, onSetStart, onSetEnd }) {
  const trackRef = useRef(null)
  const fillRef = useRef(null)
  const thumbRef = useRef(null)
  const timeRef = useRef(null)
  const dragRef = useRef(null) // 'seek' | 'start' | 'end'
  const [dragRange, setDragRange] = useState(null) // 끄는 중인 구간 (놓으면 저장)

  const duration = state.duration
  const shown = dragRange || range
  const pct = (t) => (duration ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0)

  // 위치 표시는 매 프레임 직접 갱신 (React 다시 그리기 없음)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = looper.time
      const p = pct(t) + '%'
      if (fillRef.current) fillRef.current.style.width = p
      if (thumbRef.current) thumbRef.current.style.left = p
      if (timeRef.current) timeRef.current.textContent = fmt(t)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [looper, duration])

  const timeFromPointer = (e) => {
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    return Math.round(ratio * duration * 10) / 10
  }

  const onDown = (kind) => (e) => {
    if (!duration) return
    e.stopPropagation()
    dragRef.current = kind
    e.currentTarget.setPointerCapture?.(e.pointerId)
    onMove(e)
  }
  const onMove = (e) => {
    const kind = dragRef.current
    if (!kind) return
    const t = timeFromPointer(e)
    if (kind === 'seek') looper.seek(t)
    else {
      const base = dragRange || range || { start: 0, end: duration }
      const next = kind === 'start'
        ? { start: Math.min(t, base.end - 0.3), end: base.end }
        : { start: base.start, end: Math.max(t, base.start + 0.3) }
      setDragRange(next)
    }
  }
  const onUp = () => {
    if (dragRef.current && dragRef.current !== 'seek' && dragRange) onRangeChange(dragRange)
    dragRef.current = null
    setDragRange(null)
  }

  const playing = state.mode === 'playing' || state.mode === 'gap'
  const repeatLabel = state.repeat === 0 ? '∞' : state.repeat
  const round = state.mode === 'stopped' ? 0 : state.count + 1

  return (
    <div className={styles.player}>
      {/* 진행바 */}
      <div
        className={styles.bar}
        onPointerDown={onDown('seek')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="slider"
        aria-label="재생 위치"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(state.time)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') looper.seek(looper.time - 2)
          if (e.key === 'ArrowRight') looper.seek(looper.time + 2)
        }}
      >
        <div className={styles.track} ref={trackRef}>
          {verseStarts?.slice(1).map((s, i) => (
            <span key={i} className={styles.tick} style={{ left: pct(s) + '%' }} />
          ))}
          {shown && (
            <div
              className={styles.loop}
              style={{ left: pct(shown.start) + '%', width: pct(shown.end) - pct(shown.start) + '%' }}
            />
          )}
          <div className={styles.fill} ref={fillRef} />
          <div className={styles.thumb} ref={thumbRef} />
          {shown && (
            <>
              <button
                type="button"
                className={`${styles.handle} ${styles.handleA}`}
                style={{ left: pct(shown.start) + '%' }}
                onPointerDown={onDown('start')}
                aria-label={`구간 시작 ${fmt(shown.start)}`}
              >A</button>
              <button
                type="button"
                className={`${styles.handle} ${styles.handleB}`}
                style={{ left: pct(shown.end) + '%' }}
                onPointerDown={onDown('end')}
                aria-label={`구간 끝 ${fmt(shown.end)}`}
              >B</button>
            </>
          )}
        </div>
      </div>

      <div className={styles.timeRow}>
        <span ref={timeRef}>0:00.0</span>
        <span className={styles.status} aria-live="polite">
          {state.mode === 'gap' ? '잠깐 쉬고 다시…' : round > 0 ? `${round}번째 / ${repeatLabel}` : shown ? `구간 ${fmt(shown.start)} – ${fmt(shown.end)}` : '전체 반복'}
        </span>
        <span>{fmt(duration)}</span>
      </div>

      {/* 조작 버튼 */}
      <div className={styles.controls}>
        <button className={styles.markBtn} onClick={onSetStart} disabled={!duration}>
          <span className={styles.markIcon}>A</span>
          여기부터
        </button>

        <div className={styles.center}>
          <button
            className={styles.stopBtn}
            onClick={() => looper.stop()}
            aria-label="정지"
            disabled={state.mode === 'stopped'}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
          <button
            className={styles.playBtn}
            onClick={() => looper.toggle()}
            aria-label={playing ? '일시정지' : '재생'}
            disabled={!duration}
          >
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

        <button className={styles.markBtn} onClick={onSetEnd} disabled={!duration}>
          여기까지
          <span className={styles.markIcon}>B</span>
        </button>
      </div>
    </div>
  )
}
