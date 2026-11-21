import { useState } from 'react'
import DitherFlower from './art/DitherFlower.tsx'
import Explainer from './explainer/Explainer.tsx'
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
      <section className="home__hero">
      <DitherFlower />
      <div className="home__text">
        <div className="home__mark">{'ECHØ'}</div>
        <h1>Your laptop can hear your hands.</h1>
        <p className="home__lede">By leveraging the power of sound and some neat physics, ECHØ is able to discern your movements and gestures, creating a wide range of applications for all devices with a speaker and a microphone.</p>
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
      <div className="home__more">scroll · how it works</div>
      </section>
      <section className="home__how">
        <div className="home__howhead"><div className="lk__eyebrow">HOW IT WORKS</div><h2>Sound in, echo out, physics in between.</h2></div>
        <Explainer embedded />
      </section>
    </div>
  )
}