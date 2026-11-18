import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AssetLibrary } from './assets.js';
import { Game } from './game.js';
import { XRInput, MouseInput } from './input.js';
import { updateBillboards } from './ui.js';

const $ = (id) => document.getElementById(id);

// ?emulate  -> install Meta's Immersive Web Emulation Runtime (a Quest 3 in the
// browser, with an on-screen control panel) so XR can be tried without a headset.
async function installEmulator() {
  const { XRDevice, metaQuest3 } = await import('https://cdn.jsdelivr.net/npm/iwer@2.7.0/+esm');
  const device = new XRDevice(metaQuest3);
  device.installRuntime({ forceInstall: true });
  window.__xrDevice = device;
  try {
    const { DevUI } = await import('https://esm.sh/@iwer/devui@2.7.0');
    new DevUI(device);
  } catch (err) {
    console.warn('IWER DevUI unavailable', err);
  }
}

async function main() {
  if (new URLSearchParams(location.search).has('emulate')) await installEmulator();
  const data = await (await fetch('data/game-data.json')).json();
  const assets = new AssetLibrary(data);
  await assets.load((p) => { $('progress').style.width = `${Math.round(p * 100)}%`; });

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 200);
  // the Unity rig starts at the origin facing +Z (three.js: -Z), eyes ~1.6 m up
  camera.position.set(0.05, 1.4, 0.3);

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
  scene.fog = new THREE.Fog(0xbfd8f0, 8, 40);

  // ---------------------------------------------------------------- world
  const terrain = assets.build(data.environment.static, { fallbackMat: 'MT_Terrain_01' });
  terrain.name = 'Terrain';
  scene.add(terrain);

  const game = new Game({ data, assets, scene, terrain });
  game.audio = makeAudio();
  game.events.addEventListener('money', (e) => { $('budget').textContent = e.amount; });
  game.events.addEventListener('hand', (e) => { $('hand').textContent = e.preset.name.replace('_', ' '); });
  game.start();

  // ---------------------------------------------------------------- input
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-0.05, 0.95, -0.25);
  controls.enableDamping = true;
  controls.maxDistance = 6;
  controls.update();
  const mouse = new MouseInput(camera, renderer.domElement, game, controls);
  const xrInput = new XRInput(renderer, scene, game);

  // ---------------------------------------------------------------- XR session
  let mode = null;
  const startSession = async (sessionMode) => {
    const session = await navigator.xr.requestSession(sessionMode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'bounded-floor'],
    });
    mode = sessionMode;
    const ar = sessionMode === 'immersive-ar';
    sky.visible = !ar;
    scene.fog = ar ? null : new THREE.Fog(0xbfd8f0, 8, 40);
    mouse.enabled = false;
    session.addEventListener('end', () => {
      mode = null;
      sky.visible = true;
      scene.fog = new THREE.Fog(0xbfd8f0, 8, 40);
      mouse.enabled = true;
      document.body.classList.remove('in-xr');
    });
    await renderer.xr.setSession(session);
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
  else if (!navigator.xr) $('xr-note').textContent = 'This browser has no WebXR. Use the mouse to play, or open on a Quest.';

  $('restart').addEventListener('click', () => game.restart());
  $('loading').classList.add('hidden');
  window.__game = game; // handy for debugging in the console
  window.__xrInput = xrInput;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    if (!mode) controls.update();
    else xrInput.update(dt);
    game.update(dt);
    game.group.traverse((o) => o.userData.animated && o.userData.update(t));
    const viewer = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    updateBillboards(scene, viewer);
    // keep the budget panel facing the player (yaw only)
    const panel = game.money.anchor;
    viewer.getWorldPosition(panel.userData.look ??= new THREE.Vector3());
    panel.userData.look.y = panel.position.y;
    panel.lookAt(panel.userData.look);
    renderer.render(scene, camera);
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
