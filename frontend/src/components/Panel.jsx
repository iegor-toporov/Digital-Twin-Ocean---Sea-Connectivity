import { useState } from 'react'
import { MODELS, defaultStartTime } from '../constants'
import ModelCard from './ModelCard'
import './Panel.css'

export default function Panel({ onRun, loading, status, statusType }) {
  const [selectedModel, setSelectedModel] = useState('OceanDrift')
  const [lon,       setLon]       = useState('12.5')
  const [lat,       setLat]       = useState('44.0')
  const [startTime, setStartTime] = useState(defaultStartTime())
  const [number,    setNumber]    = useState('100')
  const [radius,    setRadius]    = useState('1000')
  const [duration,  setDuration]  = useState('24')

  function handleSubmit(e) {
    e.preventDefault()
    onRun({
      lon:            parseFloat(lon),
      lat:            parseFloat(lat),
      model:          selectedModel,
      start_time:     startTime ? startTime + ':00' : undefined,
      number:         parseInt(number),
      radius:         parseFloat(radius),
      duration_hours: parseFloat(duration),
    })
  }

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

      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-row">
            <label>Longitudine</label>
            <input type="number" value={lon} step="0.01"
              onChange={e => setLon(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Latitudine</label>
            <input type="number" value={lat} step="0.01"
              onChange={e => setLat(e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <label>Data/ora inizio</label>
          <input type="datetime-local" value={startTime}
            onChange={e => setStartTime(e.target.value)} />
        </div>

        <div className="form-row">
          <label>Numero di particelle</label>
          <input type="number" value={number} min="1" max="1000"
            onChange={e => setNumber(e.target.value)} />
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Raggio seed (m)</label>
            <input type="number" value={radius} min="100"
              onChange={e => setRadius(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Durata (ore)</label>
            <input type="number" value={duration} min="1" max="720"
              onChange={e => setDuration(e.target.value)} />
          </div>
        </div>

        <button className="run-btn" type="submit" disabled={loading}>
          {loading ? '⏳ Simulazione in corso…' : '▶ Avvia simulazione'}
        </button>
      </form>

      {status && (
        <div className={`status ${statusType}`}>{status}</div>
      )}
    </div>
  )
}
