// "How we built it": the section under How it works on Home. Short, factual answers to what judges ask about the
// signal, the model, the agent team and the trade-offs. Numbers come from ml/REPORT.md and ml/experiments/RESULTS.md.

const BLOCKS = [
  {
    title: 'The signal',
    big: '20 kHz',
    lines: [
      'The speaker plays a tone too high for people to hear, and the mic listens for its echo.',
      'A hand moving toward the screen squeezes the echo up in pitch; moving away stretches it down.',
      'We read that Doppler shift, about 60 Hz for a quick move, 47 times a second.',
      'No camera and no images, so it works in the dark.',
    ],
  },
  {
    title: 'The model',
    big: '147 takes',
    lines: [
      '5 people recorded 147 labelled sessions: 73,000 short windows of echo.',
      'A small neural network trained on a laptop GPU, then runs inside the browser, so audio never leaves the device.',
      'Tested only on people it never saw: about 1 in 2 gestures for a stranger, rising with 5 minutes of calibration.',
      'Simple physics rules back it up: the direction of the shift settles push versus pull.',
    ],
  },
  {
    title: 'The agents',
    big: '4 + 5',
    lines: [
      '4 humans and 5 AI coding agents built this together on one shared message board.',
      'Each agent owned its own folders, enforced by git hooks, and had to acknowledge every spec change.',
      'Models trained overnight on their own; a QA agent found and closed a security hole.',
      'Humans made the calls, recorded the data and tested everything live.',
    ],
  },
  {
    title: 'Considerations',
    big: '$0',
    lines: [
      'Private by design: sound is processed on the laptop and only short events are sent.',
      'No new hardware: any laptop or phone with a speaker and a microphone.',
      'Built for people who cannot speak or reach a call button.',
      'Honest limits: some laptops echo far weaker, it needs a calm room, and it is not a medical device.',
    ],
  },
]

const FAQ = [
  ['Does it record me?', 'No. Audio is analysed on the device and thrown away; only events like "help" leave it.'],
  ['Will it work on my laptop?', 'Any laptop with a speaker and a mic; weaker speakers need a short calibration.'],
  ['Why not a camera?', 'Cameras are not allowed in many patient rooms and bathrooms, and they fail in the dark.'],
  ['How accurate is it?', 'About half of gestures for a brand-new person, much higher for someone it has learned.'],
  ['What did the AI do?', 'The agents wrote and tested most of the code; we decided what to build and recorded the data.'],
]

export default function HowWeBuilt() {
  return (
    <section className="hwb">
      <div className="lk__eyebrow">HOW WE BUILT IT</div>
      <h2 className="hwb__title">Five people, five AI agents, one weekend.</h2>
      <div className="hwb__grid">
        {BLOCKS.map((b) => (
          <div key={b.title} className="hwb__block">
            <div className="hwb__head"><span>{b.title}</span><span className="hwb__big">{b.big}</span></div>
            <ul>{b.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        ))}
      </div>
      <div className="hwb__faq">
        {FAQ.map(([q, a]) => <div key={q} className="hwb__q"><b>{q}</b><span>{a}</span></div>)}
      </div>
    </section>
  )
}
