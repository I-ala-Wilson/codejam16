import { describe, expect, it } from 'vitest'
import { buildFloor } from './dsp.ts'
import { quietest } from './pipeline.ts'

describe('quietest', () => {
  it('learns the still floor even when a hand moved for two thirds of the calibration', () => {
    const still = Array.from({ length: 47 }, (_, i) => Float32Array.from({ length: 16 }, () => -80 + (i % 3)))
    const moving = Array.from({ length: 94 }, () => Float32Array.from({ length: 16 }, (_, k) => (k > 8 ? -30 : -80)))
    const mixed = [...moving.slice(0, 50), ...still, ...moving.slice(50)]
    expect(Array.from(buildFloor(quietest(mixed)))).toEqual(Array.from(buildFloor(still)))
  })
  it('keeps at least 8 frames', () => {
    expect(quietest(Array.from({ length: 12 }, () => new Float32Array(4))).length).toBe(8)
  })
})
