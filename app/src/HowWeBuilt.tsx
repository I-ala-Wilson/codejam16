import { useState } from 'react'
import DitherCanvas from './hwb/DitherCanvas.tsx'
import { agents, model, tradeoffs } from './hwb/scenes.ts'

// "How we built it": the section under How it works on Home. Three dithered visuals, one number and one line each,
// then a small FAQ. Numbers come from ml/REPORT.md and ml/experiments/RESULTS.md.

const PANELS = [
  {
    title: 'The model', big: '147 recordings', scene: model,
    alt: 'A scrolling spectrogram with gesture streaks feeds a small convolutional network that picks one of seven gestures.',
    caption: 'We recorded 147 sessions from five people performing each gesture on cue, so every slice of echo has a known label. We trained a small neural network on a GPU to recognise the shape each gesture leaves in the echo, and we tested it only on people it had never seen to keep our accuracy honest. The finished model runs inside the browser, which keeps it fast, lets it work without an internet connection, and means that no audio ever leaves the device.',
  },
  {
    title: 'The agents', big: '4 + 5', unit: 'humans + agents', scene: agents,
    alt: 'Four humans and five AI agents around one shared board, with messages travelling to and from it.',
    caption: 'Four of us worked alongside five AI coding agents, and each agent owned its own part of the code so that no two agents could overwrite each other. Every agent read the same specification and reported its progress to one shared board, which let us coordinate the whole team from a single conversation. We made the decisions, recorded the training data, and tested every feature live, while the agents wrote and checked most of the code.',
  },
  {
    title: 'The trade-offs', big: '$0', scene: tradeoffs,
    alt: 'Icons: no camera, any laptop, stays on device, built for patients.',
    caption: 'We chose sound because every laptop already has a speaker and a microphone, it works in complete darkness, and it never captures an image of anyone. Sound gives up some precision compared with a camera, since weaker laptops produce fainter echoes and a noisy room makes gestures harder to read. It is a proof of concept and not a medical device, and we have been open about where it falls short.',
  },
]

const FAQ = [
  ['Does it record me?', 'No. Audio is analysed on the device and discarded; only events like "help" leave it.'],
  ['Will it work on my laptop?', 'Any laptop with a speaker and a mic; weaker speakers need a short calibration.'],
  ['Why not a camera?', 'Cameras are not allowed in many patient rooms and bathrooms, and they fail in the dark.'],
  ['How accurate is it?', 'About half of gestures for a brand-new person, much higher for someone it has learned.'],
  ['What did the AI do?', 'The agents wrote and tested most of the code; we decided what to build and recorded the data.'],
]

export default function HowWeBuilt() {
  const [open, setOpen] = useState(0)
  return (
    <section className="hwb">
      <div className="lk__eyebrow">HOW WE BUILT IT</div>
      <h2 className="hwb__title">Four of us built this over the weekend, with AI coding agents writing and testing most of the code.</h2>
      <div className="hwb__grid">
        {PANELS.map((p, i) => (
          <figure key={p.title} className="hwb__panel">
            <div className="hwb__head">
              <span className="hwb__name"><span className="hwb__idx">0{i + 1}</span>{p.title}</span>
              <span className="hwb__big">{p.big}{'unit' in p && <small className="hwb__unit">{p.unit}</small>}</span>
            </div>
            <div className="hwb__frame"><DitherCanvas scene={p.scene} label={p.alt} /></div>
            <figcaption className="hwb__cap">{p.caption}</figcaption>
          </figure>
        ))}
      </div>
      <div className="hwb__faq">
        <div className="hwb__faqhead">FAQ</div>
        <div className="hwb__qs">
          {FAQ.map(([q], i) => (
            <button key={q} aria-expanded={open === i} className={'hwb__q' + (open === i ? ' on' : '')} onClick={() => setOpen(open === i ? -1 : i)}>
              <span className="hwb__sign">{open === i ? '−' : '+'}</span>{q}
            </button>
          ))}
        </div>
        <div className="hwb__a" aria-live="polite">{open >= 0 ? FAQ[open][1] : 'Pick a question.'}</div>
      </div>
    </section>
  )
}
