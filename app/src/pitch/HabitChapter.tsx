import DitherCanvas from '../hwb/DitherCanvas.tsx'
import { habitScene3D } from './scenes3d.ts'
import './pitch.css'

// Home pitch chapter: Habit, the Health and Undo Button challenges. Figures supplied by the lead (pitch document) and
// EJ's live test.
const STATS = [
  { big: '15%', label: 'of Canadian children live with eczema (approx.)' },
  { big: '93%', label: 'of scratches caught in a live test (14 of 15), with no camera and no wearable' },
]

export default function HabitChapter({ go }: { go: (page: string) => void }) {
  return (
    <section id="habit" className="pz pz--chapter" aria-labelledby="pz-habit">
      <div className="pz__tags"><span>Health</span><span>Undo</span></div>
      <h2 id="pz-habit" className="pz__title">Habit: notice the scratch you otherwise would not</h2>
      <div className="pz__split">
        <div>
          <div className="pz__stats pz__stats--2">
            {STATS.map((s) => (
              <div key={s.big} className="pz__stat"><div className="pz__big">{s.big}</div><div className="pz__label">{s.label}</div></div>
            ))}
          </div>
          <p className="pz__line">Typing does nothing. Scratching sets off an alarm and a bar along the bottom. A double tap in the air snoozes it for ten minutes.</p>
          <button className="pz__btn" onClick={() => go('habit-app')}>Open live demo</button>
        </div>
        <div className="pz__frame"><DitherCanvas scene={habitScene3D} label="A hand scratches a forearm beside a laptop, then lifts away when the Habit reminder appears." /></div>
      </div>
    </section>
  )
}
