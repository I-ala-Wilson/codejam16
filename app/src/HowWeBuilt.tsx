import { useState } from 'react'
import DitherCanvas from './hwb/DitherCanvas.tsx'
import { agents, model, signal, tradeoffs } from './hwb/scenes.ts'

// "How we built it": the section under How it works on Home. Four dithered visuals, one number and one line each,
// then a small FAQ. Numbers come from ml/REPORT.md and ml/experiments/RESULTS.md.

const PANELS = [
  {
    title: 'The signal', big: '20 kHz', scene: signal,
    alt: 'A laptop speaker sends solid sound arcs to a hand; dashed echo arcs return to the mic, and the echo peak slides beside the 20 kHz tone.',
    caption: 'An inaudible tone. A hand moving toward the screen raises the echo’s pitch; away lowers it.',
  },
  {
    title: 'The model', big: '147 recordings', scene: model,
    alt: 'A scrolling spectrogram with gesture streaks feeds a small convolutional network that picks one of seven gestures.',
    caption: '147 recordings from 5 people, a small network trained on a GPU, running in your browser so audio never leaves the device.',
  },
  {
    title: 'The agents', big: '4 + 5', unit: 'humans + agents', scene: agents,
    alt: 'Four humans and five AI agents around one shared board, with messages travelling to and from it.',
    caption: 'Each agent owned its own folders, read the same spec, and posted to one shared board. Humans decided, recorded and tested.',
  },
  {
    title: 'The trade-offs', big: '$0', scene: tradeoffs,
    alt: 'Icons: no camera, any laptop, stays on device, built for patients.',
    caption: 'Limits: weaker laptops echo less, it needs a calm room, and it is not a medical device.',
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
