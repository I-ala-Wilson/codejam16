import './pitch.css'

// Home pitch section: the four CodeJam challenges ECHØ answers, one card each, in the organisers' words.
const CHALLENGES = [
  {
    name: 'Health', apps: 'Care',
    line: 'Hands-free calls for help and for pain, designed for patients who cannot reach a call button, with no camera in bathrooms or hospital rooms.',
  },
  {
    name: 'Undo Button', apps: 'Undo gesture · Lock',
    line: 'A double tap in the air reverses the last sign anywhere in ECHØ, and Lock allows a parent to undo a child\'s unhealthy screen habit.',
  },
  {
    name: 'Touch Grass', apps: 'Habit · Lock',
    line: 'Habit brings an unconscious habit to your attention as it happens, and Lock makes blocked sites appear unreachable so that the child steps away from the screen.',
  },
  {
    name: 'Agent Solution', apps: 'How we built it',
    line: 'A 128 KB model runs on the laptop\'s own processor inside the browser, with no server and no cloud cost, and the explainer above shows how it works.',
  },
]

export default function Apps() {
  return (
    <section className="pz" aria-labelledby="pz-apps">
      <h2 id="pz-apps" className="pz__title">The challenges we tackled</h2>
      <div className="pz__cards pz__cards--4">
        {CHALLENGES.map((c, i) => (
          <article key={c.name} className="pz__card">
            <div className="pz__cardhead"><span className="pz__idx">0{i + 1}</span>{c.name}</div>
            <div className="pz__cat">{c.apps}</div>
            <p className="pz__line">{c.line}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
