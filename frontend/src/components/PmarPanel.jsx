import { useState, useRef } from 'react'
import { useLang } from '../LanguageContext'
import './PmarPanel.css'

const PRESSURES = [
  { key: 'generic', icon: '🌊', labelKey: 'generic' },
  { key: 'plastic', icon: '🧴', labelKey: 'plastic' },
  { key: 'oil',     icon: '🛢️', labelKey: 'oil'     },
]

const USE_SOURCES = [
  { key: 'none',                   icon: '—'   },
  { key: 'windfarms',              icon: '⚡'  },
  { key: 'offshore_installations', icon: '🛢️' },
]

const SCENARIOS = [
  { id: 'adriatico_generic', pressure: 'generic', pnum: 100000, duration: 365, timeStep: 24, start: '2024-04-27', res: 0.05, area_it: 'Mar Adriatico', area_en: 'Adriatic Sea' },
  { id: 'adriatico_plastic', pressure: 'plastic', pnum: 100000, duration: 365, timeStep: 24, start: '2024-04-27', res: 0.05, area_it: 'Mar Adriatico', area_en: 'Adriatic Sea' },
]

const RESOLUTIONS = [
  { value: 0.001, label: '0.001°' },
  { value: 0.01,  label: '0.01°' },
  { value: 0.05,  label: '0.05°' },
  { value: 0.1,   label: '0.1°'  },
  { value: 0.2,   label: '0.2°'  },
  { value: 0.5,   label: '0.5°'  },
  { value: 1.0,   label: '1.0°'  },
]

const TIME_STEPS = [
  { value: 1,  label: '1 h'  },
  { value: 3,  label: '3 h'  },
  { value: 6,  label: '6 h'  },
  { value: 12, label: '12 h' },
  { value: 24, label: '24 h' },
]

