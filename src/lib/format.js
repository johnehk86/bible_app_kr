// 시간 표시: 0.1초 단위 (예: 1:05.3)
export function fmt(sec) {
  if (!sec || !Number.isFinite(sec) || sec < 0) sec = 0
  sec = Math.round(sec * 10) / 10 // 59.96 → "1:00.0" (not "0:60.0")
  const m = Math.floor(sec / 60)
  const s = (sec - m * 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
