// 기기 안 저장 (localStorage). 비공개 모드 등으로 실패해도 앱은 계속 동작한다.
const PREFIX = 'malsseum:'

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key)
    else localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {}
}

// 키 목록 (SPEC 7번)
export const KEYS = {
  done: 'done', //                 { "s1-01": true, ... } 암송 완료
  pos: 'pos', //                   마지막으로 연 구절 id
  settings: 'settings', //         { repeat, gap, rate, stage }
  ab: (id) => `ab:${id}`, //       { start, end } 반복 구간
  marks: (id) => `verseMarks:${id}`, // [0, 7.2, 15.9, ...] 직접 맞춘 절 시작 시각
  mask: (id) => `mask:${id}`, //   단어 가리기 단계 (0~3)
  cont: 'continuous', //           연속듣기 설정 { each, gap, rate }
  contPos: (stage) => `continuousPos:${stage}`, // 연속듣기에서 마지막으로 듣던 구절 id
}

export const DEFAULT_SETTINGS = { repeat: 0, gap: 1, rate: 1, stage: 1 }

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) }
}
