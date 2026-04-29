import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { MODEL_STYLES } from './constants'
import { useLang } from './LanguageContext'
import Panel from './components/Panel'
import SeedDrawer from './components/SeedDrawer'
import AnimationControls from './components/AnimationControls'
import PmarControls from './components/PmarControls'
import 'leaflet/dist/leaflet.css'
import './App.css'

const STRANDED_STYLE = { color: '#ef4444', fillColor: '#fca5a5', weight: 2 }

// ── OpenDrift trajectory layer ────────────────────────────────────────────────
function SimLayer({ simData, currentStep }) {
  const map         = useMap()
  const markersRef  = useRef([])
  const trajsRef    = useRef([])
  const rendererRef = useRef(L.canvas({ padding: 0.5 }))
  const styleRef    = useRef(MODEL_STYLES.OceanDrift)

  useEffect(() => {
    if (!simData) return

    markersRef.current.forEach(({ marker }) => marker.remove())
    trajsRef.current.forEach(l => l.remove())
    markersRef.current = []
    trajsRef.current   = []

    const { steps } = simData
    const style      = MODEL_STYLES[simData.model] ?? MODEL_STYLES.OceanDrift
    styleRef.current = style
    const nParticles = steps[0].length
    const nTime      = steps.length
    const renderer   = rendererRef.current

    for (let p = 0; p < nParticles; p++) {
      const coords = []
      for (let t = 0; t < nTime; t++) {
        const pos = steps[t][p]
        if (pos) coords.push([pos[1], pos[0]])
      }
      if (coords.length > 1)
        trajsRef.current.push(
          L.polyline(coords, { color: style.traj, opacity: 0.18, weight: 1, renderer }).addTo(map)
        )
    }

    for (let p = 0; p < nParticles; p++) {
      const pos      = steps[0][p]
      const latlng   = pos ? [pos[1], pos[0]] : [0, 0]
      const stranded = pos && pos[2] === true
      const marker   = L.circleMarker(latlng, {
        radius:      4,
        color:       stranded ? STRANDED_STYLE.color     : style.color,
        fillColor:   stranded ? STRANDED_STYLE.fillColor : style.fill,
        fillOpacity: pos ? 0.9 : 0,
        opacity:     pos ? 1   : 0,
        weight:      stranded ? STRANDED_STYLE.weight    : 1,
        renderer,
      }).addTo(map)
      markersRef.current.push({ marker, idx: p })
    }

    const allCoords = steps.flat().filter(Boolean).map(p => [p[1], p[0]])
    if (allCoords.length > 0)
      map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] })

    return () => {
      markersRef.current.forEach(({ marker }) => marker.remove())
      trajsRef.current.forEach(l => l.remove())
    }
  }, [simData, map])

  useEffect(() => {
    if (!simData || markersRef.current.length === 0) return
    const positions = simData.steps[currentStep]
    const style     = styleRef.current
    markersRef.current.forEach(({ marker, idx }) => {
      const pos = positions[idx]
      if (pos) {
        const stranded = pos[2] === true
        marker.setLatLng([pos[1], pos[0]])
        marker.setStyle({
          fillOpacity: 0.9,
          opacity:     1,
          color:       stranded ? STRANDED_STYLE.color     : style.color,
          fillColor:   stranded ? STRANDED_STYLE.fillColor : style.fill,
          weight:      stranded ? STRANDED_STYLE.weight    : 1,
        })
      } else {
        marker.setStyle({ fillOpacity: 0, opacity: 0 })
      }
    })
  }, [simData, currentStep])

  return null
}

