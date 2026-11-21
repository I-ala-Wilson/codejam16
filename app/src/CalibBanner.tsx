import { useEffect, useState } from 'react'
import { engine, calibratingLeft, onCalibrating } from './engine.ts'

/** "Keep still" while the sonar learns the room, and a way to redo it when gestures stop registering. */
export default function CalibBanner({ button }: { button: boolean }) {
  const [left, setLeft] = useState(calibratingLeft())
  const [running, setRunning] = useState(engine.health().running)
  useEffect(() => {
    const tick = () => { setLeft(calibratingLeft()); setRunning(engine.health().running) }
    const off = onCalibrating(tick)
    const id = window.setInterval(tick, 200)
    return () => { off(); clearInterval(id) }
  }, [])
  if (left > 0) return (
    <div className="calib calib--on">
      <b>Keep your hands still</b> · the sonar is learning your room · {Math.ceil(left / 1000)}
    </div>
  )
  if (!running || !button) return null
  return (
    <button className="calib" onClick={() => { engine.calibrate(3000).catch(() => {}) }}>
      gestures not registering? hands still, then click to recalibrate
    </button>
  )
}
