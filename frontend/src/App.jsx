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

// ── PMAR colormap helpers (replica di Spectral_r + LogNorm di matplotlib) ──────
const SPECTRAL_R = [
  [94,  79,  162], // 0.0  #5e4fa2
  [50,  136, 189], // 0.1  #3288bd
  [102, 194, 165], // 0.2  #66c2a5
  [171, 221, 164], // 0.3  #abdda4
  [230, 245, 152], // 0.4  #e6f598
  [255, 255, 191], // 0.5  #ffffbf
  [254, 224, 139], // 0.6  #fee08b
  [253, 174, 97],  // 0.7  #fdae61
  [244, 109, 67],  // 0.8  #f46d43
  [213, 62,  79],  // 0.9  #d53e4f
  [158, 1,   66],  // 1.0  #9e0142
]

function spectralR(t) {
  const n = SPECTRAL_R.length - 1
  const i = Math.min(Math.floor(t * n), n - 1)
  const f = t * n - i
  const c0 = SPECTRAL_R[i], c1 = SPECTRAL_R[i + 1]
  return [
    Math.round(c0[0] + f * (c1[0] - c0[0])),
    Math.round(c0[1] + f * (c1[1] - c0[1])),
    Math.round(c0[2] + f * (c1[2] - c0[2])),
  ]
}

function logNorm(val, vmin, vmax) {
  if (val <= 0 || !isFinite(val)) return null
  const logMin = Math.log10(Math.max(vmin, 1e-12))
  const logMax = Math.log10(vmax)
  return Math.max(0, Math.min(1, (Math.log10(val) - logMin) / (logMax - logMin)))
}