// ── EMODnet wind farms overlay ────────────────────────────────────────────────
function WindFarmsLayer({ geojson, visible }) {
  const map        = useMap()
  const layerRef   = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    layerRef.current?.remove()
    layerRef.current = null
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    if (!geojson?.features?.length) return

    layerRef.current = L.geoJSON(geojson, {
      style: {
        color:       '#facc15',
        fillColor:   '#fef08a',
        fillOpacity: 0.18,
        weight:      1.5,
        opacity:     0.75,
        dashArray:   '5 4',
      },
    }).addTo(map)

    geojson.features.forEach(feature => {
      try {
        const bounds = L.geoJSON(feature).getBounds()
        if (!bounds.isValid()) return
        const marker = L.marker(bounds.getCenter(), {
          icon: L.divIcon({
            html:       '<span class="wf-icon">⚡</span>',
            className:  '',
            iconSize:   [22, 22],
            iconAnchor: [11, 11],
          }),
          interactive: false,
          zIndexOffset: 500,
        }).addTo(map)
        markersRef.current.push(marker)
      } catch { /* geometria non valida, skip */ }
    })

    return () => {
      layerRef.current?.remove()
      markersRef.current.forEach(m => m.remove())
    }
  }, [geojson, map])

  useEffect(() => {
    if (!layerRef.current) return
    layerRef.current.setStyle({
      opacity:     visible ? 0.75 : 0,
      fillOpacity: visible ? 0.18 : 0,
    })
    markersRef.current.forEach(m => {
      const el = m.getElement()
      if (el) el.style.opacity = visible ? '1' : '0'
    })
  }, [visible])

  return null
}

// ── PMAR raster overlay ───────────────────────────────────────────────────────
function PmarLayer({ pmarData, visible }) {
  const map        = useMap()
  const overlayRef = useRef(null)

  useEffect(() => {
    overlayRef.current?.remove()
    overlayRef.current = null
    if (!pmarData?.image_b64 || !pmarData.bounds) return

    const imgUrl = `data:image/png;base64,${pmarData.image_b64}`
    const bounds = L.latLngBounds(pmarData.bounds)
    overlayRef.current = L.imageOverlay(imgUrl, bounds, { opacity: 0.8, zIndex: 400 }).addTo(map)
    map.fitBounds(bounds, { padding: [50, 50] })

    return () => overlayRef.current?.remove()
  }, [pmarData, map])

  useEffect(() => {
    if (!overlayRef.current) return
    if (visible) {
      overlayRef.current.setOpacity(0.8)
    } else {
      overlayRef.current.setOpacity(0)
    }
  }, [visible])

  return null
}

// ── Seed shape → GeoJSON ──────────────────────────────────────────────────────
function seedShapeToGeoJSON(shape) {
  if (!shape) return null
  if (shape.type === 'circle') {
    const { lon, lat, radius } = shape
    const N      = 64
    const coords = []
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * 2 * Math.PI
      const dLat  = (radius / 111320) * Math.cos(angle)
      const dLon  = (radius / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle)
      coords.push([lon + dLon, lat + dLat])
    }
    coords.push(coords[0])
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {},
      }],
    }
  }
  // rectangle
  const { lon_min, lat_min, lon_max, lat_max } = shape
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [lon_min, lat_min], [lon_max, lat_min],
          [lon_max, lat_max], [lon_min, lat_max],
          [lon_min, lat_min],
        ]],
      },
      properties: {},
    }],
  }
}

