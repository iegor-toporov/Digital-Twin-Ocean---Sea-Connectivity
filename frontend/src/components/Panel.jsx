import { useState } from 'react'
import { MODELS, defaultStartTime } from '../constants'
import { useLang } from '../LanguageContext'
import ModelCard from './ModelCard'
import './Panel.css'

function formatSeedShape(s, lang) {
  if (!s) return null
  if (s.type === 'circle') {
    const km = (s.radius / 1000).toFixed(1)
    return `${s.lon.toFixed(3)}°E  ${s.lat.toFixed(3)}°N · r = ${km} km`
  }
  return `${s.lon_min.toFixed(2)}°–${s.lon_max.toFixed(2)}°E · ${s.lat_min.toFixed(2)}°–${s.lat_max.toFixed(2)}°N`
}

export default function Panel({ onRun, loading, status, statusType, drawMode, onStartDraw, seedShape }) {
  const { lang, t, toggle } = useLang()
  const [selectedModel, setSelectedModel] = useState('OceanDrift')
  const [startTime, setStartTime] = useState(defaultStartTime())
  const [number,    setNumber]    = useState('100')
  const [duration,  setDuration]  = useState('24')

  function handleSubmit(e) {
    e.preventDefault()
    onRun({
      model:          selectedModel,
      start_time:     startTime ? startTime + ':00' : undefined,
      number:         parseInt(number),
      duration_hours: parseFloat(duration),
    })
  }

  const seedInfo = formatSeedShape(seedShape, lang)
  const p = t.panel

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{p.title}</h2>
        <button className="lang-btn" onClick={toggle} title="Switch language">
          {lang === 'it' ? 'EN' : 'IT'}
        </button>
      </div>

      <div className="section-label">{p.sectionModel}</div>
      <div className="model-grid">
        {MODELS.map(m => (
          <ModelCard
            key={m.key}
            model={{ ...m, name: t.models[m.key].name, desc: t.models[m.key].desc }}
            active={selectedModel === m.key}
            onClick={() => setSelectedModel(m.key)}
          />
        ))}
      </div>

      <div className="section-label" style={{ marginTop: 14 }}>{p.sectionSeed}</div>
      <div className="draw-buttons">
        <button
          className={`draw-btn${drawMode === 'circle' ? ' active' : ''}`}
          type="button"
          onClick={() => onStartDraw('circle')}
        >
          {p.btnCircle}
        </button>
        <button
          className={`draw-btn${drawMode === 'rectangle' ? ' active' : ''}`}
          type="button"
          onClick={() => onStartDraw('rectangle')}
        >
          {p.btnRect}
        </button>
      </div>

      {drawMode === 'circle'    && <div className="draw-hint">{p.hintCircle}</div>}
      {drawMode === 'rectangle' && <div className="draw-hint">{p.hintRect}</div>}
      {!drawMode && seedInfo    && <div className="seed-info">{seedInfo}</div>}
      {!drawMode && !seedShape  && <div className="draw-hint">{p.hintNoShape}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>{p.labelStart}</label>
          <input type="datetime-local" value={startTime}
            onChange={e => setStartTime(e.target.value)} />
        </div>

        <div className="form-row">
          <label>{p.labelParticles}</label>
          <input type="number" value={number} min="1" max="10000"
            onChange={e => setNumber(e.target.value)} />
        </div>

        <div className="form-row">
          <label>{p.labelDuration}</label>
          <input type="number" value={duration} min="1" max="720"
            onChange={e => setDuration(e.target.value)} />
        </div>

        <button className="run-btn" type="submit" disabled={loading || !seedShape}>
          {loading ? p.btnRunning : p.btnRun}
        </button>
      </form>

      {status && (
        <div className={`status ${statusType}`}>{status}</div>
      )}
    </div>
  )
}
