export function Toast({ text, visible }: { text: string; visible: boolean }) {
  return (
    <div className={`echo-toast${visible ? ' echo-toast--on' : ''}`} role="status" aria-hidden={!visible}>
      {text}
    </div>
  )
}
