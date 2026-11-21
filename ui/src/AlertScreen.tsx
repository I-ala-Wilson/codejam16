export function AlertScreen({ title, sub, onDismiss }: { title: string; sub?: string; onDismiss?: () => void }) {
  return (
    <div className="echo-alert" role="alert" onClick={onDismiss}>
      <div className="echo-alert__title">{title}</div>
      {sub && <div className="echo-alert__sub">{sub}</div>}
      {onDismiss && <div className="echo-alert__hint">Click anywhere to dismiss</div>}
    </div>
  )
}
