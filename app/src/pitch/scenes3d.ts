import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DH, DW, type Scene } from '../hwb/DitherCanvas.tsx'
import { habitScene } from './scenes.ts'

// 3D versions of the "Why not a camera" tiles: small lit three.js scenes rendered at low resolution, then ordered-
// dithered by DitherCanvas exactly like the flower and the explainer. Labels stay crisp in the overlay.

const INK = '#f2f2f0'
const WHITE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 })
const GREY = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7 })
const SCREEN = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x6a6a6a, roughness: 0.3 })

type Build = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void; anchors?: Record<string, THREE.Object3D> }
type At = (name: string, dy?: number) => [number, number]

// ONE WebGL context for every tile: each draw renders and is copied out immediately, so the tiles take turns.
// Separate contexts (plus dev hot reloads) pushed Chrome past its context limit and it killed the 3D explainer.
let renderer: THREE.WebGLRenderer | null = null
function shared(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
    renderer.setSize(640, 320, false)
    renderer.setClearColor(0x000000, 1)
  }
  return renderer
}
if (import.meta.hot) import.meta.hot.dispose(() => { renderer?.dispose(); renderer?.forceContextLoss(); renderer = null })

function make3D(
  build: () => Build,
  overlay: (g: CanvasRenderingContext2D, at: At) => void,
  paint?: (g: CanvasRenderingContext2D, at: At, t: number) => void,
): Scene {
  let r: { b: Build } | null = null
  const v = new THREE.Vector3()
  // anchors are projected into DitherCanvas's 640 x 320 design space, so 2D marks follow the 3D objects
  const at: At = (name, dy = 0) => {
    r!.b.anchors![name].getWorldPosition(v).project(r!.b.camera)
    return [(v.x + 1) / 2 * DW, (1 - v.y) / 2 * DH + dy]
  }
  return {
    draw(g, t) {
      if (!r) r = { b: build() }
      const renderer = shared()
      r.b.update(t)
      renderer.render(r.b.scene, r.b.camera)
      g.drawImage(renderer.domElement, 0, 0, DW, DH)
      paint?.(g, at, t)
    },
    overlay(g) {
      if (!r) return
      overlay(g, at)
    },
  }
}

function stage(light = 1): Build['scene'] {
  const s = new THREE.Scene()
  s.add(new THREE.AmbientLight(0xffffff, 0.12 * light))
  const key = new THREE.DirectionalLight(0xffffff, 2.4 * light); key.position.set(3, 5, 4); s.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.9 * light); rim.position.set(-4, 2, -3); s.add(rim)
  return s
}

const cam = () => { const c = new THREE.PerspectiveCamera(30, DW / DH, 0.1, 100); c.position.set(0, 1.1, 7.6); c.lookAt(0, -0.1, 0); return c }

function videoCamera(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.7), WHITE); g.add(body)
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.5, 28), GREY); lens.rotation.z = Math.PI / 2; lens.position.x = 0.85; g.add(lens)
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.25, 28), DARK); glass.rotation.y = Math.PI / 2; glass.position.x = 1.11; g.add(glass)
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.35), GREY); top.position.set(-0.25, 0.52, 0); g.add(top)
  return g
}

function tripod(): THREE.Group {
  const g = new THREE.Group()
  const L = 1.9, spread = 0.75
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5
    const top = new THREE.Vector3(0, -0.4, 0), foot = new THREE.Vector3(Math.cos(a) * spread, -0.4 - L, Math.sin(a) * spread)
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, top.distanceTo(foot), 8), GREY)
    leg.position.copy(top).add(foot).multiplyScalar(0.5)
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize())
    g.add(leg)
  }
  return g
}

function laptop(open = 1.85): THREE.Group {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 1.35), WHITE); g.add(base)
  const keys = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.01, 0.75), GREY); keys.position.set(0, 0.045, -0.15); g.add(keys)
  const hinge = new THREE.Group(); hinge.position.set(0, 0.04, -0.67); g.add(hinge)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 0.05), WHITE); lid.position.y = 0.65; hinge.add(lid)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), SCREEN); screen.position.set(0, 0.65, 0.03); hinge.add(screen)
  hinge.rotation.x = -(open - Math.PI / 2)
  return g
}

