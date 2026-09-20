/**
 * The hero object: a real-time 3D mattress.
 *
 * It comes in from the left on a diagonal, standing on edge, catches that
 * bottom edge on the floor, and then slowly topples forward onto its face —
 * pivoting on the edge it landed on, the way real dead weight does. Once it is
 * down it stays down; pointer and scroll motion ease in from that exact pose.
 *
 * Loaded dynamically so three.js never reaches a device that cannot use it.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger, reducedMotion, whenEntered } from './motion';

/** World units. The body group's origin sits on its bottom face. */
const WIDTH = 2.72;
const DEPTH = 1.94;
const GUSSET_H = 0.28;
const TOPPER_H = 0.26;
const HEIGHT = GUSSET_H + TOPPER_H;

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

/** Puffed diamond quilting: soft panels, pressed seams, stitch dots. */
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

  // Panels puff up between the seams. Batched into one path: every canvas
  // filter draw allocates its own surface, so thousands of filtered calls will
  // lock the main thread outright.
  const panels = new Path2D();
  for (let x = from; x < to; x += step) {
    for (let y = from; y < to; y += step) {
      panels.roundRect(x + 8, y + 8, step - 16, step - 16, 22);
    }
  }
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = '#efefef';
  ctx.fill(panels);

  // Seams press back down.
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

  // Stitch dots along every seam — one path, one fill, no filter.
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

  // Fabric weave over everything.
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

/** Vertical knit ribbing for the side panel. */
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

