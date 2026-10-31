import Phaser from 'phaser';
import { CAPTAINS, type CaptainDef } from '../data/captains';
import { CHALLENGES, CHALLENGE_IDS, challengeRenown } from '../data/challenges';
import { applyLoadout, arrivals, COLOURS, coloursAt, loadout, loadoutsFor, nextMilestone, reachedMilestone, type MilestoneDef } from '../data/hideout';
import { POWERS } from '../data/powers';
import { PLAYER_SHIPS, SHIP_UNLOCKS } from '../data/ships';
import { weapon } from '../data/weapons';
import { setRun } from '../render/RunBar';
import { paintEnsign, setPlayerColours, shipGeometry, type Ensign } from '../render/ShipArt';
import { ShipView } from '../render/ShipView';
import { OptionsButton } from '../render/options';
import { playSfx } from '../render/sound';
import { escHandled } from '../render/escape';
import { CAPS_FONT, COLORS, SCREEN, TITLE_FONT, textStyle, titleStyle } from '../render/theme';
import { addTip, Button, drawBar, frame, goldText, panel, SoundButton, tooltip } from '../render/ui';
import { DIFFICULTY, Run, type Difficulty } from '../sim/Run';
import { Ship } from '../sim/Ship';
import type { PowerId, ShipDef } from '../sim/types';
import {
  bumpProfile,
  chosenColours,
  chosenLoadout,
  paintings,
  profile,
  recentEvents,
  setColours,
  setLoadout,
  unlockedCaptains,
  type VoyagePainting,
} from './save';

/**
 * The hideout between voyages, in place of a menu: ships moored in the cove, captains waiting on the quay, a notice
 * board for hardships and difficulty, and the tavern wall with a painting of every voyage. The cove grows with
 * lifetime renown (data/hideout.ts).
 *
 * The cove is painted 1680x945 and drawn at (-200, -112), so it runs past the 1280x720 design area on every side for
 * wider windows, and one painting pixel is one screen pixel: everything placed on it below is in screen pixels.
 */
const COVE = { x: -200, y: -112, w: 1680, h: 945 };

/** Where each ship lies at her moorings: centre x, waterline y, and drawn height (masts and all). */
const MOORINGS: Record<string, { x: number; y: number; h: number }> = {
  wren: { x: 440, y: 602, h: 188 },
  gull: { x: 650, y: 622, h: 214 },
  maw: { x: 878, y: 644, h: 244 },
  wolf: { x: 1112, y: 650, h: 206 },
};
/** The ship's notes, over the jungle between the tavern and the sunset. */
const CARD = { x: 330, y: 58, w: 420, h: 334 };
/** Captains stand along the quay, feet on the planks. */
const QUAY = { x: 282, step: 62, y: 694, h: 118 };
/** The notice board on the tavern porch. */
const BOARD = { x: 14, y: 462, w: 230, h: 188 };
/** The tavern itself, to click for its wall of paintings. */
const TAVERN = { x: 0, y: 96, w: 318, h: 356 };
/** Lanterns strung once the hideout has a name: along the jetty, the rail and the porch. */
const LANTERNS: [number, number][] = [
  [292, 500],
  [352, 486],
  [412, 470],
  [470, 455],
  [520, 445],
  [300, 602],
  [420, 620],
  [560, 640],
  [700, 664],
  [842, 684],
  [234, 420],
  [92, 432],
];
/** The milestone pieces painted over the cove (tools/art/finish_hub.py prints these offsets). */
const OVERLAYS: Partial<Record<MilestoneDef['id'], { key: string; x: number; y: number }>> = {
  jetty: { key: 'art:hub-jetty', x: 1004, y: 429 },
  careening: { key: 'art:hub-careen', x: 1014, y: 219 },
};
/** The tar-pot fire in the careening yard, the flagstaff and the beacon on the headland. */
const TAR_FIRE = { x: 1220, y: 393 };
const STAFF = { x: 1240, top: 68, foot: 236 };
const BEACON = { x: 1172, y: 214 };

const NUMBER_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
const BEST = {
  hull: Math.max(...PLAYER_SHIPS.map((d) => d.hull)),
  hands: Math.max(...PLAYER_SHIPS.map((d) => d.hands)),
  crew: Math.max(...PLAYER_SHIPS.map((d) => d.crew.length)),
};
/** Ensign art for each power's flag over the hideout; France has her own white flag, drawn here. */
const POWER_ENSIGN: Record<PowerId, Ensign | 'france'> = { crown: 'navy', spain: 'spanish', france: 'france', brethren: 'pirate', trade: 'trade' };

/** What the voyage just ended brings home: its painting for the tavern wall, and the renown before and after. */
export interface HarbourArrival {
  painting: VoyagePainting | null;
  before: number;
  after: number;
}

interface Moored {
  def: ShipDef;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  locked: string | null;
}

interface Figure {
  def: CaptainDef;
  img: Phaser.GameObjects.Image;
  plate: Phaser.GameObjects.Text;
  pool: Phaser.GameObjects.Image;
}

/** Why a ship is still locked (with progress), or null if she can be sailed. */
function lockReason(def: ShipDef): string | null {
  const unlock = SHIP_UNLOCKS[def.id];
  if (!unlock) return null;
  const have = profile().captures;
  return have >= unlock.captures ? null : `${unlock.text} (${have}/${unlock.captures})`;
}

export class HarbourScene extends Phaser.Scene {
  private ships: Moored[] = [];
  private figures: Figure[] = [];
  private selected = 1;
  private hovered: number | null = null;
  private captainId = 'rover';
  private difficulty: Difficulty = 'normal';
  private challenges = new Set<string>();
  /** Renown the hideout is shown at: the lifetime total, or the total before the voyage just ended while it arrives. */
  private shown = 0;
  private card: Phaser.GameObjects.GameObject[] = [];
  private view: ShipView | null = null;
  private notes: Phaser.GameObjects.GameObject[] = [];
  /** An open sheet over the cove (the tavern wall, the hardships), closed by Esc. */
  private sheet: Phaser.GameObjects.GameObject[] = [];
  private sheetClose: (() => void) | null = null;
  private hoverCard: Phaser.GameObjects.GameObject[] = [];
  private milestoneArt = new Map<MilestoneDef['id'], Phaser.GameObjects.GameObject[]>();
  private launch!: Button;
  private header!: Phaser.GameObjects.Text;
  private arrival: HarbourArrival | null = null;
  /** True while the voyage's homecoming is played: keys wait until it is done. */
  private busy = false;
  private shipFocus = 0;

  constructor() {
    super('Harbour');
  }

  init(data: { shipId?: string; arrival?: HarbourArrival }): void {
    const i = PLAYER_SHIPS.findIndex((s) => s.id === (data?.shipId ?? this.registry.get('harbour-ship')));
    this.selected = i >= 0 ? i : 1;
    this.arrival = data?.arrival ?? null;
    this.ships = [];
    this.figures = [];
    this.card = [];
    this.view = null;
    this.notes = [];
    this.sheet = [];
    this.sheetClose = null;
    this.hoverCard = [];
    this.milestoneArt = new Map();
    this.hovered = null;
    this.busy = false;
  }

  preload(): void {
    if (!this.textures.exists('art:chart-paper')) this.load.image('art:chart-paper', 'art/chart-paper.jpg');
    // The hideout's own art loads here rather than at boot; anything missing is drawn plainly instead.
    const art = ['hub-cove.jpg', 'hub-wall.jpg', 'hub-jetty.png', 'hub-careen.png', ...PLAYER_SHIPS.map((s) => `hub-ship-${s.id}.png`), ...CAPTAINS.map((c) => `hub-cap-${c.id}.png`)];
    for (const file of art) {
      const key = `art:${file.replace(/\.\w+$/, '')}`;
      if (!this.textures.exists(key)) this.load.image(key, `art/${file}`);
    }
  }

