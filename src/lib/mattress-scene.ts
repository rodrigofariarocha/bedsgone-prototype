/**
 * The hero object: a real-time 3D mattress that falls in from the left and
 * bounces on the floor. Once it lands, pointer and scroll motion ease in from
 * that exact pose — never snapping on, which read as a glitch.
 *
 * Loaded dynamically so three.js never reaches a device that cannot use it.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { ScrollTrigger, reducedMotion, whenEntered } from './motion';

/** Width in world units. The group's origin sits at the bottom face, so the
 *  floor is y = 0 and a squash on impact compresses down into it. */
const WIDTH = 2.72;
const DEPTH = 1.96;
const GUSSET_H = 0.3;
const TOPPER_H = 0.24;

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
 * Procedural stitching. It drives the bump map, so the lighting carves real
 * grooves into the fabric instead of painting lines onto it.
 */
function quiltBump(anisotropy: number): THREE.CanvasTexture {
  const size = 1024;
  const el = document.createElement('canvas');
  el.width = el.height = size;
  const ctx = el.getContext('2d')!;

  const grain = ctx.createImageData(size, size);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = 138 + Math.random() * 22;
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = n;
    grain.data[i + 3] = 255;
  }
  ctx.putImageData(grain, 0, 0);

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  ctx.translate(-size / 2, -size / 2);

  const step = size / 6;
  const channel = (a: number, b: number, horizontal: boolean) => {
    const grad = horizontal
      ? ctx.createLinearGradient(0, a, 0, b)
      : ctx.createLinearGradient(a, 0, b, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.62)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0.62)');
    return grad;
  };

  for (let i = -size; i < size * 2; i += step) {
    ctx.fillStyle = channel(i - 16, i + 16, false);
    ctx.fillRect(i - 16, -size, 32, size * 3);
    ctx.fillStyle = channel(i - 16, i + 16, true);
    ctx.fillRect(-size, i - 16, size * 3, 32);
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.35, 1.35);
  texture.anisotropy = anisotropy;
  return texture;
}