export const costTile3D = make3D(() => {
  const scene = stage(), camera = cam()
  const rig = new THREE.Group(); rig.position.set(-1.9, 0.6, 0)
  const vc = videoCamera(); vc.scale.setScalar(0.9); rig.add(vc); rig.add(tripod()); scene.add(rig)
  const lap = laptop(); lap.position.set(1.9, -1.2, 0); lap.scale.setScalar(1.05); scene.add(lap)
  const lid = new THREE.Object3D(); lid.position.set(0, 1.35, -0.85); lap.add(lid) // top centre of the screen
  return {
    scene, camera, anchors: { rig: vc, lap, lid },
    update(t) {
      rig.rotation.y = -0.6 + Math.sin(t * 0.35) * 0.25
      lap.rotation.y = -0.5 + Math.sin(t * 0.35 + 1) * 0.2
    },
  }
}, (g, at) => {
  // prices stay crisp on top of the dither so they read at a glance
  const [cx, cy] = at('rig'), [lx, ly] = at('lid')
  price(g, '$$$', cx, cy - 78); price(g, '$0', lx, ly - 28)
})

export const privacyTile3D = make3D(() => {
  // the universal no-cameras sign: one large camera, turning, inside a prohibition circle
  const scene = stage(), camera = cam()
  const vc = videoCamera(); vc.scale.setScalar(1.25); vc.position.set(-0.3, 0.05, 0); scene.add(vc)
  return {
    scene, camera, anchors: { vc },
    update(t) { vc.rotation.y = -0.5 + Math.sin(t * 0.35) * 0.45 },
  }
}, () => {}, (g) => {
  noSign(g, DW / 2, 160, 118)
})

export const darkTile3D = make3D(() => {
  // a dark room: the laptop is lit only by its own screen and a faint key light; the sound is the brightest thing
  const scene = stage(0.6), camera = cam()
  const lap = laptop(); lap.scale.setScalar(1.15); lap.position.set(0.55, -1.05, 0); scene.add(lap)
  const glow = new THREE.PointLight(0xffffff, 6, 4); glow.position.set(0.55, -0.2, 0.9); scene.add(glow)
  const screen = new THREE.Object3D(); screen.position.set(0, 0.75, -0.55); lap.add(screen)
  return {
    scene, camera, anchors: { lap, screen },
    update(t) { lap.rotation.y = -0.75 + Math.sin(t * 0.4) * 0.18 },
  }
}, () => {}, (g, at, t) => {
  softMoon(g, 120, 78, 34)
  // sound leaving the screen: thin arcs fanning toward the viewer, fading as they travel, like the flower's waves
  const [sx, sy] = at('screen')
  g.lineCap = 'round'
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.45 + i / 4) % 1
    const rad = 30 + p * 150
    const a = 1 - p
    g.strokeStyle = `rgba(255,255,255,${(a * a * 0.9).toFixed(3)})`
    g.lineWidth = 2.2
    g.beginPath(); g.arc(sx, sy, rad, Math.PI * 1.08, Math.PI * 1.92); g.stroke()
  }
})

