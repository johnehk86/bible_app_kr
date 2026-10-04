import { useState } from 'react'
import { load, save, KEYS, loadSettings } from '../lib/storage.js'
import styles from './ListScreen.module.css'

export default function ListScreen({ data, all, done, onOpen }) {
  const [stage, setStage] = useState(() => {
    const s = loadSettings().stage
    return data.stages.some(x => x.stage === s) ? s : data.stages[0].stage
  })
  const lastId = load(KEYS.pos, null)
  const last = all.find(p => p.id === lastId)
  const doneCount = all.filter(p => done[p.id]).length

  const pickStage = (s) => {
    setStage(s)
    save(KEYS.settings, { ...loadSettings(), stage: s })
  }

  const current = data.stages.find(s => s.stage === stage)

  return (
    <div className={styles.container}>
      <div className="zenith" aria-hidden="true" />

      <header className={styles.topBar}>
        <span className={styles.brand}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
            <path d="M12 6.5C10.2 5.2 7.6 4.5 4 4.5v13c3.6 0 6.2.7 8 2 1.8-1.3 4.4-2 8-2v-13c-3.6 0-6.2.7-8 2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M12 6.5v13" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          말씀암송
        </span>
        <span className={styles.progress} aria-label={`전체 ${all.length}구절 중 ${doneCount}구절 암송 완료`}>
          ✓ {doneCount} / {all.length}
        </span>
      </header>

      <main className={styles.content}>
        <section className={styles.hero}>
          <h1 className={styles.title}>듣고, 반복하고,<br />마음에 새기기</h1>
          <p className={styles.subtitle}>구절을 고르고 재생 버튼만 누르면 계속 반복해서 들려드려요</p>
        </section>

        {last && (
          <button className={styles.resume} onClick={() => onOpen(last.id)}>
            <span className={styles.resumeLabel}>이어서 암송하기</span>
            <span className={styles.resumeRef}>{last.stage}단계 · {last.ref}</span>
            <span className={styles.resumeArrow} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5.14v14l11-7-11-7z" /></svg>
            </span>
          </button>
        )}

        <div className={styles.tabs} role="tablist" aria-label="단계">
          {data.stages.map(s => {
            const n = s.passages.filter(p => done[p.id]).length
            return (
              <button
                key={s.stage}
                role="tab"
                aria-selected={stage === s.stage}
                className={`${styles.tab} ${stage === s.stage ? styles.tabActive : ''}`}
                onClick={() => pickStage(s.stage)}
              >
                {s.stage}단계
                <span className={styles.tabCount}>{n}/{s.passages.length}</span>
              </button>
            )
          })}
        </div>

        <ol className={styles.list}>
          {current.passages.map(p => {
            const isDone = !!done[p.id]
            return (
              <li key={p.id}>
                <button className={`${styles.item} ${isDone ? styles.itemDone : ''}`} onClick={() => onOpen(p.id)}>
                  <span className={styles.no}>{String(p.no).padStart(2, '0')}</span>
                  <span className={styles.body}>
                    <span className={styles.ref}>{p.ref}</span>
                    <span className={styles.preview}>{p.verses[0].text}</span>
                    <span className={styles.meta}>
                      {p.verses.length}절
                      {!p.audio && <span className={styles.noAudio}> · 녹음 없음</span>}
                    </span>
                  </span>
                  {isDone ? (
                    <span className={styles.doneBadge} aria-label="암송 완료">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" width="20" height="20" className={styles.chevron} aria-hidden="true">
                      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ol>

        <p className={styles.footnote}>{data.translation}</p>
      </main>
    </div>
  )
}
