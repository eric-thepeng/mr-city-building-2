import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AssetLibrary } from './assets.js';
import { Game } from './game.js';
import { XRInput, MouseInput } from './input.js';
import { Label, updateBillboards } from './ui.js';

const $ = (id) => document.getElementById(id);

// ?emulate  -> install Meta's Immersive Web Emulation Runtime (a Quest 3 in the
// browser) so XR can be tried without a headset; drive it from the console via window.__xrDevice.
async function installEmulator() {
  const { XRDevice, metaQuest3 } = await import('https://cdn.jsdelivr.net/npm/iwer@2.7.0/+esm');
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  window.__xrDevice = device;
}

const params = new URLSearchParams(location.search);
// Snap Specs: see-through display, hands only, and fill rate is the main limit.
// Snap's docs say to turn antialiasing off there. ?specs forces this profile on.
const SPECS = params.has('specs') || /Spectacles|Snap ?OS/i.test(navigator.userAgent);
// When the runtime has no 'local-floor', the 'local' origin is at the head.
// Assume this eye height so the world still sits on the floor.
const ASSUMED_EYE_HEIGHT = 1.55;
// Where the sandbox appears in XR, relative to the head when the session starts.
const BOARD_DISTANCE = 0.75; // centre of the board; its near edge is ~0.45 m away
const BOARD_BELOW_EYES = 0.45;