/** Vertical ribbing for the side panel — knit fabric, not quilting. */
function gussetBump(anisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 64;
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d')!;

  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) {
    const grad = ctx.createLinearGradient(x, 0, x + 8, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 8, h);
  }

  const texture = new THREE.CanvasTexture(el);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 1);
  texture.anisotropy = anisotropy;
  return texture;
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
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.42;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const lookTarget = new THREE.Vector3(0, 0.15, 0);
  let baseCamY = 2.05;
  let baseCamZ = 8.4;
  let halfWidth = 3.2;

  /* ------------------------------------------------------------- lights */

  scene.add(new THREE.HemisphereLight(0xffffff, 0xffe2cd, 0.55));

  // Steep and slightly front-right, so the cast shadow tucks under the mattress
  // instead of throwing a hard slab out to the side.
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(2.8, 9.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  const shadowCam = key.shadow.camera;
  shadowCam.left = -7;
  shadowCam.right = 7;
  shadowCam.top = 7;
  shadowCam.bottom = -7;
  shadowCam.near = 0.5;
  shadowCam.far = 26;
  shadowCam.updateProjectionMatrix();
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffd3e4, 0.7);
  fill.position.set(-6, 3, 3.5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 1.15);
  rim.position.set(-2.5, 4, -6);
  scene.add(rim);

  /* ----------------------------------------------------------- materials */

  const anisotropy = renderer.capabilities.getMaxAnisotropy();

  const topFabric = new THREE.MeshPhysicalMaterial({
    color: 0xfdfcfa,
    roughness: 0.85,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0xffd0a8),
    bumpMap: quiltBump(anisotropy),
    bumpScale: 8,
    envMapIntensity: 0.4,
  });

  const sideFabric = new THREE.MeshPhysicalMaterial({
    color: 0xf2ece7,
    roughness: 0.9,
    metalness: 0,
    sheen: 0.8,
    sheenRoughness: 0.85,
    sheenColor: new THREE.Color(0xffd9bd),
    bumpMap: gussetBump(anisotropy),
    bumpScale: 3,
    envMapIntensity: 0.3,
  });

  const piping = new THREE.MeshPhysicalMaterial({
    color: 0xe24a05,
    roughness: 0.5,
    metalness: 0,
    sheen: 0.7,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.55,
  });

  /* ----------------------------------------------------------- mattress */

  const mattress = new THREE.Group();

  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mattress.add(mesh);
    return mesh;
  };

  // Side panel (gusset).
  const gusset = add(
    new THREE.Mesh(new RoundedBoxGeometry(WIDTH, GUSSET_H, DEPTH, 6, 0.07), sideFabric)
  );
  gusset.position.y = GUSSET_H / 2;

  // Quilted pillow-top, slightly proud of the base.
  const topper = add(
    new THREE.Mesh(new RoundedBoxGeometry(WIDTH - 0.02, TOPPER_H, DEPTH - 0.02, 10, 0.11), topFabric)
  );
  topper.position.y = GUSSET_H + TOPPER_H / 2 - 0.02;

  // Piping: the seam between the two layers, the bottom hem, and the top edge.
  for (const [y, w, d, h] of [
    [GUSSET_H - 0.01, WIDTH + 0.03, DEPTH + 0.03, 0.05],
    [0.035, WIDTH + 0.02, DEPTH + 0.02, 0.04],
    [GUSSET_H + TOPPER_H - 0.08, WIDTH - 0.005, DEPTH - 0.005, 0.04],
  ] as const) {
    const band = add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, h / 2.2), piping));
    band.position.y = y;
  }

  // Carry handles on the long side.
  for (const x of [-0.78, 0.78]) {
    const handle = add(
      new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.075, 0.04, 3, 0.018), piping)
    );
    handle.position.set(x, GUSSET_H / 2, DEPTH / 2 + 0.005);
  }

  // Tufting buttons.
  const buttonGeo = new THREE.SphereGeometry(0.028, 18, 14);
  for (let col = -2; col <= 2; col++) {
    for (let row = -1; row <= 1; row++) {
      const button = add(new THREE.Mesh(buttonGeo, piping));
      button.position.set(col * 0.52, GUSSET_H + TOPPER_H - 0.045, row * 0.55);
      button.scale.y = 0.5;
    }
  }

  scene.add(mattress);

  /* -------------------------------------------------------------- floor */

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    // Kept light on purpose — the soft blob below does most of the grounding.
    new THREE.ShadowMaterial({ opacity: 0.09 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH * 1.45, DEPTH * 1.5),
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
    const fraction = wide() ? 0.34 : 0.72;
    halfWidth = WIDTH / (2 * fraction);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    baseCamZ = THREE.MathUtils.clamp(halfWidth / (tan * camera.aspect), 6, 30);
  }

  /** Desktop parks it right of the headline; mobile centres it, lower down. */
  const landX = () => (wide() ? halfWidth * 0.34 : 0);

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;

    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    if (wide()) {
      camera.fov = 30;
      baseCamY = 2.55;
      lookTarget.set(0, 0.1, 0);
    } else {
      // On a phone the canvas is already a band of its own, so just centre
      // the mattress inside it.
      camera.fov = 34;
      baseCamY = 2.1;
      lookTarget.set(0, 0.1, 0);
    }

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
  /** Ramps 0 → 1 after landing so the idle motion eases in from the exact
   *  pose the mattress came to rest in, instead of snapping on. */
  let handover = 0;
  let scrollProgress = 0;
  const pointer = { x: 0, y: 0 };
  const eased = { x: 0, y: 0 };

  function restPose() {
    mattress.position.set(landX(), 0, 0);
    mattress.rotation.set(0, 0, 0);
    mattress.scale.set(1, 1, 1);
    settled = true;
    handover = 1;
  }

  function drop() {
    // Slow and heavy. A mattress does not bounce — it accelerates under
    // gravity, lands, compresses once and stays put. No rebound, no overshoot:
    // that is what made the old version read as a cartoon.
    const FALL = 3.1;
    const x = landX();

    mattress.position.set(-halfWidth - WIDTH * 1.1, 4.6, -1.1);
    mattress.rotation.set(0.3, -0.34, -0.66);
    mattress.scale.set(1, 1, 1);
    settled = false;
    handover = 0;

    const tl = gsap.timeline({
      onComplete: () => {
        settled = true;
      },
    });

    // Horizontal drift bleeds off as it falls, the way real momentum does.
    tl.to(mattress.position, { x, duration: FALL, ease: 'power1.out' }, 0)
      .to(mattress.position, { z: 0, duration: FALL, ease: 'power1.out' }, 0)
      // Gravity: slow at the top, quickest at the floor.
      .to(mattress.position, { y: 0, duration: FALL, ease: 'power2.in' }, 0)
      // It levels out on the way down rather than snapping flat on impact.
      .to(mattress.rotation, { x: 0, y: 0, z: 0, duration: FALL * 0.96, ease: 'sine.inOut' }, 0)
      .fromTo(
        camera.position,
        { z: baseCamZ * 1.12 },
        { z: baseCamZ, duration: FALL * 1.15, ease: 'sine.out' },
        0
      )
      // One soft compression on contact, then it settles and stops.
      .to(mattress.scale, { y: 0.9, x: 1.03, z: 1.028, duration: 0.16, ease: 'power2.out' }, FALL)
      .to(mattress.scale, { y: 1, x: 1, z: 1, duration: 1.05, ease: 'power2.out' }, FALL + 0.16);
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

      mattress.rotation.y = eased.x * 0.18 * k;
      mattress.rotation.x = -eased.y * 0.08 * k;
      mattress.rotation.z = -scrollProgress * 0.3 * k;
      mattress.position.x = landX() + eased.x * 0.1 * k;
      mattress.position.y = scrollProgress * 1.5 * k;

      camera.position.y = baseCamY + scrollProgress * 0.5 * k;
      camera.lookAt(lookTarget);
    }

    const height = THREE.MathUtils.clamp(mattress.position.y / 3.2, 0, 1);
    const material = contact.material as THREE.MeshBasicMaterial;
    material.opacity = 0.55 * (1 - height) * (1 - scrollProgress * 0.8);
    contact.scale.setScalar(1 + height * 1.3);
    contact.position.x = mattress.position.x;
    contact.position.z = mattress.position.z;

    renderer.render(scene, camera);
  });

  /* -------------------------------------------------------------- start */

  if (reducedMotion) {
    restPose();
    return;
  }

  restPose();
  mattress.position.y = 60; // parked off-camera until the loader hands over
  settled = false;
  whenEntered(drop);
}
