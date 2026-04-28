import './ModelCard.css'

export default function ModelCard({ model, active, onClick }) {
  return (
    <div
      className={`model-card${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <div className="icon">{model.icon}</div>
      <div className="name">{model.name}</div>
      <div className="desc">{model.desc}</div>
    </div>
  )
}
