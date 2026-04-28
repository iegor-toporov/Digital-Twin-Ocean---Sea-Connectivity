import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { MODEL_STYLES } from './constants'
import Panel from './components/Panel'
import SeedDrawer from './components/SeedDrawer'
import AnimationControls from './components/AnimationControls'
import 'leaflet/dist/leaflet.css'
import './App.css'

function SimLayer({ simData, currentStep }) {
  const map         = useMap()
  const markersRef  = useRef([])
  const trajsRef    = useRef([])
  const rendererRef = useRef(L.canvas({ padding: 0.5 }))

  useEffect(() => {
    if (!simData) return

    markersRef.current.forEach(({ marker }) => marker.remove())
    trajsRef.current.forEach(l => l.remove())
    markersRef.current = []
    trajsRef.current   = []

    const { steps } = simData
    const style      = MODEL_STYLES[simData.model] ?? MODEL_STYLES.OceanDrift
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
      const pos    = steps[0][p]
      const latlng = pos ? [pos[1], pos[0]] : [0, 0]
      const marker = L.circleMarker(latlng, {
        radius: 4, color: style.color, fillColor: style.fill,
        fillOpacity: pos ? 0.9 : 0, opacity: pos ? 1 : 0,
        weight: 1, renderer,
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
    markersRef.current.forEach(({ marker, idx }) => {
      const pos = positions[idx]
      if (pos) {
        marker.setLatLng([pos[1], pos[0]])
        marker.setStyle({ fillOpacity: 0.9, opacity: 1 })
      } else {
        marker.setStyle({ fillOpacity: 0, opacity: 0 })
      }
    })
  }, [simData, currentStep])

  return null
}

export default function App() {
  const [simData,     setSimData]     = useState(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [isPlaying,   setIsPlaying]   = useState(false)
  const [speed,       setSpeed]       = useState(5)
  const [loading,     setLoading]     = useState(false)
  const [status,      setStatus]      = useState('')
  const [statusType,  setStatusType]  = useState('')

  const [drawMode,       setDrawMode]       = useState(null)
  const [seedShape,      setSeedShape]      = useState(null)
  const [showSeedShape,  setShowSeedShape]  = useState(true)

  const timerRef = useRef(null)

  function handleStartDraw(mode) {
    setDrawMode(mode)
    setSeedShape(null)
  }

  function handleShapeDone(shape) {
    setSeedShape(shape)
    setDrawMode(null)
  }

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

  async function handleRun({ model, start_time, number, duration_hours }) {
    if (!seedShape) {
      setStatus("Disegna prima un'area di seeding sulla mappa.", 'error')
      setStatusType('error')
      return
    }

    const seedParams = seedShape.type === 'circle'
      ? { seeding_type: 'circle', lon: seedShape.lon, lat: seedShape.lat, radius: seedShape.radius }
      : { seeding_type: 'rectangle', lon_min: seedShape.lon_min, lat_min: seedShape.lat_min,
          lon_max: seedShape.lon_max, lat_max: seedShape.lat_max }

    setLoading(true)
    setStatus(`Simulazione ${MODEL_STYLES[model]?.label ?? model}… (1-2 min)`)
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
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`)
      }

      const raw  = await resp.json()
      const data = (raw.steps && raw.times) ? raw : (raw.trajectory ?? raw)
      if (!data.steps || !data.times) throw new Error('Risposta non valida dal server')

      const nParticles = data.steps[0].filter(Boolean).length
      setStatus(`${nParticles} particelle · ${data.times.length} passi`)
      setStatusType('ok')
      setSimData(data)
      setCurrentStep(0)
      setIsPlaying(true)

    } catch (err) {
      setStatus(`Errore: ${err.message}`)
      setStatusType('error')
    } finally {
      setLoading(false)
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
        <SeedDrawer
          drawMode={drawMode}
          seedShape={seedShape}
          showSeedShape={showSeedShape}
          onShapeDone={handleShapeDone}
        />
      </MapContainer>

      <Panel
        onRun={handleRun}
        loading={loading}
        status={status}
        statusType={statusType}
        drawMode={drawMode}
        onStartDraw={handleStartDraw}
        seedShape={seedShape}
      />

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