function defaultStartDate() {
  const d = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatSeedShape(s) {
  if (!s) return null
  if (s.type === 'circle') {
    const km = (s.radius / 1000).toFixed(1)
    return `${s.lon.toFixed(3)}°E  ${s.lat.toFixed(3)}°N · r=${km} km`
  }
  return `${s.lon_min.toFixed(2)}°–${s.lon_max.toFixed(2)}°E · ${s.lat_min.toFixed(2)}°–${s.lat_max.toFixed(2)}°N`
}

export default function PmarPanel({
  onRun, loading, status, statusType,
  drawMode, onStartDraw, seedShape,
  useSource, onUseSourceChange,
  windfarmsLoading, windfarmsEmpty,
  offshoreLoading, offshoreEmpty,
}) {
  const { t, lang } = useLang()
  const p = t.pmar

  const [runMode,       setRunMode]       = useState('custom')  // 'custom' | 'scenario'
  const [scenarioId,    setScenarioId]    = useState('')
  const [seedMode,      setSeedMode]      = useState('draw')   // 'draw' | 'upload'
  const [pressure,      setPressure]      = useState('generic')
  const [startDate,     setStartDate]     = useState(defaultStartDate())
  const [durationDays,  setDurationDays]  = useState('3')
  const [pnum,          setPnum]          = useState('200')
  const [res,           setRes]           = useState(0.1)
  const [timeStepHours, setTimeStepHours] = useState(1)
  const [shapefileB64,  setShapefileB64]  = useState(null)
  const [shapefileName, setShapefileName] = useState('')
  const fileRef = useRef(null)

  function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setShapefileB64(ev.target.result.split(',')[1])
      setShapefileName(file.name)
    }
    reader.readAsDataURL(file)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (runMode === 'scenario') {
      onRun({ scenario_id: scenarioId, res })
      return
    }
    const startIso = startDate + 'T00:00:00'
    onRun({
      pressure,
      use_source:      useSource,
      start_time:      startIso,
      duration_days:   parseInt(durationDays),
      pnum:            parseInt(pnum),
      res,
      time_step_hours: parseInt(timeStepHours),
      shapefile_b64:   seedMode === 'upload' ? shapefileB64 : null,
    })
  }

  const seedInfo   = seedMode === 'draw' ? formatSeedShape(seedShape) : null
  const canSubmit  = !loading && (
    runMode === 'scenario'
      ? !!scenarioId
      : seedMode === 'draw' ? !!seedShape : !!shapefileB64
  )

  const ncBytesPerStep  = pressure === 'oil' ? 160 : pressure === 'plastic' ? 60 : 40
  const stepsPerDay     = 24 / timeStepHours
  const ncEstimateBytes = parseInt(pnum || 0) * parseInt(durationDays || 0) * stepsPerDay * ncBytesPerStep
  function formatNcSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB'
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + ' MB'
    return (bytes / 1e3).toFixed(0) + ' KB'
  }
  const ncSizeClass = ncEstimateBytes > 2e9 ? 'pmar-nc-size pmar-nc-size--warn'
                    : ncEstimateBytes > 5e8 ? 'pmar-nc-size pmar-nc-size--caution'
                    : 'pmar-nc-size'

  return (
    <form onSubmit={handleSubmit} className="pmar-form">

      {/* ── Run mode toggle ───────────────────────────────────────────── */}
      <div className="pmar-mode-tabs" style={{ marginTop: 4 }}>
        <button type="button"
          className={`pmar-mode-tab${runMode === 'custom' ? ' active' : ''}`}
          onClick={() => setRunMode('custom')}
        >{p.modeCustomBtn}</button>
        <button type="button"
          className={`pmar-mode-tab${runMode === 'scenario' ? ' active' : ''}`}
          onClick={() => setRunMode('scenario')}
        >{p.modeScenarioBtn}</button>
      </div>

      {/* ── Scenario mode ─────────────────────────────────────────────── */}
      {runMode === 'scenario' && (() => {
        const sc = SCENARIOS.find(s => s.id === scenarioId) ?? null
        return (
          <>
            <div className="section-label" style={{ marginTop: 10 }}>{p.sectionScenario}</div>
            <select
              className="pmar-select"
              style={{ width: '100%', marginTop: 6 }}
              value={scenarioId}
              onChange={e => setScenarioId(e.target.value)}
            >
              <option value="">{p.scenarioHint}</option>
              {SCENARIOS.map(s => (
                <option key={s.id} value={s.id}>{p.scenarios[s.id]}</option>
              ))}
            </select>
            {sc && (
              <div className="pmar-scenario-info">
                <div className="pmar-scenario-info-row">
                  <span>{p.sectionSeed}</span>
                  <span>{lang === 'it' ? sc.area_it : sc.area_en}</span>
                </div>
                <div className="pmar-scenario-info-row">
                  <span>{p.sectionPressure}</span>
                  <span>{p.pressures[sc.pressure]}</span>
                </div>
                <div className="pmar-scenario-info-row">
                  <span>{p.labelStart}</span>
                  <span>{sc.start}</span>
                </div>
                <div className="pmar-scenario-info-row">
                  <span>{p.labelDuration}</span>
                  <span>{sc.duration} d</span>
                </div>
                <div className="pmar-scenario-info-row">
                  <span>{p.labelParticles}</span>
                  <span>{sc.pnum.toLocaleString()}</span>
                </div>
                <div className="pmar-scenario-info-row">
                  <span>{p.labelTimeStep}</span>
                  <span>{sc.timeStep} h</span>
                </div>
                <div className="pmar-scenario-info-row">
                  <span>{p.labelRes}</span>
                  <span>{sc.res}°</span>
                </div>
              </div>
            )}
          </>
        )
      })()}

      {/* ── Seeding mode toggle (solo custom) ────────────────────────── */}
      {runMode === 'custom' && <>
      <div className="section-label" style={{ marginTop: 10 }}>{p.sectionSeed}</div>
      <div className="pmar-mode-tabs">
        <button
          type="button"
          className={`pmar-mode-tab${seedMode === 'draw' ? ' active' : ''}`}
          onClick={() => setSeedMode('draw')}
        >{p.modeDrawBtn}</button>
        <button
          type="button"
          className={`pmar-mode-tab${seedMode === 'upload' ? ' active' : ''}`}
          onClick={() => setSeedMode('upload')}
        >{p.modeUploadBtn}</button>
      </div>

      {/* ── Draw mode ─────────────────────────────────────────────────── */}
      {seedMode === 'draw' && (
        <>
          <div className="draw-buttons" style={{ marginTop: 8 }}>
            <button
              type="button"
              className={`draw-btn${drawMode === 'circle' ? ' active' : ''}`}
              onClick={() => onStartDraw('circle')}
            >{p.btnCircle}</button>
            <button
              type="button"
              className={`draw-btn${drawMode === 'rectangle' ? ' active' : ''}`}
              onClick={() => onStartDraw('rectangle')}
            >{p.btnRect}</button>
          </div>
          {drawMode === 'circle'    && <div className="draw-hint">{p.hintCircle}</div>}
          {drawMode === 'rectangle' && <div className="draw-hint">{p.hintRect}</div>}
          {!drawMode && seedInfo    && <div className="seed-info">{seedInfo}</div>}
          {!drawMode && !seedShape  && <div className="draw-hint">{p.hintNoShape}</div>}
        </>
      )}

      {/* ── Upload mode ───────────────────────────────────────────────── */}
      {seedMode === 'upload' && (
        <div className="pmar-upload-area" onClick={() => fileRef.current?.click()}>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          {shapefileB64
            ? <span className="pmar-file-name">📂 {shapefileName}</span>
            : <span className="pmar-upload-hint">{p.uploadHint}</span>
          }
        </div>
      )}

      {/* ── Pressure (solo custom) ───────────────────────────────────── */}
      </>}

      {runMode === 'custom' && <>
      <div className="section-label" style={{ marginTop: 14 }}>{p.sectionPressure}</div>
      <div className="pmar-pressure-grid">
        {PRESSURES.map(pr => (
          <button
            key={pr.key}
            type="button"
            className={`pmar-pressure-btn${pressure === pr.key ? ' active' : ''}`}
            onClick={() => setPressure(pr.key)}
          >
            {pr.icon} {p.pressures[pr.key]}
          </button>
        ))}
      </div>
      </>}

      {/* ── Use layer (comune) ───────────────────────────────────────── */}
      <div className="section-label" style={{ marginTop: 14 }}>{p.sectionUse}</div>
      <div className="pmar-use-grid">
        {USE_SOURCES.map(u => (
          <button
            key={u.key}
            type="button"
            className={`pmar-use-btn${useSource === u.key ? ' active' : ''}`}
            onClick={() => onUseSourceChange(u.key)}
          >
            {u.key === 'windfarms' && windfarmsLoading ? '⏳ …'
              : u.key === 'offshore_installations' && offshoreLoading ? '⏳ …'
              : `${u.icon} ${p.useSources[u.key]}`
            }
          </button>
        ))}
      </div>
      {useSource === 'windfarms' && !windfarmsEmpty && (
        <div className="pmar-use-info">{p.useWindfarmsInfo}</div>
      )}
      {useSource === 'windfarms' && windfarmsEmpty && (
        <div className="pmar-use-warn">{p.useWindfarmsEmpty}</div>
      )}
      {useSource === 'offshore_installations' && !offshoreEmpty && (
        <div className="pmar-use-info">{p.useOffshoreInfo}</div>
      )}
      {useSource === 'offshore_installations' && offshoreEmpty && (
        <div className="pmar-use-warn">{p.useOffshoreEmpty}</div>
      )}

      {/* ── Params (solo custom) ─────────────────────────────────────── */}
      {runMode === 'custom' && <>
      <div className="form-row">
        <label>{p.labelStart}</label>
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
        />
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>{p.labelDuration}</label>
          <input
            type="number" value={durationDays} min="1" max="730"
            onChange={e => setDurationDays(e.target.value)}
          />
        </div>
        <div className="form-row">
          <label>{p.labelParticles}</label>
          <input
            type="number" value={pnum} min="10" max="100000"
            onChange={e => setPnum(e.target.value)}
          />
        </div>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>{p.labelRes}</label>
          <select
            className="pmar-select"
            value={res}
            onChange={e => setRes(parseFloat(e.target.value))}
          >
            {RESOLUTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>{p.labelTimeStep}</label>
          <select
            className="pmar-select"
            value={timeStepHours}
            onChange={e => setTimeStepHours(parseInt(e.target.value))}
          >
            {TIME_STEPS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      </>}

      {/* ── Risoluzione griglia (scenario mode) ──────────────────────── */}
      {runMode === 'scenario' && (
        <div className="form-row" style={{ marginTop: 10 }}>
          <label>{p.labelRes}</label>
          <select
            className="pmar-select"
            value={res}
            onChange={e => setRes(parseFloat(e.target.value))}
          >
            {RESOLUTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      <button className="run-btn" type="submit" disabled={!canSubmit}>
        {loading ? p.btnRunning : p.btnRun}
      </button>

      {runMode === 'custom' && (
        <div className={ncSizeClass}>
          {p.ncSizeHint.replace('{size}', formatNcSize(ncEstimateBytes))}
        </div>
      )}

      {status && (
        <div className={`status ${statusType}`}>{status}</div>
      )}
    </form>
  )
}
