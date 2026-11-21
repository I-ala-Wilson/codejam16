import './pitch.css'

// Home pitch section: the three apps on one sonar engine, one card each with its category.
const APPS = [
  {
    name: 'Care', category: 'Health and accessibility',
    line: 'A hands-free help call for hospital beds and bathrooms, where cameras are not allowed. Wave to call a nurse, even in the dark.',
  },
  {
    name: 'Lock', category: 'Digital wellbeing and parenting',
    line: 'Blocked sites look like "This site can\'t be reached", so to a kid the Wi-Fi is just broken. Only your secret hand signs open them.',
  },
  {
    name: 'Habit', category: 'Healthy habits',
    line: 'Notices repeated scratching while you work and gives a soft nudge. Double tap to snooze it.',
  },
]

export default function Apps() {
  return (
    <section className="pz" aria-labelledby="pz-apps">
      <h2 id="pz-apps" className="pz__title">Three apps, one sonar</h2>
      <div className="pz__cards">
        {APPS.map((a, i) => (
          <article key={a.name} className="pz__card">
            <div className="pz__cardhead"><span className="pz__idx">0{i + 1}</span>{a.name}</div>
            <div className="pz__cat">{a.category}</div>
            <p className="pz__line">{a.line}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
