export const MODEL_STYLES = {
  OceanDrift: { color: '#0ea5e9', fill: '#7dd3fc', traj: '#38bdf8', badge: '#0c4a6e', label: '🌊 Tracciante' },
  PlastDrift: { color: '#f59e0b', fill: '#fde68a', traj: '#fbbf24', badge: '#451a03', label: '🧴 Plastica'   },
  LarvalFish: { color: '#22c55e', fill: '#86efac', traj: '#4ade80', badge: '#052e16', label: '🐟 Larve'      },
  OpenOil:    { color: '#ef4444', fill: '#fca5a5', traj: '#f87171', badge: '#450a0a', label: '🛢️ Petrolio'  },
}

export const MODELS = [
  { key: 'OceanDrift', icon: '🌊', name: 'Tracciante',  desc: 'Correnti superficiali'       },
  { key: 'PlastDrift', icon: '🧴', name: 'Plastica',     desc: 'Con wind drag e Stokes'      },
  { key: 'LarvalFish', icon: '🐟', name: 'Larve/uova',  desc: 'Galleggiabilità verticale'   },
  { key: 'OpenOil',    icon: '🛢️', name: 'Idrocarburi', desc: 'Evaporazione ed emulsione'   },
]

export function defaultStartTime() {
  const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`
}
