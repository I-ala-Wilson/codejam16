import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GestureType } from '@contracts/engine.ts'
import { HOP } from '@engine/pipeline.ts'
import { Window } from '@ui/index.ts'
import { engine } from './engine.ts'
import { toPcm16, download } from './Record.tsx'
import { UI_SOUND_GAIN } from './sonar.ts'

// Guided runner for the dataset battery in ml/PROTOCOL.md (sections 2, 3, 7).
// Labels come from the cues: each rep = [cue sample, cue sample + cueWindow], sample-exact via frame count x HOP.

const LEAD_IN_MS = 3000
const REPS = 20

type Take =
  | { kind: 'gesture'; gesture: GestureType; distanceCm: number; cueWindowMs: number; periodMs: number; how: string; variant?: string; folder?: string; reps?: number }
  | { kind: 'none'; noneKind: 'a' | 'b' | 'c' | 'd' | 'e'; durationMs: number; how: string; folder?: string }

const G = (gesture: GestureType, dists: [number, number], cueWindowMs: number, periodMs: number, how: string): Take[] =>
  dists.map((distanceCm) => ({ kind: 'gesture', gesture, distanceCm, cueWindowMs, periodMs, how }))

const BATTERY: Take[] = [
  ...G('PUSH', [20, 50], 1500, 3000, 'One push toward the screen, then bring your hand back calmly before the next cue.'),
  ...G('PULL', [20, 50], 1500, 3000, 'One pull away from the screen, then bring your hand back calmly before the next cue.'),
  ...G('UNDO', [20, 50], 1500, 3000, 'Double tap: two quick small taps toward the screen, like double-clicking the air.'),
  ...G('OPEN_CLOSE', [15, 30], 2000, 3500, 'Palm toward the screen: open and close your hand 2 to 3 times.'),
  ...G('WAVE', [20, 50], 2500, 4000, 'Wave about 3 swings, side to side.'),
  { kind: 'none', noneKind: 'a', durationMs: 60000, how: 'Rest your hand still in front of the laptop for the whole minute.' },
  { kind: 'none', noneKind: 'b', durationMs: 60000, how: 'Type and use the trackpad/mouse normally for the whole minute.' },
  { kind: 'none', noneKind: 'c', durationMs: 60000, how: 'Lean, turn your head, reach for a cup; have someone walk past behind you.' },
  { kind: 'none', noneKind: 'd', durationMs: 60000, how: 'Let your hand wander slowly in front of the screen without making any gesture.' },
]

// Habit add-on (Sat morning): Habit mode scratch motion (not a gesture) + extra typing as the false-alarm counterexample.
const HABIT: Take[] = [
  { kind: 'gesture', gesture: 'REPETITIVE', variant: 'scratch', distanceCm: 20, cueWindowMs: 3000, periodMs: 5000,
    how: 'Scratch your forearm in front of the laptop for the whole GO window (small, fast, repeated), then rest your arm still.' },
  { kind: 'none', noneKind: 'e', durationMs: 120000, how: 'Type normally for 2 minutes (write anything). This teaches Habit that typing is NOT a habit.' },
]

// Demo-day calibration (ml/README.md): the presenter's own takes on the demo laptop, in the demo room, at demo volume.
// calib-1 is trained on (counted 5 times); livecheck-1 is never trained on and is the before/after test for the new model.
const C = (folder: string, gesture: GestureType, distanceCm: number, reps: number): Take => {
  const b = BATTERY.find((x) => x.kind === 'gesture' && x.gesture === gesture)!
  return { ...(b as Extract<Take, { kind: 'gesture' }>), distanceCm, folder, reps }
}
const CALIB: Take[] = [
  C('calib-1', 'PUSH', 20, 20), C('calib-1', 'PULL', 20, 20), C('calib-1', 'WAVE', 30, 20),
  C('calib-1', 'OPEN_CLOSE', 20, 20), C('calib-1', 'UNDO', 20, 20),
  { kind: 'none', noneKind: 'd', durationMs: 60000, folder: 'calib-1', how: 'Let your hand wander slowly in front of the screen without making any gesture.' },
  C('livecheck-1', 'WAVE', 30, 10), C('livecheck-1', 'UNDO', 20, 10), C('livecheck-1', 'PUSH', 20, 10), C('livecheck-1', 'PULL', 20, 10),
]

