export function Banner({
  tone,
  title,
  detail,
  onDismiss,
}: {
  tone: 'alert' | 'warn' | 'ok'
  title: string
  detail?: string
  onDismiss?: () => void
}) {
  return (
    <div className={`echo-banner echo-banner--${tone}`} role={tone === 'alert' ? 'alert' : 'status'}>
      <div className="echo-banner__text">
        <strong className="echo-banner__title">{title}</strong>
        {detail && <span className="echo-banner__detail">{detail}</span>}
      </div>
      {onDismiss && (
        <button type="button" className="echo-banner__close" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
