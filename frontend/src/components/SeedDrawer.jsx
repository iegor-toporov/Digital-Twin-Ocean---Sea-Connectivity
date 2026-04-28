import { useEffect, useRef } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

const CONFIRMED_STYLE = {
  color: '#0ea5e9', fillColor: '#7dd3fc',
  fillOpacity: 0.18, weight: 2,
}
const PREVIEW_STYLE = {
  color: '#0ea5e9', fillColor: '#7dd3fc',
  fillOpacity: 0.10, weight: 2, dashArray: '6 4',
}

export default function SeedDrawer({ drawMode, seedShape, onShapeDone }) {
  const map = useMap()

  // Refs usati dentro useMapEvents per evitare closure stale
  const drawModeRef    = useRef(drawMode)
  const onShapeDoneRef = useRef(onShapeDone)
  useEffect(() => { drawModeRef.current    = drawMode    }, [drawMode])
  useEffect(() => { onShapeDoneRef.current = onShapeDone }, [onShapeDone])

  // Layer sulla mappa (preview durante disegno + shape confermata)
  const layerRef  = useRef(null)
  // Stato interno del disegno (non causa re-render)
  const stateRef  = useRef({ circlePhase: 'idle', circleCenter: null, rectDrawing: false, rectStart: null })

  function clearLayer() {
    layerRef.current?.remove()
    layerRef.current = null
  }

  // Cursore + reset stato quando drawMode cambia
  useEffect(() => {
    if (drawMode) {
      clearLayer()
      stateRef.current = { circlePhase: 'idle', circleCenter: null, rectDrawing: false, rectStart: null }
      map.getContainer().style.cursor = 'crosshair'
    } else {
      map.getContainer().style.cursor = ''
    }
    return () => { map.getContainer().style.cursor = '' }
  }, [drawMode, map])

  // Mostra la shape confermata quando non si sta disegnando
  useEffect(() => {
    if (drawMode) return
    clearLayer()
    if (!seedShape) return

    if (seedShape.type === 'circle') {
      layerRef.current = L.circle([seedShape.lat, seedShape.lon], {
        radius: seedShape.radius, ...CONFIRMED_STYLE,
      }).addTo(map)
    } else {
      layerRef.current = L.rectangle([
        [seedShape.lat_min, seedShape.lon_min],
        [seedShape.lat_max, seedShape.lon_max],
      ], CONFIRMED_STYLE).addTo(map)
    }

    return clearLayer
  }, [drawMode, seedShape, map])

  useMapEvents({
    // ── Cerchio ───────────────────────────────────────────────────────────────
    click(e) {
      if (drawModeRef.current !== 'circle') return
      const s = stateRef.current

      if (s.circlePhase === 'idle') {
        s.circlePhase  = 'radius'
        s.circleCenter = e.latlng
        clearLayer()
        layerRef.current = L.circle(e.latlng, { radius: 500, ...PREVIEW_STYLE }).addTo(map)
      } else {
        const radius = Math.max(100, Math.round(s.circleCenter.distanceTo(e.latlng)))
        clearLayer()
        stateRef.current = { ...stateRef.current, circlePhase: 'idle', circleCenter: null }
        onShapeDoneRef.current({
          type: 'circle',
          lon:  s.circleCenter.lng,
          lat:  s.circleCenter.lat,
          radius,
        })
      }
    },

    mousemove(e) {
      const mode = drawModeRef.current
      const s    = stateRef.current

      if (mode === 'circle' && s.circlePhase === 'radius' && s.circleCenter) {
        const radius = Math.max(100, Math.round(s.circleCenter.distanceTo(e.latlng)))
        layerRef.current?.setRadius(radius)
      }

      if (mode === 'rectangle' && s.rectDrawing && s.rectStart) {
        const bounds = L.latLngBounds(s.rectStart, e.latlng)
        if (layerRef.current) {
          layerRef.current.setBounds(bounds)
        } else {
          layerRef.current = L.rectangle(bounds, PREVIEW_STYLE).addTo(map)
        }
      }
    },

    // ── Rettangolo ────────────────────────────────────────────────────────────
    mousedown(e) {
      if (drawModeRef.current !== 'rectangle') return
      map.dragging.disable()
      stateRef.current.rectDrawing = true
      stateRef.current.rectStart   = e.latlng
      clearLayer()
    },

    mouseup(e) {
      if (drawModeRef.current !== 'rectangle' || !stateRef.current.rectDrawing) return
      map.dragging.enable()
      stateRef.current.rectDrawing = false

      const bounds = L.latLngBounds(stateRef.current.rectStart, e.latlng)
      stateRef.current.rectStart = null

      // Ignora click senza trascinamento
      const sw = bounds.getSouthWest()
      const ne = bounds.getNorthEast()
      if (Math.abs(ne.lng - sw.lng) < 0.001 && Math.abs(ne.lat - sw.lat) < 0.001) return

      clearLayer()
      onShapeDoneRef.current({
        type:    'rectangle',
        lon_min: sw.lng, lat_min: sw.lat,
        lon_max: ne.lng, lat_max: ne.lat,
      })
    },
  })

  return null
}
