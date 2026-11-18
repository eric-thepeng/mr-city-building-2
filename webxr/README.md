# MR City Building — WebXR

A browser port of the Unity game on `main`, built with [three.js](https://threejs.org) and WebXR.
It runs in the Meta Quest browser (mixed reality with passthrough, or VR) and on desktop with a mouse.
No build step and no install: it is plain ES modules, and three.js loads from a CDN.

## Run it

```bash
python -m http.server 8123 --directory webxr
```

Then open <http://localhost:8123>.

- **Desktop:** drag buildings with the mouse. The scroll wheel sets the height, Q/E rotates, and dragging empty space orbits the camera.
- **No headset?** Open <http://localhost:8123/?emulate>. This installs Meta's
  [Immersive Web Emulation Runtime](https://github.com/meta-quest/immersive-web-emulation-runtime),
  an emulated Quest 3, so you can use *Enter VR* / *Enter MR* in a normal browser.
- **Quest:** WebXR needs HTTPS or `localhost`. The quickest way is to plug the headset in over USB and run
  `adb reverse tcp:8123 tcp:8123`. Then open `http://localhost:8123` in the Quest browser.
  You can also host the `webxr/` folder on any HTTPS static host, such as GitHub Pages.

## How it maps to the Unity project

| Unity (`Assets/Scripts`)                          | WebXR (`webxr/src`)                                        |
|---------------------------------------------------|------------------------------------------------------------|
| `BuildingBase.cs`                                 | `Building` in `game.js`: states, cost, release / reset     |
| `SupportBeam.cs`                                  | `Building.calculateSupportBeam` (downward raycast per beam) |
| `ScoringIdentifier.cs`                            | `Building.calculateScoring` / `sendAndAddScore`            |
| `HandManager.cs` + `SO_HandPreset`                | `HandManager` in `game.js`                                 |
| `MoneyManager.cs`                                 | `MoneyManager` in `game.js` (starting budget 100)          |
| `SO_BuildingIdentifier`                           | `buildingInfo` in `data/game-data.json`                    |
| XR Interaction Toolkit (grab / ray / hover)       | `XRInput` in `input.js` (controllers + hand tracking)      |
| TextMeshPro world UI                              | canvas labels in `ui.js`                                   |
| `Environment.prefab` (terrain + resource nodes)   | `environment` in `data/game-data.json`                     |

The data is **exported from the Unity assets**, not hand-copied. If you change a prefab, a
ScriptableObject, or the environment in Unity, regenerate it:

```bash
python webxr/tools/export_game_data.py
```

The export reads the prefab/scene YAML (`tools/unity_yaml.py`) and the Odin-serialized
scoring tables and hand presets. It converts Unity's left-handed transforms to three.js, writes
`data/game-data.json`, and copies the FBX models and textures it needs into `assets/`.

## Differences from the Unity build

- **Resource nodes score.** In Unity, `BuildingBase.Start()` sets `canScore = false` on every
  node, including ore and gas resource nodes. That is why the commit says "working except resource
  scoring". Here they score as the ScriptableObjects describe, for example Gas Extractor next to gas +6.
- **Grabbed buildings stay upright.** They follow the controller's yaw only, so the support beams stay vertical.
- **Ray grab:** the thumbstick pushes the building away or pulls it in.
- MK Toon shading is approximated with `MeshToonMaterial`. The gas VFX Graph is a simple puff effect.
- MR mode uses `immersive-ar` (passthrough) with the same layout. VR mode adds a gradient sky.
