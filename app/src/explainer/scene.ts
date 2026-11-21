import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// ECHØ explainer: a laptop pings 20 kHz, the hand reflects it, the echo's spacing shows Doppler.
// Scene units are metres. Sound is drawn ~1000x slower than real so the wavefronts can be seen.

export const F0 = 20000
export const C = 343
const CV = 0.3 // drawn speed of sound, scene m/s
const EMIT = 0.25 // seconds between outgoing wavefronts
const SPEED_SCALE = 5 // drawn hand speed -> real hand speed shown in the readout
const PIX = 1 // CSS px per dither pixel (finer dots read as smoother shapes)
const OUT_HALF = 0.5 // half-angle of an outgoing wavefront arc (rad)
const REF_HALF = 0.6

export const GESTURES = [
  { name: 'IDLE', sub: 'hand still · the echo sits right on 20 kHz', dur: 3 },
  { name: 'PUSH', sub: 'hand toward the screen · echo squeezed · pitch up', dur: 4 },
  { name: 'PULL', sub: 'hand away · echo stretched · pitch down', dur: 4 },
  { name: 'WAVE', sub: 'side to side · pitch wobbles up, down, up', dur: 4 },
  { name: 'OPEN / CLOSE', sub: 'fingers fold and spread · small shifts both ways', dur: 4 },
  { name: 'UNDO', sub: 'two quick finger taps toward the screen · two small blips', dur: 3 },
] as const

export type Frame = { gesture: number; v: number; df: number }
export type Hooks = {
  onFrame: (f: Frame) => void
  labels: { speaker: HTMLElement; mic: HTMLElement }
}
export type Controls = {
  jump: (g: number) => void
  togglePause: () => boolean
  toggleOrbit: () => boolean
  toggleDither: () => boolean
  dispose: () => void
}

const V = THREE.Vector3
const Y = new V(0, 1, 0)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ss = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }
const srgb = (hex: number) => new V(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255)

const BG = 0x1e1f21
const INK = 0xf2f2f0
const ACCENT = INK // no colour accent: echoes are told apart by their dashes

// Each wavefront is a thin expanding spherical cap (a shallow bowl opening along the direction of travel). It is drawn
// as fine lines of fixed world thickness: a bright rim where the shell is seen edge-on, plus faint latitude rings so the
// bowl reads as 3D (no radial meridians). Echoes are dashed along the rim.
const shellVert = /* glsl */ `
varying vec3 vL; varying vec3 vN; varying vec3 vW;
void main() {
  vL = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`
const shellFrag = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uR; uniform float uHalf; uniform float uDash;
varying vec3 vL; varying vec3 vN; varying vec3 vW;
float line(float d) { float x = d / 0.0012; return exp(-x * x); }
void main() {
  float th = acos(clamp(vL.y, -1.0, 1.0));
  float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
  float rim = line(uR * (1.0 - sqrt(max(0.0, 1.0 - ndv * ndv))));
  float rings = line(uR * abs(th - uHalf / 3.0)) + line(uR * abs(th - 2.0 * uHalf / 3.0));
  float dash = uDash > 0.0 ? step(0.5, fract(th * uDash * 1.6)) : 1.0;
  float edge = 1.0 - smoothstep(uHalf * 0.6, uHalf, th);
  float a = uAlpha * edge * (rim * dash + 0.3 * rings);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, min(a, 1.0));
}`

const ditherVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`
const ditherFrag = /* glsl */ `
uniform sampler2D tScene; uniform vec2 uRes; uniform vec3 uBg; uniform vec3 uInk; uniform vec3 uAccent;
varying vec2 vUv;
float bayer8(ivec2 p) {
  int x = p.x & 7; int y = p.y & 7; int xy = x ^ y;
  int v = ((xy & 1) << 5) | ((x & 1) << 4) | ((xy & 2) << 2) | ((x & 2) << 1) | ((xy & 4) >> 1) | ((x & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}
void main() {
  vec2 px = floor(vUv * uRes);
  vec3 c = texture2D(tScene, (px + 0.5) / uRes).rgb;
  float l = max(0.0, pow(dot(c, vec3(0.299, 0.587, 0.114)), 0.4545) - 0.07) / 0.93;
  bool on = l > bayer8(ivec2(px));
  vec3 ink = (c.b - c.r) > 0.05 ? uAccent : uInk;
  gl_FragColor = vec4(on ? ink : uBg, 1.0);
}`

function texFromCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  draw(cv.getContext('2d')!)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function setLimb(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  m.position.copy(a).add(b).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(Y, new V().subVectors(b, a).normalize())
}

// Two-bone IK: elbow position for shoulder a, wrist target t, bone lengths l1/l2, bending toward pole.
function solveElbow(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = new V().subVectors(t, a)
  const len = Math.min(Math.max(d.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3)
  d.normalize()
  const cosA = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len)
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  const perp = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize()
  return out.copy(a).addScaledVector(d, l1 * cosA).addScaledVector(perp, l1 * sinA)
}

