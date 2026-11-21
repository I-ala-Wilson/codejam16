import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine.ts'
import { addEvent, emptyInput, type InputState } from './password.ts'
import { UI_SOUND_GAIN } from '../sonar.ts'

/** Turns live engine gestures into a sign sequence (with UNDO = delete last, debounce and auto-reset). */
export function useSignInput(active: boolean) {
  const [state, setState] = useState<InputState>(emptyInput())
  const ref = useRef(state)
  useEffect(() => {
    if (!active) return
    return engine.onGesture((e) => {
      const next = addEvent(ref.current, e)
      if (next !== ref.current && next.signs.length !== ref.current.signs.length) tick(next.signs.length > ref.current.signs.length)
      ref.current = next; setState(next)
    })
  }, [active])
  const reset = () => { ref.current = emptyInput(); setState(ref.current) }
  return { signs: state.signs, reset }
}

let ctx: AudioContext | null = null
function tick(added: boolean) {
  ctx ??= new AudioContext()
  const o = ctx.createOscillator(); const g = ctx.createGain()
  o.frequency.value = added ? 880 : 440; g.gain.value = UI_SOUND_GAIN
  o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08)
}
