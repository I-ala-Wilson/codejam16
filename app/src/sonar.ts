import { engine } from './engine.ts'

// Start the sonar with no click (mic permission is remembered for this origin). Shared by Lock, Care and Habit.
let starting: Promise<boolean> | null = null
export function ensureSonar(): Promise<boolean> {
  if (engine.health().running) return Promise.resolve(true)
  starting ??= engine.start().then(() => engine.calibrate(3000)).then(() => true).catch(() => false).finally(() => { starting = null })
  return starting
}

/** Keep trying until the sonar runs: after a failed start (audio blocked before any click), every later click or key
 *  retries once the previous attempt has finished, so an early click can't leave it stopped. */
export function keepSonarOn(): () => void {
  let done = false
  const kick = async () => {
    if (done || engine.health().running) return
    await (starting ?? Promise.resolve(false)) // let a pending attempt finish first
    if (!engine.health().running) await ensureSonar()
    if (engine.health().running) stop()
  }
  const stop = () => { done = true; window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick) }
  window.addEventListener('pointerdown', kick)
  window.addEventListener('keydown', kick)
  ensureSonar().then((ok) => { if (ok) stop() })
  return stop
}

/** Gain for UI beeps and chimes. The system volume stays high for the 20 kHz tone, so these stay quiet. */
export const UI_SOUND_GAIN = 0.03

let actx: AudioContext | null = null
/** A soft two-note chime (care confirmations, habit nudges). */
export function chime(up = true, gain = UI_SOUND_GAIN * 0.7) {
  actx ??= new AudioContext()
  const t = actx.currentTime
  for (const [i, f] of (up ? [660, 880] : [880, 660]).entries()) {
    const o = actx.createOscillator(); const g = actx.createGain()
    o.type = 'sine'; o.frequency.value = f
    g.gain.setValueAtTime(0, t + i * 0.16); g.gain.linearRampToValueAtTime(gain, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5)
    o.connect(g).connect(actx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.55)
  }
}
