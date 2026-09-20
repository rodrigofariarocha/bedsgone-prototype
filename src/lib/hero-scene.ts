/**
 * The hero scene.
 *
 *   1. The pickup drives in from the left and stops.
 *   2. The mattress falls in on a diagonal, standing on edge, catches that edge
 *      on the bed floor and topples flat into the bed.
 *   3. The price card is revealed (`bg:loaded` on window).
 *   4. Scrolling drives the truck off to the right, wheels turning, mattress
 *      riding along with it.
 *
 * Loaded dynamically so three.js never reaches a device that cannot use it.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger, reducedMotion, whenEntered } from './motion';

/* Mattress, in world units. The body group's origin sits on its bottom face. */
const MAT_W = 2.6;
const MAT_D = 1.86;
const GUSSET_H = 0.26;
const TOPPER_H = 0.24;
const MAT_H = GUSSET_H + TOPPER_H;

/* Truck. It faces +X, so it drives in from the left and leaves to the right. */
const TRUCK_LEN = 7.4;
const BED_FROM = -3.45;
const BED_TO = 0.1;
const BED_W = 2.9;
const SIDE_T = 0.15;        // thickness of each body side panel
const ROCKER_Y = 0.78;      // where the body's lower edge sits
const RAIL_Y = 1.32;        // top of the bed sides
const BED_FLOOR_Y = 1.05;
const CAB_FROM = 0.1;
const CAB_TO = 2.45;
const ROOF_Y = 2.58;
const NOSE_X = 3.62;
const BED_CENTER_X = (BED_FROM + BED_TO) / 2;
const WHEEL_R = 0.68;

/** Fires once the mattress is in the bed, so the page can reveal the card. */
export const LOADED_EVENT = 'bg:loaded';


export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Textures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Turns a grayscale height canvas into a tangent-space normal map with a Sobel
 * filter. A real normal map catches light along the quilt seams from every
 * angle, which a bump-map approximation never quite manages.
 */
function heightToNormal(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = height.width;
  const src = height.getContext('2d')!.getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d')!;
  const dst = ctx.createImageData(size, size);

  const at = (x: number, y: number) => {
    const xi = (x + size) % size;
    const yi = (y + size) % size;
    return src[(yi * size + xi) * 4] / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      let nx = dx * strength;
      let ny = dy * strength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;

      const i = (y * size + x) * 4;
      dst.data[i] = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (1 / len) * 255;
      dst.data[i + 3] = 255;
    }
  }

  ctx.putImageData(dst, 0, 0);
  return out;
}

/**
 * Puffed diamond quilting. Every layer is one batched Path2D on purpose: a
 * filtered canvas draw allocates its own surface, so thousands of individually
 * blurred calls will lock the main thread outright.
 */
function quiltHeight(size = 512): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = el.height = size;
  const ctx = el.getContext('2d')!;

  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-size / 2, -size / 2);

  const step = size / 4;
  const from = -step * 2;
  const to = size + step * 2;

  const panels = new Path2D();
  for (let x = from; x < to; x += step) {
    for (let y = from; y < to; y += step) {
      panels.roundRect(x + 8, y + 8, step - 16, step - 16, 22);
    }
  }
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = '#efefef';
  ctx.fill(panels);

  const seams = new Path2D();
  for (let i = from; i < to; i += step) {
    seams.moveTo(i, from);
    seams.lineTo(i, to);
    seams.moveTo(from, i);
    seams.lineTo(to, i);
  }
  ctx.filter = 'blur(4px)';
  ctx.strokeStyle = '#3a3a3a';
  ctx.lineWidth = 5;
  ctx.stroke(seams);

  ctx.filter = 'none';
  const dots = new Path2D();
  for (let i = from; i < to; i += step) {
    for (let t = from; t < to; t += 12) {
      dots.moveTo(i + 1.5, t);
      dots.arc(i, t, 1.5, 0, Math.PI * 2);
      dots.moveTo(t + 1.5, i);
      dots.arc(t, i, 1.5, 0, Math.PI * 2);
    }
  }
  ctx.fillStyle = '#6a6a6a';
  ctx.fill(dots);
  ctx.restore();

  ctx.filter = 'none';
  const grain = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    const v = Math.max(0, Math.min(255, grain.data[i] + n));
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
  }
  ctx.putImageData(grain, 0, 0);

  return el;
}

