// 구간 반복 재생기 — <audio> 하나를 감싸서 A–B 반복, 반복 횟수, 반복 사이 쉼, 속도를 처리한다.
//
// 정확한 끝점: timeupdate(약 250ms 간격)만으로는 늦으므로, 화면이 켜져 있을 땐
// requestAnimationFrame 으로 매 프레임 위치를 검사한다. 화면이 꺼지면 rAF 가 멈추므로
// timeupdate 도 함께 들어 둔다 (조금 덜 정확하지만 반복은 계속된다).
//
// 상태(mode): 'stopped' 멈춤(구간 처음) / 'playing' 재생 중 / 'paused' 일시정지 / 'gap' 반복 사이 쉬는 중

const END_EPS = 0.03 // 끝점보다 이만큼 일찍 되돌림 (프레임 지연 보정)
const MIN_RANGE = 0.3

export class Looper {
  constructor(audio) {
    this.audio = audio
    this.mode = 'stopped'
    this.range = null // { start, end } 없으면 전체
    this.repeat = 0 // 0 = 무한
    this.gap = 0 // 초
    this.rate = 1
    this.count = 0 // 지금까지 끝까지 들은 횟수
    this.listeners = new Set()
    this.raf = 0
    this.gapTimer = 0

    this.onTime = () => this.check()
    this.onEnded = () => this.reachedEnd()
    this.onMeta = () => this.emit()
    this.onPause = () => {
      // 다른 앱/잠금화면/이어폰 버튼으로 멈췄을 때 상태 맞추기.
      // 파일 끝에 닿으면 브라우저가 'ended' 직전에 'pause'를 보내는데, 이건 반복 처리(onEnded)에 맡긴다.
      if (this.audio.ended) return
      if (this.mode === 'playing') { this.mode = 'paused'; this.stopTicker(); this.emit() }
    }
    this.onPlay = () => {
      if (this.mode !== 'playing') { this.mode = 'playing'; this.startTicker(); this.emit() }
    }
    audio.addEventListener('timeupdate', this.onTime)
    audio.addEventListener('ended', this.onEnded)
    audio.addEventListener('loadedmetadata', this.onMeta)
    audio.addEventListener('durationchange', this.onMeta)
    audio.addEventListener('pause', this.onPause)
    audio.addEventListener('play', this.onPlay)
    this.applyRate()
  }

  destroy() {
    this.stopTicker()
    clearTimeout(this.gapTimer)
    const a = this.audio
    a.pause()
    a.removeEventListener('timeupdate', this.onTime)
    a.removeEventListener('ended', this.onEnded)
    a.removeEventListener('loadedmetadata', this.onMeta)
    a.removeEventListener('durationchange', this.onMeta)
    a.removeEventListener('pause', this.onPause)
    a.removeEventListener('play', this.onPlay)
    this.listeners.clear()
  }

  // ── 구독 (React 화면 갱신용) ──
  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  emit() {
    for (const fn of this.listeners) fn()
  }

  get duration() {
    const d = this.audio.duration
    return Number.isFinite(d) ? d : 0
  }
  get time() {
    return this.audio.currentTime
  }
  get start() {
    return this.range ? this.range.start : 0
  }
  get end() {
    return this.range ? this.range.end : this.duration
  }

  // ── 설정 ──
  setRange(range) {
    this.range = range && range.end - range.start >= MIN_RANGE ? { ...range } : null
    this.count = 0
    // 재생 중인데 지금 위치가 새 구간 밖이면 구간 처음으로
    const t = this.time
    if (this.range && (t < this.range.start - 0.05 || t > this.range.end)) {
      this.audio.currentTime = this.range.start
    }
    this.emit()
  }

  setOptions({ repeat, gap, rate }) {
    if (repeat !== undefined) this.repeat = repeat
    if (gap !== undefined) this.gap = gap
    if (rate !== undefined) { this.rate = rate; this.applyRate() }
    this.emit()
  }

  applyRate() {
    const a = this.audio
    a.playbackRate = this.rate
    // 속도를 바꿔도 음높이는 그대로 (대부분의 브라우저 기본값이지만 명시)
    a.preservesPitch = true
    a.mozPreservesPitch = true
    a.webkitPreservesPitch = true
  }

  // ── 조작 ──
  play() {
    clearTimeout(this.gapTimer)
    const t = this.time
    if (this.mode === 'stopped' || t < this.start - 0.05 || t >= this.end - END_EPS) {
      this.audio.currentTime = this.start
      if (this.mode === 'stopped') this.count = 0
    }
    this.mode = 'playing'
    this.applyRate()
    const p = this.audio.play()
    if (p && p.catch) p.catch(() => { this.mode = 'paused'; this.stopTicker(); this.emit() })
    this.startTicker()
    this.emit()
  }

  pause() {
    clearTimeout(this.gapTimer)
    if (this.mode === 'gap') this.audio.currentTime = this.start
    this.mode = 'paused'
    this.audio.pause()
    this.stopTicker()
    this.emit()
  }

  toggle() {
    if (this.mode === 'playing' || this.mode === 'gap') this.pause()
    else this.play()
  }

  stop() {
    clearTimeout(this.gapTimer)
    this.mode = 'stopped'
    this.audio.pause()
    this.audio.currentTime = this.start
    this.count = 0
    this.stopTicker()
    this.emit()
  }

  seek(t) {
    const d = this.duration
    this.audio.currentTime = Math.max(0, d ? Math.min(t, d - 0.05) : t)
    if (this.mode === 'stopped') this.mode = 'paused'
    this.emit()
  }

  // t초부터 재생 (단어/절을 눌렀을 때)
  playFrom(t) {
    clearTimeout(this.gapTimer)
    this.audio.currentTime = Math.max(0, t)
    if (this.mode === 'stopped') this.count = 0
    this.mode = 'playing'
    this.applyRate()
    const p = this.audio.play()
    if (p && p.catch) p.catch(() => { this.mode = 'paused'; this.stopTicker(); this.emit() })
    this.startTicker()
    this.emit()
  }

  // ── 반복 처리 ──
  check() {
    if (this.mode !== 'playing') return
    const t = this.time
    // 구간이 없으면 끝점 = 파일 끝. 파일이 실제로 끝나기 직전에 되돌려야 끊김이 없다
    const end = this.end
    if (end > 0 && t >= end - END_EPS && t < end + 1.0) this.reachedEnd()
  }

  reachedEnd() {
    if (this.mode !== 'playing') return
    this.count += 1
    if (this.repeat > 0 && this.count >= this.repeat) {
      this.stop()
      return
    }
    if (this.gap > 0) {
      this.mode = 'gap'
      this.audio.pause()
      this.audio.currentTime = this.start
      this.stopTicker()
      this.emit()
      this.gapTimer = setTimeout(() => {
        if (this.mode !== 'gap') return
        this.play()
      }, this.gap * 1000)
    } else {
      // 쉼 없이 곧바로 처음으로 (재생은 멈추지 않음)
      this.audio.currentTime = this.start
      if (this.audio.paused) {
        const p = this.audio.play()
        if (p && p.catch) p.catch(() => {})
      }
      this.emit()
    }
  }

  // ── 매 프레임 검사 ──
  startTicker() {
    if (this.raf) return
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      this.check()
    }
    this.raf = requestAnimationFrame(loop)
  }
  stopTicker() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
