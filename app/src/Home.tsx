import { useEffect, useState } from 'react'
import DitherFlower from './art/DitherFlower.tsx'
import Explainer from './explainer/Explainer.tsx'
import HowWeBuilt from './HowWeBuilt.tsx'
import Apps from './pitch/Apps.tsx'
import Results from './pitch/Results.tsx'
import Close from './pitch/Close.tsx'
import { engine } from './engine.ts'

// Landing screen: Ian's flower as a full-screen ordered dither, the headline top-left, the apps bottom-left. Style per docs/STYLE.md.
export default function Home({ go }: { go: (page: string) => void }) {
  const [running, setRunning] = useState(engine.health().running)
  // the app starts the sonar on load (App.tsx); this only reflects whether it is running yet
  useEffect(() => {
    const id = setInterval(() => setRunning(engine.health().running), 500)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="home">
      <section className="home__hero">
      <DitherFlower />
      <div className="home__text">
        <div className="home__mark">{'ECHØ'}</div>
        <h1>Your laptop can hear your hands.<br />Right now.</h1>
        <p className="home__lede">By leveraging the power of sound and some neat physics, ECHØ is able to discern your movements and gestures from the noise of the room you're in, creating a wide range of applications for all devices with a speaker and a microphone.</p>
      </div>
      <div className="home__apps">
        <span className="mono-label">{running ? 'sonar on · move your hand' : 'starting sonar…'}</span>
        <button className="dot-btn" onClick={() => go('lock')}>Lock</button>
        <button className="dot-btn" onClick={() => go('care')}>Care</button>
        <button className="dot-btn" onClick={() => go('habit-app')}>Habit</button>
      </div>
      </section>
      <section className="home__how">
        <Explainer embedded />
      </section>
      <section><Apps /></section>
      <section><Results /></section>
      <section>
        <HowWeBuilt />
      </section>
      <section><Close /></section>
    </div>
  )
}