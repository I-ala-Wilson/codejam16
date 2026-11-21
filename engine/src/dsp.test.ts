import { describe, expect, it } from 'vitest'
import {
  analyzeFrame,
  buildFloor,
  centerBinIndex,
  FLOOR_SIGMAS,
  fft,
  hann,
  mad,
  median,
  sliceAroundTone,
  snrDb,
  spectrumDb,
} from './dsp.ts'

const FS = 48000
const N = 4096
const BIN_HZ = FS / N

/** Deterministic uniform noise in [-amp, amp]. */
function noise(length: number, amp: number, seed = 1): Float32Array {
  let s = seed
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = (s / 0xffffffff - 0.5) * 2 * amp
  }
  return out
}

function sines(parts: ReadonlyArray<{ hz: number; amp: number }>, noiseAmp = 0, seed = 1): Float32Array {
  const out = noise(N, noiseAmp, seed)
  for (const { hz, amp } of parts) {
    for (let i = 0; i < N; i++) out[i] += amp * Math.sin((2 * Math.PI * hz * i) / FS)
  }
  return out
}

const dbToAmp = (db: number): number => 10 ** (db / 20)

function toneBins(samples: Float32Array): Float32Array {
  const full = spectrumDb(samples, hann(N))
  return sliceAroundTone(full, centerBinIndex(20000, BIN_HZ), Math.round(500 / BIN_HZ))
}

describe('fft', () => {
  it('puts a bin-centred sine in the expected bin', () => {
    const n = 64
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 5 * i) / n)
    fft(re, im)
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]))
    const peak = mags.indexOf(Math.max(...mags.slice(0, n / 2)))
    expect(peak).toBe(5)
  })

  it('rejects non power-of-two sizes', () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow()
  })
})

describe('spectrumDb', () => {
  it('reports a full-scale bin-centred sine as 0 dB', () => {
    const hz = (FS * 100) / N
    const db = spectrumDb(sines([{ hz, amp: 1 }]), hann(N))
    expect(db[100]).toBeCloseTo(0, 0)
  })
})

describe('sliceAroundTone', () => {
  it('returns 2 * half + 1 bins centred on the tone', () => {
    const full = new Float32Array(N / 2).map((_, i) => i)
    const out = sliceAroundTone(full, 100, 10)
    expect(out.length).toBe(21)
    expect(out[10]).toBe(100)
  })
})

describe('median and mad', () => {
  it('computes the median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
  it('computes the median absolute deviation', () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1)
  })
})

describe('analyzeFrame', () => {
  const carrier = { hz: 20000, amp: dbToAmp(-36) }
  const noiseAmp = dbToAmp(-100)
  const stillFrames = Array.from({ length: 20 }, (_, i) => toneBins(sines([carrier], noiseAmp, i + 1)))
  const floor = buildFloor(stillFrames)

  it('gives a positive shift and more toward-energy for an approaching hand', () => {
    const bins = toneBins(sines([carrier, { hz: 20117, amp: dbToAmp(-56) }], noiseAmp, 99))
    const r = analyzeFrame(bins, BIN_HZ, floor)
    expect(r.shiftHz).toBeGreaterThan(80)
    expect(r.shiftHz).toBeLessThan(150)
    expect(r.energyToward).toBeGreaterThan(30)
    expect(r.energyAway).toBeLessThan(r.energyToward)
  })

  it('gives a negative shift for a receding hand', () => {
    const bins = toneBins(sines([carrier, { hz: 19883, amp: dbToAmp(-56) }], noiseAmp, 99))
    const r = analyzeFrame(bins, BIN_HZ, floor)
    expect(r.shiftHz).toBeLessThan(-80)
    expect(r.shiftHz).toBeGreaterThan(-150)
    expect(r.energyAway).toBeGreaterThan(r.energyToward)
  })

  it('reports almost no shift and no energy for a still room', () => {
    const bins = toneBins(sines([carrier], noiseAmp, 99))
    const r = analyzeFrame(bins, BIN_HZ, floor)
    expect(Math.abs(r.shiftHz)).toBeLessThan(30)
    expect(r.energyToward).toBeLessThan(6)
    expect(r.energyAway).toBeLessThan(6)
  })

  it('rejects a floor of a different length', () => {
    expect(() => analyzeFrame(new Float32Array(11), BIN_HZ, new Float32Array(9))).toThrow()
  })
})

describe('buildFloor', () => {
  it('sits FLOOR_SIGMAS robust sigmas (1.4826 * MAD) above the per-bin median', () => {
    const frames = [new Float32Array([0, 10]), new Float32Array([2, 10]), new Float32Array([4, 10])]
    const floor = buildFloor(frames)
    expect(floor[0]).toBeCloseTo(2 + FLOOR_SIGMAS * 1.4826 * 2, 4)
    expect(floor[1]).toBe(10)
  })

  it('rejects an empty frame list', () => {
    expect(() => buildFloor([])).toThrow()
  })
})

describe('snrDb', () => {
  it('is at least 30 dB for a clean -36 dBFS tone over a -90 dBFS noise floor', () => {
    const bins = toneBins(sines([{ hz: 20000, amp: dbToAmp(-36) }], dbToAmp(-90)))
    expect(snrDb(bins)).toBeGreaterThan(30)
  })

  it('is near zero when there is only noise', () => {
    const bins = toneBins(sines([], dbToAmp(-60)))
    expect(snrDb(bins)).toBeLessThan(15)
  })
})
