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

// Each wavefront is an arc band of fixed world thickness, drawn on a quad in the vertical plane of travel.
const arcVert = /* glsl */ `
uniform float uScale;
varying vec2 vP;
void main() {
  vP = position.xy * uScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const arcFrag = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uR; uniform float uHalf; uniform float uDash;
varying vec2 vP;
void main() {
  float d = length(vP);
  float ang = abs(atan(vP.x, vP.y));
  float mask = 1.0 - smoothstep(uHalf * 0.55, uHalf, ang);
  if (uDash > 0.0) mask *= step(0.42, fract(atan(vP.x, vP.y) * uDash));
  float x = (d - uR) / 0.0035;
  float band = exp(-x * x) + 0.22 * exp(-x * x / 16.0);
  float a = uAlpha * band * mask;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
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

// Turn a bone so its rest-space axes a and b (orthonormal) point along world directions da and db; db is made
// perpendicular to da first. Every Xbot bone rests with an identity rotation, so rest space is the model's own frame.
const mRest = new THREE.Matrix4(), mWant = new THREE.Matrix4(), qWant = new THREE.Quaternion(), qPar = new THREE.Quaternion()
const ob = new V(), oc = new V(), oa = new V()
function orient(bone: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, da: THREE.Vector3, db: THREE.Vector3) {
  oa.copy(da).normalize()
  ob.copy(db).addScaledVector(oa, -db.dot(oa)).normalize()
  mWant.makeBasis(oa, ob, oc.crossVectors(oa, ob))
  mRest.makeBasis(a, b, new V().crossVectors(a, b)).transpose()
  qWant.setFromRotationMatrix(mWant.multiply(mRest))
  bone.parent!.getWorldQuaternion(qPar)
  bone.quaternion.copy(qPar.invert().multiply(qWant))
  bone.updateMatrixWorld(true)
}

type Wave = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; on: boolean; t0: number; c: THREE.Vector3; hit: boolean; hitR: number; k: number }

const X = new V(1, 0, 0)
const bx = new V(), bz = new V(), basis = new THREE.Matrix4()
// Orient a wave quad: local +y along the travel direction, plane turned to face the camera as much as it can, so a
// wavefront reads as an arc from the side and from the front alike.
const toEye = new V()
function orientArc(m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, eye: THREE.Vector3) {
  const d = new V().subVectors(to, from).normalize()
  toEye.subVectors(eye, from).normalize()
  bz.copy(toEye).addScaledVector(d, -toEye.dot(d))
  if (bz.lengthSq() < 1e-6) bz.copy(X).addScaledVector(d, -X.dot(d))
  bz.normalize()
  bx.crossVectors(d, bz)
  m.quaternion.setFromRotationMatrix(basis.makeBasis(bx, d, bz))
}

export function createExplainer(host: HTMLElement, hooks: Hooks): Controls {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)
  renderer.domElement.style.display = 'block'

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x30302c, 1.5))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(1.2, 2.2, 1.4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.8)
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
  const alu = lam(0xb6b6b6)
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
  flat(0.1, 0.062, null, 0x9c9c9c, 0, 0.062)
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

  // Rigged person: the Xbot mannequin (Mixamo skeleton), seated once on load; the right arm is solved every frame
  type Rig = { bone: (n: string) => THREE.Bone; l1: number; l2: number }
  let rig: Rig | null = null
  let disposed = false
  const HIP = new V(0, 0.55, 0.62)
  const ALONG_R = new V(-1, 0, 0), ALONG_L = new V(1, 0, 0), DOWN = new V(0, -1, 0), UP = new V(0, 1, 0)
  const pA = new V(), pE = new V(), pB = new V(), dU = new V(), dF = new V(), bend = new V()
  const solveArm = (r: Rig, side: 'Left' | 'Right', w: THREE.Vector3, pole: THREE.Vector3, finger: THREE.Vector3, palmN: THREE.Vector3) => {
    const along = side === 'Right' ? ALONG_R : ALONG_L
    const arm = r.bone(side + 'Arm'), fore = r.bone(side + 'ForeArm')
    arm.getWorldPosition(pA)
    solveElbow(pA, w, r.l1, r.l2, pole, pE)
    dU.subVectors(pE, pA).normalize()
    dF.subVectors(w, pE).normalize()
    bend.crossVectors(dU, dF)
    if (bend.lengthSq() < 1e-6) bend.crossVectors(dU, pole)
    orient(arm, along, side === 'Right' ? UP : DOWN, dU, bend)
    fore.getWorldPosition(pB)
    orient(fore, along, DOWN, dF.subVectors(w, pB), palmN)
    orient(r.bone(side + 'Hand'), along, DOWN, finger, palmN)
  }
  new GLTFLoader().load('/models/person/xbot.glb', (gltf) => {
    const root = gltf.scene
    if (disposed) { root.traverse(free); return }
    try {
      const bones = new Map<string, THREE.Bone>()
      const body = new THREE.MeshLambertMaterial({ color: 0xb8b8b6 }), joints = new THREE.MeshLambertMaterial({ color: 0x7a7a78 })
      const old = new Set<THREE.Material>()
      root.traverse((o) => {
        if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o as THREE.Bone)
        const m = o as THREE.SkinnedMesh
        if (m.isMesh) {
          old.add(m.material as THREE.Material)
          m.material = /joint/i.test((m.material as THREE.Material).name) ? joints : body
          m.frustumCulled = false
        }
      })
      for (const mt of old) { (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose() }
      const bone = (n: string) => { const b = bones.get(n); if (!b) throw new Error('xbot: missing bone ' + n); return b }
      root.rotation.y = Math.PI // the model faces +z; turn him to the laptop
      for (const [s, k] of [['Left', 1], ['Right', -1]] as const) {
        bone(s + 'UpLeg').rotation.set(-Math.PI / 2 - 0.04, 0, k * 0.06)
        bone(s + 'Leg').rotation.set(Math.PI / 2 + 0.04 - 0.38, 0, -k * 0.06)
        bone(s + 'Foot').rotation.x = 0.38
      }
      bone('Spine').rotation.x = 0.09
      bone('Spine1').rotation.x = 0.09
      bone('Neck').rotation.x = 0.06
      bone('Head').rotation.x = 0.2
      scene.add(root)
      root.updateMatrixWorld(true)
      root.position.add(HIP.clone().sub(bone('Hips').getWorldPosition(new V())))
      root.updateMatrixWorld(true)
      const at = (n: string) => bone(n).getWorldPosition(new V())
      const r: Rig = { bone, l1: at('RightArm').distanceTo(at('RightForeArm')), l2: at('RightForeArm').distanceTo(at('RightHand')) }
      const lw = new V(-0.25, 0.775, 0.18)
      solveArm(r, 'Left', lw, new V(-0.8, -0.6, 0.4), new V(0.1, 0, -1).normalize(), DOWN)
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
  }, undefined, (e) => console.warn('xbot failed to load; keeping the simple figure', e))

  // Wavefront pool
  const quad = new THREE.PlaneGeometry(2, 2)
  const makeWave = (half: number, dash = 0) => {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new V() }, uAlpha: { value: 0 }, uR: { value: 0 }, uHalf: { value: half }, uScale: { value: 1 }, uDash: { value: dash } },
      vertexShader: arcVert, fragmentShader: arcFrag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(quad, mat)
    mesh.visible = false
    mesh.frustumCulled = false
    scene.add(mesh)
    return { mesh, mat, on: false, t0: 0, c: new V(), hit: false, hitR: 0, k: 0 }
  }
  const outs: Wave[] = Array.from({ length: 24 }, () => makeWave(OUT_HALF))
  const refs: Wave[] = Array.from({ length: 64 }, () => makeWave(REF_HALF, 9)) // echoes are dashed
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
    let curl = 0.12, tilt = 0
    if (g === 0) { out.y += 0.0015 * Math.sin(u * 2.1); out.z += 0.001 * Math.sin(u * 1.3) }
    else if (g === 1) out.z = THREE.MathUtils.lerp(FAR.z, NEAR.z, ss((u - 0.5) / 2.2))
    else if (g === 2) out.z = THREE.MathUtils.lerp(NEAR.z, FAR.z, ss((u - 0.5) / 2.2))
    else if (g === 3) {
      const env = ss(u / 0.4) * ss((4 - u) / 0.4), ph = (2 * Math.PI * u) / 1.3
      out.x += 0.085 * Math.sin(ph) * env
      out.z -= 0.045 * Math.sin(ph) * env
      tilt = -0.35 * Math.cos(ph) * env
    } else curl = 0.12 + 0.88 * (0.5 - 0.5 * Math.cos((2 * Math.PI * u) / 2))
    return { curl, tilt }
  }

  let gi = 0, gu = 0, simT = 0, camT = 0
  let camAz = 1.62, camEl = 0.22, camRad = 1.78
  let paused = false, orbit = true, dither = true
  let blendT = 1
  const blendFrom = new V()
  const Hn = new V(), Hp = new V(), Ht = new V(), wrist = new V(), elbow = new V()
  let curl = 0.12, curlPrev = 0.12, tilt = 0
  let vSm = 0, prevAvg = -1
  let nextEmit = 0

  const Hgoal = new V(), qTilt = new THREE.Quaternion(), eTilt = new THREE.Euler(), fDir = new V(), pN = new V(), mid = new V()
  const placeHand = () => {
    const p = pose(gi, gu, Ht)
    if (blendT < 1) Hgoal.lerpVectors(blendFrom, Ht, ss(blendT)); else Hgoal.copy(Ht)
    curl = p.curl; tilt = p.tilt
    if (rig) {
      // Palm to the laptop, fingers up, rolled by the wave tilt; the echo then reflects off the real palm
      wrist.copy(Hgoal).add(new V(0, -0.055, 0.012))
      qTilt.setFromEuler(eTilt.set(-0.15, 0, tilt))
      fDir.set(0, 1, 0).applyQuaternion(qTilt)
      pN.set(0, 0, -1).applyQuaternion(qTilt)
      solveArm(rig, 'Right', wrist, new V(0.45, -1, 0.35), fDir, pN)
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
        rig.bone('RightHand' + f + '1').rotation.z = curl * 1.1
        rig.bone('RightHand' + f + '2').rotation.z = curl * 1.6
        rig.bone('RightHand' + f + '3').rotation.z = curl * 1.2
      }
      rig.bone('RightHandThumb1').rotation.set(0, -curl * 0.5, curl * 0.3)
      rig.bone('RightHandThumb2').rotation.z = curl * 0.6
      rig.bone('RightHandThumb3').rotation.z = curl * 0.6
      const h = rig.bone('RightHand')
      h.updateMatrixWorld(true)
      h.getWorldPosition(Hn)
      Hn.lerp(rig.bone('RightHandMiddle1').getWorldPosition(mid), 0.55)
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

  const drawWaves = () => {
    for (const w of outs) {
      if (!w.on) { w.mesh.visible = false; continue }
      const r = CV * (simT - w.t0)
      let a = 0.75 * ss(r / 0.03)
      if (w.hit) a *= clamp01(1 - (r - w.hitR) / 0.03)
      if (a <= 0 || r > 1.5) { w.on = false; w.mesh.visible = false; continue }
      w.mesh.visible = true
      w.mesh.position.copy(S)
      orientArc(w.mesh, S, Hn, camera.position)
      w.mesh.scale.setScalar(r + 0.02)
      w.mat.uniforms.uScale.value = r + 0.02
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
      orientArc(w.mesh, w.c, M, camera.position)
      w.mesh.scale.setScalar(r + 0.02)
      w.mat.uniforms.uScale.value = r + 0.02
      w.mat.uniforms.uR.value = r
      const k = 0.5 + 0.5 * w.k
      w.mat.uniforms.uColor.value.lerpVectors(dimRef, brightRef, k)
      w.mat.uniforms.uAlpha.value = (0.45 + 0.55 * k) * ss(r / 0.02) * clamp01((dist - r) / 0.04)
    }
  }

  const target = new V(0.03, 0.88, 0.1)
  const sideTarget = target.clone(), frontTarget = new V(0.03, 0.82, 0.32)
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
    // WAVE: swing round to face the person from slightly above, then pan left and right with the hand so the
    // wavefronts can be followed; every other gesture keeps the slow side orbit.
    const waving = gi === 3
    const azGoal = waving ? Math.PI + 0.32 * Math.sin((gu * 2 * Math.PI) / 4) : 1.62 + 0.38 * Math.sin((camT * 2 * Math.PI) / 40)
    const elGoal = waving ? 0.78 : 0.22, radGoal = waving ? 2.05 : 1.78
    const kCam = Math.min(1, dt * 2.2)
    camAz += (azGoal - camAz) * kCam; camEl += (elGoal - camEl) * kCam; camRad += (radGoal - camRad) * kCam
    const az = camAz, el = camEl, rad = camRad
    target.lerp(waving ? frontTarget : sideTarget, kCam)
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