function seedShapeBounds(shape) {
  if (!shape) return null
  if (shape.type === 'circle') {
    const { lon, lat, radius } = shape
    const dLat = radius / 111320
    const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180))
    return { lon_min: lon - dLon, lat_min: lat - dLat, lon_max: lon + dLon, lat_max: lat + dLat }
  }
  const { lon_min, lat_min, lon_max, lat_max } = shape
  return { lon_min, lat_min, lon_max, lat_max }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { t, lang } = useLang()

  // active tool
  const [activeTool, setActiveTool] = useState('opendrift')

  // seed shape (shared between tools)
  const [drawMode,      setDrawMode]      = useState(null)
  const [seedShape,     setSeedShape]     = useState(null)
  const [showSeedShape, setShowSeedShape] = useState(true)

  // OpenDrift state
  const [simData,     setSimData]     = useState(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [speed,       setSpeed]       = useState(5)
  const [loading,     setLoading]     = useState(false)
  const [status,      setStatus]      = useState('')
  const [statusType,  setStatusType]  = useState('')

  // PMAR state
  const [pmarData,        setPmarData]        = useState(null)
  const [pmarLoading,     setPmarLoading]     = useState(false)
  const [pmarStatus,      setPmarStatus]      = useState('')
  const [pmarStatusType,  setPmarStatusType]  = useState('')
  const [showPmarRaster,  setShowPmarRaster]  = useState(true)
  const [showWindFarms,   setShowWindFarms]   = useState(true)

  // Wind farms use-layer state (lifted from PmarPanel)
  const [useSource,        setUseSource]        = useState('none')
  const [windfarmsPreview, setWindfarmsPreview] = useState(null)
  const [windfarmsLoading, setWindfarmsLoading] = useState(false)
  const [windfarmsEmpty,   setWindfarmsEmpty]   = useState(false)

  // Derived: prefer result from PMAR run, fall back to preview fetch
  const windfarmsGeoJSON = pmarData?.windfarms_geojson ?? windfarmsPreview

  const timerRef = useRef(null)

  // ── Wind farms preview fetch ───────────────────────────────────────────────
  useEffect(() => {
    if (useSource !== 'windfarms' || !seedShape) {
      setWindfarmsPreview(null)
      return
    }
    const bounds = seedShapeBounds(seedShape)
    if (!bounds) return

    setWindfarmsPreview(null)
    setWindfarmsEmpty(false)
    setWindfarmsLoading(true)
    fetch('/processes/windfarms/execution', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ inputs: bounds }),
    })
      .then(r => r.json())
      .then(raw => {
        const data = raw.result ?? raw
        if (data?.features?.length > 0) {
          setWindfarmsPreview(data)
        } else {
          setWindfarmsEmpty(true)
        }
      })
      .catch(() => { setWindfarmsEmpty(true) })
      .finally(() => setWindfarmsLoading(false))
  }, [useSource, seedShape])

  // ── Tool change ────────────────────────────────────────────────────────────
  function handleToolChange(tool) {
    setActiveTool(tool)
    setDrawMode(null)
  }

  // ── Seed drawing ───────────────────────────────────────────────────────────
  function handleStartDraw(mode) {
    setDrawMode(mode)
    setSeedShape(null)
  }

  function handleShapeDone(shape) {
    setSeedShape(shape)
    setDrawMode(null)
  }

  // ── OpenDrift animation ────────────────────────────────────────────────────
  const tick = useCallback(() => {
    setCurrentStep(prev => {
      if (prev >= (simData?.steps.length ?? 1) - 1) {
        setIsPlaying(false)
        return prev
      }
      return prev + 1
    })
  }, [simData])

  useEffect(() => {
    if (!isPlaying) { clearTimeout(timerRef.current); return }
    const delay = Math.max(40, 1000 / speed)
    timerRef.current = setTimeout(tick, delay)
    return () => clearTimeout(timerRef.current)
  }, [isPlaying, currentStep, speed, tick])

  function togglePlay() {
    if (!simData) return
    if (isPlaying) {
      setIsPlaying(false)
    } else {
      if (currentStep >= simData.steps.length - 1) setCurrentStep(0)
      setIsPlaying(true)
    }
  }

  // ── OpenDrift run ──────────────────────────────────────────────────────────
  async function handleRun({ model, start_time, number, duration_hours }) {
    if (!seedShape) {
      setStatus(t.status.noShape)
      setStatusType('error')
      return
    }

    const seedParams = seedShape.type === 'circle'
      ? { seeding_type: 'circle', lon: seedShape.lon, lat: seedShape.lat, radius: seedShape.radius }
      : { seeding_type: 'rectangle', lon_min: seedShape.lon_min, lat_min: seedShape.lat_min,
          lon_max: seedShape.lon_max, lat_max: seedShape.lat_max }

    setLoading(true)
    setStatus(t.status.running(t.modelLabels?.[model] ?? model))
    setStatusType('')
    setSimData(null)
    setIsPlaying(false)
    setCurrentStep(0)

    try {
      const resp = await fetch('/processes/opendrift/execution', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inputs: { model, start_time, number, duration_hours, ...seedParams } }),
      })

      if (!resp.ok) {
        const text = await resp.text()
        let message = t.status.httpError(resp.status)
        try {
          const json = JSON.parse(text)
          if (json.description) message = json.description
        } catch { message = text.slice(0, 300) }
        throw new Error(message)
      }

      const raw  = await resp.json()
      const data = (raw.steps && raw.times) ? raw : (raw.trajectory ?? raw)
      if (!data.steps || !data.times) throw new Error(t.status.badResponse)

      const nParticles = data.steps[0].filter(Boolean).length
      setStatus(t.status.done(nParticles, data.times.length))
      setStatusType('ok')
      setSimData(data)
      setCurrentStep(0)
      setIsPlaying(true)

    } catch (err) {
      setStatus(t.status.error(err.message))
      setStatusType('error')
    } finally {
      setLoading(false)
    }
  }

  // ── PMAR run ───────────────────────────────────────────────────────────────
  async function handleRunPmar({ pressure, start_time, duration_days, pnum, res, shapefile_b64 }) {
    const geojson = shapefile_b64 ? null : seedShapeToGeoJSON(seedShape)

    if (!geojson && !shapefile_b64) {
      setPmarStatus(t.status.noShape)
      setPmarStatusType('error')
      return
    }

    setPmarLoading(true)
    setPmarData(null)
    setPmarStatus(t.pmar.btnRunning.replace('⏳ ', '').replace('…', '…'))
    setPmarStatusType('')

    try {
      const inputs = {
        pressure,
        use_source: useSource,
        start_time,
        duration_days,
        pnum,
        res,
        ...(geojson       ? { geojson: JSON.stringify(geojson) } : {}),
        ...(shapefile_b64 ? { shapefile_b64 }                    : {}),
      }

      const resp = await fetch('/processes/pmar/execution', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ inputs }),
      })

      if (!resp.ok) {
        const text = await resp.text()
        let message = t.status.httpError(resp.status)
        try {
          const json = JSON.parse(text)
          if (json.description) message = json.description
        } catch { message = text.slice(0, 300) }
        throw new Error(message)
      }

      const raw  = await resp.json()
      const data = raw.result ?? raw

      if (!data.image_b64 || !data.bounds) throw new Error(t.status.badResponse)

      const label = lang === 'it' ? data.label_it : data.label_en
      setPmarData(data)
      setPmarStatus(`✓ PMAR — ${label}`)
      setPmarStatusType('ok')

    } catch (err) {
      setPmarStatus(t.status.error(err.message))
      setPmarStatusType('error')
    } finally {
      setPmarLoading(false)
    }
  }

  return (
    <div style={{ position: 'relative', height: '100vh' }}>
      <MapContainer
        center={[44, 12.5]}
        zoom={7}
        style={{ position: 'absolute', inset: 0 }}
        zoomControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='© OpenStreetMap · © CARTO'
          subdomains="abcd"
          maxZoom={19}
        />
        <SimLayer simData={simData} currentStep={currentStep} />
        <PmarLayer pmarData={pmarData} visible={showPmarRaster} />
        <WindFarmsLayer geojson={windfarmsGeoJSON} visible={showWindFarms} />
        <SeedDrawer
          drawMode={drawMode}
          seedShape={seedShape}
          showSeedShape={showSeedShape}
          onShapeDone={handleShapeDone}
        />
      </MapContainer>

      <Panel
        onRun={handleRun}
        onRunPmar={handleRunPmar}
        loading={loading}
        status={status}
        statusType={statusType}
        pmarLoading={pmarLoading}
        pmarStatus={pmarStatus}
        pmarStatusType={pmarStatusType}
        drawMode={drawMode}
        onStartDraw={handleStartDraw}
        seedShape={seedShape}
        activeTool={activeTool}
        onToolChange={handleToolChange}
        useSource={useSource}
        onUseSourceChange={src => { setUseSource(src); setWindfarmsEmpty(false) }}
        windfarmsLoading={windfarmsLoading}
        windfarmsEmpty={windfarmsEmpty}
      />

      {pmarData && (
        <PmarControls
          showPmarRaster={showPmarRaster}
          onTogglePmarRaster={() => setShowPmarRaster(v => !v)}
          showSeedShape={showSeedShape}
          onToggleSeedShape={() => setShowSeedShape(v => !v)}
          showWindFarms={showWindFarms}
          onToggleWindFarms={() => setShowWindFarms(v => !v)}
          hasWindFarms={!!windfarmsGeoJSON}
          elevated={!!simData}
        />
      )}

      {simData && (
        <AnimationControls
          simData={simData}
          currentStep={currentStep}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          onSliderChange={step => { setIsPlaying(false); setCurrentStep(step) }}
          speed={speed}
          onSpeedChange={setSpeed}
          showSeedShape={showSeedShape}
          onToggleSeedShape={() => setShowSeedShape(v => !v)}
        />
      )}
    </div>
  )
}
