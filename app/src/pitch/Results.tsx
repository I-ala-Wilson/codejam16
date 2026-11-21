import './pitch.css'

// Home pitch section: the honest numbers. Every figure comes from ml/experiments/summary.json and RESULTS.md
// (stranger.gestures.macro_recall, ian_on_macbook_pro_calibration, and EJ's Habit live test). Compute: app/public/models/
// gesture.onnx is 131,100 bytes; a calibration retrain is about 3 minutes on one GPU (Yahya's calib runs).
const STATS = [
  { big: '45%', label: 'of gestures recognised for a person the model has never seen', note: 'five gestures: push, pull, wave, open/close, undo' },
  { big: '66% → 77%', label: 'on our demo MacBook Pro, after the presenter recorded his own calibration takes', note: 'one person measured; 71% after about 5 minutes' },
  { big: '6 of 7', label: 'scratches caught by Habit in a live test', note: 'Habit is a separate mode, not a gesture; about 22% on unseen people' },
]

export default function Results() {
  return (
    <section className="pz" aria-labelledby="pz-results">
      <h2 id="pz-results" className="pz__title">Honest numbers</h2>
      <div className="pz__stats">
        {STATS.map((s) => (
          <div key={s.big} className="pz__stat">
            <div className="pz__big">{s.big}</div>
            <div className="pz__label">{s.label}</div>
            <div className="pz__note">{s.note}</div>
          </div>
        ))}
      </div>
      <div className="pz__compute">
        <span className="pz__computehead">Compute</span>
        <span><b>128 KB</b> model</span>
        <span>runs on the laptop's <b>CPU</b>, in the browser</span>
        <span><b>no server</b>, no GPU to use it, <b>$0</b> cloud cost</span>
        <span>about <b>3 min</b> of GPU training per calibration</span>
      </div>
      <p className="pz__small">
        Measured on 5 people and 3 laptop models, testing each person only on a model trained without them. Run-to-run noise is
        about 2 points, and the calibration figures come from one person. ECHØ is a proof of concept, not a medical device.
      </p>
    </section>
  )
}
