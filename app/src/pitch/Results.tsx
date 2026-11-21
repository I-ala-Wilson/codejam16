import './pitch.css'

// Home pitch section: the numbers and the limits. 96% is 48 of 50 live trials on the calibrated demo MacBook Pro;
// 3 m is the furthest live detection in our tests (training takes were at 20 to 50 cm); 6 of 7 is EJ's Habit live test.
const STATS = [
  { big: '96%', label: 'gestures recognised live, 48 of 50 trials' },
  { big: '3 m', label: 'furthest detection in a test, trained only up to 50 cm' },
  { big: '36 h', label: 'from idea to working prototype' },
]
const LIMITS = [
  'It needs a fairly quiet room to calibrate, and that room has to stay the same for detection to stay consistent.',
  'It learned from a small group, so it can be biased, for example toward right hand gestures.',
  'The same instruction produces different motions from person to person, open and close most of all.',
  'Two ECHØ laptops a few metres apart can interfere with each other.',
  'At first only push, pull and open and close read well; tuning each gesture\'s threshold brought the rest up.',
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
          </div>
        ))}
      </div>
      <div className="pz__limits">
        <div className="pz__limitshead">Where it falls short</div>
        <ol>{LIMITS.map((l) => <li key={l}>{l}</li>)}</ol>
      </div>
      <p className="pz__small">A proof of concept, not a finished medical device.</p>
    </section>
  )
}