async function main() {
  if (params.has('emulate')) await installEmulator();
  const data = await (await fetch('data/game-data.json')).json();
  const assets = new AssetLibrary(data);
  await assets.load((p) => { $('progress').style.width = `${Math.round(p * 100)}%`; });

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: !SPECS && !params.has('noaa'),
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  // Specs: render the XR views at 75% resolution (less memory, less fill); ?fb=1 to override
  const fb = Number(params.get('fb')) || (SPECS ? 0.75 : 1);
  renderer.xr.setFramebufferScaleFactor(fb);
  if (SPECS) Label.resolution = 1;
  renderer.xr.setReferenceSpaceType('local-floor');
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 200);
  // desktop view: standing a step back from the sandbox
  camera.position.set(0, 1.2, 0.25);
  // The player rig. three.js applies the camera's parent transform to the XR pose.
  const rig = new THREE.Group();
  rig.name = 'Rig';
  rig.add(camera);
  scene.add(rig);

  // ---------------------------------------------------------------- lighting
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x5a4636, 1.6));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  // Unity Directional Light rotation (0.408, -0.235, 0.109, 0.875), z mirrored
  const q = new THREE.Quaternion(-0.40821788, 0.23456968, 0.10938163, 0.8754261);
  sun.position.set(0, 0, 1).applyQuaternion(q).multiplyScalar(-10);
  scene.add(sun);

  // ---------------------------------------------------------------- sky
  const sky = makeSky();
  scene.add(sky);
  scene.fog = new THREE.Fog(0xbfd8f0, 2.5, 6);

  // ---------------------------------------------------------------- world
  // the sandbox terrain, baked from the Unity landscape (see tools/bake.js)
  const terrain = assets.terrain();
  terrain.name = 'Terrain';

  const game = new Game({ data, assets, scene, terrain });
  // desktop: the sandbox sits on an imaginary table in front of the camera
  const DESK_BOARD = new THREE.Vector3(0, 0.72, -0.45);
  game.placeBoard(DESK_BOARD, 0);
  game.audio = makeAudio();
  game.events.addEventListener('money', (e) => { $('budget').textContent = e.amount; });
  game.events.addEventListener('hand', (e) => { $('hand').textContent = e.preset.name.replace('_', ' '); });
  game.start();

  // ---------------------------------------------------------------- input
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.8, -0.45);
  controls.enableDamping = true;
  controls.maxDistance = 6;
  controls.update();
  const mouse = new MouseInput(camera, renderer.domElement, game, controls);
  const xrInput = new XRInput(renderer, rig, game, { models: !SPECS });

  // In-world buttons under the budget sign (inside XR there is no HTML UI).
  let needsPlacement = false;
  const addButton = (text, x, onPress) => {
    const btn = new Label({ height: 0.018 * game.ui, bg: 'rgba(45,108,223,0.95)', billboard: false });
    btn.set(text);
    btn.mesh.position.set(x, -0.05 * game.ui, 0);
    btn.mesh.raycast = THREE.Mesh.prototype.raycast; // labels ignore rays by default
    game.money.anchor.add(btn.mesh);
    xrInput.addButton(btn.mesh, onPress);
  };
  addButton('New game', -0.07 * game.ui, () => game.restart());
  addButton('Recenter', 0.07 * game.ui, () => { needsPlacement = true; });

  // ---------------------------------------------------------------- XR session
  let mode = null;
  let xrFrames = 0;
  const startSession = async (sessionMode) => {
    // Only optional features: Spectacles documents immersive-ar + hands, but not
    // 'local-floor'. Requiring a feature the runtime lacks would fail the request.
    const session = await navigator.xr.requestSession(sessionMode, {
      optionalFeatures: ['local-floor', 'hand-tracking', 'bounded-floor'],
    });
    let floor = true;
    try {
      await session.requestReferenceSpace('local-floor');
    } catch {
      floor = false;
    }
    renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
    mode = sessionMode;
    const ar = sessionMode === 'immersive-ar';
    sky.visible = !ar;
    scene.fog = ar ? null : new THREE.Fog(0xbfd8f0, 2.5, 6);
    xrInput.setHandModelsVisible(!ar);
    mouse.enabled = false;
    session.addEventListener('end', () => {
      mode = null;
      rig.position.y = 0;
      game.placeBoard(DESK_BOARD, 0);
      sky.visible = true;
      scene.fog = new THREE.Fog(0xbfd8f0, 2.5, 6);
      mouse.enabled = true;
      document.body.classList.remove('in-xr');
    });
    // Without a floor space the origin is at the head, so lift the rig (camera,
    // hands and controllers) to put the player's eyes at a normal standing height.
    rig.position.y = floor ? 0 : ASSUMED_EYE_HEIGHT;
    await renderer.xr.setSession(session);
    needsPlacement = true; // put the sandbox in front of the player once the head is tracked
    xrFrames = 0;
    window.__xrInfo = { mode: sessionMode, floor, blend: session.environmentBlendMode, enabled: session.enabledFeatures };
    document.body.classList.add('in-xr');
  };

  const setupButton = async (btn, sessionMode) => {
    const ok = navigator.xr && (await navigator.xr.isSessionSupported(sessionMode).catch(() => false));
    btn.disabled = !ok;
    if (!ok) btn.title = 'Not supported in this browser / device';
    btn.addEventListener('click', () => startSession(sessionMode).catch((err) => {
      console.error(err);
      alert(`Could not start ${sessionMode}: ${err.message}`);
    }));
  };
  await Promise.all([setupButton($('enter-ar'), 'immersive-ar'), setupButton($('enter-vr'), 'immersive-vr')]);
  if (!window.isSecureContext) $('xr-note').textContent = 'WebXR needs HTTPS (or localhost).';
  else if (!navigator.xr) $('xr-note').textContent = 'This browser has no WebXR. Use the mouse to play, or open on Specs / Quest.';
  if (SPECS) document.body.classList.add('specs');

  $('restart').addEventListener('click', () => game.restart());
  $('loading').classList.add('hidden');
  window.__game = game; // handy for debugging in the console
  window.__xrInput = xrInput;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // In XR the sandbox is placed relative to the head: ahead of the player and
  // below eye level, turned to face them. "Recenter" does it again.
  const head = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const placeInFront = () => {
    const cam = renderer.xr.getCamera();
    cam.getWorldPosition(head);
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const pos = head.clone().addScaledVector(fwd, BOARD_DISTANCE);
    pos.y = head.y - BOARD_BELOW_EYES;
    game.placeBoard(pos, Math.atan2(-fwd.x, -fwd.z));
  };

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  const animated = [];
  game.group.traverse((o) => o.userData.animated && animated.push(o));
  const look = new THREE.Vector3();
  const panelPos = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    if (!mode) controls.update();
    else xrInput.update(dt);
    game.update(dt);
    for (const o of animated) o.userData.update(t);
    const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    updateBillboards(scene, viewer);
    // keep the budget sign facing the player (yaw only)
    const panel = game.money.anchor;
    viewer.getWorldPosition(look);
    look.y = panel.getWorldPosition(panelPos).y;
    panel.lookAt(look);
    renderer.render(scene, camera);
    // the XR camera pose is valid after the first rendered frames
    if (mode && needsPlacement && ++xrFrames > 2) {
      placeInFront();
      needsPlacement = false;
    }
  });
}

function makeSky() {
  const geo = new THREE.SphereGeometry(80, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x4a8fd8) },
      horizon: { value: new THREE.Color(0xcfe3f5) },
      bottom: { value: new THREE.Color(0x8a7a6a) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.raycast = () => {};
  sky.name = 'Sky';
  return sky;
}

function makeAudio() {
  let ctx = null;
  const tones = {
    build: [[523, 0], [784, 0.08]],
    fail: [[220, 0], [180, 0.1]],
    coin: [[988, 0], [1319, 0.05]],
  };
  return {
    play(name) {
      try {
        ctx ??= new AudioContext();
        const now = ctx.currentTime;
        for (const [f, at] of tones[name] ?? []) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'triangle';
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, now + at);
          g.gain.exponentialRampToValueAtTime(0.12, now + at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.15);
          o.connect(g).connect(ctx.destination);
          o.start(now + at);
          o.stop(now + at + 0.16);
        }
      } catch { /* audio is optional */ }
    },
  };
}

main().catch((err) => {
  console.error(err);
  $('loading-text').textContent = `Failed to load: ${err.message}`;
});
