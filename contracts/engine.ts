// CONTRACT: the sonar engine's public API. engine/ implements it; app/ and qa/ use it.
// Owned by the lead. Changes go through a NEED to I-ala-Wilson and a SPEC bump.

export type GestureType =
  | 'PUSH'        // hand moves toward the laptop
  | 'PULL'        // hand moves away
  | 'WAVE'        // fast back-and-forth for >= 1 s
  | 'HOLD'        // no motion for >= 1.5 s after motion
  | 'OPEN_CLOSE'  // one hand open/close pulse (count = pulses in a burst)
  | 'UNDO'        // DOUBLE TAP TOWARD: two quick, small taps toward the screen within ~600 ms (like double-clicking the air).
                  //   Small strokes, so it is distinct from PUSH (one bigger stroke) and WAVE (4+ alternating strokes)
  | 'REPETITIVE'  // sustained 3-8 Hz small oscillation >= 4 s (scratching / nail biting), for Habit
  | 'SWIPE_LEFT' | 'SWIPE_RIGHT'           // moonshot (two-tone)
  | 'ASL_HELP' | 'ASL_YES' | 'ASL_NO' | 'ASL_MORE' | 'ASL_THANK_YOU'; // moonshot (classifier)

export interface GestureEvent {
  type: GestureType;
  t: number;            // ms, performance.now() timebase
  confidence: number;   // 0..1 (rules give 0.6..1, classifier gives softmax prob)
  speed?: number;       // m/s, signed: + toward, - away (from v = c * df / (2 * f0))
  count?: number;       // OPEN_CLOSE pulses in the burst
  source: 'rules' | 'classifier';
}

export interface SpectrumFrame {
  t: number;            // ms
  bins: Float32Array;   // magnitude in dB, centred on the tone, ~ +-500 Hz
  binHz: number;        // Hz per bin
  shiftHz: number;      // energy-weighted Doppler shift of this frame (+ toward)
  energyToward: number; // dB above calibrated floor
  energyAway: number;
}

export interface EngineHealth {
  running: boolean;
  toneHz: number;       // default 20000
  toneDbfs: number;     // default -36
  snrDb: number;        // tone peak above noise; >= 30 is healthy
  sampleRate: number;
}

export interface EngineOptions {
  toneHz?: number;      // default 20000 (inaudible on Ian's MacBook at -36 dBFS)
  toneDbfs?: number;    // default -36
  sensitivityDb?: number; // default 2.5
  useClassifier?: boolean; // default false until ml/ ships a model
  modelUrl?: string;    // ONNX model path when useClassifier is true
  ruleAssist?: GestureType[]; // with the model on, these rule-detected gestures are also reported (the model can miss them)
}

export interface Engine {
  start(): Promise<void>;          // asks for the mic (echoCancellation, noiseSuppression, autoGainControl all OFF)
  stop(): void;
  calibrate(ms?: number): Promise<void>; // learn the still-room noise floor, default 3000 ms
  health(): EngineHealth;
  onGesture(cb: (e: GestureEvent) => void): () => void; // returns unsubscribe
  onFrame(cb: (f: SpectrumFrame) => void): () => void;  // ~30-60 frames/s, for the waterfall
  startRecording(label: SessionLabel): void;  // see contracts/recording.md
  stopRecording(): Promise<RecordedSession>;
}

export interface SessionLabel { person: string; gesture: GestureType | 'FREE'; laptop: string; note?: string }
export interface RecordedSession { wav: Blob; meta: object; filename: string }

// Factory exported by engine/src/index.ts:
//   export function createEngine(opts?: EngineOptions): Engine
