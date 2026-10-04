import { useEffect, useState } from 'react'
import ListScreen from './screens/ListScreen.jsx'
import PassageScreen from './screens/PassageScreen.jsx'
import ContinuousScreen from './screens/ContinuousScreen.jsx'
import { load, save, KEYS } from './lib/storage.js'

// 화면 상태를 브라우저 history 에 기록 → 휴대폰 뒤로가기가 앱 안에서 이전 화면으로 동작
// nav = { screen: 'list' } | { screen: 'passage', id } | { screen: 'continuous', stage }
const LIST = { screen: 'list' }

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [nav, setNav] = useState(() => window.history.state?.screen ? window.history.state : LIST)
  const [done, setDone] = useState(() => load(KEYS.done, {}))

  // 본문 데이터: data/passages.json (앱 코드를 고치지 않고 이 파일과 audio/ 만 바꿔서 구절 추가·수정)
  useEffect(() => {
    fetch('./data/passages.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(setData)
      .catch(() => setError('말씀 데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'))
  }, [])

  useEffect(() => {
    window.history.replaceState(nav, '')
    const onPop = (e) => {
      setNav(e.state?.screen ? e.state : LIST)
      window.scrollTo(0, 0)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openPassage = (id, replace = false) => {
    // fromList: 목록에서 들어왔는지 (그래야 뒤로가기를 history.back 으로 처리할 수 있음)
    const next = { screen: 'passage', id, fromList: replace ? !!nav.fromList : true }
    if (replace) window.history.replaceState(next, '')
    else window.history.pushState(next, '')
    setNav(next)
    save(KEYS.pos, id)
    window.scrollTo(0, 0)
  }

  const openContinuous = (stage) => {
    const next = { screen: 'continuous', stage, fromList: true }
    window.history.pushState(next, '')
    setNav(next)
    window.scrollTo(0, 0)
  }

  const goList = () => {
    if (nav.fromList) { window.history.back(); return }
    window.history.replaceState(LIST, '')
    setNav(LIST)
    window.scrollTo(0, 0)
  }

  const toggleDone = (id) => {
    setDone(prev => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      save(KEYS.done, next)
      return next
    })
  }

  if (error) return <p style={{ padding: 32, textAlign: 'center', color: 'var(--outline)' }}>{error}</p>
  if (!data) return <p style={{ padding: 32, textAlign: 'center', color: 'var(--outline)' }}>불러오는 중…</p>

  // 암송 순서 = 1단계 → 2단계, 각 단계 안에서는 JSON 순서
  const all = data.stages.flatMap(s => s.passages.map(p => ({ ...p, stage: s.stage })))
  const index = nav.screen === 'passage' ? all.findIndex(p => p.id === nav.id) : -1

  if (index >= 0) {
    return (
      <PassageScreen
        key={all[index].id}
        passage={all[index]}
        prev={all[index - 1]}
        next={all[index + 1]}
        done={!!done[all[index].id]}
        onToggleDone={() => toggleDone(all[index].id)}
        onGo={(id) => openPassage(id, true)}
        onBack={goList}
      />
    )
  }
  const contStage = nav.screen === 'continuous' && data.stages.find(s => s.stage === nav.stage)
  if (contStage) {
    return (
      <ContinuousScreen
        key={contStage.stage}
        stage={contStage.stage}
        passages={contStage.passages}
        onBack={goList}
        onOpen={(id) => openPassage(id)}
      />
    )
  }

  return <ListScreen data={data} all={all} done={done} onOpen={openPassage} onContinuous={openContinuous} />
}
