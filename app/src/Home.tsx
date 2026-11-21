import { useState } from 'react'
import DigitBloom from './art/DigitBloom.tsx'
import { engine } from './engine.ts'

// Landing screen: the live digit bloom, one line of pitch, the three apps. Style per docs/STYLE.md.
export default function Home({ go }: { go: (page: string) => void }) {
  const [running, setRunning] = useState(engine.health().running)
  const [error, setError] = useState('')
  const start = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }
  return (
    <div className="home">
      <DigitBloom height={Math.min(620, window.innerHeight * 0.68)} />
      <div className="home__text">
        <div className="mono-label">ECHO · SONAR, NOT A CAMERA</div>
        <h1 className="serif-display">Your laptop can feel your hands.</h1>
        <p>An inaudible tone and its echo. No camera, no images, works in the dark.</p>
        {!running
          ? <button className="dot-btn" onClick={start}>Start sonar</button>
          : <p className="mono-label">sonar on · move your hand toward the screen</p>}
        {error && <p>{error}</p>}
        <div className="home__apps">
          <button className="dot-btn" onClick={() => go('lock')}>Lock</button>
          <button className="dot-btn" onClick={() => go('care')} disabled>Care (soon)</button>
          <button className="dot-btn" onClick={() => go('habit-app')} disabled>Habit (soon)</button>
        </div>
      </div>
    </div>
  )
}
