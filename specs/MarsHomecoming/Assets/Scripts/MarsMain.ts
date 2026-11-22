// MarsMain — entry point of the Mars Homecoming Lens. Port of webxr/src/main.js.
// Owns: loading the data and models, creating the Game, placing the sandbox ~75 cm ahead and
// ~45 cm below the eyes facing the player (and again on Recenter), the per-frame loop, turning
// the budget sign (yaw only), the choice panel and the labels towards the player, sound effects,
// and adapting the UI modules to the GameView interface.
// Expects (@input): the camera, the scaled Board object, the disabled model library (world.glb),
// the two UI modules. Must not: implement game rules (MarsGame / MarsBuilding / MarsProgress).

import {MarsSignUI} from "./MarsSignUI"
import {ChoiceView, MarsChoiceUI} from "./MarsChoiceUI"
import {Game, GameView, Sfx} from "./MarsGame"
import {CM_PER_UNIT} from "./MarsBuilding"
import {loadGameData} from "./MarsData"
import {MaterialSet, ModelLibrary} from "./MarsModels"
import {cylinderMesh, ringMesh, sphereMesh} from "./MarsMeshes"
import {WorldLabel} from "./MarsLabelsUI"
import {ChoiceState} from "./MarsProgress"

@component
export class MarsMain extends BaseScriptComponent implements GameView {
  @ui.label('<span style="color: #60A5FA;">MarsMain – Mars Homecoming sandbox</span>')
  @ui.separator
  @ui.group_start("References")
  @input
  @hint("The camera (Camera Object with Device Tracking)")
  camera: SceneObject

  @input
  @hint("Board: terrain, resources and buildings live here, scaled to 50 cm per game unit")
  board: SceneObject

  @input
  @hint("Disabled instance of Models/world.glb; buildings and resources are copied from it by node name")
  modelLibrary: SceneObject

  @input
  @hint("Budget sign (MarsSignUI)")
  signUI: MarsSignUI

  @input
  @hint("Choice panel in the hand row (MarsChoiceUI)")
  choiceUI: MarsChoiceUI

  @input
  @hint("game-data.json (exported from Unity)")
  gameData: JsonAsset

  @input
  @hint("expansion.json (hand-made buildings, packs, milestones)")
  expansionData: JsonAsset

  @input
  @hint("board.json (heightfield and resource nodes)")
  boardData: JsonAsset
  @ui.group_end

  @ui.separator
  @ui.group_start("Settings")
  @input
  @hint("Distance from the eyes to the centre of the board, in cm")
  @widget(new SliderWidget(40, 150, 1))
  boardDistance: number = 75

  @input
  @hint("How far below the eyes the board stands, in cm")
  @widget(new SliderWidget(0, 100, 1))
  boardBelowEyes: number = 45

  @input
  @hint("Start with every building pack unlocked (skips the milestones; the WebXR ?unlock)")
  unlockAllPacks: boolean = false

  @input
  @hint("Draw the grab / hover colliders")
  debugColliders: boolean = false

  @input
  @hint("Debug: start at the first score milestone (new pack card, then the hand choice) instead of a random first hand")
  startWithChoice: boolean = false

  @input
  @hint("Debug: deal this hand preset first (e.g. Skywatch_01); empty = a random hand, as in the WebXR version")
  firstHand: string = ""
  @ui.group_end

  @ui.separator
  @ui.group_start("Sounds")
  @input
  @allowUndefined
  @hint("Placed a building / picked a hand")
  sfxBuild: AudioTrackAsset

  @input
  @allowUndefined
  @hint("Can't build here / game over")
  sfxFail: AudioTrackAsset

  @input
  @allowUndefined
  @hint("A score reached the budget")
  sfxCoin: AudioTrackAsset

  @input
  @allowUndefined
  @hint("Score milestone")
  sfxMilestone: AudioTrackAsset

  @input
  @allowUndefined
  @hint("A cloud was used up or formed again")
  sfxCloud: AudioTrackAsset
  @ui.group_end