/** Vertical knit ribbing for the mattress side panel. */
function gussetHeight(): HTMLCanvasElement {
  const w = 256;
  const el = document.createElement('canvas');
  el.width = el.height = w;
  const ctx = el.getContext('2d')!;

  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, w, w);
  ctx.filter = 'blur(2px)';
  for (let x = 0; x < w; x += 6) {
    const grad = ctx.createLinearGradient(x, 0, x + 6, 0);
    grad.addColorStop(0, '#5c5c5c');
    grad.addColorStop(0.5, '#d8d8d8');
    grad.addColorStop(1, '#5c5c5c');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 6, w);
  }
  ctx.filter = 'none';

  const grain = ctx.getImageData(0, 0, w, w);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    const v = Math.max(0, Math.min(255, grain.data[i] + n));
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v;
  }
  ctx.putImageData(grain, 0, 0);
  return el;
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/** A rounded rectangle in the XZ plane, for running piping cord around. */
function roundedRectPath(w: number, d: number, r: number): THREE.CurvePath<THREE.Vector3> {
  const path = new THREE.CurvePath<THREE.Vector3>();
  const hw = w / 2;
  const hd = d / 2;
  const ix = hw - r;
  const iz = hd - r;
  const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

  path.add(new THREE.LineCurve3(v(-ix, -hd), v(ix, -hd)));
  path.add(new THREE.QuadraticBezierCurve3(v(ix, -hd), v(hw, -hd), v(hw, -iz)));
  path.add(new THREE.LineCurve3(v(hw, -iz), v(hw, iz)));
  path.add(new THREE.QuadraticBezierCurve3(v(hw, iz), v(hw, hd), v(ix, hd)));
  path.add(new THREE.LineCurve3(v(ix, hd), v(-ix, hd)));
  path.add(new THREE.QuadraticBezierCurve3(v(-ix, hd), v(-hw, hd), v(-hw, iz)));
  path.add(new THREE.LineCurve3(v(-hw, iz), v(-hw, -iz)));
  path.add(new THREE.QuadraticBezierCurve3(v(-hw, -iz), v(-hw, -hd), v(-ix, -hd)));

  return path;
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                      */
/* -------------------------------------------------------------------------- */

export function buildScene(host: HTMLElement, canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  const scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  const lookTarget = new THREE.Vector3(0, 1.05, 0);
  let baseCamY = 3.1;
  let baseCamZ = 14;
  let halfWidth = 8;

  /* ------------------------------------------------------------- lights */

  scene.add(new THREE.HemisphereLight(0xffffff, 0xffe0c4, 0.5));

  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(5, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.radius = 3;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.03;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -12;
  shadowCam.right = 12;
  shadowCam.top = 12;
  shadowCam.bottom = -12;
  shadowCam.near = 0.5;
  shadowCam.far = 40;
  shadowCam.updateProjectionMatrix();
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffd9bd, 0.55);
  fill.position.set(-8, 3, 6);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(-4, 5, -8);
  scene.add(rim);

  /* ----------------------------------------------------------- materials */

  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  function normalTexture(height: HTMLCanvasElement, strength: number, rx: number, ry: number) {
    const texture = new THREE.CanvasTexture(heightToNormal(height, strength));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(rx, ry);
    texture.anisotropy = anisotropy;
    return texture;
  }

  const topFabric = new THREE.MeshPhysicalMaterial({
    color: 0xfbf9f7,
    roughness: 0.88,
    sheen: 1,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(0xffd8b8),
    normalMap: normalTexture(quiltHeight(), 5.5, 1.15, 1.15),
    normalScale: new THREE.Vector2(1.1, 1.1),
    envMapIntensity: 0.5,
  });

  const sideFabric = new THREE.MeshPhysicalMaterial({
    color: 0xf1ece7,
    roughness: 0.93,
    sheen: 0.85,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xffd8b8),
    normalMap: normalTexture(gussetHeight(), 2.6, 6, 1),
    normalScale: new THREE.Vector2(0.8, 0.8),
    envMapIntensity: 0.35,
  });

  // ACES tone mapping washes bright oranges out, so anything meant to read as
  // the brand orange starts deeper and more saturated than the brand hex.
  const accent = new THREE.MeshPhysicalMaterial({
    color: 0xe24a05,
    roughness: 0.46,
    clearcoat: 0.5,
    clearcoatRoughness: 0.3,
    envMapIntensity: 0.7,
  });

  // The truck is the brand colour and the mattress is white — the other way
  // round, a white mattress inside a white bed simply vanished.
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xe85510,
    roughness: 0.28,
    clearcoat: 0.9,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1,
  });

  /** Bumpers, stripe, lamps and wheel hubs. */
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xf7f4f1,
    roughness: 0.32,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.9,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x1b1512,
    roughness: 0.18,
    metalness: 0.05,
    clearcoat: 0.45,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.55,
  });

  const rubber = new THREE.MeshStandardMaterial({
    color: 0x1c1917,
    roughness: 0.96,
    metalness: 0,
  });

  /** Alloy wheels. Metalness is what separates a rim from a painted disc. */
  const alloy = new THREE.MeshPhysicalMaterial({
    color: 0xd8d4d0,
    roughness: 0.26,
    metalness: 0.92,
    envMapIntensity: 1.5,
  });

  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x3a3532,
    roughness: 0.45,
    metalness: 0.7,
  });

  /** Headlight and indicator lenses — lit from inside, not just light-coloured. */
  const lensClear = new THREE.MeshPhysicalMaterial({
    color: 0xfff6e8,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.5,
    thickness: 0.12,
    emissive: new THREE.Color(0xfff1dc),
    emissiveIntensity: 0.55,
    envMapIntensity: 1.4,
  });

  const lensRed = new THREE.MeshPhysicalMaterial({
    color: 0xd21f10,
    roughness: 0.12,
    metalness: 0,
    emissive: new THREE.Color(0xff3312),
    emissiveIntensity: 0.5,
    envMapIntensity: 1.2,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x3b332e, roughness: 0.55 });

  /* ------------------------------------------------------------- mattress */

  const body = new THREE.Group();

  const addTo = (group: THREE.Object3D, mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const gusset = addTo(
    body,
    new THREE.Mesh(new RoundedBoxGeometry(MAT_W, GUSSET_H, MAT_D, 6, 0.05), sideFabric)
  );
  gusset.position.y = GUSSET_H / 2;

  const topper = addTo(
    body,
    new THREE.Mesh(
      new RoundedBoxGeometry(MAT_W - 0.015, TOPPER_H, MAT_D - 0.015, 14, 0.115),
      topFabric
    )
  );
  topper.position.y = GUSSET_H + TOPPER_H / 2 - 0.022;

  // Real corded piping: tubes run around a rounded rectangle, the way a
  // mattress is actually finished.
  for (const [y, inset, radius] of [
    [GUSSET_H - 0.005, 0.0, 0.024],
    [0.028, 0.005, 0.021],
    [MAT_H - 0.07, 0.03, 0.02],
  ] as const) {
    const piping = addTo(
      body,
      new THREE.Mesh(
        new THREE.TubeGeometry(
          roundedRectPath(MAT_W - inset * 2, MAT_D - inset * 2, 0.1),
          200,
          radius,
          10,
          true
        ),
        accent
      )
    );
    piping.position.y = y;
  }

  for (const x of [-0.74, 0.74]) {
    const handle = addTo(
      body,
      new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.065, 0.032, 4, 0.015), accent)
    );
    handle.position.set(x, GUSSET_H / 2, MAT_D / 2 + 0.002);
  }

  // rig   — where the mattress sits inside the truck
  //  pivot — the edge it tips over on
  //   body — the mattress, offset so that edge sits exactly at the pivot origin
  // Pivoting on the +Z bottom edge: rotating about +X then swings the far end
  // upward, which is what stands the mattress on that edge instead of driving
  // it through the bed floor.
  const pivot = new THREE.Group();
  pivot.position.z = MAT_D / 2;
  body.position.z = -MAT_D / 2;
  pivot.add(body);

  const rig = new THREE.Group();
  rig.add(pivot);

  /* ---------------------------------------------------------------- truck */

  const truck = new THREE.Group();
  const wheels: THREE.Group[] = [];

  const panel = (w: number, h: number, d: number, r = 0.05) =>
    new RoundedBoxGeometry(w, h, d, 5, r);

  /** Places a box by the two corners of its bounding volume. */
  function slab(
    material: THREE.Material,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    d: number,
    r = 0.05
  ) {
    const mesh = addTo(truck, new THREE.Mesh(panel(x1 - x0, y1 - y0, d, r), material));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
    return mesh;
  }

  /**
   * The body sides are one extruded silhouette each — cab, bed rail, hood and
   * both wheel arches in a single outline. Boxes alone cannot give you an arch,
   * and an arch is most of what makes a shape read as a vehicle.
   */
  function sideProfile(): THREE.Shape {
    const s = new THREE.Shape();
    const frontAxle = 2.3;
    const rearAxle = -2.5;
    const arch = 0.8;

    s.moveTo(BED_FROM, ROCKER_Y);
    s.lineTo(BED_FROM, RAIL_Y);
    s.lineTo(CAB_FROM, RAIL_Y);
    s.lineTo(CAB_FROM, ROOF_Y - 0.22);
    s.quadraticCurveTo(CAB_FROM + 0.03, ROOF_Y, CAB_FROM + 0.3, ROOF_Y);
    s.lineTo(CAB_TO - 0.4, ROOF_Y);
    s.quadraticCurveTo(CAB_TO - 0.12, ROOF_Y, CAB_TO, ROOF_Y - 0.26);
    s.lineTo(CAB_TO + 0.22, 1.74);
    s.lineTo(NOSE_X - 0.24, 1.7);
    s.quadraticCurveTo(NOSE_X, 1.68, NOSE_X, 1.44);
    s.lineTo(NOSE_X, ROCKER_Y + 0.2);
    s.quadraticCurveTo(NOSE_X, ROCKER_Y, NOSE_X - 0.2, ROCKER_Y);
    s.lineTo(frontAxle + arch, ROCKER_Y);
    s.absarc(frontAxle, ROCKER_Y, arch, 0, Math.PI, false);
    s.lineTo(rearAxle + arch, ROCKER_Y);
    s.absarc(rearAxle, ROCKER_Y, arch, 0, Math.PI, false);
    s.lineTo(BED_FROM, ROCKER_Y);
    return s;
  }

  const sideGeo = new THREE.ExtrudeGeometry(sideProfile(), {
    depth: SIDE_T,
    bevelEnabled: true,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    bevelSegments: 3,
    curveSegments: 18,
  });
  sideGeo.translate(0, 0, -SIDE_T / 2);

  for (const z of [-1, 1]) {
    const side = addTo(truck, new THREE.Mesh(sideGeo, paint));
    side.position.z = z * (BED_W / 2 - SIDE_T / 2);
  }

  const inner = BED_W - SIDE_T * 2 + 0.02;

  // Cab, hood and nose fill the space between the two side panels.
  slab(paint, CAB_FROM, CAB_TO, ROCKER_Y, ROOF_Y - 0.08, inner, 0.12);
  slab(paint, CAB_TO, NOSE_X - 0.05, ROCKER_Y, 1.68, inner, 0.1);
  slab(trim, NOSE_X - 0.12, NOSE_X + 0.02, ROCKER_Y + 0.15, 1.5, BED_W - 0.3, 0.05);

  // Under the bed, so you cannot see straight through the chassis.
  slab(trim, BED_FROM, CAB_FROM, ROCKER_Y - 0.02, BED_FLOOR_Y, inner, 0.04);

  // Bed floor and tailgate.
  slab(trim, BED_FROM + 0.08, BED_TO, BED_FLOOR_Y - 0.07, BED_FLOOR_Y, inner, 0.03);
  slab(paint, BED_FROM - 0.02, BED_FROM + 0.12, ROCKER_Y + 0.1, RAIL_Y, BED_W, 0.05);

  // Glass sits slightly proud of the sides, which reads as a tinted greenhouse
  // without having to cut windows out of the panels.
  slab(glass, CAB_FROM + 0.18, CAB_TO - 0.12, 1.78, ROOF_Y - 0.22, BED_W + 0.18, 0.06);
  const windscreen = addTo(
    truck,
    new THREE.Mesh(panel(0.1, 0.78, inner - 0.12, 0.05), glass)
  );
  windscreen.position.set(CAB_TO + 0.03, 2.08, 0);
  windscreen.rotation.z = -0.3;

  // A shut line and a handle: without them the side is one blank panel and the
  // whole thing reads as a toy.
  for (const z of [-1, 1]) {
    const shut = addTo(truck, new THREE.Mesh(panel(0.035, 1.28, 0.05, 0.015), trim));
    shut.position.set(CAB_FROM + 0.16, 1.9, z * (BED_W / 2 + 0.1));

    const handle = addTo(truck, new THREE.Mesh(panel(0.26, 0.07, 0.06, 0.028), chrome));
    handle.position.set(CAB_FROM + 0.95, 1.72, z * (BED_W / 2 + 0.12));
  }

  // White details against the orange body: bumpers, rocker stripe, lamps, hubs.
  slab(chrome, NOSE_X - 0.1, NOSE_X + 0.14, 0.5, 0.82, BED_W + 0.08, 0.08);
  slab(chrome, BED_FROM - 0.16, BED_FROM + 0.1, 0.5, 0.8, BED_W + 0.08, 0.08);

  for (const z of [-1, 1]) {
    const stripe = addTo(
      truck,
      new THREE.Mesh(panel(NOSE_X - BED_FROM - 1.9, 0.1, 0.05, 0.03), chrome)
    );
    stripe.position.set((BED_FROM + NOSE_X) / 2, 1.0, z * (BED_W / 2 + 0.11));
  }

  for (const z of [-1, 1]) {
    const lamp = addTo(truck, new THREE.Mesh(panel(0.12, 0.2, 0.44, 0.05), chrome));
    lamp.position.set(NOSE_X - 0.02, 1.32, z * 0.9);
  }

  /* ------------------------------------------------------------- wheels */

  // Everything here is pre-rotated so the axle runs along local Z, which makes
  // rolling a plain rotation.z later on.
  const TYRE_W = 0.3;

  // A torus gives the tyre rounded shoulders; a plain cylinder reads as a disc.
  const carcassGeo = new THREE.TorusGeometry(WHEEL_R - 0.14, 0.14, 18, 40);
  const treadGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, TYRE_W, 44, 1, true);
  treadGeo.rotateX(Math.PI / 2);
  const barrelGeo = new THREE.CylinderGeometry(0.46, 0.46, TYRE_W + 0.02, 26);
  barrelGeo.rotateX(Math.PI / 2);
  const lipGeo = new THREE.TorusGeometry(0.455, 0.032, 10, 34);
  const spokeGeo = new THREE.BoxGeometry(0.37, 0.11, 0.07);
  const capGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.07, 22);
  capGeo.rotateX(Math.PI / 2);
  const lugGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.05, 6);
  lugGeo.rotateX(Math.PI / 2);

  function buildWheel(): THREE.Group {
    const wheel = new THREE.Group();

    addTo(wheel, new THREE.Mesh(carcassGeo, rubber));
    addTo(wheel, new THREE.Mesh(treadGeo, rubber));

    addTo(wheel, new THREE.Mesh(barrelGeo, darkMetal));

    const frontLip = addTo(wheel, new THREE.Mesh(lipGeo, alloy));
    frontLip.position.z = TYRE_W / 2 - 0.01;

    // Five-spoke face, which is what most pickups actually wear.
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const spoke = addTo(wheel, new THREE.Mesh(spokeGeo, alloy));
      spoke.position.set(Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, TYRE_W / 2 - 0.03);
      spoke.rotation.z = angle;
    }

    const cap = addTo(wheel, new THREE.Mesh(capGeo, accent));
    cap.position.z = TYRE_W / 2 - 0.01;

    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + 0.6;
      const nut = addTo(wheel, new THREE.Mesh(lugGeo, darkMetal));
      nut.position.set(Math.cos(angle) * 0.155, Math.sin(angle) * 0.155, TYRE_W / 2 + 0.005);
    }

    return wheel;
  }

  for (const x of [-2.5, 2.3]) {
    for (const z of [-1, 1]) {
      const wheel = buildWheel();
      wheel.position.set(x, WHEEL_R, z * (BED_W / 2 - 0.06));
      truck.add(wheel);
      wheels.push(wheel);
    }
  }

  /* ------------------------------------------------------------- details */

  // Fender flares. A bare cut-out edge is the single thing that most gives a
  // procedural vehicle away.
  const flareGeo = new THREE.TorusGeometry(0.81, 0.075, 12, 44, Math.PI);
  for (const x of [-2.5, 2.3]) {
    for (const z of [-1, 1]) {
      const flare = addTo(truck, new THREE.Mesh(flareGeo, paint));
      flare.position.set(x, ROCKER_Y, z * (BED_W / 2 + 0.015));
    }
  }

  // Grille slats and a valance under them.
  for (let i = 0; i < 4; i++) {
    const slat = addTo(truck, new THREE.Mesh(panel(0.07, 0.075, BED_W - 0.52, 0.02), darkMetal));
    slat.position.set(NOSE_X - 0.04, 1.06 + i * 0.12, 0);
  }

  // Headlights and tail lights.
  for (const z of [-1, 1]) {
    const headlight = addTo(truck, new THREE.Mesh(panel(0.1, 0.2, 0.46, 0.05), lensClear));
    headlight.position.set(NOSE_X - 0.01, 1.33, z * 0.98);

    const tail = addTo(truck, new THREE.Mesh(panel(0.08, 0.26, 0.3, 0.04), lensRed));
    tail.position.set(BED_FROM - 0.05, 1.12, z * (BED_W / 2 - 0.26));
  }

  // Door mirrors.
  for (const z of [-1, 1]) {
    const arm = addTo(truck, new THREE.Mesh(panel(0.14, 0.05, 0.12, 0.02), darkMetal));
    arm.position.set(CAB_FROM + 1.72, 1.98, z * (BED_W / 2 + 0.1));

    const housing = addTo(truck, new THREE.Mesh(panel(0.1, 0.2, 0.1, 0.04), paint));
    housing.position.set(CAB_FROM + 1.76, 1.99, z * (BED_W / 2 + 0.2));
  }

  // Exhaust tip and a tow hitch under the tailgate.
  const exhaust = addTo(truck, new THREE.Mesh(panel(0.3, 0.09, 0.09, 0.04), alloy));
  exhaust.position.set(BED_FROM - 0.1, 0.62, -0.75);

  const hitch = addTo(truck, new THREE.Mesh(panel(0.28, 0.1, 0.12, 0.03), darkMetal));
  hitch.position.set(BED_FROM - 0.18, 0.56, 0);

  // The mattress lives inside the truck, so once it lands it simply rides along.
  truck.add(rig);
  scene.add(truck);

  /* -------------------------------------------------------------- floor */

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShadowMaterial({ opacity: 0.17 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ------------------------------------------------------------ framing */

  const wide = () => window.innerWidth >= 1024;

  /**
   * Frame by viewport fraction, not by a fixed camera distance. A phone is a
   * fraction as wide in world units as a desktop at the same z.
   */
  function frame() {
    const fraction = wide() ? 0.46 : 0.86;
    halfWidth = TRUCK_LEN / (2 * fraction);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    baseCamZ = THREE.MathUtils.clamp(halfWidth / (tan * camera.aspect), 8, 60);
  }

  /** Desktop parks the truck right of the headline; mobile centres it. */
  const parkX = () => (wide() ? halfWidth * 0.42 : 0);

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = wide() ? 30 : 36;
    baseCamY = wide() ? 4.6 : 4.0;
    lookTarget.set(0, 1.25, 0);

    frame();
    camera.position.set(0, baseCamY, baseCamZ);
    camera.updateProjectionMatrix();
    camera.lookAt(lookTarget);
  }

  resize();
  new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);

  /* ------------------------------------------------------------ the show */

  let settled = false;
  /** Ramps 0 → 1 after landing so idle motion eases in from the exact pose. */
  let handover = 0;
  let scrollProgress = 0;
  let lastTruckX = 0;
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };

  /** How far back the mattress leans once it is standing in the bed. */
  const STANDING = 1.16;
  /** Where its bottom edge rests, so the top leans onto the far bed wall. */
  const STAND_Z = -0.42;

  function restPose() {
    truck.position.set(parkX(), 0, 0);
    truck.rotation.set(0, 0, 0);
    rig.position.set(BED_CENTER_X + 0.15, BED_FLOOR_Y, STAND_Z);
    rig.rotation.set(0, 0, 0);
    pivot.rotation.set(STANDING, 0, 0);
    body.scale.set(1, 1, 1);
    lastTruckX = truck.position.x;
    settled = true;
    handover = 1;
  }

  function announceLoaded() {
    window.dispatchEvent(new CustomEvent(LOADED_EVENT));
  }

  function play() {
    const DRIVE = 2.1;
    // Quick. A mattress dropped from that height is on the floor in about a
    // second, and the slow version read as floaty.
    const FALL = 1.15;

    truck.position.set(-halfWidth - TRUCK_LEN * 0.85, 0, 0);
    truck.rotation.set(0, 0, 0);
    rig.position.set(BED_CENTER_X - 1.1, 6.2, STAND_Z - 0.5);
    rig.rotation.set(0, -0.2, -0.1);
    pivot.rotation.set(STANDING + 0.5, 0, 0);
    body.scale.set(1, 1, 1);
    settled = false;
    handover = 0;

    const tl = gsap.timeline({
      onComplete: () => {
        settled = true;
        announceLoaded();
      },
    });

    // 1. The truck pulls in and settles on its springs.
    tl.to(truck.position, { x: parkX(), duration: DRIVE, ease: 'power2.out' }, 0)
      .fromTo(
        camera.position,
        { z: baseCamZ * 1.2 },
        { z: baseCamZ, duration: DRIVE + FALL, ease: 'sine.inOut' },
        0
      )
      .to(truck.rotation, { z: 0.022, duration: 0.24, ease: 'power2.out' }, DRIVE - 0.24)
      .to(truck.rotation, { z: 0, duration: 0.8, ease: 'power2.out' }, DRIVE)

      // 2. The mattress drops in fast, already upright.
      .to(rig.position, { x: BED_CENTER_X + 0.15, duration: FALL, ease: 'power1.out' }, DRIVE - 0.2)
      .to(rig.position, { z: STAND_Z, duration: FALL, ease: 'power1.out' }, DRIVE - 0.2)
      .to(rig.position, { y: BED_FLOOR_Y, duration: FALL, ease: 'power2.in' }, DRIVE - 0.2)
      .to(rig.rotation, { y: 0, z: 0, duration: FALL, ease: 'sine.out' }, DRIVE - 0.2)

      // 3. It lands on its edge and rocks back against the far bed wall.
      .to(pivot.rotation, { x: STANDING, duration: 0.55, ease: 'power3.out' }, DRIVE - 0.2 + FALL)
      .to(body.scale, { y: 0.96, duration: 0.1, ease: 'power2.out' }, DRIVE - 0.2 + FALL)
      .to(body.scale, { y: 1, duration: 0.5, ease: 'power2.out' }, DRIVE - 0.1 + FALL)

      // 4. The truck takes the weight.
      .to(truck.position, { y: -0.07, duration: 0.12, ease: 'power2.out' }, DRIVE - 0.2 + FALL)
      .to(truck.position, { y: 0, duration: 0.9, ease: 'elastic.out(1, 0.5)' }, DRIVE - 0.08 + FALL);
  }

  /* -------------------------------------------------------- interaction */

  window.addEventListener(
    'pointermove',
    (event) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true }
  );

  if (!reducedMotion) {
    ScrollTrigger.create({
      trigger: host.closest('section') || host,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => (scrollProgress = self.progress),
    });
  }

  /* --------------------------------------------------------------- loop */

  let visible = true;
  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
    },
    { rootMargin: '200px' }
  ).observe(host);

  renderer.setAnimationLoop(() => {
    if (!visible) return;

    eased.x += (pointer.x - eased.x) * 0.04;
    eased.y += (pointer.y - eased.y) * 0.04;

    if (settled && !reducedMotion) {
      handover = Math.min(1, handover + 0.006);
      const k = handover * handover * (3 - 2 * handover); // smoothstep

      // Scrolling drives it away, out of frame to the right.
      const departure = scrollProgress * (halfWidth * 2 + TRUCK_LEN);
      truck.position.x = parkX() + departure * k + eased.x * 0.12 * k;
      truck.rotation.y = eased.x * 0.05 * k;

      camera.position.y = baseCamY + scrollProgress * 0.6 * k - eased.y * 0.12 * k;
      camera.lookAt(lookTarget);
    }

    // Wheels turn from actual distance covered, so they never look pasted on.
    const dx = truck.position.x - lastTruckX;
    if (dx !== 0) {
      for (const wheel of wheels) wheel.rotation.z -= dx / WHEEL_R;
      lastTruckX = truck.position.x;
    }

    renderer.render(scene, camera);
  });

  /* -------------------------------------------------------------- start */

  if (reducedMotion) {
    restPose();
    announceLoaded();
    return;
  }

  restPose();
  truck.position.x = -400; // parked off-camera until the loader hands over
  settled = false;
  whenEntered(play);
}
