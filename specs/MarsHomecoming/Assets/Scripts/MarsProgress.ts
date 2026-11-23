// MarsProgress — score, milestones, building packs and the hand choice. Port of `Progress` in
// webxr/src/game.js. Score counts every point placements earned or lost (separate from the
// budget). Milestones unlock a random locked pack; its card is shown on its own at the next
// pick, then its first hand is one of the two choices.
// Owns: score / level / unlocked packs, the card texts (generated from the data), the choice flow.
// Pushes to: GameView (budget sign + choice panel). Receives: pickHand(i), closeNotice().
// Must not: build UI itself.

import type {Game} from "./MarsGame"
import {CardBlock, GameData, HandPreset, Pack, displayName} from "./MarsData"
import {CM_PER_UNIT} from "./MarsBuilding"

export interface ChoiceCard {
  text: string
  /** a formatted card (the new pack's); replaces `text` */
  blocks?: CardBlock[]
  /** building keys shown as small models on top of the card */
  models: string[]
  isNew?: boolean
}

export interface ChoiceState {
  title: string
  /** the new pack's card (green), shown on its own before the hand choice */
  notice: ChoiceCard | null
  hands: ChoiceCard[]
  showContinue: boolean
}

const cm = (v: number) => +(v * CM_PER_UNIT).toFixed(1)

export class Progress {
  unlockAll = false
  score = 0
  level = 0
  unlocked = new Set<string>()
  private fresh: Pack[] = []
  private freshPick: Pack | null = null
  private awaitingHands = false
  private notice: Pack | null = null
  private offered: HandPreset[] = []
  private messageText = ""
  private messageUntil = 0
  /** buildings that were in the game before the expansion (packs add bonuses to them) */
  private base: Set<string>

  constructor(private game: Game) {
    this.base = new Set<string>()
    for (const p of game.data.handPresets) for (const k of Object.keys(p.buildings)) this.base.add(k)
  }

  private get data(): GameData {
    return this.game.data
  }

  reset(): void {
    this.score = 0
    this.level = 0
    this.unlocked = new Set(this.unlockAll ? this.data.packs.map((p) => p.name) : [])
    this.fresh = []
    this.freshPick = null
    this.awaitingHands = false
    this.notice = null
    this.offered = []
    this.messageUntil = 0
    this.game.view.showChoice(null)
    this.refreshMessage()
    this.updateUI()
  }

  get nextAt(): number {
    const m = this.data.milestones
    if (!m.length) return Infinity
    return this.level < m.length ? m[this.level] : m[m.length - 1] + 80 * (this.level - m.length + 1)
  }

  /** Hand presets that can be dealt: Unity's, plus those of every unlocked pack. */
  pool(): HandPreset[] {
    const out = [...this.data.handPresets]
    for (const pack of this.data.packs) if (this.unlocked.has(pack.name)) out.push(...pack.presets)
    return out
  }

  locked(): Pack[] {
    return this.data.packs.filter((p) => !this.unlocked.has(p.name))
  }

  add(points: number): void {
    this.score += points
    while (this.score >= this.nextAt) {
      this.level++
      this.reach()
    }
    this.updateUI()
  }

  /** A milestone: a random locked pack joins the deck (or, once all are in, some budget). */
  private reach(): void {
    this.game.sfx("milestone")
    const locked = this.locked()
    if (!locked.length) {
      const n = this.data.milestoneBonus
      this.game.money.gain(n)
      this.flash(`Milestone! +${n} budget`, 2.5)
      return
    }
    const pack = locked[Math.floor(Math.random() * locked.length)]
    this.unlocked.add(pack.name)
    this.fresh.push(pack)
    this.flash(`Milestone! New pack: ${pack.displayName}`, 3)
  }

  // --- card text ---------------------------------------------------------
  private name(k: string): string {
    return displayName(this.data, k)
  }

  /** The new buildings of a pack (the ones the base game does not have). */
  newBuildings(pack: Pack): string[] {
    const keys: string[] = []
    for (const p of pack.presets) for (const k of Object.keys(p.buildings)) if (!keys.includes(k)) keys.push(k)
    return keys.filter((k) => !this.base.has(k))
  }