/** Soft blob under the mattress — a cast shadow alone goes mushy at this scale. */
function contactTexture(): THREE.CanvasTexture {
  const size = 512;
  const el = document.createElement('canvas');
  el.width = el.height = size;
  const ctx = el.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(92, 48, 20, 0.9)');
  grad.addColorStop(0.42, 'rgba(92, 48, 20, 0.34)');
  grad.addColorStop(1, 'rgba(92, 48, 20, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(el);
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
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const lookTarget = new THREE.Vector3(0, 0.15, 0);
  let baseCamY = 2.35;
  let baseCamZ = 8.4;
  let halfWidth = 3.2;

  /* ------------------------------------------------------------- lights */

  scene.add(new THREE.HemisphereLight(0xffffff, 0xffe0c4, 0.5));

  // Steep and slightly front-right, so the cast shadow tucks under the mattress
  // instead of throwing a hard slab out to the side.
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.8, 9.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -8;
  shadowCam.right = 8;
  shadowCam.top = 8;
  shadowCam.bottom = -8;
  shadowCam.near = 0.5;
  shadowCam.far = 28;
  shadowCam.updateProjectionMatrix();
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffd9bd, 0.6);
  fill.position.set(-6, 2.6, 4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-2.5, 4, -6);
  scene.add(rim);

  /* ----------------------------------------------------------- materials */

  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  function normalTexture(height: HTMLCanvasElement, strength: number, repeat: [number, number]) {
    const texture = new THREE.CanvasTexture(heightToNormal(height, strength));
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = anisotropy;
    return texture;
  }

  const topFabric = new THREE.MeshPhysicalMaterial({
    color: 0xfbf9f7,
    roughness: 0.88,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(0xffd8b8),
    normalMap: normalTexture(quiltHeight(), 5.5, [1.15, 1.15]),
    normalScale: new THREE.Vector2(1.1, 1.1),
    envMapIntensity: 0.5,
  });

  const sideFabric = new THREE.MeshPhysicalMaterial({
    color: 0xf1ece7,
    roughness: 0.93,
    metalness: 0,
    sheen: 0.85,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xffd8b8),
    normalMap: normalTexture(gussetHeight(), 2.6, [6, 1]),
    normalScale: new THREE.Vector2(0.8, 0.8),
    envMapIntensity: 0.35,
  });

  // ACES tone mapping washes bright oranges out, so the cord starts deeper and
  // more saturated than the brand hex.
  const cord = new THREE.MeshPhysicalMaterial({
    color: 0xe24a05,
    roughness: 0.52,
    metalness: 0,
    sheen: 0.8,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.6,
  });

  /* ------------------------------------------------------------- mattress */

  const body = new THREE.Group();

  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
    return mesh;
  };

  const gusset = add(
    new THREE.Mesh(new RoundedBoxGeometry(WIDTH, GUSSET_H, DEPTH, 6, 0.055), sideFabric)
  );
  gusset.position.y = GUSSET_H / 2;

  // Quilted pillow-top, rounded generously so the silhouette reads as soft.
  const topper = add(
    new THREE.Mesh(
      new RoundedBoxGeometry(WIDTH - 0.015, TOPPER_H, DEPTH - 0.015, 14, 0.125),
      topFabric
    )
  );
  topper.position.y = GUSSET_H + TOPPER_H / 2 - 0.025;

  // Real corded piping: tubes run around a rounded rectangle, the way a
  // mattress is actually finished.
  for (const [y, inset, radius] of [
    [GUSSET_H - 0.005, 0.0, 0.026],
    [0.03, 0.005, 0.023],
    [HEIGHT - 0.075, 0.03, 0.022],
  ] as const) {
    const piping = add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          roundedRectPath(WIDTH - inset * 2, DEPTH - inset * 2, 0.11),
          220,
          radius,
          10,
          true
        ),
        cord
      )
    );
    piping.position.y = y;
  }

  // Carry handles on the long side.
  for (const x of [-0.78, 0.78]) {
    const handle = add(new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.07, 0.035, 4, 0.016), cord));
    handle.position.set(x, GUSSET_H / 2, DEPTH / 2 + 0.002);
  }

  /* --------------------------------------------------------------- rigging */

  // rig    — where the mattress is in the world
  //  pivot — the edge it tips over on
  //   body — the mattress, offset so that edge sits exactly at the pivot origin
  const pivot = new THREE.Group();
  pivot.position.z = -DEPTH / 2;
  body.position.z = DEPTH / 2;
  pivot.add(body);

  const rig = new THREE.Group();
  rig.add(pivot);
  scene.add(rig);

  /* -------------------------------------------------------------- floor */

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    // Kept light on purpose — the soft blob below does most of the grounding.
    new THREE.ShadowMaterial({ opacity: 0.1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH * 1.5, DEPTH * 1.55),
    new THREE.MeshBasicMaterial({
      map: contactTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0,
    })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.004;
  scene.add(contact);

  /* ------------------------------------------------------------ framing */

  const wide = () => window.innerWidth >= 1024;

  /**
   * Frame by viewport fraction, not by a fixed camera distance. A phone is a
   * fraction as wide in world units as a desktop at the same z, which is how
   * the mattress ended up swallowing the headline on mobile.
   */
  function frame() {
    const fraction = wide() ? 0.34 : 0.52;
    halfWidth = WIDTH / (2 * fraction);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    baseCamZ = THREE.MathUtils.clamp(halfWidth / (tan * camera.aspect), 6, 30);
  }

  /** Desktop parks it right of the headline; mobile centres it. */
  const landX = () => (wide() ? halfWidth * 0.34 : 0);

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = wide() ? 30 : 34;
    baseCamY = wide() ? 2.35 : 2.1;
    lookTarget.set(0, 0.1, 0);

    frame();
    camera.position.set(0, baseCamY, baseCamZ);
    camera.updateProjectionMatrix();
    camera.lookAt(lookTarget);
  }

  resize();
  new ResizeObserver(resize).observe(host);
  window.addEventListener('resize', resize);

  /* ----------------------------------------------------------- the drop */

  let settled = false;
  /** Ramps 0 → 1 after landing so the idle motion eases in from the exact pose
   *  the mattress came to rest in, instead of snapping on. */
  let handover = 0;
  let scrollProgress = 0;
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };

  function restPose() {
    rig.position.set(landX(), 0, 0);
    rig.rotation.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    settled = true;
    handover = 1;
  }

  function drop() {
    // Two moves, not one. It falls on the diagonal standing on edge, catches
    // that edge on the floor, then topples forward onto its face under its own
    // weight. No bounce anywhere — a mattress is dead weight.
    const FALL = 2.3;
    // Negative: rotating about +X swings the body's +z end downward, so a
    // positive lean would bury the mattress under the floor.
    const LEAN = -0.95;
    const LAY = 1.7;

    rig.position.set(-halfWidth - WIDTH * 0.9, 5.1, -1.1);
    rig.rotation.set(0, -0.34, -0.2);
    pivot.rotation.set(LEAN, 0, 0);
    body.scale.set(1, 1, 1);
    settled = false;
    handover = 0;

    const tl = gsap.timeline({
      onComplete: () => {
        settled = true;
      },
    });

    // Horizontal momentum bleeds off while vertical speed builds. That
    // difference is what makes it read as falling rather than sliding in.
    tl.to(rig.position, { x: landX(), duration: FALL, ease: 'power1.out' }, 0)
      .to(rig.position, { z: 0, duration: FALL, ease: 'power1.out' }, 0)
      .to(rig.position, { y: 0, duration: FALL, ease: 'power2.in' }, 0)
      .to(rig.rotation, { y: 0, z: 0, duration: FALL * 1.05, ease: 'sine.inOut' }, 0)
      // Stay wide while it is standing on edge — it is nearly twice as tall
      // that way — and close in as it lies down.
      .fromTo(
        camera.position,
        { z: baseCamZ * 1.34 },
        { z: baseCamZ, duration: FALL + LAY + 0.4, ease: 'sine.inOut' },
        0
      )
      // The edge bites the floor.
      .to(body.scale, { y: 0.95, duration: 0.12, ease: 'power2.out' }, FALL)
      .to(body.scale, { y: 1, duration: 0.45, ease: 'power2.out' }, FALL + 0.12)
      // Then it goes over — accelerating, because the torque grows as it falls.
      .to(pivot.rotation, { x: 0, duration: LAY, ease: 'power2.in' }, FALL + 0.14)
      // The face hits: one compression, and then it is done moving.
      .to(
        body.scale,
        { y: 0.93, x: 1.02, z: 1.02, duration: 0.14, ease: 'power2.out' },
        FALL + 0.14 + LAY
      )
      .to(body.scale, { y: 1, x: 1, z: 1, duration: 0.95, ease: 'power2.out' }, FALL + 0.28 + LAY);
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

    // Tracked every frame, drop or no drop, so there is no catch-up lurch the
    // moment the timeline hands over.
    eased.x += (pointer.x - eased.x) * 0.04;
    eased.y += (pointer.y - eased.y) * 0.04;

    if (settled && !reducedMotion) {
      handover = Math.min(1, handover + 0.006);
      const k = handover * handover * (3 - 2 * handover); // smoothstep

      rig.rotation.y = eased.x * 0.18 * k;
      rig.rotation.x = -eased.y * 0.07 * k;
      rig.rotation.z = -scrollProgress * 0.28 * k;
      rig.position.x = landX() + eased.x * 0.1 * k;
      rig.position.y = scrollProgress * 1.5 * k;

      camera.position.y = baseCamY + scrollProgress * 0.5 * k;
      camera.lookAt(lookTarget);
    }

    const height = THREE.MathUtils.clamp(rig.position.y / 3.2, 0, 1);
    const material = contact.material as THREE.MeshBasicMaterial;
    material.opacity = 0.55 * (1 - height) * (1 - scrollProgress * 0.8);
    contact.scale.setScalar(1 + height * 1.3);
    contact.position.x = rig.position.x;
    contact.position.z = rig.position.z;

    renderer.render(scene, camera);
  });

  /* -------------------------------------------------------------- start */

  if (reducedMotion) {
    restPose();
    return;
  }

  restPose();
  rig.position.y = 60; // parked off-camera until the loader hands over
  settled = false;
  whenEntered(drop);
}
