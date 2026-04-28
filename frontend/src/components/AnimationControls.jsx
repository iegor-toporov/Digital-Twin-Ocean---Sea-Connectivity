import { MODEL_STYLES } from '../constants'
import { useLang } from '../LanguageContext'
import './AnimationControls.css'

export default function AnimationControls({
  simData,
  currentStep,
  isPlaying,
  onTogglePlay,
  onSliderChange,
  speed,
  onSpeedChange,
  showSeedShape,
  onToggleSeedShape,
}) {
  const { t } = useLang()
  if (!simData) return null

  const nSteps = simData.times.length
  const style  = MODEL_STYLES[simData.model] ?? MODEL_STYLES.OceanDrift
  const locale = t.controls.locale

  const d    = new Date(simData.times[currentStep])
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const label = `${date} ${time}  (${currentStep + 1}/${nSteps})`

  return (
    <div className="controls">
      <button className="play-btn" onClick={onTogglePlay}>
        {isPlaying ? '⏸' : '▶'}
      </button>

      <input
        className="time-slider"
        type="range"
        min={0}
        max={nSteps - 1}
        value={currentStep}
        onChange={e => onSliderChange(parseInt(e.target.value))}
      />

      <span className="time-label">{label}</span>

      <span
        className="model-badge"
        style={{ background: style.badge, color: style.fill }}
      >
        {t.modelLabels[simData.model] ?? style.label}
      </span>

      <div className="speed-group">
        <span>{t.controls.speed}</span>
        <input
          className="speed-slider"
          type="range"
          min={1}
          max={20}
          value={speed}
          onChange={e => onSpeedChange(parseInt(e.target.value))}
        />
      </div>

      <button
        className={`seed-toggle-btn${showSeedShape ? ' active' : ''}`}
        onClick={onToggleSeedShape}
        title={showSeedShape ? t.controls.hideSeed : t.controls.showSeed}
      >
        ◯
      </button>
    </div>
  )
}