// Turn a bone so the world directions a and b it had in the rest pose (orthonormal) point along da and db instead;
// db is made perpendicular to da first. q0 is the bone's world rotation in the rest pose, so any rig's bind works.
const mRest = new THREE.Matrix4(), mWant = new THREE.Matrix4(), qWant = new THREE.Quaternion(), qPar = new THREE.Quaternion()
const ob = new V(), oc = new V(), oa = new V()
function setWorld(bone: THREE.Object3D, q0: THREE.Quaternion, d: THREE.Quaternion) {
  qWant.copy(d).multiply(q0)
  bone.parent!.getWorldQuaternion(qPar)
  bone.quaternion.copy(qPar.invert().multiply(qWant))
  bone.updateMatrixWorld(true)
}
const qD = new THREE.Quaternion()
function orient(bone: THREE.Object3D, q0: THREE.Quaternion, a: THREE.Vector3, b: THREE.Vector3, da: THREE.Vector3, db: THREE.Vector3) {
  oa.copy(da).normalize()
  ob.copy(db).addScaledVector(oa, -db.dot(oa)).normalize()
  mWant.makeBasis(oa, ob, oc.crossVectors(oa, ob))
  mRest.makeBasis(a, b, new V().crossVectors(a, b)).transpose()
  setWorld(bone, q0, qD.setFromRotationMatrix(mWant.multiply(mRest)))
}

type Wave = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; on: boolean; t0: number; c: THREE.Vector3; hit: boolean; hitR: number; k: number }

