import { useLang } from '../LanguageContext'
import './PmarControls.css'

export default function PmarControls({
  showPmarRaster,
  onTogglePmarRaster,
  showSeedShape,
  onToggleSeedShape,
  showWindFarms,
  onToggleWindFarms,
  hasWindFarms,
  showOffshoreInstallations,
  onToggleOffshoreInstallations,
  hasOffshoreInstallations,
  onDownloadPmar,
  elevated,
}) {
  const { t } = useLang()
  const c = t.pmarControls

  return (
    <div className={`pmar-controls${elevated ? ' elevated' : ''}`}>
      <span className="pmar-controls-label">PMAR</span>

      <button
        className={`pmar-toggle-btn${showPmarRaster ? ' active' : ''}`}
        onClick={onTogglePmarRaster}
        title={showPmarRaster ? c.hideRaster : c.showRaster}
      >
        🟥 {showPmarRaster ? c.hideRaster : c.showRaster}
      </button>

      <button
        className={`pmar-toggle-btn${showSeedShape ? ' active' : ''}`}
        onClick={onToggleSeedShape}
        title={showSeedShape ? c.hideSeed : c.showSeed}
      >
        ◯ {showSeedShape ? c.hideSeed : c.showSeed}
      </button>

      {hasWindFarms && (
        <button
          className={`pmar-toggle-btn${showWindFarms ? ' active' : ''}`}
          onClick={onToggleWindFarms}
          title={showWindFarms ? c.hideWindFarms : c.showWindFarms}
        >
          ⚡ {showWindFarms ? c.hideWindFarms : c.showWindFarms}
        </button>
      )}

      {hasOffshoreInstallations && (
        <button
          className={`pmar-toggle-btn${showOffshoreInstallations ? ' active' : ''}`}
          onClick={onToggleOffshoreInstallations}
          title={showOffshoreInstallations ? c.hideOffshore : c.showOffshore}
        >
          🛢️ {showOffshoreInstallations ? c.hideOffshore : c.showOffshore}
        </button>
      )}

      <span className="pmar-controls-sep" />
      <button className="pmar-toggle-btn" onClick={onDownloadPmar} title={c.downloadRaster}>
        ⬇ {c.downloadRaster}
      </button>
    </div>
  )
}
