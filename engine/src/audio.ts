import { HOP } from './pipeline.ts'

// Browser audio I/O: inaudible tone out of the speakers, raw mono mic samples in via an AudioWorklet.
// Needs a real mic and speaker, so it is verified by hand on the app page rather than unit-tested.

const WORKLET_NAME = 'echo-capture'
const PREFERRED_SAMPLE_RATE = 48000
/** A blocked AudioContext (autoplay policy) never resumes on its own; fail instead of hanging. */
const RESUME_TIMEOUT_MS = 3000

const WORKLET_SOURCE = `
class EchoCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(${HOP})
    this.filled = 0
  }
  process(inputs) {
    const channel = inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i]
        if (this.filled === ${HOP}) {
          this.port.postMessage(this.buffer.slice())
          this.filled = 0
        }
      }
    }
    return true
  }
}
registerProcessor('${WORKLET_NAME}', EchoCapture)
`

export interface CaptureOptions {
  readonly toneHz: number
  readonly toneDbfs: number
  readonly onChunk: (chunk: Float32Array) => void
  /** Called once if the capture dies on its own (mic unplugged or muted, context closed). */
  readonly onEnded: (reason: string) => void
}

export interface CaptureSession {
  readonly sampleRate: number
  stop(): void
}

function dbfsToGain(dbfs: number): number {
  return 10 ** (dbfs / 20)
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Ask for the mic with every browser DSP stage off; they would erase the Doppler echo. */
async function openMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Microphone unavailable: ${reason}`)
  }
}

export async function startCapture(opts: CaptureOptions): Promise<CaptureSession> {
  // Created and resumed before the mic prompt: the click's user activation can expire while it is open,
  // and a context that was not resumed during the gesture may stay suspended for good.
  const ctx = new AudioContext({ sampleRate: PREFERRED_SAMPLE_RATE, latencyHint: 'interactive' })
  const resumed = ctx.resume()
  let stream: MediaStream | null = null
  let moduleUrl: string | null = null

  const release = (): void => {
    ctx.onstatechange = null
    stream?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
    if (moduleUrl) URL.revokeObjectURL(moduleUrl)
    if (ctx.state !== 'closed') ctx.close().catch(() => undefined)
  }

  try {
    stream = await openMic()
    await withTimeout(resumed, RESUME_TIMEOUT_MS, 'Audio is blocked: click the page, then press Start again')
    moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(moduleUrl)

    const osc = ctx.createOscillator()
    osc.frequency.value = opts.toneHz
    const toneGain = ctx.createGain()
    toneGain.gain.value = dbfsToGain(opts.toneDbfs)
    osc.connect(toneGain).connect(ctx.destination)
    osc.start()

    const capture = new AudioWorkletNode(ctx, WORKLET_NAME)
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => opts.onChunk(event.data)
    const mute = ctx.createGain()
    mute.gain.value = 0 // keeps the capture node pulled by the graph without playing the mic back
    ctx.createMediaStreamSource(stream).connect(capture)
    capture.connect(mute).connect(ctx.destination)

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => opts.onEnded('Microphone disconnected or muted by the system')
    })
    ctx.onstatechange = () => {
      if (ctx.state === 'closed') opts.onEnded('Audio context closed')
    }

    return {
      sampleRate: ctx.sampleRate,
      stop: () => {
        osc.stop()
        capture.port.onmessage = null
        release()
      },
    }
  } catch (error: unknown) {
    release()
    throw error
  }
}