// ── Standard map-pin icon (reusable for all anthropogenic layers) ──────────────
function createPinIcon(fillColor, strokeColor) {
  const svg = `<svg width="14" height="21" viewBox="0 0 14 21" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 0C3.13 0 0 3.13 0 7c0 5.25 7 14 7 14S14 12.25 14 7c0-3.87-3.13-7-7-7z"
          fill="${fillColor}" stroke="${strokeColor}" stroke-width="1.5"/>
    <circle cx="7" cy="7" r="2.5" fill="${strokeColor}" opacity="0.6"/>
  </svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [14, 21], iconAnchor: [7, 21] })
}

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

// ── EMODnet offshore installations overlay ────────────────────────────────────
function OffshoreInstallationsLayer({ geojson, visible }) {
  const map        = useMap()
  const layerRef   = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    layerRef.current?.remove()
    layerRef.current = null
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    if (!geojson?.features?.length) return

    const icon = createPinIcon('#fed7aa', '#ea580c')

    layerRef.current = L.geoJSON(geojson, {
      style: {
        color:       '#f97316',
        fillColor:   '#fed7aa',
        fillOpacity: 0.25,
        weight:      1.5,
        opacity:     0.85,
      },
      pointToLayer: (_feature, latlng) => {
        const m = L.marker(latlng, { icon, interactive: false, zIndexOffset: 500 })
        markersRef.current.push(m)
        return m
      },
    }).addTo(map)

    geojson.features.forEach(feature => {
      const type = feature.geometry?.type
      if (type === 'Point' || type === 'MultiPoint') return
      try {
        const bounds = L.geoJSON(feature).getBounds()
        if (!bounds.isValid()) return
        const m = L.marker(bounds.getCenter(), { icon, interactive: false, zIndexOffset: 500 }).addTo(map)
        markersRef.current.push(m)
      } catch { /* geometria non valida, skip */ }
    })

    return () => {
      layerRef.current?.remove()
      markersRef.current.forEach(m => m.remove())
    }
  }, [geojson, map])

  useEffect(() => {
    if (!layerRef.current) return
    layerRef.current.setStyle({ opacity: visible ? 0.85 : 0, fillOpacity: visible ? 0.25 : 0 })
    markersRef.current.forEach(m => {
      const el = m.getElement()
      if (el) el.style.opacity = visible ? '1' : '0'
    })
  }, [visible])

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

    const icon = createPinIcon('#fef08a', '#ca8a04')

    layerRef.current = L.geoJSON(geojson, {
      style: {
        color:       '#facc15',
        fillColor:   '#fef08a',
        fillOpacity: 0.18,
        weight:      1.5,
        opacity:     0.75,
        dashArray:   '5 4',
      },
      pointToLayer: (_feature, latlng) => {
        const m = L.marker(latlng, { icon, interactive: false, zIndexOffset: 500 })
        markersRef.current.push(m)
        return m
      },
    }).addTo(map)

    geojson.features.forEach(feature => {
      const type = feature.geometry?.type
      if (type === 'Point' || type === 'MultiPoint') return
      try {
        const bounds = L.geoJSON(feature).getBounds()
        if (!bounds.isValid()) return
        const marker = L.marker(bounds.getCenter(), {
          icon,
          interactive:  false,
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

// ── PMAR raster overlay (canvas layer con hover per cella) ───────────────────
function PmarLayer({ pmarData, visible, passagesLabel }) {
  const map          = useMap()
  const canvasRef    = useRef(null)
  const tooltipRef   = useRef(null)
  const labelRef     = useRef(passagesLabel)
  labelRef.current   = passagesLabel

  useEffect(() => {
    if (!pmarData?.raster_values || !pmarData.bounds) return

    const {
      raster_values, vmin, vmax,
      raster_lon_min, raster_lat_min, raster_res,
      raster_nx, raster_ny,
    } = pmarData

    // Canvas nel overlayPane: viene trascinato con la mappa durante il pan
    const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide')
    canvas.style.pointerEvents = 'none'
    map.getPanes().overlayPane.appendChild(canvas)
    canvasRef.current = canvas

    // Tooltip sovrapposto al container della mappa
    const tooltip = document.createElement('div')
    tooltip.className = 'pmar-cell-tooltip'
    tooltip.style.display = 'none'
    map.getContainer().appendChild(tooltip)
    tooltipRef.current = tooltip

    function draw() {
      const size   = map.getSize()
      canvas.width  = size.x
      canvas.height = size.y
      // Allinea il canvas al pixel origin corrente della mappa
      const origin = map.containerPointToLayerPoint([0, 0])
      L.DomUtil.setPosition(canvas, origin)

      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, size.x, size.y)
      const ox = origin.x, oy = origin.y

      for (let row = 0; row < raster_ny; row++) {
        const rowData = raster_values[row]
        for (let col = 0; col < raster_nx; col++) {
          const val = rowData[col]
          if (!val || val <= 0) continue

          // row 0 = sud (lat_min), aumenta verso nord
          const lat = raster_lat_min + row * raster_res
          const lon = raster_lon_min + col * raster_res
          const half = raster_res / 2

          const sw = map.latLngToLayerPoint([lat - half, lon - half])
          const ne = map.latLngToLayerPoint([lat + half, lon + half])

          const x = ne.x - ox, y = ne.y - oy
          const w = sw.x - ne.x, h = sw.y - ne.y
          if (x + w < 0 || y + h < 0 || x > size.x || y > size.y) continue

          const t = logNorm(val, vmin, vmax)
          if (t === null) continue
          const [r, g, b] = spectralR(t)
          ctx.fillStyle = `rgba(${r},${g},${b},0.82)`
          ctx.fillRect(x, y, w, h)
        }
      }
    }

    function onMouseMove(e) {
      const { lat, lng } = e.latlng
      const col = Math.floor((lng - raster_lon_min + raster_res / 2) / raster_res)
      const row = Math.floor((lat - raster_lat_min + raster_res / 2) / raster_res)

      if (col >= 0 && col < raster_nx && row >= 0 && row < raster_ny) {
        const val = raster_values[row][col]
        if (val > 0) {
          const latC = (raster_lat_min + row * raster_res).toFixed(3)
          const lonC = (raster_lon_min + col * raster_res).toFixed(3)
          const dispVal = val >= 1 ? Math.round(val) : val.toFixed(3)
          tooltip.innerHTML =
            `<b>${dispVal}</b> ${labelRef.current}` +
            `<br><span>${latC}° N · ${lonC}° E</span>`
          tooltip.style.display = 'block'
          tooltip.style.left = (e.containerPoint.x + 14) + 'px'
          tooltip.style.top  = (e.containerPoint.y - 44) + 'px'
          return
        }
      }
      tooltip.style.display = 'none'
    }

    map.on('moveend zoomend resize', draw)
    map.on('mousemove', onMouseMove)
    map.on('mouseout',  () => { tooltip.style.display = 'none' })
    map.fitBounds(L.latLngBounds(pmarData.bounds), { padding: [50, 50] })
    draw()

    return () => {
      map.getPanes().overlayPane.removeChild(canvas)
      map.getContainer().removeChild(tooltip)
      map.off('moveend zoomend resize', draw)
      map.off('mousemove', onMouseMove)
      canvasRef.current  = null
      tooltipRef.current = null
    }
  }, [pmarData, map])

  useEffect(() => {
    if (canvasRef.current)
      canvasRef.current.style.display = visible ? '' : 'none'
    if (!visible && tooltipRef.current)
      tooltipRef.current.style.display = 'none'
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
  const [pmarErrorMsg,    setPmarErrorMsg]    = useState(null)
  const [showPmarRaster,  setShowPmarRaster]  = useState(true)
  const [showWindFarms,   setShowWindFarms]   = useState(true)

  // Use-layer state (lifted from PmarPanel)
  const [useSource,        setUseSource]        = useState('none')
  const [windfarmsPreview, setWindfarmsPreview] = useState(null)
  const [windfarmsLoading, setWindfarmsLoading] = useState(false)
  const [windfarmsEmpty,   setWindfarmsEmpty]   = useState(false)
  const [offshorePreview,  setOffshorePreview]  = useState(null)
  const [offshoreLoading,  setOffshoreLoading]  = useState(false)
  const [offshoreEmpty,    setOffshoreEmpty]    = useState(false)
  const [showOffshoreInstallations, setShowOffshoreInstallations] = useState(true)

  // Derived: prefer result from PMAR run, fall back to preview fetch
  const windfarmsGeoJSON = pmarData?.windfarms_geojson ?? windfarmsPreview
  const offshoreGeoJSON  = pmarData?.offshore_geojson  ?? offshorePreview

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

  // ── Offshore installations preview fetch ───────────────────────────────────
  useEffect(() => {
    if (useSource !== 'offshore_installations' || !seedShape) {
      setOffshorePreview(null)
      return
    }
    const bounds = seedShapeBounds(seedShape)
    if (!bounds) return

    setOffshorePreview(null)
    setOffshoreEmpty(false)
    setOffshoreLoading(true)
    fetch('/processes/offshore_installations/execution', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ inputs: bounds }),
    })
      .then(r => r.json())
      .then(raw => {
        const data = raw.result ?? raw
        if (data?.features?.length > 0) {
          setOffshorePreview(data)
        } else {
          setOffshoreEmpty(true)
        }
      })
      .catch(() => { setOffshoreEmpty(true) })
      .finally(() => setOffshoreLoading(false))
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
  async function handleRunPmar({ scenario_id, pressure, start_time, duration_days, pnum, res, time_step_hours, shapefile_b64, geotiff_b64, geotiff_url }) {
    let inputs

    if (scenario_id) {
      inputs = { scenario_id, use_source: useSource, res,
        ...(useSource === 'geotiff' && geotiff_b64  ? { geotiff_b64 }  : {}),
        ...(useSource === 'geotiff' && geotiff_url  ? { geotiff_url }  : {}),
      }
    } else {
      const geojson = shapefile_b64 ? null : seedShapeToGeoJSON(seedShape)
      if (!geojson && !shapefile_b64) {
        setPmarStatus(t.status.noShape)
        setPmarStatusType('error')
        return
      }
      inputs = {
        pressure,
        use_source: useSource,
        start_time,
        duration_days,
        pnum,
        res,
        time_step_hours,
        ...(geojson       ? { geojson: JSON.stringify(geojson) } : {}),
        ...(shapefile_b64 ? { shapefile_b64 }                    : {}),
        ...(useSource === 'geotiff' && geotiff_b64  ? { geotiff_b64 }  : {}),
        ...(useSource === 'geotiff' && geotiff_url  ? { geotiff_url }  : {}),
      }
    }

    setPmarLoading(true)
    setPmarData(null)
    setPmarStatus(t.pmar.btnRunning.replace('⏳ ', '').replace('…', '…'))
    setPmarStatusType('')

    try {

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

      if (!data.raster_values || !data.bounds) throw new Error(t.status.badResponse)

      const label = lang === 'it' ? data.label_it : data.label_en
      setPmarData(data)
      setPmarStatus(`✓ PMAR — ${label}`)
      setPmarStatusType('ok')

    } catch (err) {
      const clean = err.message
        .replace(/^Error executing process:\s*/i, '')
        .replace(/^Errore:\s*/i, '')
        .replace(/^Error:\s*/i, '')
        .trim()
      setPmarErrorMsg(clean)
      setPmarStatus('')
      setPmarStatusType('error')
    } finally {
      setPmarLoading(false)
    }
  }

  // ── PMAR raster download (GeoTIFF EPSG:4326) ──────────────────────────────
  function handleDownloadPmar() {
    if (!pmarData?.geotiff_b64) return
    const bytes = atob(pmarData.geotiff_b64)
    const buf   = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i)
    const blob  = new Blob([buf], { type: 'image/tiff' })
    const url   = URL.createObjectURL(blob)
    const a     = document.createElement('a')
    a.href      = url
    const src   = pmarData.use_source !== 'none' ? `_${pmarData.use_source}` : ''
    a.download  = `pmar_${pmarData.pressure}_${pmarData.start_time}-${pmarData.end_time}_p${pmarData.pnum}${src}.tif`
    a.click()
    URL.revokeObjectURL(url)
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
        <PmarLayer pmarData={pmarData} visible={showPmarRaster} passagesLabel={t.pmarControls.tooltipPassages} />
        <WindFarmsLayer geojson={windfarmsGeoJSON} visible={showWindFarms} />
        <OffshoreInstallationsLayer geojson={offshoreGeoJSON} visible={showOffshoreInstallations} />
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
        onUseSourceChange={src => { setUseSource(src); setWindfarmsEmpty(false); setOffshoreEmpty(false) }}
        windfarmsLoading={windfarmsLoading}
        windfarmsEmpty={windfarmsEmpty}
        offshoreLoading={offshoreLoading}
        offshoreEmpty={offshoreEmpty}
      />

      {pmarData?.colorbar_b64 && showPmarRaster && (
        <div className="pmar-colorbar">
          <span className="pmar-colorbar-label">{t.pmarControls.colorbarLabel}</span>
          <img
            src={`data:image/png;base64,${pmarData.colorbar_b64}`}
            alt="colorbar"
            className="pmar-colorbar-img"
          />
        </div>
      )}

      {pmarData && (
        <PmarControls
          showPmarRaster={showPmarRaster}
          onTogglePmarRaster={() => setShowPmarRaster(v => !v)}
          showSeedShape={showSeedShape}
          onToggleSeedShape={() => setShowSeedShape(v => !v)}
          showWindFarms={showWindFarms}
          onToggleWindFarms={() => setShowWindFarms(v => !v)}
          hasWindFarms={!!windfarmsGeoJSON}
          showOffshoreInstallations={showOffshoreInstallations}
          onToggleOffshoreInstallations={() => setShowOffshoreInstallations(v => !v)}
          hasOffshoreInstallations={!!offshoreGeoJSON}
          onDownloadPmar={handleDownloadPmar}
          elevated={!!simData}
        />
      )}

      {pmarErrorMsg && (
        <div className="pmar-error-backdrop" onClick={() => setPmarErrorMsg(null)}>
          <div className="pmar-error-modal" onClick={e => e.stopPropagation()}>
            <div className="pmar-error-icon">⚠</div>
            <p className="pmar-error-text">{pmarErrorMsg}</p>
            <button className="pmar-error-btn" onClick={() => setPmarErrorMsg(null)}>OK</button>
          </div>
        </div>
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