function price(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '40px VT323, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(s, x, y)
}
const scratchingHand = make3D(() => {
  const scene = stage(), camera = cam()
  camera.position.set(0, 3.9, 5.9)
  camera.lookAt(0, 0, 0)
  const lap = laptop()
  lap.scale.setScalar(0.85)
  lap.position.set(-2.45, -0.55, -0.95)
  lap.rotation.y = 0.6
  scene.add(lap)

  // Partial rings leave the hand visible as each pulse crosses the gap.
  const waveShape = new THREE.TorusGeometry(1, 0.045, 8, 40, Math.PI * 1.2)
  const waves = Array.from({ length: 3 }, () => {
    const wave = new THREE.Mesh(waveShape, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false,
    }))
    wave.rotation.set(0, 1.02, -Math.PI * 0.6)
    scene.add(wave)
    return wave
  })

  const sphere = new THREE.SphereGeometry(1, 32, 20)
  function oval(parent: THREE.Object3D, material: THREE.Material, position: number[], scale: number[]) {
    const part = new THREE.Mesh(sphere, material)
    part.position.fromArray(position); part.scale.fromArray(scale)
    parent.add(part)
    return part
  }
  const arm = new THREE.Group()
  arm.position.set(1, -0.5, 0)
  arm.rotation.y = 0.34
  scene.add(arm)
  oval(arm, GREY, [0.28, 0, 0], [1.26, 0.35, 0.43])
  oval(arm, DARK, [1.3, 0, 0], [0.8, 0.39, 0.47])
  const restingHand = new THREE.Group()
  restingHand.position.set(-0.85, 0.01, 0)
  restingHand.rotation.x = 0.48
  arm.add(restingHand)
  oval(restingHand, new THREE.MeshBasicMaterial({ color: 0xffffff }), [0, 0, 0], [0.4, 0.17, 0.24])
  // Cross sections widen from the heel to the knuckles, with a shallow crown on the back.
  function palm(parent: THREE.Group) {
    const shape = new THREE.Shape()
    shape.moveTo(0.16, -0.16)
    shape.bezierCurveTo(-0.06, -0.19, -0.30, -0.40, -0.69, -0.35)
    shape.quadraticCurveTo(-0.96, -0.05, -0.82, 0.33)
    shape.bezierCurveTo(-0.55, 0.40, -0.25, 0.29, 0.16, 0.15)
    shape.closePath()
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
      depth: 0.09, bevelEnabled: true, bevelSize: 0.055, bevelThickness: 0.055, bevelSegments: 3,
    }), WHITE)
    mesh.rotation.x = Math.PI / 2
    mesh.position.y = 0.05
    parent.add(mesh)
  }
  palm(restingHand)
  for (const [i, length] of [0.58, 0.76, 0.82, 0.72].entries()) {
    const z = (i - 1.5) * 0.195
    const spread = z * 0.53
    const root = -0.83 + Math.abs(z - 0.08) * 0.35
    finger(restingHand, [[root, 0, z], [root - length * 0.50, 0.015, z + spread * 0.55],
      [root - length, -0.065, z + spread]], i === 0 ? 0.066 : 0.075)
  }
  finger(restingHand, [[-0.17, 0, 0.18], [-0.35, -0.01, 0.37], [-0.55, -0.03, 0.55], [-0.74, -0.055, 0.60]], 0.09)

  const hand = new THREE.Group()
  scene.add(hand)
  oval(hand, WHITE, [0.18, 0.37, 0], [0.52, 0.18, 0.39])
  oval(hand, GREY, [0.85, 0.59, -0.04], [0.65, 0.19, 0.22]).rotation.z = 0.32
  function finger(parent: THREE.Group, points: number[][], radius: number) {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3().fromArray(p)))
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(path, 18, radius, 10, false), WHITE))
    oval(parent, WHITE, points[points.length - 1], [radius, radius, radius])
  }
  for (const [i, length] of [0.86, 0.92, 0.82, 0.66].entries()) {
    const z = 0.22 - i * 0.15
    finger(hand, [[-0.08, 0.39, z], [-length * 0.65, 0.41, z], [-length, 0.23, z], [-length + 0.09, 0.02, z]], 0.069)
  }
  finger(hand, [[0.32, 0.36, 0.18], [0.12, 0.30, 0.32], [-0.12, 0.22, 0.39], [-0.25, 0.20, 0.36]], 0.085)
  return { scene, camera, update(t) {
    const pause = Math.min(1, Math.max(0, (t % 5 - 2.2) * 4), Math.max(0, (4.7 - t % 5) * 3))
    hand.position.set(1.18 + 0.23 * Math.sin(t * 15) * (1 - pause), -0.13 + 0.57 * pause, 0.02)
    hand.rotation.y = -0.4
      waves.forEach((wave, i) => {
        const progress = (t * 0.55 + i / waves.length) % 1
        wave.position.set(-1.88 + progress * 1.65, -0.26 + progress * 0.16, -0.66 + progress * 0.53)
        wave.scale.setScalar(0.22 + progress * 0.53)
        wave.material.opacity = Math.min(1, progress * 12, (1 - progress) * 5)
      })
  } }
}, () => {})