const BATTERIES = { main: BATTERY, habit: HABIT, calib: CALIB } as const
type BatteryName = keyof typeof BATTERIES

const takeName = (t: Take) => (t.folder ? `${t.folder}: ` : '') + (t.kind === 'gesture'
  ? `${t.variant ? `HABIT (${t.variant})` : t.gesture} at ${t.distanceCm} cm` : `NONE (${t.noneKind})`)
const repsOf = (t: Take) => (t.kind === 'gesture' && t.reps) || REPS

type Phase = 'idle' | 'away' | 'leadin' | 'cue' | 'rest' | 'none' | 'saving'

export default function Dataset({ only }: { only: BatteryName }) {
  const [login, setLogin] = useState(localStorage.getItem('echo.login') ?? '')
  const [laptopModel, setLaptopModel] = useState(localStorage.getItem('echo.laptop') ?? '')
  const [hand, setHand] = useState<'L' | 'R'>((localStorage.getItem('echo.hand') as 'L' | 'R') ?? 'R')
  const [volumePct, setVolumePct] = useState(Number(localStorage.getItem('echo.volume') ?? 70))
  const [running, setRunning] = useState(engine.health().running)
  const [snr, setSnr] = useState(0)
  const battery = only
  const LIST = BATTERIES[battery]
  const [idx, setIdx] = useState(Number(localStorage.getItem(`echo.takeIdx.${battery}`) ?? 0))
  const [phase, setPhase] = useState<Phase>('idle')
  const [cueText, setCueText] = useState('')
  const [count, setCount] = useState(0)
  const [rep, setRep] = useState(0)
  const [warn, setWarn] = useState('')
  const [error, setError] = useState('')
  const frames = useRef(0)
  const leadInMotion = useRef(false)
  const phaseRef = useRef<Phase>('idle')
  const aborted = useRef(false)
  // Leaving this tab mid-take: stop and discard the recording (its labels would be wrong), never wedge the page.
  useEffect(() => () => {
    if (phaseRef.current !== 'idle') { aborted.current = true; engine.stopRecording().catch(() => {}) }
  }, [])

  useEffect(() => {
    // a different person starts their own battery at take 1
    if (localStorage.getItem('echo.login') !== login) setIdx(0)
    localStorage.setItem('echo.login', login)
  }, [login])
  useEffect(() => { localStorage.setItem('echo.laptop', laptopModel) }, [laptopModel])
  useEffect(() => { localStorage.setItem('echo.hand', hand) }, [hand])
  useEffect(() => { localStorage.setItem('echo.volume', String(volumePct)) }, [volumePct])
  useEffect(() => { localStorage.setItem(`echo.takeIdx.${battery}`, String(idx)) }, [idx, battery])

  useEffect(() => engine.onFrame((f) => {
    frames.current += 1
    if (phaseRef.current === 'leadin' && Math.max(f.energyToward, f.energyAway) > 6) leadInMotion.current = true
    if (frames.current % 10 === 0) setSnr(engine.health().snrDb)
  }), [])

  const setP = (p: Phase) => { phaseRef.current = p; setPhase(p) }
  const sampleNow = () => frames.current * HOP

  const startSonar = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }

  const runTake = async () => {
    const t = LIST[idx]
    setError(''); setWarn('')
    if (engine.health().snrDb < 30) setWarn('Tone health is below 30 dB: turn the volume up before recording.')
    const person = login.trim()
    const laptop = laptopModel.trim().toLowerCase().replace(/\s+/g, '-')
    // Grace period BEFORE recording: the click itself moves your hand, so it must not land in the still lead-in.
    setP('away')
    for (let s = 2; s > 0; s--) { setCount(s); await sleep(1000) }
    try {
      engine.startRecording({ person, gesture: t.kind === 'gesture' ? t.gesture : 'FREE', laptop, note: takeName(t) })
    } catch (e) { setError(String(e)); setP('idle'); return }
    frames.current = 0
    leadInMotion.current = false
    aborted.current = false

    // 3 s hands-off lead-in (still-room floor + NONE examples)
    setP('leadin')
    for (let s = 3; s > 0; s--) { setCount(s); await sleep(1000) }
    if (leadInMotion.current) setWarn('Motion during the hands-off lead-in. Finish this take, then press "Redo last take".')

    const reps: { start: number; end: number; label: string; speed?: string }[] = []
    const sr = engine.health().sampleRate || 48000
    if (t.kind === 'gesture') {
      for (let i = 0; i < repsOf(t); i++) {
        const speed = i % 2 === 0 ? 'natural' : 'brisk'
        setRep(i + 1); setCueText(`${t.gesture.replace('_', ' ')}: ${speed}`)
        const start = sampleNow()
        reps.push({ start, end: start + Math.round((t.cueWindowMs / 1000) * sr), label: t.gesture, speed })
        beep(); setP('cue'); await sleep(t.cueWindowMs)
        setP('rest'); await sleep(t.periodMs - t.cueWindowMs)
      }
    } else {
      setP('none')
      const end = Date.now() + t.durationMs
      while (Date.now() < end) { setCount(Math.ceil((end - Date.now()) / 1000)); await sleep(250) }
    }

    if (aborted.current) return
    setP('saving')
    try {
      const s = await engine.stopRecording()
      const stamp = s.filename.match(/_(\d{8}-\d{6})\.wav$/)?.[1] ?? Date.now().toString()
      const tag = t.kind === 'gesture' ? `${t.gesture}${t.variant ? '-' + t.variant : ''}_${t.distanceCm}cm` : `NONE-${t.noneKind}`
      const base = `${t.folder ? t.folder + '__' : ''}${person.toLowerCase()}_${tag}_${laptop}_${battery === 'habit' ? 'h' : battery === 'calib' ? 'c' : 't'}${idx + 1}_${stamp}`
      const meta = {
        ...(s.meta as Record<string, unknown>),
        gesture: t.kind === 'gesture' ? t.gesture : 'NONE',
        reps,
        takeKind: t.kind,
        battery,
        variant: t.kind === 'gesture' ? t.variant : undefined,
        distanceCm: t.kind === 'gesture' ? t.distanceCm : null,
        noneKind: t.kind === 'none' ? t.noneKind : undefined,
        cueWindowMs: t.kind === 'gesture' ? t.cueWindowMs : null,
        periodMs: t.kind === 'gesture' ? t.periodMs : null,
        leadInMs: LEAD_IN_MS,
        leadInMotion: leadInMotion.current,
        hand, volumePct, laptopModel: laptopModel.trim(),
        protocol: 'ml/PROTOCOL.md',
      }
      download(await toPcm16(s.wav), `${base}.wav`)
      download(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), `${base}.json`)
      setIdx((i) => Math.min(i + 1, LIST.length))
    } catch (e) { setError(String(e)) }
    setP('idle'); setRep(0)
  }

  const ready = login.trim() !== '' && laptopModel.trim() !== ''
  const done = idx >= LIST.length
  const t = LIST[Math.min(idx, LIST.length - 1)]
  const busy = phase !== 'idle'

  return (
    <Window title={battery === 'main' ? 'Dataset recording (main battery, 14 takes)' : battery === 'calib' ? 'Calibration (demo day, 10 takes, about 12 minutes)' : 'Habit recording (add-on, 3 takes)'}>
      {!busy && (
        <>
          <Box title="1. About you (once)">
            GitHub login: <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="e.g. EJ2007" />{' '}
            Laptop: <input value={laptopModel} onChange={(e) => setLaptopModel(e.target.value)} placeholder="e.g. MacBook Air M2" />{' '}
            Hand: <select value={hand} onChange={(e) => setHand(e.target.value as 'L' | 'R')}><option value="R">right</option><option value="L">left</option></select>{' '}
            Volume %: <input type="number" value={volumePct} onChange={(e) => setVolumePct(Number(e.target.value))} style={{ width: 60 }} />
            <p>Set the laptop volume to about 70%, palm toward the screen, keep the room as quiet and still as you can. Mark 15, 20, 30 and 50 cm from the screen on the desk with tape if you can.</p>
          </Box>
          <Box title="2. Sonar">
            {running ? <>On · tone health <b>{snr.toFixed(0)} dB</b> {snr >= 30 ? '✓' : '✗ turn the volume up'}</> :
              <button onClick={startSonar} disabled={!ready}>Start sonar and calibrate (hands off 3 s)</button>}
          </Box>
          {battery === 'calib' && <Box title="What this is"><p>Record in the room you will demo in, at the volume you will demo at, sitting the way you will sit. Takes 1 to 6 (calib-1) teach the model your hands; takes 7 to 10 (livecheck-1) are never trained on and prove the new model is better. Just press Record, follow the big GO prompts, and move to the next take. Redo any take where you messed up.</p></Box>}
          <Box title={`3. ${battery === 'main' ? 'Main battery' : battery === 'calib' ? 'Calibration' : 'Habit add-on'}: ${Math.min(idx, LIST.length)} of ${LIST.length} done`}>
            <div style={{ height: 14, border: '2px solid #000', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
              <div style={{ width: `${(Math.min(idx, LIST.length) / LIST.length) * 100}%`, height: '100%', background: 'currentColor' }} />
            </div>
            {done && battery === 'calib' ? (
              <p><b>All 10 takes done.</b> In a terminal run <b>scripts/file-takes</b> from the codejam16 folder: it moves the files from Downloads into data/recordings/&lt;you&gt;/calib-1 and livecheck-1, audits them and pushes. Then tell Yahya "calib-1 pushed, run the calib retrain".</p>
            ) : done ? (
              <p><b>All takes done.</b> Tell your agent: <b>"move my Echo dataset files from Downloads into data/recordings/{login || '<my login>'}/ and push them"</b>. Then post DONE to Yahya-github.</p>
            ) : (
              <>
                <p style={{ fontSize: 22 }}>Next: <b>{takeName(t)}</b></p>
                <p>{t.how}</p>
                {t.kind === 'gesture'
                  ? <p>Hand at <b>{t.distanceCm} cm</b>. 3 s hands off, then {repsOf(t)} cues every {t.periodMs / 1000} s (alternating natural and brisk). Do one rep per GO, then put your hand back at the same rest spot and keep it still until the next beep. About {Math.round((LEAD_IN_MS + repsOf(t) * t.periodMs) / 1000)} s.</p>
                  : <p>3 s hands off, then 60 s of the activity above.</p>}
                <button onClick={runTake} disabled={!running} style={{ fontSize: 18 }}>Record this take</button>
              </>
            )}
            {' '}<button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>Redo last take</button>
            {' '}Jump to take: <select value={Math.min(idx, LIST.length - 1)} onChange={(e) => setIdx(Number(e.target.value))}>
              {LIST.map((b, i) => <option key={i} value={i}>{i + 1}. {takeName(b)}</option>)}
            </select>
            {' '}<button onClick={() => setIdx(0)}>Restart battery</button>
          </Box>
        </>
      )}

      {busy && (
        <Box title={`${takeName(t)}${phase === 'cue' || phase === 'rest' ? `: rep ${rep} of ${repsOf(t)}` : ''}`}>
          <div style={{ fontSize: 64, fontWeight: 900, textAlign: 'center', padding: '28px 0', border: '2px solid #000', borderRadius: 8,
            background: phase === 'cue' ? '#000' : '#fff', color: phase === 'cue' ? '#fff' : '#000' }}>
            {phase === 'away' && `Take your hands away… ${count}`}
            {phase === 'leadin' && `Hands off, keep still… ${count}`}
            {phase === 'cue' && `GO: ${cueText}`}
            {phase === 'rest' && 'hand back to rest, stay still'}
            {phase === 'none' && `${count}s`}
            {phase === 'saving' && 'saving…'}
          </div>
          <p>{t.how}</p>
          <p>Tone health {snr.toFixed(0)} dB{snr < 30 ? ' ✗ too low' : ''}</p>
        </Box>
      )}
      {warn && <p><b>Warning:</b> {warn}</p>}
      {error && <p><b>Problem:</b> {error}</p>}
    </Window>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ border: '2px solid #000', borderRadius: 8, padding: '12px 16px', marginBottom: 12, boxShadow: '3px 3px 0 #000' }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  )
}

// Audible cue at 1 kHz: far below the 20 kHz sonar band, so it doesn't pollute the Doppler window.
let beepCtx: AudioContext | null = null
function beep() {
  beepCtx ??= new AudioContext()
  const o = beepCtx.createOscillator(); const g = beepCtx.createGain()
  o.frequency.value = 1000; g.gain.value = UI_SOUND_GAIN
  o.connect(g).connect(beepCtx.destination)
  o.start(); o.stop(beepCtx.currentTime + 0.12)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// note: an aborted take finishes its timers silently and is never saved (see the aborted check before saving)
