import { useState } from 'react'
import DitherCanvas from './hwb/DitherCanvas.tsx'
import { agents, model, pipeline, tradeoffs } from './hwb/scenes.ts'

// "How we built it": the section under How it works on Home. Three dithered visuals, one number and one line each.
// Numbers come from ml/REPORT.md and ml/experiments/RESULTS.md.

const PANELS = [
  {
    title: 'The model', big: '202 recordings', scene: model,
    alt: 'A scrolling spectrogram with gesture streaks feeds a small convolutional network that picks one of seven outputs: five gestures, Habit, or nothing.',
    caption: 'We recorded 202 sessions from five people, so every second of echo has an exact label. A small neural network learned the shape of each gesture in about three minutes, and it runs entirely in your browser.',
    scene2: pipeline, alt2: 'Record, label, train, model, run: five people make 202 takes, cue beeps label them, three minutes on one GPU, a 32k-parameter model, running in the browser about twelve times a second.',
    specs: [
      ['Input', '1 s of echo: 48 × 87 Doppler bins around 20 kHz'],
      ['Model', 'small CNN, 3 conv blocks, 7 outputs, 32k params, 128 KB'],
      ['Training', 'PyTorch, 30 epochs, augmented but never mirrored'],
      ['Data', '202 recordings, 5 people, 134k windows'],
      ['Testing', 'every score on a person the model never saw'],
      ['Runs', 'in the browser on the laptop CPU, 12×/s'],
    ],
  },
  {
    title: 'The agents', big: '5 agents', unit: 'communicating through one shared board', scene: agents,
    alt: 'Four humans and five AI agents around one shared board, with messages travelling to and from it.',
    caption: 'Four of us worked with five AI coding agents, each owning its own part of the code and reporting to one shared board where they could assign each other tasks. We made the architecture decisions, recorded the training data and tested every feature live, while the agents wrote and checked most of the code.',
  },
  {
    title: 'The trade-offs', big: '$0', scene: tradeoffs,
    alt: 'The same gestures as echo spectrograms in a quiet room, a noisy room and on a weaker laptop, above three gains: no hardware cost, works in the dark, never an image.',
    caption: 'We chose sound because every laptop already has a speaker and a microphone, it works in complete darkness, and it never captures an image of anyone. Sound gives up some precision compared with a camera, since weaker laptops produce fainter echoes and a noisy room makes gestures harder to read. It is a proof of concept and not a medical device, and we have been open about where it falls short.',
  },
]

export default function HowWeBuilt() {
  const [card, setCard] = useState(false)
  return (
    <section className="hwb">
      <div className="hwb__grid">
        {PANELS.map((p, i) => (
          <figure key={p.title} className="hwb__panel">
            <div className="hwb__head">
              <span className="hwb__name"><span className="hwb__idx">0{i + 1}</span>{p.title}</span>
              <span className="hwb__big">{p.big}</span>
              {'unit' in p && <small className="hwb__unit">{p.unit}</small>}
            </div>
            <div className="hwb__frame"><DitherCanvas scene={p.scene} label={p.alt} /></div>
            {'scene2' in p && p.scene2 && <div className="hwb__frame hwb__frame2"><div className="hwb__frame2title">How we trained it</div><DitherCanvas scene={p.scene2} label={p.alt2} fps={60} /></div>}
            <figcaption className="hwb__cap">
              {p.caption}
              {'specs' in p && p.specs && (
                <>
                  <button className="hwb__q hwb__card" aria-expanded={card} onClick={() => setCard(!card)}>
                    <span className="hwb__sign">{card ? '−' : '+'}</span>Full explanation
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
    </section>
  )
}
