import { useState } from 'react'
import DitherFlower from './art/DitherFlower.tsx'
import { engine } from './engine.ts'

// Landing screen: Ian's flower as a full-screen ordered dither, the headline top-left, the apps bottom-left. Style per docs/STYLE.md.
export default function Home({ go }: { go: (page: string) => void }) {
  const [running, setRunning] = useState(engine.health().running)
  const [error, setError] = useState('')
  const start = async () => {
    setError('')
    try { await engine.start(); await engine.calibrate(3000); setRunning(true) } catch (e) { setError(String(e)) }
  }
  return (
    <div className="home">
      <DitherFlower />
      <div className="home__text">
        <div className="home__mark">{'ECHO Ø'}</div>
        <h1>Your laptop can hear your hands.</h1>
        <p className="home__lede">By leveraging the power of sound and some neat physics, Echo Null is able to discern your movements and gestures, turning any laptop into a call button, a lock and a habit coach.</p>
      </div>
      <div className="home__apps">
        {!running
          ? <button className="dot-btn" onClick={start}>Start sonar</button>
          : <span className="mono-label">sonar on · move your hand</span>}
        <button className="dot-btn" onClick={() => go('lock')}>Lock</button>
        <button className="dot-btn" onClick={() => go('care')}>Care</button>
        <button className="dot-btn" onClick={() => go('habit-app')}>Habit</button>
        {error && <span className="mono-label">{error}</span>}
      </div>
    </div>
  )
}
