import { useState } from 'react'
import { MODELS, defaultStartTime } from '../constants'
import ModelCard from './ModelCard'
import './Panel.css'

function formatSeedShape(s) {
  if (!s) return null
  if (s.type === 'circle') {
    const km = (s.radius / 1000).toFixed(1)
    return `${s.lon.toFixed(3)}°E  ${s.lat.toFixed(3)}°N · r = ${km} km`
  }
  return `${s.lon_min.toFixed(2)}°–${s.lon_max.toFixed(2)}°E · ${s.lat_min.toFixed(2)}°–${s.lat_max.toFixed(2)}°N`
}

export default function Panel({ onRun, loading, status, statusType, drawMode, onStartDraw, seedShape }) {
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

  const seedInfo = formatSeedShape(seedShape)

  return (
    <div className="panel">
      <h2>OpenDrift Simulation</h2>

      <div className="section-label">Modello di deriva</div>
      <div className="model-grid">
        {MODELS.map(m => (
          <ModelCard
            key={m.key}
            model={m}
            active={selectedModel === m.key}
            onClick={() => setSelectedModel(m.key)}
          />
        ))}
      </div>

      <div className="section-label" style={{ marginTop: 14 }}>Area di seeding</div>
      <div className="draw-buttons">
        <button
          className={`draw-btn${drawMode === 'circle' ? ' active' : ''}`}
          type="button"
          onClick={() => onStartDraw('circle')}
        >
          ◯ Cerchio
        </button>
        <button
          className={`draw-btn${drawMode === 'rectangle' ? ' active' : ''}`}
          type="button"
          onClick={() => onStartDraw('rectangle')}
        >
          ▭ Rettangolo
        </button>
      </div>

      {drawMode === 'circle'    && <div className="draw-hint">Clicca per il centro, poi di nuovo per il raggio</div>}
      {drawMode === 'rectangle' && <div className="draw-hint">Clicca e trascina per disegnare</div>}
      {!drawMode && seedInfo    && <div className="seed-info">{seedInfo}</div>}
      {!drawMode && !seedShape  && <div className="draw-hint">Disegna un'area sulla mappa per iniziare</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>Data/ora inizio</label>
          <input type="datetime-local" value={startTime}
            onChange={e => setStartTime(e.target.value)} />
        </div>

        <div className="form-row">
          <label>Numero di particelle</label>
          <input type="number" value={number} min="1" max="10000"
            onChange={e => setNumber(e.target.value)} />
        </div>

        <div className="form-row">
          <label>Durata (ore)</label>
          <input type="number" value={duration} min="1" max="720"
            onChange={e => setDuration(e.target.value)} />
        </div>

        <button className="run-btn" type="submit" disabled={loading || !seedShape}>
          {loading ? '⏳ Simulazione in corso…' : '▶ Avvia simulazione'}
        </button>
      </form>

      {status && (
        <div className={`status ${statusType}`}>{status}</div>
      )}
    </div>
  )
}