export function createExplainer(host: HTMLElement, hooks: Hooks): Controls {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)
  renderer.domElement.style.display = 'block'

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x101010, 0.25))
  const key = new THREE.DirectionalLight(0xffffff, 2.8)
  key.position.set(1.2, 2.2, 1.4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.6)
  rim.position.set(-1.5, 1.2, -1.2)
  scene.add(rim)

  const lam = (hex: number) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true })
  const edgeMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.75 })
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, edges = false, parent: THREE.Object3D = scene) => {
    const g = new THREE.BoxGeometry(w, h, d)
    const m = new THREE.Mesh(g, mat)
    m.position.set(x, y, z)
    parent.add(m)
    if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat))
    return m
  }

  // Desk
  const deskMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c })
  box(1.3, 0.035, 0.75, deskMat, 0, 0.7225, -0.02, true)
  for (const [x, z] of [[-0.62, -0.36], [0.62, -0.36], [-0.62, 0.32], [0.62, 0.32]]) box(0.035, 0.705, 0.035, deskMat, x, 0.3525, z, true)

  // Laptop base, keyboard, trackpad, speaker grilles
  const alu = lam(0x8a8a8a)
  box(0.31, 0.016, 0.22, alu, 0, 0.748, 0, true)
  const keyTex = texFromCanvas(256, 112, (g) => {
    g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, 256, 112)
    g.fillStyle = '#909090'
    for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) g.fillRect(4 + c * 18, 4 + r * 21, 14, 16)
    g.fillRect(58, 4 + 5 * 21 - 2, 130, 5)
  })
  const flat = (w: number, d: number, map: THREE.Texture | null, color: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color, map }))
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.7565, z)
    scene.add(m)
    return m
  }
  flat(0.215, 0.092, keyTex, 0xffffff, 0, -0.04)
  flat(0.1, 0.062, null, 0x6c6c6c, 0, 0.062)
  const grilleTex = texFromCanvas(40, 140, (g) => {
    g.fillStyle = '#b6b6b6'; g.fillRect(0, 0, 40, 140)
    g.fillStyle = '#161616'
    for (let r = 0; r < 23; r++) for (let c = 0; c < 6; c++) { g.beginPath(); g.arc(4 + c * 6.4, 4 + r * 6, 1.8, 0, Math.PI * 2); g.fill() }
  })
  flat(0.026, 0.09, grilleTex, 0xffffff, -0.135, -0.04)
  flat(0.026, 0.09, grilleTex, 0xffffff, 0.135, -0.04)
  const S = new V(0.135, 0.757, -0.04)

  // Screen, hinged at the back edge, with a faint glow and the mic dot on the top bezel
  const screen = new THREE.Group()
  screen.position.set(0, 0.756, -0.108)
  screen.rotation.x = -0.24
  scene.add(screen)
  box(0.31, 0.205, 0.008, alu, 0, 0.1025, -0.004, true, screen)
  const glowTex = texFromCanvas(128, 80, (g) => {
    const gr = g.createRadialGradient(64, 40, 4, 64, 40, 80)
    gr.addColorStop(0, '#dcdcdc'); gr.addColorStop(1, '#5c5c5c')
    g.fillStyle = gr; g.fillRect(0, 0, 128, 80)
  })
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.284, 0.178), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.55 }))
  display.position.set(0, 0.106, 0.0006)
  screen.add(display)
  const micDot = new THREE.Mesh(new THREE.CircleGeometry(0.0032, 16), new THREE.MeshBasicMaterial({ color: INK }))
  micDot.position.set(0, 0.198, 0.0008)
  screen.add(micDot)
  scene.updateMatrixWorld(true)
  const M = micDot.getWorldPosition(new V())

  // Chair
  const chairMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0c })
  box(0.44, 0.04, 0.42, chairMat, 0, 0.43, 0.64, true)
  box(0.42, 0.44, 0.03, chairMat, 0, 0.72, 0.86, true)
  for (const [x, z] of [[-0.19, 0.46], [0.19, 0.46], [-0.19, 0.82], [0.19, 0.82]]) box(0.03, 0.41, 0.03, chairMat, x, 0.205, z, true)

  // Fallback person: capsules and spheres, replaced by the rigged model once it loads
  const person = new THREE.Group()
  scene.add(person)
  const smooth = (hex: number) => new THREE.MeshLambertMaterial({ color: hex })
  const skin = smooth(0xd8d8d8)
  const cloth = smooth(0x8e8e8e)
  const capsule = (r: number, len: number, mat: THREE.Material, segs = 24) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r), 8, segs), mat)
    person.add(m)
    return m
  }
  const torso = capsule(0.12, 0.5, cloth, 32)
  torso.scale.set(1.3, 1, 0.8)
  setLimb(torso, new V(0, 0.56, 0.62), new V(0, 0.94, 0.56))
  setLimb(capsule(0.06, 0.5, cloth), new V(-0.19, 1.0, 0.54), new V(0.19, 1.0, 0.54))
  setLimb(capsule(0.04, 0.1, skin), new V(0, 1.03, 0.55), new V(0, 1.1, 0.535))
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 40, 28), skin)
  head.position.set(0, 1.18, 0.525)
  head.scale.set(0.92, 1.08, 1)
  person.add(head)
  for (const s of [-1, 1]) {
    setLimb(capsule(0.065, 0.39, cloth), new V(s * 0.09, 0.5, 0.62), new V(s * 0.1, 0.5, 0.24))
    setLimb(capsule(0.05, 0.45, cloth), new V(s * 0.1, 0.5, 0.24), new V(s * 0.1, 0.07, 0.27))
    box(0.08, 0.05, 0.2, lam(0x303030), s * 0.1, 0.025, 0.21, false, person)
  }
  const L1 = 0.29, L2 = 0.27
  // Left arm resting on the desk
  const lShoulder = new V(-0.19, 1.0, 0.54), lWrist = new V(-0.27, 0.78, 0.26)
  const lElbow = solveElbow(lShoulder, lWrist, L1, L2, new V(-0.5, -1, 0.4), new V())
  setLimb(capsule(0.042, L1, cloth), lShoulder, lElbow)
  setLimb(capsule(0.036, L2, skin), lElbow, lWrist)
  { const lh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), skin); lh.scale.set(0.07, 0.024, 0.095); lh.position.set(-0.27, 0.755, 0.2); person.add(lh) }

  // Right arm, driven every frame
  const rShoulder = new V(0.19, 1.0, 0.54)
  const rUpper = capsule(0.042, L1, cloth)
  const rFore = capsule(0.036, L2, skin)
  const hand = new THREE.Group()
  person.add(hand)
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), skin)
  palm.scale.set(0.078, 0.09, 0.026)
  hand.add(palm)
  const fingerGeo = (len: number) => {
    const g = new THREE.CapsuleGeometry(0.0085, len - 0.017, 4, 12)
    g.translate(0, len / 2, 0)
    return g
  }
  const fingers: { a: THREE.Group; b: THREE.Group }[] = []
  for (const [x, len] of [[-0.027, 0.036], [-0.009, 0.04], [0.009, 0.038], [0.027, 0.03]] as const) {
    const a = new THREE.Group()
    a.position.set(x, 0.042, 0)
    hand.add(a)
    a.add(new THREE.Mesh(fingerGeo(len), skin))
    const b = new THREE.Group()
    b.position.y = len
    a.add(b)
    b.add(new THREE.Mesh(fingerGeo(len * 0.85), skin))
    fingers.push({ a, b })
  }
  const thumb = new THREE.Group()
  thumb.position.set(-0.036, -0.012, -0.004)
  hand.add(thumb)
  thumb.add(new THREE.Mesh(fingerGeo(0.045), skin))

  const done = new Set<unknown>()
  const free = (o: THREE.Object3D) => {
    const m = o as THREE.SkinnedMesh
    if (m.isSkinnedMesh) m.skeleton.dispose()
    if (m.geometry && !done.has(m.geometry)) { done.add(m.geometry); m.geometry.dispose() }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []
    for (const mat of mats) {
      if (done.has(mat)) continue
      done.add(mat)
      const map = (mat as THREE.MeshBasicMaterial).map
      if (map) map.dispose()
      mat.dispose()
    }
  }

  // Rigged person: a Ready Player Me young man (three.js example, Mixamo bone names), seated once on load; the right arm is solved every frame
  type Arm = { up: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3; bend: THREE.Vector3; palm: THREE.Vector3; across: THREE.Vector3 }
  type Rig = { bone: (n: string) => THREE.Bone; q0: (n: string) => THREE.Quaternion; l1: number; l2: number; arm: Record<'Left' | 'Right', Arm>; curl: { b: THREE.Bone; q: THREE.Quaternion; axis: THREE.Vector3; k: number; spread: THREE.Vector3; ks: number; index: boolean; thumb: boolean }[] }
  let rig: Rig | null = null
  let disposed = false
  const SEAT_Y = 0.52, HIP_Z = 0.62
  const FWD = new V(0, 0, -1)
  const ortho = (v: THREE.Vector3, along: THREE.Vector3) => v.clone().addScaledVector(along, -v.dot(along)).normalize()
  const pA = new V(), pE = new V(), pB = new V(), dU = new V(), dF = new V(), bend = new V(), acr = new V()
  const solveArm = (r: Rig, side: 'Left' | 'Right', w: THREE.Vector3, pole: THREE.Vector3, finger: THREE.Vector3, palmN: THREE.Vector3) => {
    const a = r.arm[side]
    const arm = r.bone(side + 'Arm'), fore = r.bone(side + 'ForeArm')
    arm.getWorldPosition(pA)
    solveElbow(pA, w, r.l1, r.l2, pole, pE)
    dU.subVectors(pE, pA).normalize()
    dF.subVectors(w, pE).normalize()
    bend.crossVectors(dU, dF)
    if (bend.lengthSq() < 1e-6) bend.crossVectors(dU, pole)
    orient(arm, r.q0(side + 'Arm'), a.up, a.bend, dU, bend)
    fore.getWorldPosition(pB)
    // Roll the forearm by the thumb-side axis, which stays across the wrist hinge, so the hand only bends on it
    // (rolling by the palm normal flips when the forearm points at the laptop and pinches the wrist)
    acr.crossVectors(finger, palmN).multiplyScalar(side === 'Right' ? 1 : -1)
    orient(fore, r.q0(side + 'ForeArm'), a.fore, ortho(a.across, a.fore), dF.subVectors(w, pB), acr)
    orient(r.bone(side + 'Hand'), r.q0(side + 'Hand'), a.hand, ortho(a.palm, a.hand), finger, palmN)
  }
  // Lowest point of the skinned surface, for putting his feet on the floor
  const minY = (root: THREE.Object3D) => {
    let y = Infinity
    const v = new V()
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isSkinnedMesh) return
      const pos = m.geometry.attributes.position
      for (let i = 0; i < pos.count; i += 3) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); if (v.y < y) y = v.y }
    })
    return y
  }
  // The bow tie, lapel flower and vest buttons are small separate pieces inside the shirt mesh: find its connected
  // pieces (welding seams by position) and drop the small ones on the chest, so the torso reads as one smooth surface
  const dropTrim = (g: THREE.BufferGeometry) => {
    const pos = g.attributes.position, idx = g.index
    if (!idx) return
    const n = pos.count, par = Array.from({ length: n }, (_, i) => i)
    const find = (a: number) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a }
    const join = (a: number, b: number) => { par[find(a)] = find(b) }
    for (let t = 0; t < idx.count; t += 3) { join(idx.getX(t), idx.getX(t + 1)); join(idx.getX(t + 1), idx.getX(t + 2)) }
    const seen = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const k = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
      const o = seen.get(k)
      if (o === undefined) seen.set(k, i); else join(i, o)
    }
    const box = new Map<number, { n: number; b: THREE.Box3 }>()
    const v = new V()
    for (let i = 0; i < n; i++) {
      const r = find(i)
      if (!box.has(r)) box.set(r, { n: 0, b: new THREE.Box3() })
      const c = box.get(r)!
      c.n++
      c.b.expandByPoint(v.fromBufferAttribute(pos, i))
    }
    const drop = new Set<number>()
    for (const [r, c] of box) {
      const m = c.b.getCenter(v)
      if (c.n <= 230 && c.b.max.y - c.b.min.y < 0.12 && Math.abs(m.x) < 0.25 && m.y > 1.1 && m.y < 1.6 && m.z > 0.05) drop.add(r)
    }
    const keep: number[] = []
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t)
      if (!drop.has(find(a))) keep.push(a, idx.getX(t + 1), idx.getX(t + 2))
    }
    g.setIndex(keep)
  }
  new GLTFLoader().load('/models/person/guy.glb', (gltf) => {
    const root = gltf.scene
    if (disposed) { root.traverse(free); return }
    try {
      const bones = new Map<string, THREE.Bone>()
      const old = new Set<THREE.Material>()
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x9a9a98 }) // one smooth grey: a sculpted shape, no face or clothes detail
      root.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o as THREE.Bone)
        const m = o as THREE.SkinnedMesh
        if (m.isMesh && /^(EyeLeft|EyeRight|Wolf3D_Teeth|Wolf3D_Beard|Wolf3D_Headwear)$/.test(m.name)) m.visible = false // no face, just the shape
        if (m.isMesh) {
          const was = m.material as THREE.MeshStandardMaterial
          old.add(was)
          m.material = bodyMat
          m.frustumCulled = false
          if (m.name === 'Wolf3D_Outfit_Top') dropTrim(m.geometry)
        }
      })
      for (const mt of old) {
        const s = mt as THREE.MeshStandardMaterial
        for (const t of [s.map, s.normalMap, s.roughnessMap, s.metalnessMap, s.aoMap, s.emissiveMap]) t?.dispose()
        mt.dispose()
      }
      const bone = (n: string) => { const b = bones.get(n); if (!b) throw new Error('guy.glb: missing bone ' + n); return b }
      // With the eyes hidden, the empty sockets catch the light as bright dots: fill them flush with the face
      for (const eye of ['LeftEye', 'RightEye']) {
        const c = bone(eye).getWorldPosition(new V())
        root.traverse((o) => {
          const m = o as THREE.SkinnedMesh
          if (m.name !== 'Wolf3D_Head') return
          const pos = m.geometry.attributes.position, nrm = m.geometry.attributes.normal, v = new V()
          for (let i = 0; i < pos.count; i++) {
            if (v.fromBufferAttribute(pos, i).distanceTo(c) > 0.022) continue
            pos.setZ(i, Math.max(pos.getZ(i), c.z + 0.008))
            nrm.setXYZ(i, 0, 0.15, 0.99)
          }
          pos.needsUpdate = true
          nrm.needsUpdate = true
        })
      }
      const at = (n: string) => bone(n).getWorldPosition(new V())
      scene.add(root)
      root.updateMatrixWorld(true)
      // Turn him so his toes point at the laptop
      const toe = at('RightToeBase').sub(at('RightFoot')).setY(0).normalize()
      root.rotation.y = Math.atan2(toe.x, toe.z) - Math.atan2(FWD.x, FWD.z)
      root.updateMatrixWorld(true)
      root.position.add(new V(0, SEAT_Y, HIP_Z).sub(at('RightUpLeg').setX(0)))
      root.updateMatrixWorld(true)

      const rest = new Map<string, THREE.Quaternion>()
      for (const [n, b] of bones) rest.set(n, b.getWorldQuaternion(new THREE.Quaternion()))
      const q0 = (n: string) => rest.get(n)!
      const dir = (a: string, b: string) => at(b).sub(at(a)).normalize()
      const ankleH = at('RightFoot').y - minY(root)
      const armRest = (s: 'Left' | 'Right'): Arm => {
        const up = dir(s + 'Arm', s + 'ForeArm'), hand = dir(s + 'Hand', s + 'HandMiddle1')
        const across = at(s + 'HandIndex1').sub(at(s + 'HandPinky1'))
        const palm = new V().crossVectors(hand, across).multiplyScalar(s === 'Right' ? -1 : 1).normalize()
        across.copy(new V().crossVectors(hand, palm).multiplyScalar(s === 'Right' ? 1 : -1).normalize())
        return { up, fore: dir(s + 'ForeArm', s + 'Hand'), hand, bend: ortho(new V().crossVectors(up, FWD), up), palm, across }
      }
      const arms = { Left: armRest('Left'), Right: armRest('Right') }
      const r: Rig = { bone, q0, l1: at('RightArm').distanceTo(at('RightForeArm')), l2: at('RightForeArm').distanceTo(at('RightHand')), arm: arms, curl: [] }

      // Seated: lean forward a little, head down to the screen, thighs on the seat, shins down to the floor
      const X = new V(1, 0, 0)
      const rx = (a: number) => new THREE.Quaternion().setFromAxisAngle(X, a)
      setWorld(bone('Spine'), q0('Spine'), rx(-0.08))
      setWorld(bone('Spine1'), q0('Spine1'), rx(-0.16))
      setWorld(bone('Neck'), q0('Neck'), rx(-0.2))
      setWorld(bone('Head'), q0('Head'), rx(-0.42))
      for (const [s, k] of [['Left', -1], ['Right', 1]] as const) {
        const thighA = dir(s + 'UpLeg', s + 'Leg'), shinA = dir(s + 'Leg', s + 'Foot')
        orient(bone(s + 'UpLeg'), q0(s + 'UpLeg'), thighA, ortho(X, thighA), new V(k * 0.06, 0.05, -1).normalize(), X)
        const knee = at(s + 'Leg'), len = knee.distanceTo(bone(s + 'Foot').getWorldPosition(new V()))
        const dy = Math.min(len, knee.y - ankleH)
        orient(bone(s + 'Leg'), q0(s + 'Leg'), shinA, ortho(X, shinA), new V(k * 0.02, -dy, -Math.sqrt(Math.max(0, len * len - dy * dy))).normalize(), X)
        setWorld(bone(s + 'Foot'), q0(s + 'Foot'), new THREE.Quaternion())
      }
      root.updateMatrixWorld(true)

      // Finger joints curl about the bind-pose axis that swings each bone into the palm, capped at full curl to
      // MCP 80°, PIP 95°, DIP 60°. The thumb opposes gently toward the middle finger (CMC 25°, MCP 35°, IP 40°),
      // so it lands on the fingers instead of rotating through the palm.
      const palmR = arms.Right.palm
      const D = Math.PI / 180
      const midPip = at('RightHandMiddle2')
      for (const [f, ks] of [['Index', [80 * D, 95 * D, 60 * D]], ['Middle', [80 * D, 95 * D, 60 * D]], ['Ring', [80 * D, 95 * D, 60 * D]], ['Pinky', [80 * D, 95 * D, 60 * D]], ['Thumb', [25 * D, 35 * D, 40 * D]]] as const) {
        for (let i = 0; i < 3; i++) {
          const n = 'RightHand' + f + (i + 1)
          const along = dir(n, 'RightHand' + f + (i + 2))
          const inv = q0(n).clone().invert()
          const toward = f === 'Thumb' ? ortho(midPip.clone().sub(at(n)), along) : palmR
          const axis = new V().crossVectors(along, toward).normalize().applyQuaternion(inv)
          // Knuckles also fan out, away from the middle finger (the thumb away from the index)
          const ref = f === 'Thumb' ? 'RightHandIndex1' : 'RightHandMiddle1'
          const fan = i === 0 && f !== 'Middle' ? new V().crossVectors(along, ortho(at(n).sub(at(ref)), along)).normalize().applyQuaternion(inv) : new V(1, 0, 0)
          const ks2 = i === 0 ? ({ Index: 0.1, Middle: 0, Ring: 0.08, Pinky: 0.2, Thumb: 0.35 } as const)[f] : 0
          r.curl.push({ b: bone(n), q: bone(n).quaternion.clone(), axis, k: ks[i], spread: fan, ks: ks2, index: f === 'Index', thumb: f === 'Thumb' })
        }
      }

      // Left fingers relaxed with a slight curl, resting on the desk
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let i = 0; i < 3; i++) {
        const n = 'LeftHand' + f + (i + 1)
        const axis = new V().crossVectors(dir(n, 'LeftHand' + f + (i + 2)), arms.Left.palm).normalize().applyQuaternion(q0(n).clone().invert())
        bone(n).quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, [0.15, 0.25, 0.15][i]))
      }
      solveArm(r, 'Left', new V(-0.3, 0.8, 0.27), new V(-0.8, -0.6, 0.4), new V(0.1, 0, -1).normalize(), new V(0, -1, 0))
      rig = r
      scene.remove(person)
      person.traverse(free)
      prevAvg = -1
      placeHand()
      Hp.copy(Hn)
    } catch (e) {
      scene.remove(root)
      root.traverse(free)
      rig = null
      console.warn(e)
    }
  }, undefined, (e) => console.warn('guy.glb failed to load; keeping the simple figure', e))

  // Wavefront pool
  const caps = new Map<number, THREE.SphereGeometry>()
  const makeWave = (half: number, dash = 0) => {
    if (!caps.has(half)) caps.set(half, new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, half))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new V() }, uAlpha: { value: 0 }, uR: { value: 0 }, uHalf: { value: half }, uDash: { value: dash } },
      vertexShader: shellVert, fragmentShader: shellFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(caps.get(half)!, mat)
    mesh.visible = false
    mesh.frustumCulled = false
    scene.add(mesh)
    return { mesh, mat, on: false, t0: 0, c: new V(), hit: false, hitR: 0, k: 0 }
  }
  const outs: Wave[] = Array.from({ length: 24 }, () => makeWave(OUT_HALF))
  const refs: Wave[] = Array.from({ length: 64 }, () => makeWave(REF_HALF, 16)) // echoes are dashed
  const take = (pool: Wave[]) => pool.find((w) => !w.on) ?? null
  const inkV = srgb(INK)
  const dimRef = srgb(0x9a9a98), brightRef = srgb(0xffffff)

  // Dither pass
  const rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true })
  const ditherMat = new THREE.ShaderMaterial({
    uniforms: { tScene: { value: rt.texture }, uRes: { value: new THREE.Vector2(2, 2) }, uBg: { value: srgb(BG) }, uInk: { value: srgb(INK) }, uAccent: { value: srgb(ACCENT) } },
    vertexShader: ditherVert, fragmentShader: ditherFrag, depthTest: false, depthWrite: false,
  })
  const quadGeo = new THREE.PlaneGeometry(2, 2)
  const quadScene = new THREE.Scene()
  quadScene.add(new THREE.Mesh(quadGeo, ditherMat))
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  let W = 1, H = 1
  const resize = () => {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight)
    renderer.setSize(W, H)
    camera.aspect = W / H
    camera.setViewOffset(W, H, -W * 0.18, -H * 0.02, W, H) // figure sits right of the words column
    const rw = Math.max(1, Math.floor(W / PIX)), rh = Math.max(1, Math.floor(H / PIX))
    rt.setSize(rw, rh)
    ditherMat.uniforms.uRes.value.set(rw, rh)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()

  // Gesture timeline
  const FAR = new V(0.07, 0.93, 0.25), NEAR = new V(0.07, 0.93, 0.08)
  const pose = (g: number, u: number, out: THREE.Vector3) => {
    out.copy(FAR)
    let curl = 0.12, tilt = 0, spread = 0, point = 0, tap = 0
    if (g === 0) { out.y += 0.0015 * Math.sin(u * 2.1); out.z += 0.001 * Math.sin(u * 1.3) }
    else if (g === 1) { out.z = THREE.MathUtils.lerp(FAR.z, NEAR.z, ss((u - 0.5) / 2.2)); curl = 0; spread = 1 }
    else if (g === 2) { out.z = THREE.MathUtils.lerp(NEAR.z, FAR.z, ss((u - 0.5) / 2.2)); curl = 0; spread = 1 }
    else if (g === 3) {
      const env = ss(u / 0.4) * ss((4 - u) / 0.4), ph = (2 * Math.PI * u) / 1.3
      out.x += 0.085 * Math.sin(ph) * env
      out.z -= 0.045 * Math.sin(ph) * env
      tilt = -0.35 * Math.cos(ph) * env
    } else if (g === 4) curl = 0.5 - 0.5 * Math.cos((2 * Math.PI * u) / 2) // open hand to full fist and back
    else {
      // UNDO: hand turns palm down and points the index at the screen, then double-clicks the air with that finger
      // (two 0.15 s knuckle flexes 0.2 s apart, the wrist nudging forward ~1.5 cm with each), then a pause
      point = ss(u / 0.45) * ss((3 - u) / 0.45)
      out.y += 0.06 * point // lift the pointing hand clear of the keyboard
      curl = 0.12 + 0.58 * point // the other three fingers curl to ~70%, the thumb rests on the middle finger
      for (const t0 of [0.8, 1.15]) if (u > t0 && u < t0 + 0.15) {
        const b = Math.sin((Math.PI * (u - t0)) / 0.15)
        tap = b
        out.z -= 0.015 * b
      }
    }
    return { curl, tilt, spread, point, tap }
  }

  let gi = 0, gu = 0, simT = 0, camT = 0
  // Camera state [azimuth, elevation, radius, look-at x, y, z], moved by a critically damped spring so every
  // change eases in and out like a hand-operated camera
  const cam = [1.62, 0.22, 1.78, 0.03, 0.88, 0.1], camV = [0, 0, 0, 0, 0, 0], camGoal = cam.slice()
  const CAM_W = 1.7 // spring stiffness: a big move settles in about 3 s
  let handXs = 0.07
  let paused = false, orbit = true, dither = true
  let blendT = 1
  const blendFrom = new V()
  const Hn = new V(), Hp = new V(), Ht = new V(), wrist = new V(), elbow = new V()
  let curl = 0.12, curlPrev = 0.12, tilt = 0, spread = 0
  let vSm = 0, prevAvg = -1
  let nextEmit = 0

  const Hgoal = new V(), qTilt = new THREE.Quaternion(), qC = new THREE.Quaternion(), eTilt = new THREE.Euler(), fDir = new V(), pN = new V(), mid = new V()
  const placeHand = () => {
    const p = pose(gi, gu, Ht)
    if (blendT < 1) Hgoal.lerpVectors(blendFrom, Ht, ss(blendT)); else Hgoal.copy(Ht)
    curl = p.curl; tilt = p.tilt; spread = p.spread
    const point = p.point, tap = p.tap
    if (rig) {
      // Palm to the laptop, fingers up, rolled by the wave tilt; the echo then reflects off the real palm
      wrist.copy(Hgoal).add(new V(0, -0.055, 0.012))
      qTilt.setFromEuler(eTilt.set(-0.45 - point * (Math.PI / 2 - 0.75), 0, tilt))
      fDir.set(0, 1, 0).applyQuaternion(qTilt)
      pN.set(0, 0, -1).applyQuaternion(qTilt)
      solveArm(rig, 'Right', wrist, new V(0.45, -1, 0.35), fDir, pN)
      for (const c of rig.curl) {
        const cu = c.index ? THREE.MathUtils.lerp(curl, 0.05 + 0.32 * tap, point) : c.thumb ? Math.max(curl, point) : curl
        c.b.quaternion.copy(c.q).multiply(qC.setFromAxisAngle(c.axis, cu * c.k)).multiply(qC.setFromAxisAngle(c.spread, spread * c.ks))
      }
      const h = rig.bone('RightHand')
      h.updateMatrixWorld(true)
      h.getWorldPosition(Hn)
      Hn.lerp(rig.bone('RightHandMiddle1').getWorldPosition(mid), 0.55)
      if (point > 0) Hn.lerp(rig.bone('RightHandIndex4').getWorldPosition(mid), point) // UNDO reflects off the fingertip
      return
    }
    Hn.copy(Hgoal)
    hand.position.copy(Hn)
    hand.rotation.set(-0.15, 0, tilt)
    for (const f of fingers) { f.a.rotation.x = -curl * 1.5; f.b.rotation.x = -curl * 1.8 }
    thumb.rotation.set(-curl * 0.9, 0, 0.6 - curl * 1.1)
    wrist.copy(Hn).add(new V(0, -0.055, 0.012))
    solveElbow(rShoulder, wrist, L1, L2, new V(0.45, -1, 0.35), elbow)
    setLimb(rUpper, rShoulder, elbow)
    setLimb(rFore, elbow, wrist)
  }
  placeHand()
  Hp.copy(Hn)

  const step = (dt: number) => {
    const tPrev = simT
    simT += dt
    gu += dt
    if (gu >= GESTURES[gi].dur) { gu -= GESTURES[gi].dur; gi = (gi + 1) % GESTURES.length }
    if (blendT < 1) blendT = Math.min(1, blendT + dt / 0.5)
    Hp.copy(Hn); curlPrev = curl
    placeHand()

    // Signed speed toward the laptop: rate the speaker->hand->mic path shortens, halved
    const avg = (Hn.distanceTo(S) + Hn.distanceTo(M)) / 2
    const vScene = prevAvg < 0 ? 0 : -(avg - prevAvg) / dt
    prevAvg = avg
    const vFingers = ((curl - curlPrev) / dt) * 0.012
    vSm += (vScene + vFingers - vSm) * Math.min(1, dt / 0.08)

    while (simT >= nextEmit) {
      const w = take(outs)
      if (w) { w.on = true; w.t0 = nextEmit; w.hit = false; w.c.copy(S) }
      nextEmit += EMIT
    }
    for (const w of outs) {
      if (!w.on || w.hit) continue
      const fNow = CV * (simT - w.t0) - Hn.distanceTo(S)
      if (fNow < 0) continue
      const fPrev = CV * (tPrev - w.t0) - Hp.distanceTo(S)
      const frac = fPrev < 0 ? -fPrev / (fNow - fPrev) : 0
      const tHit = tPrev + frac * dt
      w.hit = true
      w.hitR = CV * (tHit - w.t0)
      const r = take(refs)
      if (r) { r.on = true; r.t0 = tHit; r.c.lerpVectors(Hp, Hn, frac); r.k = Math.max(-1, Math.min(1, vScene / 0.1)) }
    }
  }

  const travel = new V()
  const drawWaves = () => {
    for (const w of outs) {
      if (!w.on) { w.mesh.visible = false; continue }
      const r = CV * (simT - w.t0)
      let a = ss(r / 0.03) * Math.pow(1 - Math.min(1, r / 1.5), 1.3) // full ink, fading with distance
      if (w.hit) a *= clamp01(1 - (r - w.hitR) / 0.03)
      if (a <= 0 || r > 1.5) { w.on = false; w.mesh.visible = false; continue }
      w.mesh.visible = true
      w.mesh.position.copy(S)
      w.mesh.quaternion.setFromUnitVectors(Y, travel.subVectors(Hn, S).normalize())
      w.mesh.scale.setScalar(Math.max(r, 1e-4))
      w.mat.uniforms.uR.value = r
      w.mat.uniforms.uColor.value.copy(inkV)
      w.mat.uniforms.uAlpha.value = a
    }
    for (const w of refs) {
      if (!w.on) { w.mesh.visible = false; continue }
      const r = CV * (simT - w.t0)
      const dist = w.c.distanceTo(M)
      if (r >= dist) { w.on = false; w.mesh.visible = false; continue }
      w.mesh.visible = true
      w.mesh.position.copy(w.c)
      w.mesh.quaternion.setFromUnitVectors(Y, travel.subVectors(M, w.c).normalize())
      w.mesh.scale.setScalar(Math.max(r, 1e-4))
      w.mat.uniforms.uR.value = r
      const k = 0.5 + 0.5 * w.k
      w.mat.uniforms.uColor.value.lerpVectors(dimRef, brightRef, k)
      w.mat.uniforms.uAlpha.value = 0.85 * (0.45 + 0.55 * k) * (1 - 0.5 * r / dist) * ss(r / 0.02) * clamp01((dist - r) / 0.04)
    }
  }

  const target = new V(0.03, 0.88, 0.1)
  const label = (el: HTMLElement, p: THREE.Vector3) => {
    const q = p.clone().project(camera)
    el.style.transform = `translate(${((q.x + 1) / 2) * W}px, ${((1 - q.y) / 2) * H}px)`
  }

  let raf = 0, last = performance.now()
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (!paused && dt > 0) step(dt)
    if (orbit) camT += dt
    // WAVE: ease round to face him from slightly above and follow the hand with a heavily damped pan; every other
    // gesture holds the side view with a very slow drift and a tiny breathing sway
    const waving = gi === 3
    handXs += (Hn.x - handXs) * Math.min(1, dt / 1.5)
    const sway = 0.004 * Math.sin((camT * 2 * Math.PI) / 9.3)
    if (waving) camGoal.splice(0, 6, Math.PI + 0.5 * (handXs - 0.07), 0.78, 2.3, 0.03 + 0.5 * (handXs - 0.07), 0.86, 0.32)
    else camGoal.splice(0, 6, 1.62 + 0.15 * Math.sin((camT * 2 * Math.PI) / 90) + sway, 0.22 + 0.006 * Math.sin((camT * 2 * Math.PI) / 7), 1.78, 0.03, 0.88, 0.1)
    for (let k = 0; k < 6; k++) {
      camV[k] += (CAM_W * CAM_W * (camGoal[k] - cam[k]) - 2 * CAM_W * camV[k]) * dt
      cam[k] += camV[k] * dt
    }
    const [az, el, rad] = cam
    target.set(cam[3], cam[4], cam[5])
    camera.position.set(target.x + rad * Math.sin(az) * Math.cos(el), target.y + rad * Math.sin(el), target.z + rad * Math.cos(az) * Math.cos(el))
    camera.lookAt(target)
    drawWaves()

    if (dither) {
      renderer.setClearColor(0x000000, 1)
      renderer.setRenderTarget(rt)
      renderer.render(scene, camera)
      renderer.setRenderTarget(null)
      renderer.render(quadScene, quadCam)
    } else {
      renderer.setClearColor(BG, 1)
      renderer.render(scene, camera)
    }
    label(hooks.labels.speaker, S)
    label(hooks.labels.mic, M)
    const v = vSm * SPEED_SCALE
    hooks.onFrame({ gesture: gi, v, df: (2 * v * F0) / C })
  }
  raf = requestAnimationFrame(frame)

  return {
    jump: (g) => { blendFrom.copy(Hgoal); blendT = 0; gi = g; gu = 0 },
    togglePause: () => (paused = !paused),
    toggleOrbit: () => (orbit = !orbit),
    toggleDither: () => (dither = !dither),
    dispose: () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      disposed = true
      scene.traverse(free)
      quadScene.traverse(free)
      rt.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