  /** A table of what a building scores: what it likes on the left, what it dislikes on the right. */
  private scoreTable(k: string): CardBlock | null {
    const b = this.data.buildingInfo[k]
    const row = ([o, v]: [string, number]): [string, string] => [this.name(o), `${v > 0 ? "+" : "\u2212"}${Math.abs(v)}`]
    const entries = Object.keys(b.scoring).map((o) => [o, b.scoring[o]] as [string, number])
    const good = entries.filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).map(row)
    const bad = entries.filter(([, v]) => v < 0).sort((x, y) => x[1] - y[1]).map(row)
    if (b.altitude) good.push([`Height per ${cm(b.altitude.per)} cm`, `+${b.altitude.points}`])
    return good.length || bad.length ? {good, bad} : null
  }

  /** The hover card of a building: name, range, score table, and its special rule. */
  scoreCard(k: string): CardBlock[] {
    const b = this.data.buildingInfo[k]
    const blocks: CardBlock[] = [{title: this.name(k)}]
    if (b.detectDistance > 0) blocks.push({sub: `Range ${cm(b.detectDistance)} cm`})
    const table = this.scoreTable(k)
    if (table) blocks.push(table)
    if (b.note) blocks.push({sub: b.note})
    return blocks
  }

  /** The card of a new pack: each new building's table, what it adds to old ones, its hands. */
  describe(pack: Pack): CardBlock[] {
    const info = this.data.buildingInfo
    const fresh = this.newBuildings(pack)
    const blocks: CardBlock[] = [{sub: pack.blurb ?? pack.summary ?? ""}]
    for (const k of fresh) {
      const b = info[k]
      blocks.push({heading: b.detectDistance > 0 ? `${this.name(k)} \u00b7 range ${cm(b.detectDistance)} cm` : this.name(k)})
      const table = this.scoreTable(k)
      if (table) blocks.push(table)
      if (b.note) blocks.push({sub: b.note})
    }
    // old buildings that now earn next to the new ones
    const liked: [string, string][] = []
    for (const k of Object.keys(info)) {
      if (!this.base.has(k)) continue
      for (const n of fresh) {
        if ((info[k].scoring[n] ?? 0) > 0) liked.push([`${this.name(k)} near ${this.name(n)}`, `+${info[k].scoring[n]}`])
      }
    }
    if (liked.length) blocks.push({heading: "Also"}, {good: liked, bad: []})
    blocks.push({heading: "Hands"})
    for (const p of pack.presets) blocks.push({text: this.handLine(p)})
    return blocks
  }

  handLine(preset: HandPreset): string {
    return Object.keys(preset.buildings)
      .map((k) => `${preset.buildings[k] > 1 ? `${preset.buildings[k]}× ` : ""}${this.name(k)}`)
      .join(" + ")
  }

  // --- the choice ----------------------------------------------------------
  /** The hand is used up: offer two hands (a just-unlocked pack's hand is always one of them). */
  offerHands(): void {
    if (this.game.over) return
    this.freshPick = this.fresh.shift() ?? null
    if (this.freshPick) {
      // a pack was unlocked: show its card on its own first, the hands after "Continue"
      this.notice = this.freshPick
      this.awaitingHands = true
      this.pushChoice()
      return
    }
    this.showHands()
  }

  private showHands(): void {
    const picks: {preset: HandPreset; pack: Pack | null}[] = []
    const freshPack = this.freshPick
    this.freshPick = null
    if (freshPack) picks.push({preset: freshPack.presets[0], pack: freshPack})
    const pool = this.pool().filter((p) => !picks.some((q) => q.preset === p))
    while (picks.length < 2 && pool.length) picks.push({preset: pool.splice(Math.floor(Math.random() * pool.length), 1)[0], pack: null})
    this.offered = picks.map((p) => p.preset)
    this.handCards = picks.map((pick) => {
      const p = pick.preset
      const lines = [`#${p.name.replace("_", " ")}${pick.pack ? ` · NEW (${pick.pack.displayName})` : ""}`]
      for (const k of Object.keys(p.buildings)) lines.push(`  ${p.buildings[k]}× ${this.name(k)}`)
      if (p.freeMoney) lines.push(`  +${p.freeMoney} budget`)
      return {text: lines.join("\n"), models: Object.keys(p.buildings), isNew: !!pick.pack}
    })
    this.pushChoice()
  }

  private handCards: ChoiceCard[] = []

  private pushChoice(): void {
    const notice = this.notice
    this.game.view.showChoice({
      title: notice ? `New pack unlocked: ${notice.displayName}` : "Pick your next hand",
      notice: notice ? {text: "", blocks: this.describe(notice), models: this.newBuildings(notice)} : null,
      hands: notice ? [] : this.handCards,
      showContinue: !!notice && this.awaitingHands,
    })
  }

  /** The pack card's Continue (or a tap on the card). */
  closeNotice(): void {
    if (!this.notice) return
    this.notice = null
    if (this.awaitingHands) {
      // the new pack's card was its own step; now the hand choice
      this.awaitingHands = false
      this.showHands()
      return
    }
    this.pushChoice()
  }

  /** A hand card was picked. */
  pickHand(i: number): void {
    if (this.game.over) return
    const preset = this.offered[i]
    if (!preset) return
    this.offered = []
    this.handCards = []
    this.notice = null
    this.game.view.showChoice(null)
    this.game.sfx("build")
    this.game.hand.deal(preset)
  }

  /** The game is over (budget below 0): clear the choice and say so on the sign. */
  gameOver(): void {
    this.awaitingHands = false
    this.offered = []
    this.handCards = []
    this.notice = null
    this.game.view.showChoice(null)
    this.refreshMessage()
  }

  // --- the budget sign -------------------------------------------------------
  /** A short message above the score for a few seconds. */
  private flash(text: string, seconds: number): void {
    this.messageText = text
    this.messageUntil = this.game.time + seconds
    this.refreshMessage()
  }

  private refreshMessage(): void {
    if (this.game.over) this.game.view.setMessage("Game over · tap New game", "over")
    else if (this.game.time < this.messageUntil) this.game.view.setMessage(this.messageText, "info")
    else this.game.view.setMessage(null, "info")
  }

  update(): void {
    if (this.messageUntil && this.game.time >= this.messageUntil) {
      this.messageUntil = 0
      this.refreshMessage()
    }
  }

  updateUI(): void {
    const left = this.nextAt - this.score
    this.game.view.setScore(this.score, `${left} until next ${this.locked().length ? "unlock" : "bonus"}`)
  }
}