  private game: Game | null = null
  private sounds: Partial<Record<Sfx, AudioComponent>> = {}
  private needsPlacement = true
  private frames = 0
  private root: SceneObject
  private camT: Transform

  onAwake(): void {
    if (!this.camera || !this.board || !this.modelLibrary || !this.signUI || !this.choiceUI || !this.gameData || !this.expansionData || !this.boardData) {
      print("MarsMain: a required @input is not wired (camera, board, modelLibrary, signUI, choiceUI, data). Check the MarsHomecoming object.")
      return
    }
    this.root = this.getSceneObject()
    this.camT = this.camera.getTransform()
    this.modelLibrary.enabled = false
    this.makeSounds()
    this.createEvent("OnStartEvent").bind(() => this.start())
    this.createEvent("UpdateEvent").bind(() => this.update())
    this.createEvent("LateUpdateEvent").bind(() => this.lateUpdate())
  }

  private start(): void {
    const data = loadGameData(this.gameData, this.expansionData, this.boardData)
    const mats = loadMaterials()
    const models = new ModelLibrary(this.modelLibrary, mats)
    const meshes = {beam: cylinderMesh(0.003, 6), sphere: sphereMesh(24, 12), ring: ringMesh(0.6, 24)}
    const game = new Game(data, models, meshes, this.board, this.root, this)
    game.debugColliders = this.debugColliders
    game.progress.unlockAll = this.unlockAllPacks
    this.game = game

    // the sign over the far edge, the choice panel in the hand row
    this.signUI.getSceneObject().getTransform().setLocalPosition(game.signPosition.uniformScale(CM_PER_UNIT))
    this.choiceUI.setModelMaker((key, parent) => {
      const object = models.instance(`block_${key}`, parent)
      return {object, box: models.localBox(object, parent)}
    })
    this.signUI.onNewGame.add(() => this.game?.restart())
    this.signUI.onRecenter.add(() => (this.needsPlacement = true))
    this.choiceUI.onPickHand.add((i) => this.game?.progress.pickHand(i))
    this.choiceUI.onContinue.add(() => this.game?.progress.closeNotice())

    game.start(this.startWithChoice, this.firstHand)
    print(`MarsMain: started (${data.board.resources.length} resource nodes, ${Object.keys(data.blocks).length} building types, ${data.packs.length} packs)`)
  }

  private update(): void {
    const game = this.game
    if (!game) return
    game.update(Math.min(getDeltaTime(), 0.1))
    // the camera pose is valid after the first frames
    if (this.needsPlacement && ++this.frames > 2) {
      this.placeInFront()
      this.needsPlacement = false
      this.frames = 0
    }
  }

  private lateUpdate(): void {
    if (!this.game) return
    const cam = this.camT.getWorldPosition()
    // the budget sign turns towards the player (yaw only)
    const signT = this.signUI.getSceneObject().getTransform()
    const d = cam.sub(signT.getWorldPosition())
    const flat = new vec3(d.x, 0, d.z)
    if (flat.lengthSquared > 1e-6) signT.setWorldRotation(quat.lookAt(flat.normalize(), vec3.up()))
    // the choice panel faces the player fully (tilted back), so models stand above the text
    const choice = this.choiceUI.getSceneObject()
    if (choice.enabled) {
      const ct = choice.getTransform()
      const dc = cam.sub(ct.getWorldPosition())
      if (dc.lengthSquared > 1e-6) ct.setWorldRotation(quat.lookAt(dc.normalize(), vec3.up()))
    }
    WorldLabel.faceCamera(this.camT.getWorldRotation())
  }

  /** The sandbox in front of the player: ahead, below eye level, turned to face them. */
  private placeInFront(): void {
    const head = this.camT.getWorldPosition()
    let fwd = this.camT.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    fwd = new vec3(fwd.x, 0, fwd.z)
    fwd = fwd.lengthSquared < 1e-6 ? new vec3(0, 0, -1) : fwd.normalize()
    const pos = head.add(fwd.uniformScale(this.boardDistance))
    const t = this.root.getTransform()
    t.setWorldPosition(new vec3(pos.x, head.y - this.boardBelowEyes, pos.z))
    t.setWorldRotation(quat.fromEulerAngles(0, Math.atan2(-fwd.x, -fwd.z), 0))
  }

