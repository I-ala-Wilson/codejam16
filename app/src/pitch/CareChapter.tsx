import DitherCanvas from '../hwb/DitherCanvas.tsx'
import { careScene } from './scenes.ts'
import './pitch.css'

// Home pitch chapter: Care, the Health challenge. Figures supplied by the lead from the team's pitch document.
const STATS = [
  { big: '108,000', label: 'stroke hospital or emergency department visits a year in Canada (approx.)' },
  { big: '56.6%', label: 'of stroke patients present with arm weakness on admission (2021 study)' },
]
const GESTURES = [['Wave', 'help'], ['Open / close', 'pain'], ['Double tap', 'cancel']]

export default function CareChapter({ go }: { go: (page: string) => void }) {
  return (
    <section id="care" className="pz pz--chapter" aria-labelledby="pz-care">
      <div className="pz__tags"><span>Health</span></div>
      <h2 id="pz-care" className="pz__title">Care: a call button you do not have to reach</h2>
      <div className="pz__split">
        <div>
          <div className="pz__stats pz__stats--2">
            {STATS.map((s) => (
              <div key={s.big} className="pz__stat"><div className="pz__big">{s.big}</div><div className="pz__label">{s.label}</div></div>
            ))}
          </div>
          <ul className="pz__gestures">
            {GESTURES.map(([g, a]) => <li key={g}><b>{g}</b><span>{a}</span></li>)}
          </ul>
          <p className="pz__line">ECHØ has no lens and stores no audio. Only the event leaves the room.</p>
          <button className="pz__btn" onClick={() => go('care')}>Open live demo</button>
        </div>
        <div className="pz__frame"><DitherCanvas scene={careScene} label="A patient in bed waves; sound arcs travel from a bedside laptop to the hand and back, and the caregiver's phone lights up with HELP." /></div>
      </div>
    </section>
  )
}
