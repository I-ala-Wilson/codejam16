import { useEffect, useRef, useState } from 'react'
import { engine } from './engine.ts'
import { download, toPcm16 } from './Record.tsx'
import { ensureSonar } from './sonar.ts'

// Breathing experiment recorder (go/no-go for contactless breathing rate). Each take is 60 s of raw audio with the
// tone on while the person breathes along to an on-screen pacer, so the true rate is known. Saves
// breath-<take>-<file>.wav plus a .json with the pacer schedule (inhale start times in seconds from record start).
const TAKES = [
  { id: '10bpm', rate: 10, how: 'Breathe with the circle: in as it grows, out as it shrinks.' },
  { id: '15bpm', rate: 15, how: 'Breathe with the circle: in as it grows, out as it shrinks.' },
  { id: '20bpm', rate: 20, how: 'Breathe with the circle: in as it grows, out as it shrinks.' },
  { id: 'hold', rate: 15, how: 'Breathe with the circle for 20 s, HOLD your breath 20 s, then breathe again.' },
  { id: 'natural', rate: 0, how: 'Breathe normally, do not count, sit still.' },
] as const
const SECONDS = 60

export default function BreathRecord() {
  const [person, setPerson] = useState(localStorage.getItem('echo.person') ?? '')
  const [laptop, setLaptop] = useState(localStorage.getItem('echo.laptop') ?? '')
  const [running, setRunning] = useState(engine.health().running)
  const [take, setTake] = useState<(typeof TAKES)[number] | null>(null)
  const [t, setT] = useState(0)
  const [done, setDone] = useState<string[]>([])
  const [error, setError] = useState('')
  const circle = useRef<HTMLDivElement>(null)

  useEffect(() => { ensureSonar().then(setRunning) }, [])

  const run = async (k: (typeof TAKES)[number]) => {
    setError('')
    localStorage.setItem('echo.person', person); localStorage.setItem('echo.laptop', laptop)
    try { engine.startRecording({ person: person.trim().toLowerCase(), gesture: 'FREE', laptop: laptop.trim().toLowerCase().replace(/\s+/g, '-'), note: `breath ${k.id}, paced ${k.rate} bpm, laptop 30-40 cm from chest, screen angled at torso` }) }
    catch (e) { setError(String(e)); return }
    setTake(k)
    const t0 = performance.now()
    const inhales: number[] = []
    let lastBreath = -1
    await new Promise<void>((resolve) => {
      const tick = () => {
        const s = (performance.now() - t0) / 1000
        setT(s)
        const holding = k.id === 'hold' && s >= 20 && s < 40
        const period = k.rate ? 60 / k.rate : 0
        let scale = 0.55
        if (period && !holding) {
          const n = Math.floor(s / period)
          if (n !== lastBreath) { lastBreath = n; inhales.push(Math.round(n * period * 100) / 100) }
          scale = 0.55 + 0.45 * (0.5 - 0.5 * Math.cos((2 * Math.PI * s) / period))
        }
        if (circle.current) circle.current.style.transform = `scale(${scale})`
        if (s >= SECONDS) resolve(); else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    try {
      const rec = await engine.stopRecording()
      const name = `breath-${k.id}-${rec.filename}`
      download(await toPcm16(rec.wav), name)
      download(new Blob([JSON.stringify({ ...rec.meta, breath: { take: k.id, paced_bpm: k.rate, hold: k.id === 'hold' ? [20, 40] : null, inhale_starts_s: inhales } }, null, 2)], { type: 'application/json' }), name.replace(/\.wav$/, '.json'))
      setDone((d) => [...d, k.id])
    } catch (e) { setError(String(e)) }
    setTake(null)
  }

  return (
    <div className="lk">
      <div className="lk__center">
        <div className="lk__eyebrow">ECHØ BREATHING EXPERIMENT</div>
        {take ? (
          <>
            <h1 className="lk__title">{take.id === 'hold' && t >= 20 && t < 40 ? 'HOLD' : take.rate ? `${take.rate} breaths / min` : 'breathe normally'}</h1>
            <div style={{ width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '20px 0' }}>
              <div ref={circle} style={{ width: 260, height: 260, borderRadius: '50%', background: 'var(--ink)', transform: 'scale(.55)' }} />
            </div>
            <p className="lk__sub">{take.how}</p>
            <div className="lk__status">{Math.max(0, Math.ceil(SECONDS - t))} s left · sit still, hands in your lap</div>
          </>
        ) : (
          <>
            <h1 className="lk__title">Breathing takes</h1>
            <p className="lk__sub">Laptop 30-40 cm from your chest, screen tilted to face your torso, volume 100%, sit still, hands in your lap. Close every other ECHØ tab and anything else playing sound, and do not touch the volume during a take. 60 s each.</p>
            <p><input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="your name" className="lk__input" style={{ font: '400 24px var(--pixel)', background: 'transparent', color: 'var(--ink)', border: '1px dotted var(--ink)', padding: '6px 10px' }} /> <input value={laptop} onChange={(e) => setLaptop(e.target.value)} placeholder="laptop, e.g. macbook-air-m2" style={{ font: '400 24px var(--pixel)', background: 'transparent', color: 'var(--ink)', border: '1px dotted var(--ink)', padding: '6px 10px', marginLeft: 10 }} /></p>
            {!running && <div className="lk__row"><button className="lk__btn lk__btn--primary" onClick={() => ensureSonar().then(setRunning)}>Start sonar</button></div>}
            <div className="lk__row" style={{ flexWrap: 'wrap', maxWidth: 900 }}>
              {TAKES.map((k) => (
                <button key={k.id} className={`lk__btn${done.includes(k.id) ? '' : ' lk__btn--primary'}`} disabled={!running || !person.trim() || !laptop.trim()} onClick={() => run(k)}>
                  {done.includes(k.id) ? `${k.id} done` : k.id}
                </button>
              ))}
            </div>
            <p className="lk__sub" style={{ marginTop: 30 }}>Files land in Downloads. Move them to data/recordings/&lt;your login&gt;/breath/ and push, or tell Ian's chat.</p>
          </>
        )}
        {error && <div className="lk__status">Problem: {error}</div>}
      </div>
    </div>
  )
}
