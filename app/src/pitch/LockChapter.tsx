import './pitch.css'

// Home pitch chapter: Lock, the Touch Grass and Undo Button challenges. The miniature mirrors the look of Chrome's
// net-error page that extension/veil.js shows on a locked site.
export default function LockChapter({ go }: { go: (page: string) => void }) {
  return (
    <section id="lock" className="pz pz--chapter" aria-labelledby="pz-lock">
      <div className="pz__tags"><span>Touch Grass</span><span>Undo</span></div>
      <h2 id="pz-lock" className="pz__title">Lock: the site is simply down</h2>
      <div className="pz__split">
        <div>
          <p className="pz__line pz__line--lead">To the child, a blocked site looks like it is simply down, so they put the device away and go outside.</p>
          <p className="pz__line">Parents unlock it with a private sequence of hand gestures. Only two faint dots show progress, so nobody watching learns the code.</p>
          <button className="pz__btn" onClick={() => go('lock')}>Open live demo</button>
        </div>
        <div className="pz__chrome" role="img" aria-label="A miniature of Chrome's This site can't be reached page with a Reload button and two faint dots at the bottom.">
          <svg className="pz__chrome-icon" viewBox="0 0 72 72" aria-hidden="true">
            <path fill="#5f6368" d="M18 8h30l12 12v42a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
            <path fill="#fff" d="M48 8v12h12z" opacity=".6" />
            <circle cx="30" cy="34" r="3" fill="#fff" /><circle cx="46" cy="34" r="3" fill="#fff" />
            <path d="M28 50c3-4 13-4 16 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
          <div className="pz__chrome-h">This site can’t be reached</div>
          <div className="pz__chrome-p"><b>youtube.com</b> refused to connect.</div>
          <div className="pz__chrome-p">Try checking the connection</div>
          <div className="pz__chrome-code">ERR_CONNECTION_REFUSED</div>
          <div className="pz__chrome-row"><span className="pz__chrome-btn">Reload</span></div>
          <div className="pz__chrome-dots"><i /><i /></div>
        </div>
      </div>
    </section>
  )
}