  create(): void {
    const p = profile();
    const arrived = this.arrival && this.arrival.after > this.arrival.before ? this.arrival : null;
    this.shown = arrived ? arrived.before : p.renown;
    setPlayerColours(chosenColours());
    this.events.once('shutdown', () => this.view?.destroy());

    this.cove();
    for (const m of ['lanterns', 'jetty', 'careening', 'colours', 'beacon'] as MilestoneDef['id'][]) if (reachedMilestone(this.shown, m)) this.milestone(m, false);
    this.mooredShips();
    this.quay();

    // The header: the hideout's name and how famous its captain is.
    goldText(this, 24, 12, 'Hideout Cove', 36).setShadow(0, 2, '#000', 6, false, true);
    this.header = this.add.text(26, 56, '', textStyle(14, COLORS.text, { fontStyle: 'italic', wordWrap: { width: 290 } })).setShadow(0, 1, '#000', 4, false, true);
    this.refreshHeader();

    // Small controls along the top right, out of the painting's way.
    const top = 14;
    let bx = SCREEN.w - 20 - 38;
    new OptionsButton(this, bx, top, 38);
    bx -= 46;
    new SoundButton(this, bx, top, 38);
    bx -= 132;
    const home = new Button(this, bx, top, 124, 38, '← Title', () => this.scene.start('Title'), { size: 15, hint: 'Esc' });
    bx -= 138;
    new Button(this, bx, top, 130, 38, 'Logbook', () => this.scene.start('Logbook'), { size: 15 });
    bx -= 190;
    new Button(this, bx, top, 182, 38, 'Sail Together', () => this.scene.start('CoopLobby'), { size: 15, hint: 'T', tip: 'Co-op: crew one ship with friends on your network.' });

    this.launch = new Button(this, SCREEN.w - 24 - 300, SCREEN.h - 62, 300, 48, '', () => this.start(), { size: 19, hint: 'Enter' });

    const levels = Object.keys(DIFFICULTY) as Difficulty[];
    const saved = this.registry.get('difficulty') as Difficulty | undefined;
    this.difficulty = saved && levels.includes(saved) ? saved : 'normal';
    const savedCh = this.registry.get('challenges') as string[] | undefined;
    this.challenges = new Set((savedCh ?? []).filter((id) => CHALLENGE_IDS.includes(id)));
    const captains = unlockedCaptains().filter((c) => c.renown <= this.shown);
    const savedCaptain = this.registry.get('captain') as string | undefined;
    this.captainId = captains.some((c) => c.id === savedCaptain) ? savedCaptain! : 'rover';
    this.noticeBoard();
    this.tavernDoor();

    const kb = this.input.keyboard!;
    const free = () => !this.busy && !this.sheet.length;
    kb.on('keydown-LEFT', () => free() && this.select((this.selected + PLAYER_SHIPS.length - 1) % PLAYER_SHIPS.length));
    kb.on('keydown-RIGHT', () => free() && this.select((this.selected + 1) % PLAYER_SHIPS.length));
    kb.on('keydown-UP', () => free() && this.cycleCaptain(-1));
    kb.on('keydown-DOWN', () => free() && this.cycleCaptain(1));
    kb.on('keydown-C', () => free() && this.cycleCaptain(1));
    kb.on('keydown-D', () => free() && this.cycleDifficulty());
    kb.on('keydown-F', () => free() && this.cycleColours());
    kb.on('keydown-L', () => free() && this.cycleLoadout());
    kb.on('keydown-W', () => (this.sheet.length ? this.closeSheet() : free() && this.openWall()));
    kb.on('keydown-H', () => (this.sheet.length ? this.closeSheet() : free() && this.openHardships()));
    kb.on('keydown-T', () => free() && this.scene.start('CoopLobby'));
    PLAYER_SHIPS.forEach((_, i) =>
      kb.on(`keydown-${NUMBER_KEYS[i]}`, () => {
        if (this.sheet.length) (this.sheet.filter((o) => o instanceof Button && o.getData('pick'))[i] as Button | undefined)?.press();
        else if (free()) this.select(i);
      }),
    );
    kb.on('keydown-ENTER', () => {
      if (this.busy) return;
      if (this.sheet.length) this.closeSheet();
      else this.launch.press();
    });
    kb.on('keydown-ESC', () => {
      escHandled();
      if (this.busy) return;
      if (this.sheet.length) this.closeSheet();
      else home.press();
    });

    this.select(this.selected);
    this.selectCaptain(this.captainId, false);
    if (this.arrival) this.homecoming(this.arrival);
  }

  // --- The cove --------------------------------------------------------------------------------------------------