let habitWebGL = true
export const habitScene3D: Scene = {
  draw(g, t) {
    if (habitWebGL) {
      try { scratchingHand.draw(g, t); return } catch { habitWebGL = false }
    }
    habitScene.draw(g, t)
  },
  overlay(g, t) {
    if (!habitWebGL) { habitScene.overlay?.(g, t); return }
    if (t % 5 > 2.2 && t % 5 < 4.2) chip(g, 'Hands down for a moment.', DW / 2, 295)
  },
}

function label(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(s, x, y)
}
function chip(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'
  const w = g.measureText(s).width + 14
  g.fillStyle = INK; g.fillRect(x - w / 2, y - 14, w, 28)
  g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y + 0.5)
}
function softMoon(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const halo = g.createRadialGradient(x, y, r * 0.6, x, y, r * 2.4)
  halo.addColorStop(0, 'rgba(255,255,255,0.22)'); halo.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.4, 0, Math.PI * 2); g.fill()
  const body = g.createRadialGradient(x - r * 0.35, y - r * 0.3, r * 0.1, x, y, r)
  body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#9a9a9a')
  g.fillStyle = body; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  const shade = g.createRadialGradient(x + r * 0.5, y - r * 0.2, r * 0.6, x + r * 0.5, y - r * 0.2, r * 1.05)
  shade.addColorStop(0, '#000000'); shade.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = shade; g.beginPath(); g.arc(x + r * 0.5, y - r * 0.2, r * 1.05, 0, Math.PI * 2); g.fill()
}
function noSign(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 12
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
  const a = Math.PI / 4
  g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke()
}

// ---------- Care: the explainer's mannequin reclined in a hospital bed; HELP (wave) then PAIN (open/close) ----------
// Timeline (s): wave 0-4, pulse laptop -> phone 4-4.8, HELP 4.8-5.9; open/close 5.6-9.6, pulse 9.6-10.4, PAIN 10.4-11.5.
const CARE_T = 11.5
const careAt = (t: number) => t % CARE_T
const careWave = (u: number) => u < 4.2
const careCall = (u: number): 'HELP' | 'PAIN' | null => (u >= 4.8 && u < 5.9 ? 'HELP' : u >= 10.4 ? 'PAIN' : null)
const carePulse = (u: number): number | null => (u >= 4 && u < 4.8 ? (u - 4) / 0.8 : u >= 9.6 && u < 10.4 ? (u - 9.6) / 0.8 : null)
let careT = 0 // the scene clock, shared with the overlay (which gets no time argument)

// Small copies of the explainer's rig helpers (app/src/explainer/scene.ts): two-bone IK and "turn a bone so its rest
// directions point along new ones", working from each bone's rest world rotation.
const V3 = THREE.Vector3
function ikElbow(a: THREE.Vector3, t: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  const d = new V3().subVectors(t, a)
  const len = Math.min(Math.max(d.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3)
  d.normalize()
  const cosA = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA))
  const perp = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d))).normalize()
  return out.copy(a).addScaledVector(d, l1 * cosA).addScaledVector(perp, l1 * sinA)
}
function setWorldQ(bone: THREE.Object3D, q0: THREE.Quaternion, d: THREE.Quaternion) {
  const want = d.clone().multiply(q0), par = new THREE.Quaternion()
  bone.parent!.getWorldQuaternion(par)
  bone.quaternion.copy(par.invert().multiply(want))
  bone.updateMatrixWorld(true)
}
function aim(bone: THREE.Object3D, q0: THREE.Quaternion, a: THREE.Vector3, b: THREE.Vector3, da: THREE.Vector3, db: THREE.Vector3) {
  const x = da.clone().normalize(), y = db.clone().addScaledVector(x, -db.dot(x)).normalize()
  const want = new THREE.Matrix4().makeBasis(x, y, new V3().crossVectors(x, y))
  const rest = new THREE.Matrix4().makeBasis(a, b, new V3().crossVectors(a, b)).transpose()
  setWorldQ(bone, q0, new THREE.Quaternion().setFromRotationMatrix(want.multiply(rest)))
}
const perpTo = (v: THREE.Vector3, along: THREE.Vector3) => v.clone().addScaledVector(along, -v.dot(along)).normalize()

const SOFT = (hex: number) => new THREE.MeshLambertMaterial({ color: hex })
const PHONE_GLOW = new THREE.MeshBasicMaterial({ color: 0x0a0a0a })

