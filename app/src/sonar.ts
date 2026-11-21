import { engine } from './engine.ts'

// Start the sonar with no click (mic permission is remembered for this origin). Shared by Lock, Care and Habit.
let starting: Promise<boolean> | null = null
export function ensureSonar(): Promise<boolean> {
  if (engine.health().running) return Promise.resolve(true)
  starting ??= engine.start().then(() => engine.calibrate(3000)).then(() => true).catch(() => false).finally(() => { starting = null })
  return starting
}

let actx: AudioContext | null = null
/** A soft two-note chime (care confirmations, habit nudges). */
export function chime(up = true, gain = 0.08) {
  actx ??= new AudioContext()
  const t = actx.currentTime
  for (const [i, f] of (up ? [660, 880] : [880, 660]).entries()) {
    const o = actx.createOscillator(); const g = actx.createGain()
    o.type = 'sine'; o.frequency.value = f
    g.gain.setValueAtTime(0, t + i * 0.16); g.gain.linearRampToValueAtTime(gain, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5)
    o.connect(g).connect(actx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55)
  }
}