  private cove(): void {
    if (this.textures.exists('art:hub-cove')) {
      this.add.image(COVE.x, COVE.y, 'art:hub-cove').setOrigin(0).setDisplaySize(COVE.w, COVE.h).setDepth(-10);
    } else {
      // Without the painting: a dusk sky over dark water.
      const g = this.add.graphics().setDepth(-10);
      g.fillGradientStyle(0x3a2440, 0x3a2440, 0xc0603a, 0xc0603a, 1).fillRect(COVE.x, COVE.y, COVE.w, 520);
      g.fillStyle(0x0c2430, 1).fillRect(COVE.x, 408, COVE.w, COVE.h);
      g.fillStyle(0x2a1c10, 1).fillRect(COVE.x, 640, COVE.w, 300);
    }
    // Dusk deepens towards the edges, so the ships and the quay hold the eye.
    this.add.image(SCREEN.w / 2, SCREEN.h / 2, vignette(this)).setDisplaySize(COVE.w, COVE.h).setDepth(-9);

    // Glints of the last light on the water, under the sunset.
    const spark = sparkTexture(this);
    this.time.addEvent({
      delay: 220,
      loop: true,
      callback: () => {
        const x = 930 + (Math.random() - 0.5) * 140;
        const y = 440 + Math.random() * 120;
        const s = this.add.image(x, y, spark).setDepth(-8).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.18 + Math.random() * 0.3);
        this.tweens.add({ targets: s, alpha: 0.7, duration: 300 + Math.random() * 200, yoyo: true, onComplete: () => s.destroy() });
      },
    });
    // The tavern's lamps breathe.
    const glow = glowTexture(this);
    for (const [x, y, s] of [
      [113, 437, 1.3],
      [228, 300, 0.9],
      [292, 438, 0.8],
    ]) {
      const l = this.add.image(x, y, glow).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD).setScale(s).setAlpha(0.5);
      this.tweens.add({ targets: l, alpha: 0.75, scale: s * 1.08, duration: 900 + Math.random() * 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  /** Put a milestone's piece into the cove; `fresh` makes it arrive with a flourish. */
  private milestone(id: MilestoneDef['id'], fresh: boolean): Phaser.GameObjects.GameObject[] {
    if (this.milestoneArt.has(id)) return this.milestoneArt.get(id)!;
    const made: Phaser.GameObjects.GameObject[] = [];
    const glow = glowTexture(this);
    const flicker = (o: Phaser.GameObjects.Image, a: number) =>
      this.tweens.add({ targets: o, alpha: { from: a * 0.75, to: a }, duration: 260 + Math.random() * 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: Math.random() * 400 });
    switch (id) {
      case 'lanterns':
        for (const [x, y] of LANTERNS) {
          const post = this.add.image(x, y, lanternTexture(this)).setOrigin(0.5, 0.6).setDepth(-6);
          const l = this.add.image(x, y, glow).setDepth(-6).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55).setAlpha(0.8);
          flicker(l, 0.85);
          made.push(post, l);
        }
        break;
      case 'jetty':
      case 'careening': {
        const o = OVERLAYS[id];
        if (o && this.textures.exists(o.key)) made.push(this.add.image(o.x, o.y, o.key).setOrigin(0).setDepth(-7.5));
        if (id === 'careening') {
          const f = this.add.image(TAR_FIRE.x, TAR_FIRE.y, glow).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD).setScale(0.8).setTint(0xff9a40);
          flicker(f, 0.9);
          made.push(f);
        } else {
          const l = this.add.image(1281, 512, glow).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD).setScale(0.5);
          flicker(l, 0.8);
          made.push(l);
        }
        break;
      }
      case 'colours':
        made.push(...this.flagstaff());
        break;
      case 'beacon': {
        // An iron brazier on three legs, high on the hill above the yard.
        const tripod = this.add.graphics().setDepth(-7.1);
        tripod.lineStyle(2, 0x120c06, 1).lineBetween(BEACON.x - 9, BEACON.y + 22, BEACON.x, BEACON.y + 4).lineBetween(BEACON.x + 9, BEACON.y + 22, BEACON.x, BEACON.y + 4).lineBetween(BEACON.x, BEACON.y + 22, BEACON.x, BEACON.y + 4);
        tripod.fillStyle(0x1a1008, 1).fillRect(BEACON.x - 8, BEACON.y, 16, 6);
        made.push(tripod);
        const b = this.add.image(BEACON.x, BEACON.y, glow).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD).setScale(2.4).setTint(0xffa040);
        const core = this.add.image(BEACON.x, BEACON.y, glow).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD).setScale(0.7).setTint(0xfff0b0);
        flicker(b, 0.9);
        flicker(core, 1);
        made.push(b, core);
        // Sparks rise from it.
        const spark = sparkTexture(this);
        const ev = this.time.addEvent({
          delay: 160,
          loop: true,
          callback: () => {
            const s = this.add.image(BEACON.x + (Math.random() - 0.5) * 14, BEACON.y, spark).setDepth(-7).setBlendMode(Phaser.BlendModes.ADD).setScale(0.15).setTint(0xffb050);
            this.tweens.add({ targets: s, y: BEACON.y - 40 - Math.random() * 40, x: s.x + (Math.random() - 0.5) * 30, alpha: 0, duration: 1400, onComplete: () => s.destroy() });
          },
        });
        this.events.once('shutdown', () => ev.remove());
        break;
      }
    }
    this.milestoneArt.set(id, made);
    if (fresh)
      for (const o of made as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Alpha)[]) {
        const a = o.alpha;
        o.setAlpha(0);
        this.tweens.add({ targets: o, alpha: a, duration: 1400, ease: 'Sine.easeInOut' });
      }
    return made;
  }

  /** A flagstaff on the headland: your colours at the head, and below them every power that ever called you friend. */
  private flagstaff(): Phaser.GameObjects.GameObject[] {
    const made: Phaser.GameObjects.GameObject[] = [];
    const g = this.add.graphics().setDepth(-6.5);
    g.lineStyle(3, 0x1a1008, 1).lineBetween(STAFF.x, STAFF.foot, STAFF.x, STAFF.top);
    g.fillStyle(0xd9b467, 1).fillCircle(STAFF.x, STAFF.top - 2, 3);
    made.push(g);
    const flags: (Ensign | 'france')[] = [chosenColours(), ...(profile().allies ?? []).map((p) => POWER_ENSIGN[p])];
    flags.slice(0, 5).forEach((f, i) => {
      const img = this.add.image(STAFF.x, STAFF.top + 6 + i * 30, flagTexture(this, f)).setOrigin(1, 0.42).setDepth(-6.5).setScale(0.62);
      this.tweens.add({ targets: img, scaleY: 0.56, scaleX: 0.6, duration: 700 + i * 90, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      made.push(img);
    });
    const hit = this.add.rectangle(STAFF.x - 40, STAFF.top - 6, 50, 6 + flags.length * 30, 0, 0).setOrigin(0).setDepth(-6).setInteractive();
    const allies = profile().allies ?? [];
    addTip(hit, allies.length ? `Allied colours: ${allies.map((p) => POWERS[p].name).join(', ')}.` : 'Your colours. Powers you end a voyage allied with will fly theirs beside them.');
    made.push(hit);
    return made;
  }

  // --- Ships at their moorings -----------------------------------------------------------------------------------

  private mooredShips(): void {
    PLAYER_SHIPS.forEach((def, i) => {
      const m = MOORINGS[def.id] ?? { x: 500 + i * 170, y: 590, h: 190 };
      const key = this.textures.exists(`art:hub-ship-${def.id}`) ? `art:hub-ship-${def.id}` : shipSilhouette(this);
      // Her reflection first, upside down and broken by the swell.
      const shadow = this.add.image(m.x, m.y - 4, key).setOrigin(0.5, 0.03).setFlipY(true).setDepth(-5).setAlpha(0.22).setTint(0x40506a);
      shadow.setScale(m.h / shadow.height, (m.h / shadow.height) * 0.55);
      const glow = this.add.image(m.x, m.y - 6, glowTexture(this)).setDepth(-5).setBlendMode(Phaser.BlendModes.ADD).setScale(2.2, 0.6).setAlpha(0).setTint(0xffc070);
      const img = this.add.image(m.x, m.y, key).setOrigin(0.5, 0.97).setDepth(-4 + i * 0.01);
      img.setScale(m.h / img.height);
      const locked = lockReason(def);
      img.setTint(locked ? 0x2a3038 : 0xb8a898);
      // She rides the swell at her moorings, each to her own time.
      this.tweens.add({ targets: [img], y: m.y + 2.5, angle: { from: -0.6, to: 0.6 }, duration: 2400 + i * 330, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      img.setInteractive({ useHandCursor: true, pixelPerfect: this.textures.exists(`art:hub-ship-${def.id}`), alphaTolerance: 8 });
      img.on('pointerover', () => this.hoverShip(i));
      img.on('pointerout', () => this.hoverShip(null));
      img.on('pointerdown', () => !this.busy && this.select(i));
      if (locked) {
        const lock = this.add.image(m.x, m.y - m.h * 0.55, padlock(this)).setDepth(-3).setScale(1.3);
        addTip(img, `${def.name} is not yours yet. To unlock: ${locked}`);
        void lock;
      }
      this.ships.push({ def, img, shadow, glow, locked });
    });
  }

  private hoverShip(i: number | null): void {
    this.hovered = i;
    this.paintShips();
    // A hovered ship shows her notes; moving off goes back to the chosen one.
    if (!this.busy && !this.sheet.length) this.showCard(i ?? this.selected);
  }

  /** The chosen ship lit by a lantern on the water, a hovered one brightened, the rest in the dusk. */
  private paintShips(): void {
    this.ships.forEach((s, j) => {
      const lit = j === this.selected;
      const hover = j === this.hovered;
      s.img.setTint(s.locked ? (hover ? 0x40464e : 0x2a3038) : lit ? 0xfff0dc : hover ? 0xe8d8c4 : 0xa89888);
      this.tweens.killTweensOf(s.glow);
      this.tweens.add({ targets: s.glow, alpha: lit ? 0.55 : hover ? 0.25 : 0, duration: 300 });
    });
  }

  private select(i: number): void {
    const changed = i !== this.selected || !this.card.length;
    this.selected = i;
    this.registry.set('harbour-ship', PLAYER_SHIPS[i].id);
    const def = PLAYER_SHIPS[i];
    const locked = this.ships[i]?.locked;
    this.launch
      .setEnabled(!locked)
      .setText(locked ? `${def.name} is locked` : `Set Sail in ${def.name} →`)
      .setTip(locked ? `To unlock: ${locked}` : null);
    this.paintShips();
    if (changed) {
      playSfx(this, 'creak', 0.25);
      this.showCard(i);
    }
  }

  /** Her notes on a sheet over the jungle: name, particulars, guns and the shipwright's draught of her. */
  private showCard(i: number): void {
    if (this.shipFocus === i && this.card.length) return;
    this.shipFocus = i;
    for (const o of this.card) o.destroy();
    this.card = [];
    this.view?.destroy();
    this.view = null;
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.card.push(o);
      return o;
    };
    const def = PLAYER_SHIPS[i];
    const lo = chosenLoadout(def.id);
    const guns = lo ? loadout(lo)!.guns : def.guns;
    const c = CARD;
    const x = c.x + 20;
    const w = c.w - 40;
    keep(panel(this, c.x, c.y, c.w, c.h).setDepth(0.2));
    const name = keep(goldText(this, x, c.y + 10, def.name, 30).setDepth(0.3));
    keep(this.add.text(x + name.width + 12, c.y + 22, def.className, titleStyle(17, COLORS.text, { fontStyle: 'italic' })).setDepth(0.3));
    keep(this.add.text(x, c.y + 50, def.description, textStyle(13, COLORS.text, { wordWrap: { width: w }, lineSpacing: 2 })).setDepth(0.3));

    const g = keep(this.add.graphics().setDepth(0.3));
    const evasion = def.speedBonus > 0 ? `+${def.speedBonus}%` : def.speedBonus < 0 ? `${def.speedBonus}%` : '±0%';
    const tiles: [string, string, number | null, string][] = [
      ['Hull', `${def.hull}`, def.hull / BEST.hull, COLORS.text],
      ['Deckhands', `${def.hands}`, def.hands / BEST.hands, COLORS.text],
      ['Crew', `${def.crew.length}`, def.crew.length / BEST.crew, COLORS.text],
      ['Evasion', evasion, null, def.speedBonus > 0 ? COLORS.textGood : def.speedBonus < 0 ? COLORS.textWarn : COLORS.text],
    ];
    const sy = c.y + 108;
    const tw = Math.floor(w / tiles.length);
    tiles.forEach(([label, value, frac, color], j) => {
      const tx = x + j * tw;
      keep(this.add.text(tx, sy, label, { fontFamily: CAPS_FONT, fontSize: '13px', color: COLORS.textDim }).setDepth(0.3));
      keep(this.add.text(tx, sy + 15, value, textStyle(20, color, { fontStyle: 'bold' })).setDepth(0.3));
      if (frac !== null) drawBar(g, tx + 1, sy + 43, tw - 16, 4, frac, 0xc8a26a);
    });

    const counts = new Map<string, number>();
    for (const gun of guns) counts.set(weapon(gun.weapon).name, (counts.get(weapon(gun.weapon).name) ?? 0) + 1);
    const gunText = [...counts].map(([n, k]) => (k > 1 ? `${k}× ${n}` : n)).join(', ');
    const melee = def.melee && def.melee !== 1 ? ` · boarders ×${def.melee}` : '';
    keep(this.add.text(x, sy + 56, 'Guns', { fontFamily: CAPS_FONT, fontSize: '13px', color: COLORS.textDim }).setDepth(0.3));
    keep(this.add.text(x + 48, sy + 55, `${gunText}${melee}`, textStyle(13, COLORS.text, { wordWrap: { width: w - 48 } })).setDepth(0.3));

    // Her battery: as built, or one of the alternates renown has earned.
    const options = loadoutsFor(def.id, profile().renown);
    let py = sy + 80;
    if (options.length) {
      const label = lo ? loadout(lo)!.name : 'As built';
      const b = keep(
        new Button(this, x, py, w, 26, `Battery: ${label}`, () => this.cycleLoadout(), {
          size: 13,
          hint: 'L',
          tip: lo ? loadout(lo)!.blurb : `Her guns as the shipwright built her. Renown has earned other batteries: ${options.map((o) => o.name).join(', ')}.`,
        }),
      );
      b.setOn(!!lo).setDepth(0.3);
      py += 32;
    } else {
      const next = PLAYER_SHIPS.length && loadoutsFor(def.id, 1e9)[0];
      if (next) keep(this.add.text(x, py + 4, `At ${next.renown} renown: the ${next.name}.`, textStyle(12, COLORS.textDim, { fontStyle: 'italic' })).setDepth(0.3));
      py += 26;
    }

    // The shipwright's draught, on a strip of chart paper.
    const strip = { x: c.x + 14, y: py, w: c.w - 28, h: c.y + c.h - 14 - py };
    const paper = this.textures.exists('art:chart-paper') ? keep(this.add.image(strip.x, strip.y, 'art:chart-paper').setOrigin(0).setDisplaySize(strip.w, strip.h).setDepth(0.25)) : keep(this.add.rectangle(strip.x, strip.y, strip.w, strip.h, 0xd9c49a).setOrigin(0).setDepth(0.25));
    void paper;
    this.card.push(...frame(this, strip.x - 2, strip.y - 2, strip.w + 4, strip.h + 4, 0.26, false));
    const ship = new Ship({ ...def, guns }, 'player');
    const geo = shipGeometry(ship);
    const spanW = geo.padL - 0.25 + geo.tip + 1.2;
    const spanH = geo.beam * 2 + 0.2;
    const tile = Math.min(16, (strip.w - 30) / spanW, (strip.h - 8) / spanH);
    const left = strip.x + (strip.w - spanW * tile) / 2 + (geo.padL - 0.25) * tile;
    this.view = new ShipView(this, ship, left, strip.y + (strip.h - ship.height * tile) / 2, tile, false, false);

    const locked = this.ships[i]?.locked;
    if (locked) {
      // Her particulars stay readable; the lock lies across her draught.
      keep(this.add.rectangle(strip.x, strip.y, strip.w, strip.h, 0x05090d, 0.78).setOrigin(0).setDepth(7));
      keep(this.add.image(strip.x + 40, strip.y + strip.h / 2, padlock(this)).setScale(1.6).setDepth(7));
      keep(this.add.text(strip.x + 76, strip.y + strip.h / 2, `Not yet yours.\n${locked}`, textStyle(15, COLORS.text, { wordWrap: { width: strip.w - 96 }, lineSpacing: 3 })).setOrigin(0, 0.5).setDepth(7));
    }
    for (const o of this.card as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Alpha)[]) if ('setAlpha' in o) {
      const a = o.alpha;
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: a, duration: 160 });
    }
  }

  private cycleLoadout(): void {
    const def = PLAYER_SHIPS[this.selected];
    const options = [null, ...loadoutsFor(def.id, profile().renown).map((l) => l.id)];
    if (options.length < 2) return;
    const now = chosenLoadout(def.id);
    setLoadout(def.id, options[(options.indexOf(now) + 1) % options.length]);
    playSfx(this, 'click', 0.35);
    this.shipFocus = -1;
    this.showCard(this.selected);
  }

  // --- Captains on the quay --------------------------------------------------------------------------------------

  private quay(): void {
    CAPTAINS.forEach((def, i) => {
      const x = QUAY.x + i * QUAY.step;
      const y = QUAY.y + (i % 2 ? -6 : 0);
      const pool = this.add.image(x, y - 6, glowTexture(this)).setDepth(0.5).setBlendMode(Phaser.BlendModes.ADD).setScale(1.2, 0.45).setAlpha(0).setTint(0xffc070);
      const key = this.textures.exists(`art:hub-cap-${def.id}`) ? `art:hub-cap-${def.id}` : figureSilhouette(this);
      const img = this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(0.6 + (i % 2 ? 0 : 0.01));
      img.setScale(QUAY.h / img.height);
      const plate = this.add
        .text(x, y + 2, '', textStyle(11, COLORS.text, { align: 'center', stroke: '#000', strokeThickness: 3 }))
        .setOrigin(0.5, 0)
        .setDepth(0.7);
      img.setInteractive({ useHandCursor: true });
      img.on('pointerover', () => this.captainHover(i));
      img.on('pointerout', () => this.captainHover(null));
      img.on('pointerdown', () => !this.busy && this.selectCaptain(def.id));
      // A captain idles: a slow breath.
      this.tweens.add({ targets: img, scaleY: img.scaleY * 1.012, duration: 1600 + i * 170, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.figures.push({ def, img, plate, pool });
    });
    this.paintCaptains();
  }

  private captainOpen(def: CaptainDef): boolean {
    return def.renown <= this.shown;
  }

  /** Earned captains in the lantern light, the rest black against the dusk with the renown they wait for. */
  private paintCaptains(): void {
    for (const f of this.figures) {
      const open = this.captainOpen(f.def);
      const lit = f.def.id === this.captainId;
      if (open) f.img.clearTint().setTint(lit ? 0xffffff : 0xb0a49a);
      else f.img.setTintFill(0x07090c);
      f.img.setAlpha(open ? 1 : 0.88);
      f.plate.setText(open ? (lit ? f.def.name.replace(/^The /, '') : '') : `renown ${f.def.renown}`).setColor(open ? COLORS.gold : COLORS.textDim).setFontSize(open ? 12 : 10);
      this.tweens.killTweensOf(f.pool);
      this.tweens.add({ targets: f.pool, alpha: lit ? 0.6 : 0, duration: 260 });
    }
  }

  private selectCaptain(id: string, sound = true): void {
    const def = CAPTAINS.find((c) => c.id === id);
    if (!def) return;
    if (!this.captainOpen(def)) {
      if (sound) playSfx(this, 'click', 0.2);
      return;
    }
    this.captainId = id;
    this.registry.set('captain', id);
    if (sound) playSfx(this, 'click', 0.35);
    this.paintCaptains();
  }

  private cycleCaptain(dir: number): void {
    const open = CAPTAINS.filter((c) => this.captainOpen(c));
    const i = open.findIndex((c) => c.id === this.captainId);
    this.selectCaptain(open[(i + dir + open.length) % open.length].id);
    this.captainHover(this.figures.findIndex((f) => f.def.id === this.captainId), true);
  }

  /** A note above a captain: portrait if one is painted, name and gift, or the renown a locked one needs. */
  private captainHover(i: number | null, brief = false): void {
    for (const o of this.hoverCard) o.destroy();
    this.hoverCard = [];
    if (i === null || i < 0 || this.sheet.length) return;
    const f = this.figures[i];
    const open = this.captainOpen(f.def);
    const portrait = `art:portrait-captain-${f.def.id}`;
    const hasPortrait = open && this.textures.exists(portrait);
    const w = 300;
    const pw = hasPortrait ? 76 : 0;
    const text = open ? f.def.blurb : `Sails with you at ${f.def.renown} renown. You have ${profile().renown}.`;
    const body = this.add.text(0, 0, text, textStyle(13, COLORS.text, { wordWrap: { width: w - 28 - pw }, lineSpacing: 2 })).setDepth(12);
    const h = Math.max(hasPortrait ? 112 : 0, 40 + body.height + 14);
    const x = Phaser.Math.Clamp(f.img.x - w / 2, 8, SCREEN.w - w - 8);
    const y = f.img.y - QUAY.h - h - 10;
    const box = panel(this, x, y, w, h).setDepth(11);
    const head = this.add.text(x + 14 + pw, y + 10, open ? f.def.name : 'A stranger in the shadows', { fontFamily: CAPS_FONT, fontSize: '17px', color: open ? COLORS.gold : COLORS.textDim }).setDepth(12);
    body.setPosition(x + 14 + pw, y + 36);
    this.hoverCard.push(box, head, body);
    if (hasPortrait) {
      const img = this.add.image(x + 10, y + 10, portrait).setOrigin(0).setDepth(12);
      img.setScale(Math.min(72 / img.width, (h - 20) / img.height));
      this.hoverCard.push(img, ...frame(this, x + 9, y + 9, img.displayWidth + 2, img.displayHeight + 2, 12, false));
    }
    if (brief) {
      const shown = this.hoverCard;
      this.time.delayedCall(1600, () => {
        if (this.hoverCard !== shown) return;
        for (const o of shown) o.destroy();
        this.hoverCard = [];
      });
    }
  }

  // --- The notice board ------------------------------------------------------------------------------------------

  private noticeBoard(): void {
    const b = BOARD;
    const g = this.add.graphics().setDepth(0.4);
    // Two posts and a weathered board.
    g.fillStyle(0x1e140b, 1).fillRect(b.x + 18, b.y + b.h - 6, 9, 46).fillRect(b.x + b.w - 27, b.y + b.h - 6, 9, 46);
    g.fillStyle(0x000000, 0.4).fillRect(b.x + 5, b.y + 7, b.w, b.h);
    g.fillStyle(0x4a3220, 1).fillRect(b.x, b.y, b.w, b.h);
    g.lineStyle(1, 0x2a1a0c, 0.8);
    for (let yy = b.y + 22; yy < b.y + b.h; yy += 22) g.lineBetween(b.x + 2, yy, b.x + b.w - 2, yy);
    g.lineStyle(3, 0x2a1a0c, 1).strokeRect(b.x, b.y, b.w, b.h);
    this.add.text(b.x + b.w / 2, b.y + 6, 'Notices', { fontFamily: CAPS_FONT, fontSize: '16px', color: '#e9d7b0' }).setOrigin(0.5, 0).setDepth(0.45).setShadow(0, 1, '#000', 3, false, true);
    this.refreshNotes();
  }

  /** The three notes pinned to the board: difficulty, hardships, colours. Each click changes it. */
  private refreshNotes(): void {
    for (const o of this.notes) o.destroy();
    this.notes = [];
    const b = BOARD;
    const n = this.challenges.size;
    const bonus = Math.round((challengeRenown([...this.challenges]) - 1) * 100);
    const colours = COLOURS.find((c) => c.id === chosenColours())!;
    const slips: { text: string; hint: string; tip: string; act: () => void; angle: number; flag?: Ensign }[] = [
      { text: `${DIFFICULTY[this.difficulty].label}`, hint: 'D', tip: `Difficulty. ${DIFFICULTY[this.difficulty].blurb} Click to change.`, act: () => this.cycleDifficulty(), angle: -2 },
      {
        text: n ? `Hardships: ${n}\n+${bonus}% renown` : 'No hardships',
        hint: 'H',
        tip: `Sail with a handicap for more renown.${n ? `\n\n${CHALLENGES.filter((c) => this.challenges.has(c.id)).map((c) => `${c.name}: ${c.blurb}`).join('\n')}` : ''}`,
        act: () => this.openHardships(),
        angle: 1.5,
      },
      {
        text: colours.name,
        hint: 'F',
        tip: `The colours you fly: ${colours.blurb}${coloursAt(profile().renown).length > 1 ? ' Click to change.' : ` More are earned with renown (${COLOURS.filter((c) => c.renown > 0).map((c) => `${c.name} at ${c.renown}`).join(', ')}).`}`,
        act: () => this.cycleColours(),
        angle: -1,
        flag: colours.id,
      },
    ];
    slips.forEach((s, i) => {
      const sx = b.x + 12 + (i === 2 ? 0 : i * 106);
      const sy = b.y + 32 + (i === 2 ? 76 : 0);
      const sw = i === 2 ? b.w - 24 : 98;
      const sh = i === 2 ? 66 : 68;
      const slip = this.add.container(sx + sw / 2, sy + sh / 2).setDepth(0.5).setAngle(s.angle);
      const paper = this.textures.exists('art:chart-paper') ? this.add.image(0, 0, 'art:chart-paper').setDisplaySize(sw, sh) : this.add.rectangle(0, 0, sw, sh, 0xd9c49a);
      const shade = this.add.rectangle(3, 4, sw, sh, 0x000000, 0.35);
      const pin = this.add.circle(0, -sh / 2 + 6, 3.5, 0x8a1c1c).setStrokeStyle(1, 0x2a0a0a);
      const t = this.add
        .text(s.flag ? -sw / 2 + 74 : 0, 2, s.text, { fontFamily: TITLE_FONT, fontSize: '15px', color: COLORS.ink, align: s.flag ? 'left' : 'center', wordWrap: { width: s.flag ? sw - 86 : sw - 10 } })
        .setOrigin(s.flag ? 0 : 0.5, 0.5);
      const hint = this.add.text(sw / 2 - 5, sh / 2 - 3, s.hint, { fontFamily: TITLE_FONT, fontSize: '11px', color: COLORS.inkRed }).setOrigin(1, 1).setAlpha(0.8);
      slip.add([shade, paper, pin, t, hint]);
      if (s.flag) slip.add(this.add.image(-sw / 2 + 64, 2, flagTexture(this, s.flag)).setOrigin(1, 0.42).setScale(0.62));
      slip.setSize(sw, sh).setInteractive({ useHandCursor: true });
      slip.on('pointerover', () => slip.setScale(1.05));
      slip.on('pointerout', () => slip.setScale(1));
      slip.on('pointerdown', () => !this.busy && s.act());
      addTip(slip, s.tip);
      this.notes.push(slip);
    });
  }

  private cycleDifficulty(): void {
    const levels = Object.keys(DIFFICULTY) as Difficulty[];
    this.difficulty = levels[(levels.indexOf(this.difficulty) + 1) % levels.length];
    this.registry.set('difficulty', this.difficulty);
    playSfx(this, 'page', 0.4);
    tooltip(this).hide();
    this.refreshNotes();
  }

  private cycleColours(): void {
    const open = coloursAt(profile().renown);
    if (open.length < 2) return;
    const next = open[(open.findIndex((c) => c.id === chosenColours()) + 1) % open.length];
    setColours(next.id);
    setPlayerColours(next.id);
    playSfx(this, 'sail', 0.3);
    tooltip(this).hide();
    this.refreshNotes();
    // The flagstaff and the ship's draught fly the new colours.
    const staff = this.milestoneArt.get('colours');
    if (staff) {
      for (const o of staff) o.destroy();
      this.milestoneArt.delete('colours');
      this.milestone('colours', false);
    }
    this.shipFocus = -1;
    this.showCard(this.selected);
  }

  // --- Sheets over the cove: hardships and the tavern wall --------------------------------------------------------

  private closeSheet(): void {
    const items = this.sheet;
    const after = this.sheetClose;
    this.sheet = [];
    this.sheetClose = null;
    tooltip(this).hide();
    this.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
    after?.();
  }

  private openHardships(): void {
    if (this.sheet.length) return;
    const ROW = 56;
    const w = 600;
    const h = 108 + CHALLENGES.length * ROW + 60;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2;
    const veil = this.add.rectangle(COVE.x, COVE.y, COVE.w, COVE.h, 0x000000, 0.55).setOrigin(0).setDepth(20).setInteractive();
    veil.on('pointerdown', () => this.closeSheet());
    const box = panel(this, x, y, w, h, { modal: true }).setDepth(21);
    box.setInteractive();
    const head = goldText(this, SCREEN.w / 2, y + 16, 'Hardships', 32).setOrigin(0.5, 0).setDepth(22);
    const note = this.add
      .text(SCREEN.w / 2, y + 62, 'Each one makes the voyage harder and earns a share more renown.', textStyle(14, COLORS.textDim, { align: 'center' }))
      .setOrigin(0.5, 0)
      .setDepth(22);
    this.sheet.push(veil, box, head, note);
    CHALLENGES.forEach((c, i) => {
      const label = () => `${this.challenges.has(c.id) ? '✓ ' : ''}${c.name}  ·  +${Math.round(c.renown * 100)}% renown`;
      const b: Button = new Button(this, x + 30, y + 96 + i * ROW, w - 60, 44, label(), () => {
        if (this.challenges.has(c.id)) this.challenges.delete(c.id);
        else this.challenges.add(c.id);
        this.registry.set('challenges', [...this.challenges]);
        b.setText(label()).setOn(this.challenges.has(c.id));
      }, { size: 16, tip: c.blurb, hint: `${i + 1}` });
      b.setOn(this.challenges.has(c.id)).setDepth(22).setData('pick', true);
      this.sheet.push(b);
    });
    this.sheet.push(new Button(this, SCREEN.w / 2 - 90, y + h - 54, 180, 38, 'Done', () => this.closeSheet(), { size: 16, hint: 'Enter' }).setDepth(22));
    this.sheetClose = () => this.refreshNotes();
  }

  private tavernDoor(): void {
    const t = TAVERN;
    const hit = this.add.rectangle(t.x, t.y, t.w, t.h, 0xffffff, 0).setOrigin(0).setDepth(0.1).setInteractive({ useHandCursor: true });
    const sign = this.add.container(186, 470).setDepth(0.42);
    const n = paintings().length;
    const board = this.add.rectangle(0, 0, 150, 30, 0x2a1a0c, 0.92).setStrokeStyle(1.5, COLORS.brass, 0.8);
    const label = this.add.text(-4, 0, 'The Tavern', { fontFamily: CAPS_FONT, fontSize: '16px', color: COLORS.gold }).setOrigin(0.5);
    const key = this.add.text(70, 1, 'W', textStyle(11, '#c9b48a')).setOrigin(1, 0.5);
    sign.add([board, label, key]);
    sign.setPosition(146, 398);
    const glow = this.add.image(140, 300, glowTexture(this)).setDepth(0.05).setBlendMode(Phaser.BlendModes.ADD).setScale(3.2, 2.6).setAlpha(0).setTint(0xffc070);
    hit.on('pointerover', () => this.tweens.add({ targets: glow, alpha: 0.3, duration: 200 }));
    hit.on('pointerout', () => this.tweens.add({ targets: glow, alpha: 0, duration: 200 }));
    hit.on('pointerdown', () => !this.busy && this.openWall());
    addTip(hit, n ? `The tavern wall: ${n} painting${n > 1 ? 's' : ''} of your voyages.` : 'The tavern wall, bare as yet: every voyage you sail will hang a painting here.');
  }

  /** The tavern wall: a painting of each voyage, with a brass plate. `hang` is carried in and hung first. */
  private openWall(hang: VoyagePainting | null = null, onClose?: () => void): void {
    if (this.sheet.length) return;
    tooltip(this).hide();
    for (const o of this.hoverCard) o.destroy();
    this.hoverCard = [];
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.sheet.push(o);
      return o;
    };
    if (this.textures.exists('art:hub-wall')) keep(this.add.image(COVE.x, COVE.y, 'art:hub-wall').setOrigin(0).setDisplaySize(COVE.w, COVE.h).setDepth(20).setInteractive());
    else keep(this.add.rectangle(COVE.x, COVE.y, COVE.w, COVE.h, 0x24170d, 1).setOrigin(0).setDepth(20).setInteractive());
    keep(this.add.rectangle(COVE.x, COVE.y, COVE.w, COVE.h, 0x000000, 0.25).setOrigin(0).setDepth(20.1));
    keep(goldText(this, SCREEN.w / 2, 16, 'The Tavern Wall', 38).setOrigin(0.5, 0).setDepth(21).setShadow(0, 2, '#000', 6, false, true));
    const wall = paintings().slice().reverse();
    if (!wall.length) {
      keep(
        this.add
          .text(SCREEN.w / 2, SCREEN.h / 2 - 20, 'The wall is bare.\nSail a voyage, and the tavern will hang her painting here.', titleStyle(22, COLORS.text, { align: 'center', fontStyle: 'italic', lineSpacing: 6 }))
          .setOrigin(0.5)
          .setDepth(21)
          .setShadow(0, 2, '#000', 6, false, true),
      );
    }
    // Four to a row, newest first, each in a gilt frame with its brass plate beneath.
    const PW = 212;
    const PH = 119;
    const GAP_X = 64;
    const ROW_H = 194;
    const perRow = 4;
    const rows = Math.ceil(wall.length / perRow);
    const top = Math.max(76, (SCREEN.h - 70 - rows * ROW_H) / 2 + 56);
    let hung: Phaser.GameObjects.Container | null = null;
    wall.forEach((v, k) => {
      const row = Math.floor(k / perRow);
      const inRow = Math.min(perRow, wall.length - row * perRow);
      const x0 = (SCREEN.w - (inRow * PW + (inRow - 1) * GAP_X)) / 2;
      const cx = x0 + (k % perRow) * (PW + GAP_X) + PW / 2;
      const cy = top + row * ROW_H + PH / 2;
      const c = this.paintingFrame(v, PW, PH).setPosition(cx, cy).setDepth(21);
      keep(c);
      // Hung a touch askew, as tavern pictures are.
      c.setAngle(((v.seed % 7) - 3) * 0.4);
      if (hang && v.seed === hang.seed) hung = c;
    });
    keep(
      this.add
        .text(SCREEN.w / 2, SCREEN.h - 28, 'Click anywhere or press Esc to go back out to the cove', textStyle(13, COLORS.textDim, { fontStyle: 'italic' }))
        .setOrigin(0.5)
        .setDepth(21),
    );
    const back = this.sheet[0];
    back.on('pointerdown', () => !this.busy && this.closeSheet());
    this.sheetClose = onClose ?? null;
    playSfx(this, 'creak', 0.3);
    if (hung) this.hangAnimation(hung);
  }

  /** One voyage in a gilt frame: her portrait, her captain, how far she got, her renown and a line from her log. */
  private paintingFrame(v: VoyagePainting, w: number, h: number): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const def = PLAYER_SHIPS.find((s) => s.id === v.ship);
    const cap = CAPTAINS.find((x) => x.id === v.captain);
    c.add(this.add.rectangle(6, 9, w + 22, h + 22, 0x000000, 0.5));
    // The gilt frame: a dark rebate inside a gold moulding.
    c.add(this.add.rectangle(0, 0, w + 22, h + 22, 0x8a6a2a).setStrokeStyle(3, 0xd9b467));
    c.add(this.add.rectangle(0, 0, w + 8, h + 8, 0x3a2810).setStrokeStyle(1, 0xf2d38a, 0.8));
    const key = `art:ship-${v.ship}`;
    if (this.textures.exists(key)) {
      const img = this.add.image(0, 0, key);
      const s = Math.max(w / img.width, h / img.height);
      img.setScale(s).setCrop((img.width - w / s) / 2, (img.height - h / s) / 2, w / s, h / s);
      // A lost voyage is painted in the dark of the storm that took her.
      if (!v.won) img.setTint(0x9a8c80);
      c.add(img);
    } else c.add(this.add.rectangle(0, 0, w, h, 0x1d3041));
    if (!v.won) {
      // Black crape across the corner for a ship that never came home.
      const crape = this.add.graphics();
      crape.fillStyle(0x07070a, 0.92).fillTriangle(w / 2 - 46, -h / 2 - 11, w / 2 + 11, -h / 2 - 11, w / 2 + 11, -h / 2 + 46);
      c.add(crape);
    } else {
      c.add(this.add.image(w / 2 - 6, -h / 2 + 8, glowTexture(this)).setScale(0.4).setTint(0xffe080).setBlendMode(Phaser.BlendModes.ADD));
    }
    // The brass plate.
    const plate = this.add.rectangle(0, h / 2 + 30, w - 10, 40, 0xb08a3e).setStrokeStyle(1.5, 0x5a4018);
    const t1 = this.add.text(0, h / 2 + 14, `${def?.name ?? v.ship}  ·  ${cap?.name.replace(/^The /, '') ?? v.captain}`, { fontFamily: CAPS_FONT, fontSize: '14px', color: '#2a1606' }).setOrigin(0.5, 0);
    const t2 = this.add
      .text(0, h / 2 + 31, `${v.won ? 'Broke the blockade' : `${v.sailed} of ${v.total} legs · ${v.sea}`}  ·  +${v.renown} renown`, { fontFamily: TITLE_FONT, fontSize: '12px', color: '#2a1606', fontStyle: 'italic' })
      .setOrigin(0.5, 0);
    if (t2.width > w - 16) t2.setScale((w - 16) / t2.width);
    c.add([plate, t1, t2]);
    c.setSize(w + 22, h + 70);
    c.setInteractive({ useHandCursor: false });
    addTip(c, `${v.title}\n${v.label}: ${v.highlight}`);
    return c;
  }

  /** The voyage's painting carried in, held up, and hung on its nail: it swings and settles. */
  private hangAnimation(c: Phaser.GameObjects.Container): void {
    this.busy = true;
    const x = c.x;
    const y = c.y;
    const angle = c.angle;
    c.setPosition(SCREEN.w / 2, SCREEN.h + 160).setScale(1.5).setAngle(-6).setDepth(25);
    const shade = this.add.rectangle(COVE.x, COVE.y, COVE.w, COVE.h, 0x000000, 0.45).setOrigin(0).setDepth(24);
    const caption = this.add
      .text(SCREEN.w / 2, SCREEN.h / 2 + 150, 'A new painting for the wall', titleStyle(24, COLORS.gold, { fontStyle: 'italic' }))
      .setOrigin(0.5)
      .setDepth(26)
      .setAlpha(0)
      .setShadow(0, 2, '#000', 6, false, true);
    this.sheet.push(shade, caption);
    this.tweens.chain({
      targets: c,
      tweens: [
        { y: SCREEN.h / 2 - 30, angle: 2, duration: 900, ease: 'Cubic.easeOut', onStart: () => this.tweens.add({ targets: caption, alpha: 1, duration: 600, delay: 400 }) },
        { scale: 1.55, duration: 900, yoyo: true, ease: 'Sine.easeInOut' },
        {
          x,
          y,
          scale: 1,
          angle: angle + 7,
          duration: 700,
          ease: 'Cubic.easeInOut',
          onStart: () => {
            this.tweens.add({ targets: [shade, caption], alpha: 0, duration: 600 });
          },
          onComplete: () => {
            playSfx(this, 'hit-wood', 0.5);
            this.cameras.main.shake(90, 0.002);
          },
        },
        { angle: angle - 4, duration: 360, ease: 'Sine.easeInOut' },
        { angle: angle + 2, duration: 300, ease: 'Sine.easeInOut' },
        { angle, duration: 260, ease: 'Sine.easeOut' },
      ],
      onComplete: () => {
        c.setDepth(21);
        this.busy = false;
      },
    });
  }

  // --- Coming home -----------------------------------------------------------------------------------------------

  /** Back from a voyage: her painting is hung in the tavern, then whatever renown has brought arrives at the dock. */
  private homecoming(a: HarbourArrival): void {
    const news = arrivals(a.before, a.after);
    const captains = CAPTAINS.filter((c) => c.renown > a.before && c.renown <= a.after);
    const dock = () => this.arrive(a.after, news.milestones, captains, news.colours.length + news.loadouts.length ? [...news.colours.map((c) => `Colours: ${c.name}`), ...news.loadouts.map((l) => `${PLAYER_SHIPS.find((s) => s.id === l.ship)?.name}: the ${l.name}`)] : []);
    if (a.painting) this.time.delayedCall(350, () => this.openWall(a.painting, () => this.time.delayedCall(250, dock)));
    else dock();
  }

  /** Each new thing arrives in turn, with a banner across the cove. */
  private arrive(total: number, milestones: MilestoneDef[], captains: CaptainDef[], extras: string[]): void {
    const steps: { title: string; text: string; act: () => void }[] = [
      ...milestones.map((m) => ({ title: m.name, text: m.text, act: () => void this.milestone(m.id, true) })),
      ...captains.map((c) => ({
        title: `${c.name} joins the hideout`,
        text: c.blurb,
        act: () => {
          this.shown = Math.max(this.shown, c.renown);
          const f = this.figures.find((x) => x.def.id === c.id);
          if (f) {
            this.paintCaptains();
            const y = f.img.y;
            f.img.setY(y + 40).setAlpha(0);
            this.tweens.add({ targets: f.img, y, alpha: 1, duration: 900, ease: 'Cubic.easeOut' });
          }
        },
      })),
      ...(extras.length ? [{ title: 'Earned with renown', text: extras.join('\n'), act: () => this.refreshNotes() }] : []),
    ];
    const finish = () => {
      this.shown = total;
      this.paintCaptains();
      this.refreshHeader();
      this.shipFocus = -1;
      this.showCard(this.selected);
      this.busy = false;
    };
    if (!steps.length) return finish();
    this.busy = true;
    // The ship's notes make way for the news.
    for (const o of this.card) o.destroy();
    this.card = [];
    this.view?.destroy();
    this.view = null;
    playSfx(this, 'bell', 0.5);
    let k = 0;
    const next = () => {
      if (k >= steps.length) return finish();
      const s = steps[k++];
      s.act();
      this.banner(s.title, s.text, next);
    };
    next();
  }

  /** A banner across the cove that waits for a click or a key (or a few seconds). */
  private banner(title: string, text: string, done: () => void): void {
    const w = 640;
    const body = this.add.text(SCREEN.w / 2, 0, text, textStyle(15, COLORS.text, { align: 'center', wordWrap: { width: w - 60 }, lineSpacing: 3 })).setOrigin(0.5, 0).setDepth(31);
    const h = 70 + body.height + 34;
    const y = 132;
    const box = panel(this, (SCREEN.w - w) / 2, y, w, h, { modal: true }).setDepth(30);
    const kicker = this.add.text(SCREEN.w / 2, y + 12, 'New at the hideout', { fontFamily: CAPS_FONT, fontSize: '13px', color: COLORS.textDim }).setOrigin(0.5, 0).setDepth(31);
    const head = goldText(this, SCREEN.w / 2, y + 28, title, 26).setOrigin(0.5, 0).setDepth(31);
    body.setY(y + 66);
    const hint = this.add.text(SCREEN.w / 2, y + h - 22, 'Click or press Enter', textStyle(11, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(0.5, 0).setDepth(31);
    const parts = [box, kicker, head, body, hint];
    parts.forEach((o) => o.setAlpha(0));
    this.tweens.add({ targets: parts, alpha: 1, duration: 300 });
    playSfx(this, 'cheer', 0.25);
    let gone = false;
    const go = () => {
      escHandled();
      if (gone) return;
      gone = true;
      this.input.off('pointerdown', go);
      this.input.keyboard?.off('keydown-ENTER', go);
      this.input.keyboard?.off('keydown-SPACE', go);
      this.input.keyboard?.off('keydown-ESC', go);
      timer.remove();
      this.tweens.add({ targets: parts, alpha: 0, duration: 220, onComplete: () => parts.forEach((o) => o.destroy()) });
      done();
    };
    const timer = this.time.delayedCall(6000, go);
    // A beat before it can be dismissed, so a click meant for the last banner does not skip this one.
    this.time.delayedCall(350, () => {
      if (gone) return;
      this.input.on('pointerdown', go);
      this.input.keyboard?.on('keydown-ENTER', go);
      this.input.keyboard?.on('keydown-SPACE', go);
      this.input.keyboard?.on('keydown-ESC', go);
    });
  }

  private refreshHeader(): void {
    // While a voyage's renown is still arriving, the header shows the total from before it.
    const r = this.shown;
    const next = nextMilestone(r);
    this.header.setText(`Renown ${r}${next ? `  ·  ${next.name} at ${next.renown}` : '  ·  the most famous cove in the Caribbean'}`);
  }

  // --- Setting sail ----------------------------------------------------------------------------------------------

  private start(): void {
    if (this.busy) return;
    const def = PLAYER_SHIPS[this.selected];
    if (this.ships[this.selected]?.locked) return;
    bumpProfile('voyages');
    this.registry.set('counted-win', false);
    const run = new Run(def.id, undefined, this.difficulty, this.captainId, [...this.challenges]);
    applyLoadout(run, chosenLoadout(def.id));
    setPlayerColours(chosenColours());
    // Tales from the last few voyages come round less often.
    run.recent = recentEvents();
    setRun(this, run);
    this.registry.set('chart-note', '');
    playSfx(this, 'sail', 0.4);
    this.scene.start('SeaMap');
  }

  update(time: number): void {
    this.view?.draw(time);
  }
}

// --- Painted bits ------------------------------------------------------------------------------------------------

/** A soft round glow, for lanterns, fires and the light pooled under a chosen ship or captain. */
function glowTexture(scene: Phaser.Scene): string {
  const key = 'hub:glow';
  if (scene.textures.exists(key)) return key;
  const S = 96;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,214,140,0.9)');
  g.addColorStop(0.25, 'rgba(255,190,100,0.45)');
  g.addColorStop(1, 'rgba(255,170,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  tex.refresh();
  return key;
}

function sparkTexture(scene: Phaser.Scene): string {
  const key = 'hub:spark';
  if (scene.textures.exists(key)) return key;
  const S = 48;
  const c = S / 2;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,240,200,0.9)');
  glow.addColorStop(0.25, 'rgba(255,220,150,0.35)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,248,225,0.9)';
  ctx.beginPath();
  ctx.ellipse(c, c, c, 1.4, 0, 0, Math.PI * 2);
  ctx.fill();
  tex.refresh();
  return key;
}

/** A ship's lantern on a short post. */
function lanternTexture(scene: Phaser.Scene): string {
  const key = 'hub:lantern';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 14, 30)!;
  const ctx = tex.getContext();
  ctx.fillStyle = '#1a1008';
  ctx.fillRect(6, 14, 2, 16);
  ctx.fillRect(3, 4, 8, 2);
  ctx.fillStyle = '#ffd88a';
  ctx.fillRect(4, 6, 6, 8);
  ctx.strokeStyle = '#1a1008';
  ctx.lineWidth = 1;
  ctx.strokeRect(3.5, 5.5, 7, 9);
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(7, 4);
  ctx.stroke();
  tex.refresh();
  return key;
}

