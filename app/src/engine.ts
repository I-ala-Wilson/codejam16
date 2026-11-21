import { createEngine } from '@engine/index.ts'

// One engine for the whole app so every page shares the same mic + tone.
export const engine = createEngine({ useClassifier: true, modelUrl: '/models/gesture.onnx', ruleAssist: ['WAVE', 'OPEN_CLOSE'] })

// While the engine learns the room it treats everything it hears as "still". A hand moving then raises that bar and
// later gestures never clear it, so every calibration is announced on screen (CalibBanner) and can be redone.
let calibratingUntil = 0
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((l) => l())
export const calibratingLeft = () => Math.max(0, calibratingUntil - Date.now())
export const onCalibrating = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const calibrate = engine.calibrate.bind(engine)
engine.calibrate = async (ms = 3000) => {
  calibratingUntil = Math.max(calibratingUntil, Date.now() + ms); tell()
  try { await calibrate(ms) } finally { if (Date.now() >= calibratingUntil - 50) calibratingUntil = 0; tell() }
}
