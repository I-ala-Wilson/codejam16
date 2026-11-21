import { createEngine } from '@engine/index.ts'

// One engine for the whole app so every page shares the same mic + tone.
export const engine = createEngine()
