// 단어 가리기 — 단계마다 가릴 어절을 고른다. 같은 구절이면 언제나 같은 어절이 가려지고,
// 높은 단계는 낮은 단계에서 가린 어절을 모두 포함한다 (외울수록 조금씩 더 가려짐).
export const MASK_LEVELS = [
  { label: '끔', ratio: 0 },
  { label: '조금', ratio: 0.3 },
  { label: '많이', ratio: 0.6 },
  { label: '전부', ratio: 1 },
]

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function maskedSet(passageId, wordCount, level) {
  const ratio = MASK_LEVELS[level]?.ratio ?? 0
  if (!ratio) return new Set()
  const order = Array.from({ length: wordCount }, (_, i) => i)
    .sort((a, b) => hash(`${passageId}:${a}`) - hash(`${passageId}:${b}`))
  return new Set(order.slice(0, Math.round(wordCount * ratio)))
}
