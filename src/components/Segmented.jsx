import styles from './Segmented.module.css'

// 선택 버튼 묶음 (반복 횟수, 쉬는 시간, 속도 등)
export default function Segmented({ label, options, value, onChange }) {
  return (
    <div className={styles.row}>
      <span className={styles.label} id={`seg-${label}`}>{label}</span>
      <div className={styles.group} role="radiogroup" aria-labelledby={`seg-${label}`}>
        {options.map(o => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={`${styles.btn} ${value === o.value ? styles.active : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
