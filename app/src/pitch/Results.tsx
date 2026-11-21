import './pitch.css'

// Home pitch section: the numbers. 96% is Ian's 100 live trials on the calibrated demo MacBook Pro; 6 of 7 is EJ's Habit
// live test; app/public/models/gesture.onnx is 131,100 bytes; a calibration retrain is about 3 minutes on one GPU.
const STATS = [
  { big: '96%', label: 'gestures recognised live on our demo laptop' },
  { big: '6 of 7', label: 'scratches caught by Habit' },
  { big: '128 KB', label: 'model, running in the browser' },
  { big: '$0', label: 'server and cloud cost' },
]

export default function Results() {
  return (
    <section className="pz" aria-labelledby="pz-results">
      <h2 id="pz-results" className="pz__title">Honest numbers</h2>
      <div className="pz__stats pz__stats--4">
        {STATS.map((s) => (
          <div key={s.big} className="pz__stat">
            <div className="pz__big">{s.big}</div>
            <div className="pz__label">{s.label}</div>
          </div>
        ))}
      </div>
      <p className="pz__small">96% over 100 live trials by one presenter after calibration. A proof of concept, not a medical device.</p>
    </section>
  )
}