  // --- GameView ---------------------------------------------------------------
  setBudget(amount: number): void {
    this.signUI.setBudget(amount)
  }

  setScore(score: number, untilText: string): void {
    this.signUI.setScore(score, untilText)
  }

  setMessage(text: string | null, kind: "info" | "over"): void {
    this.signUI.setMessage(text, kind)
  }

  showChoice(state: ChoiceState | null): void {
    if (!state) {
      this.choiceUI.hide()
      return
    }
    const view: ChoiceView = state
    this.choiceUI.show(view)
    // stands in the hand row, its bottom edge a little below the row
    const game = this.game!
    const sc = game.spawnCenter
    const h = this.choiceUI.panelSize.y
    this.choiceUI.getSceneObject().getTransform().setLocalPosition(
      new vec3(sc.x * CM_PER_UNIT, (sc.y - 0.03) * CM_PER_UNIT + h / 2 - 2, sc.z * CM_PER_UNIT),
    )
  }

  budgetWorldPosition(): vec3 {
    return this.signUI.budgetWorldPosition()
  }

  sfx(name: Sfx): void {
    const a = this.sounds[name]
    if (a && !isNull(a)) {
      if (a.isPlaying()) a.stop(false)
      a.play(1)
    }
  }

  private makeSounds(): void {
    const tracks: Record<Sfx, AudioTrackAsset> = {
      build: this.sfxBuild,
      fail: this.sfxFail,
      coin: this.sfxCoin,
      milestone: this.sfxMilestone,
      cloud: this.sfxCloud,
    }
    for (const name of Object.keys(tracks) as Sfx[]) {
      const track = tracks[name]
      if (!track) continue
      const o = global.scene.createSceneObject(`Sfx-${name}`)
      o.setParent(this.getSceneObject())
      const a = o.createComponent("Component.AudioComponent") as AudioComponent
      a.audioTrack = track
      a.playbackMode = Audio.PlaybackMode.LowLatency
      a.volume = 0.6
      this.sounds[name] = a
    }
  }
}

/** The game's materials (Assets/Materials, made from the GLTF preset with the WebXR colours). */
function loadMaterials(): MaterialSet {
  return {
    regular: {
      Building: requireAsset("../Materials/MH_Building.mat") as Material,
      BuildingExtra: requireAsset("../Materials/MH_BuildingExtra.mat") as Material,
      Sign: requireAsset("../Materials/MH_Sign.mat") as Material,
      Glass: requireAsset("../Materials/MH_Glass.mat") as Material,
      Ore: requireAsset("../Materials/MH_Ore.mat") as Material,
      Terrain: requireAsset("../Materials/MH_Terrain.mat") as Material,
      SandboxWall: requireAsset("../Materials/MH_SandboxWall.mat") as Material,
      Crystal: requireAsset("../Materials/MH_Crystal.mat") as Material,
      Cloud: requireAsset("../Materials/MH_Cloud.mat") as Material,
    },
    error: {
      Building: requireAsset("../Materials/MH_Building_Error.mat") as Material,
      BuildingExtra: requireAsset("../Materials/MH_BuildingExtra_Error.mat") as Material,
      Sign: requireAsset("../Materials/MH_Sign_Error.mat") as Material,
      Glass: requireAsset("../Materials/MH_Glass_Error.mat") as Material,
      Ore: requireAsset("../Materials/MH_Ore_Error.mat") as Material,
    },
    beam: requireAsset("../Materials/MH_Beam.mat") as Material,
    beamError: requireAsset("../Materials/MH_Beam_Error.mat") as Material,
    detect: requireAsset("../Materials/MH_Detect.mat") as Material,
    ghost: requireAsset("../Materials/MH_Ghost.mat") as Material,
    dust: requireAsset("../Materials/MH_Dust.mat") as Material,
    gas: requireAsset("../Materials/MH_Gas.mat") as Material,
  }
}
