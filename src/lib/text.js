// 본문을 어절(띄어쓰기 단위)로 나누고, 어절마다 "말하는 길이"의 근사치(음절 수)를 매긴다.
// 한국어는 음절 하나하나를 거의 같은 길이로 말하는 언어라 음절 수가 발화 시간을 잘 예측한다.

const HANGUL = /[가-힣]/g
const DIGIT = /[0-9]/g
const LATIN = /[A-Za-z]/g
const PUNCT_END = /[,.;:!?·…」』")\]]$/

export function syllables(word) {
  const h = (word.match(HANGUL) || []).length
  const d = (word.match(DIGIT) || []).length * 1.5 // 숫자는 읽으면 길어짐 (예: 12 → 십이)
  const l = (word.match(LATIN) || []).length * 0.4
  return Math.max(0.5, h + d + l)
}

// passage.verses → 어절 목록 (화면 표시와 정렬에 같은 목록을 쓴다)
// { text, verseIndex, syl, verseEnd, punct }
export function tokenize(verses) {
  const words = []
  verses.forEach((v, vi) => {
    const parts = v.text.split(/\s+/).filter(Boolean)
    parts.forEach((text, k) => {
      words.push({
        text,
        verseIndex: vi,
        syl: syllables(text),
        verseEnd: k === parts.length - 1,
        punct: PUNCT_END.test(text),
      })
    })
  })
  return words
}