/** A dark vignette, clear in the middle. */
function vignette(scene: Phaser.Scene): string {
  const key = 'hub:vignette';
  if (scene.textures.exists(key)) return key;
  const W = 640;
  const H = 360;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.32, W / 2, H * 0.55, W * 0.6);
  g.addColorStop(0, 'rgba(4,8,12,0)');
  g.addColorStop(1, 'rgba(4,8,12,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  tex.refresh();
  return key;
}

/** A flag as it flies from a staff (hoist at the right): any ensign the ships fly, or the white flag of France. */
function flagTexture(scene: Phaser.Scene, flag: Ensign | 'france'): string {
  const key = `hub:flag-${flag}`;
  if (scene.textures.exists(key)) return key;
  const u = 80;
  const W = Math.ceil(1.25 * u);
  const H = Math.ceil(0.75 * u);
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  if (flag === 'france') {
    // Paint it as a trade flag for its shape, then whiten it and scatter golden lilies.
    paintEnsign(ctx, W - 0.1 * u, H * 0.42, u, 'trade');
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = '#efe9da';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d9aa48';
    for (const [x, y] of [
      [0.35, 0.3],
      [0.62, 0.4],
      [0.48, 0.58],
    ])
      ctx.fillRect(x * W - 2, y * H - 3, 4, 6);
    ctx.globalCompositeOperation = 'source-over';
  } else paintEnsign(ctx, W - 0.1 * u, H * 0.42, u, flag);
  tex.refresh();
  return key;
}

