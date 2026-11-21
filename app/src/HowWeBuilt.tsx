import { useState } from 'react'
import DitherCanvas from './hwb/DitherCanvas.tsx'
import { agents, model, pipeline, tradeoffs } from './hwb/scenes.ts'

// "How we built it": the section under How it works on Home. Three dithered visuals, one number and one line each,
// then a small FAQ. Numbers come from ml/REPORT.md and ml/experiments/RESULTS.md.

const PANELS = [
  {
    title: 'The model', big: '202 recordings', scene: model,
    alt: 'A scrolling spectrogram with gesture streaks feeds a small convolutional network that picks one of seven outputs: five gestures, Habit, or nothing.',
    caption: 'We recorded 202 sessions from five people, so every second of echo has an exact label. A small neural network learned the shape of each gesture in about three minutes, and it runs entirely in your browser.',
    scene2: pipeline, alt2: 'Record, label, train, model, run: five people make 202 takes, cue beeps label them, three minutes on one GPU, a 32k-parameter model, running in the browser about twelve times a second.',
    specs: [
      ['Input', '1 s window: 48 frames × 87 frequency bins around 20 kHz, in dB above the room’s noise floor'],
      ['Model', 'CNN: 3 conv blocks (16, 32, 64 channels), mean + max pooling, 64-unit dense layer, 7 outputs; 32k parameters, 128 KB'],
      ['Training', 'PyTorch, AdamW, cosine schedule, 30 epochs, class-balanced, label smoothing; time, frequency, gain and noise augmentation, never mirrored'],
      ['Data', '202 recordings, 5 people, about 134,000 windows; demo-laptop calibration counted 5×'],
      ['Testing', 'leave one person out: every score is on a person the model never saw'],
      ['Runs', 'ONNX Runtime Web on the laptop CPU, about 12 evaluations a second'],
    ],
  },
  {
    title: 'The agents', big: '4 + 5', unit: 'humans + agents', scene: agents,
    alt: 'Four humans and five AI agents around one shared board, with messages travelling to and from it.',
    caption: 'The four of us worked alongside five AI coding agents, and each agent owned its own part of the code so that no two agents could overwrite each other. Every agent read the same specification and reported its progress to one shared board, which let us coordinate all of our agents, and permitted them to assign each other tasks to ensure work was always getting done. Humans made the architecture decisions, recorded all the training data, and tested every feature live, while the agents wrote and checked most of the code.',
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
  const [card, setCard] = useState(false)
  return (
    <section className="hwb">
      <div className="hwb__grid">
        {PANELS.map((p, i) => (
          <figure key={p.title} className="hwb__panel">
            <div className="hwb__head">
              <span className="hwb__name"><span className="hwb__idx">0{i + 1}</span>{p.title}</span>
              <span className="hwb__big">{p.big}{'unit' in p && <small className="hwb__unit">{p.unit}</small>}</span>
            </div>
            <div className="hwb__frame"><DitherCanvas scene={p.scene} label={p.alt} /></div>
            {'scene2' in p && p.scene2 && <div className="hwb__frame hwb__frame2"><DitherCanvas scene={p.scene2} label={p.alt2} /></div>}
            <figcaption className="hwb__cap">
              {p.caption}
              {'specs' in p && p.specs && (
                <>
                  <button className="hwb__q hwb__card" aria-expanded={card} onClick={() => setCard(!card)}>
                    <span className="hwb__sign">{card ? '−' : '+'}</span>Model card
                  </button>
                  {card && (
                    <dl className="hwb__specs">
                      {p.specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                    </dl>
                  )}
                </>
              )}
            </figcaption>
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
