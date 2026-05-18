import { useState, useRef, useEffect } from 'react'
import { useLang } from '../LanguageContext'
import './PmarPanel.css'

const PRESSURES = [
  { key: 'generic', icon: '🌊', labelKey: 'generic' },
  { key: 'plastic', icon: '🧴', labelKey: 'plastic' },
  { key: 'oil',     icon: '🛢️', labelKey: 'oil'     },
]

const USE_SOURCES = [
  { key: 'none',                   icon: ''    },
  { key: 'windfarms',              icon: '⚡'  },
  { key: 'offshore_installations', icon: '🛢️' },
  { key: 'geotiff',               icon: '🗺️' },
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

function seedShapeToGeoJSON(shape) {
  if (!shape) return null
  if (shape.type === 'circle') {
    const { lon, lat, radius } = shape
    const N = 64
    const coords = []
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * Math.PI
      const dLat  = (radius / 111320) * Math.cos(angle)
      const dLon  = (radius / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle)
      coords.push([lon + dLon, lat + dLat])
    }
    coords.push(coords[0])
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }] }
  }
  const { lon_min, lat_min, lon_max, lat_max } = shape
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[lon_min,lat_min],[lon_max,lat_min],[lon_max,lat_max],[lon_min,lat_max],[lon_min,lat_min]]] }, properties: {} }],
  }
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

  // Tabs: 'custom' = Simulazione, 'scenario' = Analisi
  const [runMode, setRunMode] = useState('custom')

  // Seeding area mode in Simulation form
  const [seedAreaMode,      setSeedAreaMode]      = useState('draw')
  const [shapefileB64,      setShapefileB64]      = useState(null)
  const [shapefileName,     setShapefileName]     = useState('')
  const fileRef = useRef(null)

  // T4MSP area picker (for seeding in new simulation form)
  const [t4mspAreas,        setT4mspAreas]        = useState([])
  const [selectedT4mspArea, setSelectedT4mspArea] = useState(null)
  const [t4mspSearch,       setT4mspSearch]       = useState('')

  // New simulation params
  const [customLabel,   setCustomLabel]   = useState('')
  const [customDesc,    setCustomDesc]    = useState('')
  const [seedAreaName,  setSeedAreaName]  = useState('')
  const [pressure,      setPressure]      = useState('generic')
  const [startDate,     setStartDate]     = useState(defaultStartDate())
  const [durationDays,  setDurationDays]  = useState('30')
  const [pnum,          setPnum]          = useState('1000')
  const [timeStepHours, setTimeStepHours] = useState(1)

  // Analisi tab params
  const [res,         setRes]         = useState(0.1)
  const [margin,      setMargin]      = useState('1')
  const [geotiffB64,  setGeotiffB64]  = useState(null)
  const [geotiffName, setGeotiffName] = useState('')
  const [geotiffUrl,  setGeotiffUrl]  = useState('')
  const geotiffRef = useRef(null)

  // Scenario state
  const [scenarioStatuses, setScenarioStatuses] = useState({})
  const [scenarioId,       setScenarioId]       = useState('')

  // Custom precompute
  const [customJob,             setCustomJob]             = useState(null)
  const [customPrecomputeError, setCustomPrecomputeError] = useState(null)
  const [refetchFlag,           setRefetchFlag]           = useState(0)

  // ── Fetch statuses (on mount, tab switch, or explicit refetch) ────────────
  useEffect(() => {
    fetch('/processes/scenario_status/execution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: {} }),
    })
      .then(r => r.json())
      .then(raw => {
        const data    = raw.result ?? raw
        const resp    = (data.scenarios !== undefined) ? data : { scenarios: data, t4msp_areas: [] }
        const s = {}
        for (const [id, info] of Object.entries(resp.scenarios)) {
          s[id] = { ...info, status: info.computed ? 'ready' : 'not_computed' }
        }
        setScenarioStatuses(s)
        setT4mspAreas(resp.t4msp_areas ?? [])
      })
      .catch(() => {})
  }, [runMode, refetchFlag])

  // ── Polling custom precompute job ─────────────────────────────────────────
  useEffect(() => {
    if (!customJob) return
    const iv = setInterval(async () => {
      try {
        const r   = await fetch(`/jobs/${customJob.jobId}`)
        const job = await r.json()
        if (job.status === 'successful') {
          try {
            const resR    = await fetch(`/jobs/${customJob.jobId}/results`)
            const results = await resR.json()
            const newSid  = results.scenario_id
            if (newSid) setScenarioId(newSid)
          } catch {}
          setCustomJob(null)
          setRefetchFlag(f => f + 1)
        } else if (job.status === 'failed') {
          setCustomJob(null)
          setCustomPrecomputeError(p.computeBusy)
          setRefetchFlag(f => f + 1)
        }
      } catch {}
    }, 5000)
    return () => clearInterval(iv)
  }, [customJob, p.computeBusy])

  async function handleCustomCompute() {
    setCustomPrecomputeError(null)
    const geojson = seedAreaMode === 'draw' ? seedShapeToGeoJSON(seedShape) : null

    const startIso = startDate + 'T00:00:00'
    const label    = customLabel.trim() || `${p.pressures[pressure]} — ${startDate}`
    const inputs   = {
      pressure,
      start_time:      startIso,
      duration_days:   parseInt(durationDays),
      pnum:            parseInt(pnum),
      time_step_hours: parseInt(timeStepHours),
      label,
      ...(geojson            ? { geojson: JSON.stringify(geojson) }  : {}),
      ...(shapefileB64       ? { shapefile_b64: shapefileB64 }       : {}),
      ...(selectedT4mspArea  ? { t4msp_area_id: selectedT4mspArea }  : {}),
      ...(seedAreaMode === 'draw' && seedAreaName.trim()
            ? { area_name: seedAreaName.trim() } : {}),
      ...(customDesc.trim() ? { description: customDesc.trim() } : {}),
    }
    try {
      const r    = await fetch('/processes/precompute/execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Prefer': 'respond-async' },
        body: JSON.stringify({ inputs }),
      })
      const data = await r.json()
      setCustomJob({ jobId: data.jobID })
    } catch {
      setCustomPrecomputeError('Errore avvio pre-calcolo.')
    }
  }

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

  function handleGeotiffChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setGeotiffB64(ev.target.result.split(',')[1])
      setGeotiffName(file.name)
    }
    reader.readAsDataURL(file)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (runMode !== 'scenario') return
    const gUrl = geotiffUrl.trim() || null
    onRun({
      scenario_id: scenarioId,
      res,
      margin: parseFloat(margin) || 0,
      geotiff_b64: useSource === 'geotiff' ? geotiffB64 : null,
      geotiff_url: useSource === 'geotiff' ? gUrl        : null,
    })
  }

  const seedInfo = seedAreaMode === 'draw' ? formatSeedShape(seedShape) : null

  const canPrecompute = !customJob && !loading && (
    (seedAreaMode === 'draw'   && !!seedShape) ||
    (seedAreaMode === 'upload' && !!shapefileB64) ||
    (seedAreaMode === 't4msp'  && !!selectedT4mspArea)
  )

  const canSubmit = !loading && runMode === 'scenario' &&
    !!scenarioId && scenarioStatuses[scenarioId]?.status === 'ready' &&
    (useSource !== 'geotiff' || !!geotiffB64 || !!geotiffUrl.trim())

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

  const customEntries = Object.entries(scenarioStatuses).filter(([, sc]) => sc.source === 'custom')

  const searchLow      = t4mspSearch.toLowerCase()
  const filteredAreas  = searchLow
    ? t4mspAreas.filter(a => a.label.toLowerCase().includes(searchLow))
    : t4mspAreas

  function ScenarioItem({ sid, sc }) {
    const st         = sc.status ?? 'unknown'
    const isSelected = scenarioId === sid
    const isReady    = st === 'ready'
    const label      = lang === 'it' ? sc.label_it : sc.label_en
    return (
      <div
        className={`pmar-scenario-item${isSelected && isReady ? ' selected' : ''}${!isReady ? ' disabled' : ''}`}
        onClick={() => isReady && setScenarioId(sid)}
      >
        <div className="pmar-scenario-item-header">
          <span className="pmar-scenario-item-label">{label}</span>
          <span className="pmar-scenario-item-status">
            {st === 'ready'        && '✅'}
            {st === 'not_computed' && '⬜'}
            {st === 'error'        && '❌'}
            {st === 'unknown'      && '…'}
          </span>
        </div>
        <div className="pmar-scenario-item-meta">
          {p.pressures[sc.pressure]} · {sc.start_time} · {sc.duration_days} d · {sc.pnum?.toLocaleString()} p
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="pmar-form">

      {/* ── Tab toggle ────────────────────────────────────────────────── */}
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

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── TAB SIMULAZIONE ─────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {runMode === 'custom' && <>

        {/* ── Simulazioni esistenti ────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 10 }}>{p.sectionExisting}</div>
        {customEntries.length === 0
          ? <div className="draw-hint">{p.noExisting}</div>
          : <>
              <div className="pmar-select-wrapper">
                <select
                  className="pmar-select pmar-scenario-select"
                  value={scenarioId}
                  onChange={e => setScenarioId(e.target.value)}
                >
                  <option value="">{p.scenarioNone}</option>
                  {customEntries.map(([sid, sc]) => {
                    const label = lang === 'it' ? sc.label_it : sc.label_en
                    const icon  = sc.status === 'ready' ? '✅' : sc.status === 'not_computed' ? '⬜' : '❌'
                    return <option key={sid} value={sid}>{icon} {label}</option>
                  })}
                </select>
              </div>
              {(() => {
                const sc = scenarioId ? scenarioStatuses[scenarioId] : null
                if (sc) {
                  const areaName = lang === 'it'
                    ? (sc.area_it || p.areaUndefined)
                    : (sc.area_en || p.areaUndefined)
                  const isCustomArea = areaName === 'Area personalizzata' || areaName === 'Custom area'
                  return (
                    <div className="pmar-scenario-info" style={{ marginTop: 6 }}>
                      <div className="pmar-scenario-info-row">
                        <span>{p.seedAreaName}</span>
                        <span>{isCustomArea ? p.areaUndefined : areaName}</span>
                      </div>
                      <div className="pmar-scenario-info-row">
                        <span>{p.sectionPressure}</span><span>{p.pressures[sc.pressure]}</span>
                      </div>
                      <div className="pmar-scenario-info-row">
                        <span>{p.labelStart}</span><span>{sc.start_time}</span>
                      </div>
                      <div className="pmar-scenario-info-row">
                        <span>{p.labelDuration}</span><span>{sc.duration_days} d</span>
                      </div>
                      <div className="pmar-scenario-info-row">
                        <span>{p.labelParticles}</span><span>{sc.pnum?.toLocaleString()}</span>
                      </div>
                      <div className="pmar-scenario-info-row">
                        <span>{p.labelTimeStep}</span><span>{sc.time_step_hours} h</span>
                      </div>
                      <div className="pmar-scenario-info-row">
                        <span>{p.labelCmemsMarginShort}</span><span>{sc.cmems_margin ?? 5} °</span>
                      </div>
                      {sc.description && (
                        <div style={{ marginTop: 6, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5,
                          borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 6 }}>
                          {sc.description}
                        </div>
                      )}
                    </div>
                  )
                }
                return <div className="draw-hint" style={{ marginTop: 5 }}>{p.sectionExistingDesc}</div>
              })()}
            </>
        }

        {/* ── Nuova simulazione ────────────────────────────────────── */}
        <div className="pmar-section-title">{p.sectionNewScenario}</div>

        {/* ── Titolo ──────────────────────────────────────────────── */}
        <div className="form-row">
          <label>{p.labelTitle}</label>
          <input type="text" value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            placeholder={p.labelTitleHint} />
        </div>

        {/* ── Descrizione ─────────────────────────────────────────── */}
        <div className="form-row">
          <label>{p.labelDesc}</label>
          <textarea value={customDesc}
            onChange={e => setCustomDesc(e.target.value)}
            placeholder={p.labelDescHint} />
        </div>

        {/* ── Area di seeding ─────────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 6 }}>{p.seedAreaLabel}</div>

        {/* Riga 1: gruppo Disegna */}
        <div className={`pmar-draw-group${seedAreaMode === 'draw' ? ' active' : ''}`} style={{ marginBottom: 6 }}>
          <button type="button"
            className={`pmar-mode-tab${seedAreaMode === 'draw' ? ' active' : ''}`}
            onClick={() => setSeedAreaMode('draw')}
          >{p.seedAreaDraw}</button>
          <button type="button"
            className={`draw-btn${seedAreaMode === 'draw' && drawMode === 'circle' ? ' active' : ''}`}
            onClick={() => { setSeedAreaMode('draw'); onStartDraw('circle') }}
          >{p.btnCircle}</button>
          <button type="button"
            className={`draw-btn${seedAreaMode === 'draw' && drawMode === 'rectangle' ? ' active' : ''}`}
            onClick={() => { setSeedAreaMode('draw'); onStartDraw('rectangle') }}
          >{p.btnRect}</button>
        </div>

        {/* Riga 2: Shapefile + Area predefinita */}
        <div className="pmar-seed-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button type="button"
            className={`pmar-mode-tab${seedAreaMode === 'upload' ? ' active' : ''}`}
            onClick={() => setSeedAreaMode('upload')}
          >{p.seedAreaUpload}</button>
          <button type="button"
            className={`pmar-mode-tab${seedAreaMode === 't4msp' ? ' active' : ''}`}
            onClick={() => setSeedAreaMode('t4msp')}
          >{p.seedAreaT4msp}</button>
        </div>

        {seedAreaMode === 'draw' && (
          <>
            {drawMode === 'circle'    && <div className="draw-hint" style={{ marginTop: 6 }}>{p.hintCircle}</div>}
            {drawMode === 'rectangle' && <div className="draw-hint" style={{ marginTop: 6 }}>{p.hintRect}</div>}
            {!drawMode && seedInfo    && <div className="seed-info" style={{ marginTop: 6 }}>{seedInfo}</div>}
            {!drawMode && !seedShape  && <div className="draw-hint" style={{ marginTop: 6 }}>{p.hintNoShape}</div>}
            <div className="form-row" style={{ marginTop: 8 }}>
              <label>{p.labelSeedName}</label>
              <input type="text" value={seedAreaName}
                onChange={e => setSeedAreaName(e.target.value)}
                placeholder={p.labelSeedNameHint} />
            </div>
          </>
        )}

        {seedAreaMode === 'upload' && (
          <div className="pmar-upload-area" onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".zip" style={{ display: 'none' }}
              onChange={handleFileChange} />
            {shapefileB64
              ? <span className="pmar-file-name">📂 {shapefileName}</span>
              : <span className="pmar-upload-hint">{p.uploadHint}</span>
            }
          </div>
        )}

        {seedAreaMode === 't4msp' && (
          <>
            <input className="pmar-url-input" type="text" placeholder={p.t4mspSearchHint}
              value={t4mspSearch}
              onChange={e => { setT4mspSearch(e.target.value); setSelectedT4mspArea(null) }}
              style={{ marginTop: 8 }}
            />
            <div className="pmar-area-list">
              {filteredAreas.map(area => (
                <div
                  key={area.id}
                  className={`pmar-area-item${selectedT4mspArea === area.id ? ' selected' : ''}`}
                  onClick={() => setSelectedT4mspArea(selectedT4mspArea === area.id ? null : area.id)}
                >
                  <span>{area.label}</span>
                  {selectedT4mspArea === area.id && <span>✅</span>}
                </div>
              ))}
              {filteredAreas.length === 0 && <div className="draw-hint">⋯</div>}
            </div>
          </>
        )}

        {/* ── Tipo di pressione ────────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 14 }}>{p.sectionPressure}</div>
        <div className="pmar-pressure-grid">
          {PRESSURES.map(pr => (
            <button key={pr.key} type="button"
              className={`pmar-pressure-btn${pressure === pr.key ? ' active' : ''}`}
              onClick={() => setPressure(pr.key)}
            >{pr.icon} {p.pressures[pr.key]}</button>
          ))}
        </div>

        {/* ── Parametri ───────────────────────────────────────────── */}
        <div className="form-row">
          <label>{p.labelStart}</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>{p.labelDuration}</label>
            <input type="number" value={durationDays} min="1" max="730"
              onChange={e => setDurationDays(e.target.value)} />
          </div>
          <div className="form-row">
            <label>{p.labelParticles}</label>
            <input type="number" value={pnum} min="10" max="100000"
              onChange={e => setPnum(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <label>{p.labelTimeStep}</label>
          <div className="pmar-select-wrapper" style={{ marginTop: 0 }}>
            <select className="pmar-select pmar-scenario-select" value={timeStepHours}
              onChange={e => setTimeStepHours(parseInt(e.target.value))}>
              {TIME_STEPS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className={ncSizeClass}>
          {p.ncSizeHint.replace('{size}', formatNcSize(ncEstimateBytes))}
        </div>

        <button type="button" className="run-btn" disabled={!canPrecompute}
          onClick={handleCustomCompute}
        >{customJob ? p.btnPrecomputing : p.btnPrecompute}</button>

        {customPrecomputeError && (
          <div className="status error">{customPrecomputeError}</div>
        )}
      </>}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── TAB ANALISI ─────────────────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {runMode === 'scenario' && <>

        {/* ── Info simulazione selezionata ─────────────────────────── */}
        {(() => {
          const sc = scenarioStatuses[scenarioId]
          if (!sc || sc.status !== 'ready') {
            return (
              <div className="draw-hint" style={{ marginTop: 12 }}>{p.hintNoScenario}</div>
            )
          }
          return (
            <div className="pmar-scenario-info" style={{ marginTop: 10 }}>
              <div className="pmar-scenario-info-row">
                <span>{p.sectionPressure}</span>
                <span>{p.pressures[sc.pressure]}</span>
              </div>
              <div className="pmar-scenario-info-row">
                <span>{p.labelStart}</span><span>{sc.start_time}</span>
              </div>
              <div className="pmar-scenario-info-row">
                <span>{p.labelDuration}</span><span>{sc.duration_days} d</span>
              </div>
              <div className="pmar-scenario-info-row">
                <span>{p.labelParticles}</span><span>{sc.pnum?.toLocaleString()}</span>
              </div>
              <div className="pmar-scenario-info-row">
                <span>{p.labelTimeStep}</span><span>{sc.time_step_hours} h</span>
              </div>
              {sc.description && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5,
                  borderTop: '1px solid rgba(148,163,184,0.12)', paddingTop: 6 }}>
                  {sc.description}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Layer sorgente ───────────────────────────────────────── */}
        <div className="section-label" style={{ marginTop: 14 }}>{p.sectionUse}</div>
        <div className="pmar-use-grid">
          {USE_SOURCES.map(u => (
            <button key={u.key} type="button"
              className={`pmar-use-btn${useSource === u.key ? ' active' : ''}`}
              onClick={() => onUseSourceChange(u.key)}
            >
              {u.key === 'windfarms' && windfarmsLoading ? '⏳ …'
                : u.key === 'offshore_installations' && offshoreLoading ? '⏳ …'
                : u.icon ? `${u.icon} ${p.useSources[u.key]}` : p.useSources[u.key]}
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
        {useSource === 'geotiff' && (
          <>
            <div className="pmar-upload-area" onClick={() => geotiffRef.current?.click()}>
              <input ref={geotiffRef} type="file" accept=".tif,.tiff"
                style={{ display: 'none' }} onChange={handleGeotiffChange} />
              {geotiffB64
                ? <span className="pmar-file-name">🗺️ {geotiffName}</span>
                : <span className="pmar-upload-hint">{p.geotiffUploadHint}</span>
              }
            </div>
            <div className="pmar-url-separator">{p.geotiffOrLabel}</div>
            <input className={`pmar-url-input${geotiffUrl.trim() ? ' has-value' : ''}`}
              type="url" placeholder={p.geotiffUrlHint} value={geotiffUrl}
              onChange={e => setGeotiffUrl(e.target.value)} />
          </>
        )}

        {/* ── Risoluzione ──────────────────────────────────────────── */}
        <div className="form-row" style={{ marginTop: 10 }}>
          <label>{p.labelRes}</label>
          <select className="pmar-select" value={res}
            onChange={e => setRes(parseFloat(e.target.value))}>
            {RESOLUTIONS.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* ── Margine study area ───────────────────────────────────── */}
        <div className="form-row">
          <label>{p.labelMargin}</label>
          <input type="number" value={margin} min="0" max="20" step="any"
            onChange={e => setMargin(e.target.value)} />
        </div>

        {/* ── Run ─────────────────────────────────────────────────── */}
        <button className="run-btn" type="submit" disabled={!canSubmit}>
          {loading ? p.btnRunning : p.btnRun}
        </button>

        {status && <div className={`status ${statusType}`}>{status}</div>}
      </>}

    </form>
  )
}