/** Without the painted ship: a dark hull and bare masts. */
function shipSilhouette(scene: Phaser.Scene): string {
  const key = 'hub:ship-silhouette';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 200, 200)!;
  const ctx = tex.getContext();
  ctx.fillStyle = '#1a120a';
  ctx.beginPath();
  ctx.moveTo(10, 160);
  ctx.lineTo(190, 160);
  ctx.lineTo(170, 194);
  ctx.lineTo(30, 194);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(70, 20, 5, 140);
  ctx.fillRect(125, 34, 5, 126);
  ctx.fillStyle = '#c8bca0';
  ctx.fillRect(48, 40, 50, 50);
  ctx.fillRect(104, 52, 46, 46);
  tex.refresh();
  return key;
}

/** Without a painted figure: a cloaked captain in a tricorn, in silhouette. */
function figureSilhouette(scene: Phaser.Scene): string {
  const key = 'hub:figure';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 60, 140)!;
  const ctx = tex.getContext();
  ctx.fillStyle = '#2a2018';
  ctx.beginPath();
  ctx.arc(30, 26, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, 20);
  ctx.lineTo(50, 20);
  ctx.lineTo(30, 8);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, 40);
  ctx.lineTo(44, 40);
  ctx.lineTo(52, 108);
  ctx.lineTo(8, 108);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(18, 104, 9, 36);
  ctx.fillRect(33, 104, 9, 36);
  tex.refresh();
  return key;
}

/** A small iron padlock. */
function padlock(scene: Phaser.Scene): string {
  const key = 'hub:padlock';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 28, 32)!;
  const ctx = tex.getContext();
  ctx.strokeStyle = '#d9c9a0';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(14, 13, 7, Math.PI, 0);
  ctx.lineTo(21, 16);
  ctx.moveTo(7, 13);
  ctx.lineTo(7, 16);
  ctx.stroke();
  ctx.fillStyle = '#b8924a';
  ctx.strokeStyle = '#1a0e05';
  ctx.lineWidth = 1.5;
  ctx.fillRect(3, 15, 22, 15);
  ctx.strokeRect(3, 15, 22, 15);
  ctx.fillStyle = '#1a0e05';
  ctx.beginPath();
  ctx.arc(14, 21, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(13, 22, 2, 5);
  tex.refresh();
  return key;
}
