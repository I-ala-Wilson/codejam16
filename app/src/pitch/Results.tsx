import DitherCanvas from '../hwb/DitherCanvas.tsx'
import { limits } from '../hwb/scenes.ts'
import './pitch.css'

// Home pitch section: the numbers and the limits. 96% is 48 of 50 live trials on the calibrated demo MacBook Pro;
// 3 m is the furthest live detection in our tests (training takes were at 20 to 50 cm).
const STATS = [
  { big: '96%', label: '48 of 50 live trials' },
  { big: '3 m', label: 'highest observed detection range, trained at 50 cm' },
]

export default function Results() {
  return (
    <section className="pz" aria-labelledby="pz-results">
      <h2 id="pz-results" className="pz__title">Our figures</h2>
      <div className="pz__honest">
        <div className="pz__honeststats">
          {STATS.map((s) => (
            <div key={s.big} className="pz__stat">
              <div className="pz__big">{s.big}</div>
              <div className="pz__label">{s.label}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="pz__frame pz__frame--flush">
            <DitherCanvas scene={limits} label="Five limits: it needs recalibrating whenever the room or laptop position changes; only five people trained it, so new users are read less reliably; the same sign varies from person to person; two ECHØ laptops a few metres apart interfere; each gesture needed its own tuned threshold; it is a proof of concept built in 36 hours, not a finished medical device." />
          </div>
        </div>
      </div>
    </section>
  )
}
