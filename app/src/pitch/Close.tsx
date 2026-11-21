import './pitch.css'

const TEAM = [
  { name: 'Ian', url: 'https://ianwilson.dev' },
  { name: 'Yahya', url: 'https://yahya-hallani.dev/' },
  { name: 'EJ', url: 'https://www.linkedin.com/in/eunjunko/' },
  { name: 'Michael', url: 'https://www.linkedin.com/in/michael-lulic-401b65234/' },
]

// Home pitch section: the closing line and the team.
export default function Close() {
  return (
    <section className="pz pz--close" aria-label="Closing">
      <p className="pz__closing">Your laptop can hear your hands.</p>
      <p className="pz__team">
        ECHØ · {TEAM.map((m, i) => <span key={m.name}>{i > 0 && ' · '}<a href={m.url} target="_blank" rel="noreferrer">{m.name}</a></span>)}
      </p>
    </section>
  )
}
