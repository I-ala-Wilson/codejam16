import './pitch.css'

// Home pitch section: the four CodeJam challenges ECHØ answers, one card each, in the organisers' words.
const CHALLENGES = [
  {
    name: 'Health', apps: 'Care',
    line: 'Hands-free help and pain calls for people who cannot reach a button, with no camera in bathrooms or hospital rooms.',
  },
  {
    name: 'Undo Button', apps: 'Undo gesture · Lock',
    line: 'A double tap in the air deletes the last sign anywhere in ECHØ, and Lock lets a parent undo a kid\'s bad screen habit.',
  },
  {
    name: 'Touch Grass', apps: 'Habit · Lock',
    line: 'Habit nudges you off a screen habit. Lock makes blocked sites look unreachable, so the kid goes outside.',
  },
  {
    name: 'Agent Solution', apps: 'How we built it',
    line: 'A 128 KB model that runs on the laptop\'s own CPU, in the browser: no server, no cloud cost. The explainer shows how it works.',
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