export const careScene3D = make3D(() => {
  // softer, darker lighting than the camera tiles, like the explainer
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x101010, 0.35))
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-2, 4, 3); scene.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.45); rim.position.set(3, 2, -3); scene.add(rim)
  const camera = new THREE.PerspectiveCamera(27, DW / DH, 0.05, 50)
  camera.position.set(-2.55, 1.85, 2.75); camera.lookAt(-0.25, 0.68, 0.05)

  // bed along +z (head at -z), low contrast: dark frame, mid-grey mattress, soft rounded pillows and blanket
  const bedMat = SOFT(0x2c2c2c), sheet = SOFT(0x444444), soft = SOFT(0x555555)
  const MT = 0.58 // mattress top
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 2.1), bedMat); frame.position.set(0, 0.36, 0); scene.add(frame)
  const headboard = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.05), bedMat); headboard.position.set(0, 0.7, -1.07); scene.add(headboard)
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 2.0), sheet); mattress.position.set(0, MT - 0.08, 0); scene.add(mattress)
  const pillow = (z: number, y: number, r: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), soft); m.scale.set(0.36, 0.1, 0.2); m.position.set(0, y, z); m.rotation.x = r; scene.add(m)
  }
  pillow(-0.92, MT + 0.12, 0.2); pillow(-0.78, MT + 0.3, 0.9)
  const blanket = new THREE.Mesh(new THREE.CapsuleGeometry(1, 2, 8, 24), soft)
  blanket.rotation.x = Math.PI / 2; blanket.scale.set(0.36, 0.38, 0.2); blanket.position.set(0, MT + 0.09, 0.5); scene.add(blanket)

  // bedside table with the laptop (the patient's right), caregiver phone further out
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 0.45), bedMat); table.position.set(-0.85, 0.28, -0.55); scene.add(table)
  const lap = laptop(); lap.scale.setScalar(0.17); lap.position.set(-0.85, 0.565, -0.55); lap.rotation.y = Math.PI * 0.62; scene.add(lap)
  const lapScreen = new THREE.Object3D(); lapScreen.position.set(0, 0.75, -0.6); lap.add(lapScreen)
  const phone = new THREE.Group(); phone.position.set(1.25, 0.05, 0.75); scene.add(phone); phone.lookAt(camera.position)
  phone.add(new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.5, 0.03), new THREE.MeshBasicMaterial({ color: 0xf2f2f0 })))
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.42), PHONE_GLOW); glass.position.z = 0.017; phone.add(glass)
  const handAnchor = new THREE.Object3D(); handAnchor.position.set(-0.3, MT + 0.5, -0.2); scene.add(handAnchor)

  // the explainer's rigged mannequin, reclined about 35 degrees on the pillows, legs straight under the blanket
  type Rig = { bone: (n: string) => THREE.Bone; q0: (n: string) => THREE.Quaternion; l1: number; l2: number; up: THREE.Vector3; fore: THREE.Vector3; hand: THREE.Vector3; palm: THREE.Vector3; curl: { b: THREE.Bone; q: THREE.Quaternion; axis: THREE.Vector3; k: number }[] }
  let rig: Rig | null = null
  new GLTFLoader().load('/models/person/guy.glb', (gltf) => {
    const root = gltf.scene, bones = new Map<string, THREE.Bone>()
    const body = new THREE.MeshLambertMaterial({ color: 0xd2d2d0 })
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/^mixamorig:?/, ''), o as THREE.Bone)
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      if (/^(EyeLeft|EyeRight|Wolf3D_Teeth|Wolf3D_Beard|Wolf3D_Headwear)$/.test(m.name)) m.visible = false
      ;(m.material as THREE.Material).dispose(); m.material = body; m.frustumCulled = false
    })
    const bone = (n: string) => { const b = bones.get(n); if (!b) throw new Error('guy.glb: missing bone ' + n); return b }
    const at = (n: string) => bone(n).getWorldPosition(new V3())
    scene.add(root)
    root.rotation.x = -(55 * Math.PI) / 180 // upright -> reclined 35 degrees above the mattress, facing up the bed
    root.updateMatrixWorld(true)
    root.position.add(new V3(0, MT + 0.1, -0.35).sub(at('Hips')))
    root.updateMatrixWorld(true)
    const rest = new Map<string, THREE.Quaternion>()
    for (const [n, b] of bones) rest.set(n, b.getWorldQuaternion(new THREE.Quaternion()))
    const q0 = (n: string) => rest.get(n)!
    const dir = (a: string, b: string) => at(b).sub(at(a)).normalize()
    const X = new V3(1, 0, 0)
    // legs straight along the bed, under the blanket
    for (const s of ['Left', 'Right']) {
      const thigh = dir(s + 'UpLeg', s + 'Leg'), shin = dir(s + 'Leg', s + 'Foot'), toe = dir(s + 'Foot', s + 'ToeBase')
      aim(bone(s + 'UpLeg'), q0(s + 'UpLeg'), thigh, perpTo(X, thigh), new V3(s === 'Left' ? 0.04 : -0.04, -0.06, 1).normalize(), X)
      aim(bone(s + 'Leg'), q0(s + 'Leg'), shin, perpTo(X, shin), new V3(0, -0.05, 1).normalize(), X)
      aim(bone(s + 'Foot'), q0(s + 'Foot'), toe, perpTo(X, toe), new V3(0, 0.3, 1).normalize(), X) // relaxed: toes along the bed, not up
    }
    // left arm resting on the blanket
    const lUp = dir('LeftArm', 'LeftForeArm'), lFore = dir('LeftForeArm', 'LeftHand')
    aim(bone('LeftArm'), q0('LeftArm'), lUp, perpTo(X, lUp), new V3(0.15, -0.75, 0.6).normalize(), X)
    aim(bone('LeftForeArm'), q0('LeftForeArm'), lFore, perpTo(X, lFore), new V3(-0.15, -0.25, 1).normalize(), X)
    root.updateMatrixWorld(true)
    const up = dir('RightArm', 'RightForeArm'), hand = dir('RightHand', 'RightHandMiddle1')
    const across = at('RightHandIndex1').sub(at('RightHandPinky1'))
    const palm = new V3().crossVectors(hand, across).multiplyScalar(-1).normalize()
    const r: Rig = { bone, q0, l1: at('RightArm').distanceTo(at('RightForeArm')), l2: at('RightForeArm').distanceTo(at('RightHand')), up, fore: dir('RightForeArm', 'RightHand'), hand, palm, curl: [] }
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let i = 0; i < 3; i++) {
      const n = 'RightHand' + f + (i + 1)
      const axis = new V3().crossVectors(dir(n, 'RightHand' + f + (i + 2)), palm).normalize().applyQuaternion(q0(n).clone().invert())
      r.curl.push({ b: bone(n), q: bone(n).quaternion.clone(), axis, k: [1.3, 1.5, 1.0][i] })
    }
    rig = r
  }, undefined, (e) => console.warn('guy.glb failed to load for the Care scene', e))

  const w = new V3(), pA = new V3(), pE = new V3(), pB = new V3(), tmp = new V3()
  const ease = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u) }
  return {
    scene, camera, anchors: { hand: handAnchor, lapScreen, glass, phone },
    update(t) {
      careT = t
      const u = careAt(t)
      PHONE_GLOW.color.setScalar(careCall(u) ? 1 : 0.04)
      const r = rig
      if (!r) return
      const sh = r.bone('RightArm').getWorldPosition(pA)
      // The patient has a weak arm (the stat beside this scene), so the arm never lifts: the forearm rests on the
      // blanket and only the hand moves. HELP is a small wave from the wrist, PAIN is the fingers opening and closing.
      const restW = tmp.set(sh.x - 0.12, MT + 0.14, sh.z + 0.42)
      let k = 0, curl = 0.15
      const pole = new V3(-0.4, -1, 0.3)
      if (careWave(u)) k = ease(u / 0.6) * (1 - ease((u - 3.6) / 0.6))
      else {
        const v = u - 5.6; k = ease(v / 0.6) * (1 - ease((v - 3.6) / 0.6))
        curl = v > 0 && v < 4 ? 0.12 + 0.85 * k * (0.5 - 0.5 * Math.cos(Math.max(0, v - 0.6) * Math.PI * 2 / 1.0)) : 0.15
      }
      w.copy(restW)
      ikElbow(sh, w, r.l1, r.l2, pole, pE)
      const dU = new V3().subVectors(pE, sh).normalize(), dF = new V3().subVectors(w, pE).normalize()
      const lift = careWave(u) ? k : 0
      // wave: the hand tips up at the wrist and sways side to side; otherwise it lies flat along the forearm
      const fingers = dF.clone().lerp(new V3(0, 1, 0), 0.75 * lift).addScaledVector(new V3(0, 0, 1), Math.sin(u * 5.5) * 0.55 * lift).normalize()
      const palmN = new V3(0, 1, 0).lerp(new V3(-0.9, 0, 0.3), lift).normalize()
      const bend = new V3().crossVectors(dU, dF); if (bend.lengthSq() < 1e-6) bend.copy(pole)
      aim(r.bone('RightArm'), r.q0('RightArm'), r.up, perpTo(new V3().crossVectors(r.up, r.palm), r.up), dU, bend)
      r.bone('RightForeArm').getWorldPosition(pB)
      aim(r.bone('RightForeArm'), r.q0('RightForeArm'), r.fore, perpTo(r.palm, r.fore), dF.clone().subVectors(w, pB), palmN)
      aim(r.bone('RightHand'), r.q0('RightHand'), r.hand, perpTo(r.palm, r.hand), fingers, palmN)
      for (const c of r.curl) c.b.quaternion.copy(c.q).multiply(new THREE.Quaternion().setFromAxisAngle(c.axis, c.k * curl))
      r.bone('RightHand').getWorldPosition(handAnchor.position)
    },
  }
}, (g, at) => {
  const call = careCall(careAt(careT))
  const [px, py] = at('glass'), [qx, qy] = at('phone')
  if (call) chip(g, call, px, py)
  label(g, 'CAREGIVER', Math.min(qx, DW - 70), qy + 74)
}, (g, at, t) => {
  const u = careAt(t)
  const [hx, hy] = at('hand'), [lx, ly] = at('lapScreen'), [px, py] = at('glass')
  g.lineCap = 'round'
  // faint, thin arcs from the moving hand to the laptop while a gesture is under way
  if ((u > 0.6 && u < 4) || (u > 6.2 && u < 9.6)) {
    const dir = Math.atan2(ly - hy, lx - hx), d = Math.hypot(lx - hx, ly - hy)
    for (let i = 0; i < 3; i++) {
      const p = (u * 0.8 + i / 3) % 1
      g.strokeStyle = `rgba(255,255,255,${(0.18 + (1 - p) * 0.3).toFixed(3)})`; g.lineWidth = 1.4
      g.beginPath(); g.arc(hx, hy, 10 + p * (d - 10), dir - 0.35, dir + 0.35); g.stroke()
    }
  }
  // the event leaves ECHØ as a radio signal: arcs ripple out of the laptop, then a sine-wave packet travels in a
  // straight line to the phone; the phone lights only when it arrives
  const dx = px - lx, dy = py - ly, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.2
  g.setLineDash([3, 6]); g.beginPath(); g.moveTo(lx, ly); g.lineTo(px, py); g.stroke(); g.setLineDash([])
  const p = carePulse(u)
  if (p !== null) {
    const toward = Math.atan2(dy, dx)
    for (let k = 0; k < 3; k++) {
      const q = p * 1.8 - k * 0.2
      if (q <= 0 || q >= 1) continue
      g.strokeStyle = `rgba(255,255,255,${(0.8 * (1 - q)).toFixed(3)})`; g.lineWidth = 2
      g.beginPath(); g.arc(lx, ly, 8 + q * 46, toward - 0.6, toward + 0.6); g.stroke()
    }
    // the packet: a short sine wave whose envelope rises and falls, moving along the line
    const head = p * len, span = 70
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.2
    g.beginPath()
    for (let sx = Math.max(0, head - span); sx <= Math.min(len, head); sx += 1.5) {
      const e = Math.sin(((sx - (head - span)) / span) * Math.PI)
      const amp = 7 * e * e
      const off = Math.sin((sx - t * 260) * 0.32) * amp
      const x = lx + ux * sx + nx * off, y = ly + uy * sx + ny * off
      if (sx === Math.max(0, head - span)) g.moveTo(x, y); else g.lineTo(x, y)
    }
    g.stroke()
  }
})
