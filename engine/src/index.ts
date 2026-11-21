import type { Engine, EngineOptions } from '../../contracts/engine.ts'

// Scaffold only. Yahya's issue replaces this with the real implementation (see contracts/engine.ts).
export function createEngine(_opts: EngineOptions = {}): Engine {
  const notYet = () => { throw new Error('engine not implemented yet') }
  return {
    start: async () => notYet(),
    stop: () => {},
    calibrate: async () => notYet(),
    health: () => ({ running: false, toneHz: 20000, toneDbfs: -36, snrDb: 0, sampleRate: 0 }),
    onGesture: () => () => {},
    onFrame: () => () => {},
    startRecording: () => notYet(),
    stopRecording: async () => notYet(),
  }
}
