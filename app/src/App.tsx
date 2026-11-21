import { useState } from 'react'
import { createEngine } from '@engine/index.ts'
import { Window } from '@ui/index.ts'

const engine = createEngine()

// Scaffold. Ian's lane: waterfall, Record, Lock, Care, Habit pages.
export default function App() {
  const [status, setStatus] = useState('idle')
  const start = async () => {
    try { await engine.start(); setStatus('running') }
    catch (e) { setStatus(String(e)) }
  }
  return (
    <Window title="Echo">
      <p>Sonar engine status: {status}</p>
      <button onClick={start}>Start sonar</button>
    </Window>
  )
}
