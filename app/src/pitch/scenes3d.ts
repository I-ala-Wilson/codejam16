import * as THREE from 'three'
import { DH, DW, type Scene } from '../hwb/DitherCanvas.tsx'

// 3D versions of the "Why not a camera" tiles: small lit three.js scenes rendered at low resolution, then ordered-
// dithered by DitherCanvas exactly like the flower and the explainer. Labels stay crisp in the overlay.

const INK = '#f2f2f0'
const WHITE = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 })
const GREY = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.6 })
const DARK = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7 })

type Build = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void; anchors?: Record<string, THREE.Object3D> }
type At = (name: string, dy?: number) => [number, number]

function make3D(build: () => Build, overlay: (g: CanvasRenderingContext2D, at: At) => void): Scene {
  let r: { renderer: THREE.WebGLRenderer; b: Build } | null = null
  return {
    draw(g, t) {
      if (!r) {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
        renderer.setSize(480, 240, false)
        renderer.setClearColor(0x000000, 1)
        r = { renderer, b: build() }
      }
      r.b.update(t)
      r.renderer.render(r.b.scene, r.b.camera)
      g.drawImage(r.renderer.domElement, 0, 0, DW, DH)
    },
    overlay(g) {
      if (!r) return
      const b = r.b, v = new THREE.Vector3()
      // labels follow the 3D objects: project the anchor into the 640 x 320 design space
      const at: At = (name, dy = 0) => {
        b.anchors![name].getWorldPosition(v).project(b.camera)
        return [(v.x + 1) / 2 * DW, (1 - v.y) / 2 * DH + dy]
      }
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

const cam = () => { const c = new THREE.PerspectiveCamera(30, DW / DH, 0.1, 100); c.position.set(0, 1.1, 6.6); c.lookAt(0, 0, 0); return c }

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
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), DARK); screen.position.set(0, 0.65, 0.03); hinge.add(screen)
  hinge.rotation.x = -(open - Math.PI / 2)
  return g
}

/** Expanding sound shells: thin rings that grow outward from a point and fade, like the explainer's waves. */
function shells(n: number, dir: THREE.Vector3): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group()
  const rings: THREE.Mesh[] = []
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.022, 6, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }))
    m.lookAt(dir)
    group.add(m); rings.push(m)
  }
  return {
    group,
    update(t) {
      rings.forEach((m, i) => {
        const p = (t * 0.55 + i / n) % 1
        m.scale.setScalar(0.2 + p * 1.4)
        ;(m.material as THREE.MeshBasicMaterial).opacity = 1 - p
      })
    },
  }
}

export const costTile3D = make3D(() => {
  const scene = stage(), camera = cam()
  const rig = new THREE.Group(); rig.position.set(-1.9, 0.6, 0)
  const vc = videoCamera(); vc.scale.setScalar(0.9); rig.add(vc); rig.add(tripod()); scene.add(rig)
  const lap = laptop(); lap.position.set(1.9, -1.2, 0); lap.scale.setScalar(1.05); scene.add(lap)
  return {
    scene, camera, anchors: { rig: vc, lap },
    update(t) {
      rig.rotation.y = -0.6 + Math.sin(t * 0.6) * 0.35
      lap.rotation.y = -0.5 + Math.sin(t * 0.6 + 1) * 0.3
    },
  }
}, (g, at) => {
  const [cx, cy] = at('rig'), [lx] = at('lap')
  chip(g, '$$$', cx, cy - 72); chip(g, '$0', lx, 38)
  label(g, 'CAMERA / LIDAR', cx, 312); label(g, 'YOUR LAPTOP', lx, 312)
})

export const privacyTile3D = make3D(() => {
  // the universal no-cameras sign: one large camera, turning, inside a prohibition circle
  const scene = stage(), camera = cam()
  const vc = videoCamera(); vc.scale.setScalar(1.25); vc.position.set(-0.3, 0.05, 0); scene.add(vc)
  return {
    scene, camera, anchors: { vc },
    update(t) { vc.rotation.y = -0.5 + Math.sin(t * 0.6) * 0.6 },
  }
}, (g) => {
  noSign(g, DW / 2, 150, 118)
  label(g, 'NOT ALLOWED IN BATHROOMS', DW / 2, 300)
})

export const darkTile3D = make3D(() => {
  // the room is dark: the laptop is barely lit, and only its sound is bright
  const scene = stage(0.35), camera = cam()
  const lap = laptop(); lap.scale.setScalar(1.05); lap.position.set(0.3, -1.1, 0); scene.add(lap)
  const s = shells(3, new THREE.Vector3(0, 1.1, 6.6)); s.group.position.set(0.3, -0.15, 0.2); scene.add(s.group)
  return {
    scene, camera, anchors: { lap },
    update(t) {
      s.update(t)
      lap.rotation.y = -0.35 + Math.sin(t * 0.4) * 0.2
    },
  }
}, (g, at) => {
  const [lx] = at('lap')
  moon(g, 110, 70, 30)
  label(g, 'LIGHTS OFF, STILL LISTENING', lx, 312)
})

function label(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(s, x, y)
}
function chip(g: CanvasRenderingContext2D, s: string, x: number, y: number) {
  g.font = '26px VT323, monospace'
  const w = g.measureText(s).width + 14
  g.fillStyle = INK; g.fillRect(x - w / 2, y - 14, w, 28)
  g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y + 0.5)
}
function moon(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = INK; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#000'; g.beginPath(); g.arc(x + r * 0.45, y - r * 0.25, r * 0.9, 0, Math.PI * 2); g.fill()
}
function noSign(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.strokeStyle = INK; g.lineWidth = 9
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke()
  const a = Math.PI / 4
  g.beginPath(); g.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.stroke()
}
