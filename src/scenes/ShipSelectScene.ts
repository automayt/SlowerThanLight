import Phaser from 'phaser';
import { PLAYER_SHIPS, SHIP_UNLOCKS } from '../data/ships';
import { weapon } from '../data/weapons';
import { placeArt } from '../render/art';
import { setRun } from '../render/RunBar';
import { shipGeometry } from '../render/ShipArt';
import { ShipView } from '../render/ShipView';
import { CAPS_FONT, COLORS, SCREEN, TITLE_FONT, textStyle, titleStyle } from '../render/theme';
import { addTip, Button, divider, drawBar, drawPips, frame, goldText, panel, Sea } from '../render/ui';
import { DIFFICULTY, Run, type Difficulty } from '../sim/Run';
import { Ship } from '../sim/Ship';
import { SYSTEM_NAMES, type ShipDef, type SystemId } from '../sim/types';
import { bumpProfile, profile, recentEvents, unlockedCaptains } from './save';
import { CAPTAINS } from '../data/captains';

const MARGIN = 22;
/** The featured ship: her portrait, the shipwright's draught of her below it, and her particulars to the right. */
const PORTRAIT = { x: MARGIN, y: 76, w: 748, h: 232 };
const PLAN = { x: MARGIN, y: 320, w: 748, h: 188 };
const NOTES = { x: PORTRAIT.x + PORTRAIT.w + 18, y: 76, w: SCREEN.w - MARGIN - (PORTRAIT.x + PORTRAIT.w + 18), h: PLAN.y + PLAN.h - 76 };
/** The fleet, as a row of small framed portraits to pick from. */
const THUMB = { w: 176, h: 99, gap: 20, y: 524 };
const THUMB_X = (SCREEN.w - (PLAYER_SHIPS.length * THUMB.w + (PLAYER_SHIPS.length - 1) * THUMB.gap)) / 2;
const FOOT_Y = SCREEN.h - 54;
const SYSTEMS: SystemId[] = ['helm', 'sails', 'guns', 'bulwarks', 'pumps', 'surgeon'];
const NUMBER_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
/** The best of each stat across the fleet, so the bars compare ships at a glance. */
const BEST = {
  hull: Math.max(...PLAYER_SHIPS.map((d) => d.hull)),
  hands: Math.max(...PLAYER_SHIPS.map((d) => d.hands)),
  crew: Math.max(...PLAYER_SHIPS.map((d) => d.crew.length)),
};
const INK = 0x2a170a;

/** Why a ship is still locked (with progress), or null if it can be sailed. */
function lockReason(def: ShipDef): string | null {
  const unlock = SHIP_UNLOCKS[def.id];
  if (!unlock) return null;
  const have = profile().captures;
  return have >= unlock.captures ? null : `${unlock.text} (${have}/${unlock.captures})`;
}

export class ShipSelectScene extends Phaser.Scene {
  private sea!: Sea;
  private view: ShipView | null = null;
  /** Everything drawn for the featured ship, replaced when another is picked. */
  private feature: Phaser.GameObjects.GameObject[] = [];
  private thumbs: Phaser.GameObjects.Image[] = [];
  private names: Phaser.GameObjects.Text[] = [];
  private ring!: Phaser.GameObjects.Graphics;
  private locks: (string | null)[] = [];
  private selected = 1;
  private launch!: Button;
  private difficulty: Difficulty = 'normal';
  private captainId = 'rover';

  constructor() {
    super('ShipSelect');
  }

  init(data: { shipId?: string }): void {
    const i = PLAYER_SHIPS.findIndex((s) => s.id === data.shipId);
    this.selected = i >= 0 ? i : 1;
    this.view = null;
    this.feature = [];
    this.thumbs = [];
    this.names = [];
    this.locks = PLAYER_SHIPS.map(lockReason);
  }

  preload(): void {
    if (!this.textures.exists('art:chart-paper')) this.load.image('art:chart-paper', 'art/chart-paper.jpg');
  }

  create(): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const title = goldText(this, SCREEN.w / 2, 12, 'Choose Your Ship', 40).setOrigin(0.5, 0);
    divider(this, SCREEN.w / 2, title.y + title.height + 2, 360);
    this.events.once('shutdown', () => this.view?.destroy());

    // The draught's paper and the notes' panel stay; what is drawn on them changes with the ship.
    const paper = placeArt(this, 'chart-paper', PLAN.x, PLAN.y, PLAN.w, PLAN.h, false);
    if (!paper) this.add.rectangle(PLAN.x, PLAN.y, PLAN.w, PLAN.h, 0xd9c49a).setOrigin(0);
    // A draughtsman's grid, faint.
    const grid = this.add.graphics().lineStyle(1, 0x5a4a30, 0.12);
    for (let gx = PLAN.x + 24; gx < PLAN.x + PLAN.w; gx += 24) grid.lineBetween(gx, PLAN.y + 6, gx, PLAN.y + PLAN.h - 6);
    for (let gy = PLAN.y + 22; gy < PLAN.y + PLAN.h; gy += 24) grid.lineBetween(PLAN.x + 6, gy, PLAN.x + PLAN.w - 6, gy);
    frame(this, PLAN.x - 3, PLAN.y - 3, PLAN.w + 6, PLAN.h + 6, 0.5, false);
    this.add.rectangle(PLAN.x + 3, PLAN.y + 9, PLAN.w, PLAN.h, 0x000000, 0.4).setOrigin(0).setDepth(-1);
    panel(this, NOTES.x, NOTES.y, NOTES.w, NOTES.h);

    // The fleet: one framed portrait each, the chosen one ringed in gold.
    PLAYER_SHIPS.forEach((def, i) => {
      const x = THUMB_X + i * (THUMB.w + THUMB.gap);
      const art = placeArt(this, `ship-${def.id}`, x, THUMB.y, THUMB.w, THUMB.h, false);
      const hit = art ?? this.add.rectangle(x, THUMB.y, THUMB.w, THUMB.h, COLORS.panel).setOrigin(0);
      frame(this, x - 3, THUMB.y - 3, THUMB.w + 6, THUMB.h + 6, 0.5);
      hit.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.select(i));
      hit.on('pointerover', () => i !== this.selected && art?.setAlpha(1));
      hit.on('pointerout', () => i !== this.selected && art?.setAlpha(0.7));
      if (art) this.thumbs.push(art);
      const locked = this.locks[i];
      if (locked) {
        addTip(hit, `Locked. To unlock: ${locked}`);
        art?.setTint(0x6a6a72);
        this.add.image(x + THUMB.w - 22, THUMB.y + 22, padlock(this)).setDepth(1);
      }
      this.add.text(x + 8, THUMB.y + THUMB.h - 6, `${i + 1}`, textStyle(13, COLORS.text, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(0, 1).setDepth(1);
      this.names.push(this.add.text(x + THUMB.w / 2, THUMB.y + THUMB.h + 6, def.name, titleStyle(18, COLORS.text)).setOrigin(0.5, 0));
    });
    this.ring = this.add.graphics().setDepth(1);

    this.launch = new Button(this, SCREEN.w / 2 - 170, FOOT_Y, 340, 44, '', () => this.start(), { size: 19, hint: 'Enter' });
    const back = new Button(this, MARGIN, FOOT_Y + 6, 120, 34, '← Back', () => this.scene.start('Title'), { size: 14, hint: 'Esc' });

    const levels = Object.keys(DIFFICULTY) as Difficulty[];
    const saved = this.registry.get('difficulty') as Difficulty | undefined;
    this.difficulty = saved && levels.includes(saved) ? saved : 'normal';
    const label = () => `Difficulty: ${DIFFICULTY[this.difficulty].label}`;
    const tip = () => `${DIFFICULTY[this.difficulty].blurb} Click to change: the fleet’s speed, your starting purse and provisions, and how hard enemies hit.`;
    const diff = new Button(this, SCREEN.w - MARGIN - 230, FOOT_Y + 6, 230, 34, label(), () => {
      this.difficulty = levels[(levels.indexOf(this.difficulty) + 1) % levels.length];
      this.registry.set('difficulty', this.difficulty);
      diff.setText(label()).setTip(tip());
    }, { size: 14, hint: 'D', tip: tip() });

    // The captain: those earned with renown, in turn. The locked ones are named in the tip, with the renown they need.
    const captains = unlockedCaptains();
    const savedCaptain = this.registry.get('captain') as string | undefined;
    this.captainId = captains.some((c) => c.id === savedCaptain) ? savedCaptain! : 'rover';
    const fame = profile().renown;
    const locked = CAPTAINS.filter((c) => c.renown > fame);
    const captainLabel = () => `Captain: ${CAPTAINS.find((c) => c.id === this.captainId)!.name.replace(/^The /, '')}`;
    const captainTip = () =>
      `${CAPTAINS.find((c) => c.id === this.captainId)!.blurb}${locked.length ? `\n\nRenown ${fame}. Still to earn: ${locked.map((c) => `${c.name} (${c.renown})`).join(', ')}.` : ''}`;
    const cap = new Button(this, MARGIN + 120 + 12, FOOT_Y + 6, 250, 34, captainLabel(), () => {
      this.captainId = captains[(captains.findIndex((c) => c.id === this.captainId) + 1) % captains.length].id;
      this.registry.set('captain', this.captainId);
      cap.setText(captainLabel()).setTip(captainTip());
    }, { size: 14, hint: 'C', tip: captainTip() });

    const kb = this.input.keyboard!;
    kb.on('keydown-C', () => cap.press());
    kb.on('keydown-LEFT', () => this.select((this.selected + PLAYER_SHIPS.length - 1) % PLAYER_SHIPS.length));
    kb.on('keydown-RIGHT', () => this.select((this.selected + 1) % PLAYER_SHIPS.length));
    PLAYER_SHIPS.forEach((_, i) => kb.on(`keydown-${NUMBER_KEYS[i]}`, () => this.select(i)));
    kb.on('keydown-ENTER', () => this.launch.press());
    kb.on('keydown-ESC', () => back.press());
    kb.on('keydown-D', () => diff.press());
    this.select(this.selected);
  }

  /** Feature a ship: her portrait, draught and particulars, and set the launch button to match. */
  private select(i: number): void {
    const changed = i !== this.selected || !this.feature.length;
    this.selected = i;
    const def = PLAYER_SHIPS[i];
    const locked = this.locks[i];
    this.launch
      .setEnabled(!locked)
      .setText(locked ? `${def.name} is locked` : `Set Sail in ${def.name} →`)
      .setTip(locked ? `To unlock: ${locked}` : null);
    this.thumbs.forEach((t, j) => t.setAlpha(j === i ? 1 : 0.7));
    this.names.forEach((n, j) => n.setColor(j === i ? COLORS.gold : COLORS.textDim));
    const tx = THUMB_X + i * (THUMB.w + THUMB.gap);
    this.ring
      .clear()
      .lineStyle(6, 0xf2c45a, 0.25)
      .strokeRect(tx - 7, THUMB.y - 7, THUMB.w + 14, THUMB.h + 14)
      .lineStyle(2.5, 0xf2c45a, 1)
      .strokeRect(tx - 5, THUMB.y - 5, THUMB.w + 10, THUMB.h + 10);
    if (!changed) return;

    for (const o of this.feature) o.destroy();
    this.feature = [];
    this.view?.destroy();
    this.view = null;
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.feature.push(o);
      return o;
    };

    // Her portrait, with her name painted across the foot of it.
    const p = PORTRAIT;
    const art = placeArt(this, `ship-${def.id}`, p.x, p.y, p.w, p.h, false);
    if (art) keep(art.setAlpha(0));
    else keep(this.add.rectangle(p.x, p.y, p.w, p.h, COLORS.panel).setOrigin(0));
    keep(this.add.image(p.x, p.y + p.h, shade(this)).setOrigin(0, 1).setDisplaySize(p.w, 120));
    this.feature.push(...frame(this, p.x - 3, p.y - 3, p.w + 6, p.h + 6));
    const name = keep(goldText(this, p.x + 26, p.y + p.h - 58, def.name, 46).setOrigin(0, 1).setAlpha(0));
    keep(this.add.text(p.x + 30, p.y + p.h - 52, def.className, titleStyle(20, COLORS.text, { fontStyle: 'italic' })).setShadow(0, 1, '#000', 4, false, true));
    if (art) this.tweens.add({ targets: art, alpha: 1, duration: 320 });
    this.tweens.add({ targets: name, alpha: 1, x: { from: p.x + 10, to: p.x + 26 }, duration: 420, ease: 'Cubic.easeOut' });
    if (locked) {
      keep(this.add.rectangle(p.x, p.y, p.w, p.h, 0x05090d, 0.55).setOrigin(0).setDepth(0.6));
      keep(this.add.image(p.x + p.w - 150, p.y + 70, padlock(this)).setScale(2.2).setDepth(0.7));
      keep(this.add.text(p.x + p.w - 150, p.y + 120, `Locked\n${locked}`, textStyle(15, COLORS.text, { align: 'center', wordWrap: { width: 260 }, lineSpacing: 3 })).setOrigin(0.5, 0).setDepth(0.7).setShadow(0, 1, '#000', 4, false, true));
    }

    // The shipwright's draught: her plan, fitted inside the paper with room for the caption.
    keep(this.add.text(PLAN.x + 18, PLAN.y + 12, `The draught of ${def.name}`, { fontFamily: CAPS_FONT, fontSize: '15px', color: COLORS.ink }).setAlpha(0.8).setDepth(0.5));
    const ship = new Ship(def, 'player');
    const geo = shipGeometry(ship);
    const spanW = geo.padL - 0.25 + geo.tip + 1.2;
    const spanH = geo.beam * 2 + 0.2;
    const boxH = PLAN.h - 34;
    const tile = Math.min(30, (PLAN.w - 60) / spanW, (boxH - 6) / spanH);
    const left = PLAN.x + (PLAN.w - spanW * tile) / 2 + (geo.padL - 0.25) * tile;
    this.view = new ShipView(this, ship, left, PLAN.y + 28 + (boxH - ship.height * tile) / 2, tile, false, false);
    // A scale bar in the corner, as on any draught.
    const bar = keep(this.add.graphics().setDepth(0.5));
    const bx = PLAN.x + PLAN.w - 18 - 4 * tile;
    const by = PLAN.y + PLAN.h - 16;
    bar.lineStyle(1, INK, 0.7).strokeRect(bx, by - 4, 4 * tile, 4);
    for (let k = 0; k < 4; k += 2) bar.fillStyle(INK, 0.7).fillRect(bx + k * tile, by - 4, tile, 4);
    keep(this.add.text(bx - 6, by - 2, 'Scale of fathoms', { fontFamily: TITLE_FONT, fontSize: '12px', color: COLORS.ink, fontStyle: 'italic' }).setOrigin(1, 0.5).setAlpha(0.75).setDepth(0.5));

    this.notes(def, keep);
  }

  /** Her particulars, on the panel at the right. */
  private notes(def: ShipDef, keep: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const n = NOTES;
    const x = n.x + 22;
    const w = n.w - 44;
    keep(this.add.text(n.x + n.w / 2, n.y + 16, 'The Shipwright’s Notes', { fontFamily: CAPS_FONT, fontSize: '22px', color: COLORS.gold }).setOrigin(0.5, 0));
    keep(divider(this, n.x + n.w / 2, n.y + 50, 220));
    const desc = keep(this.add.text(x, n.y + 64, def.description, textStyle(15, COLORS.text, { wordWrap: { width: w }, lineSpacing: 3 })));

    // Four headline numbers, each with a bar against the best in the fleet.
    const g = keep(this.add.graphics());
    const evasion = def.speedBonus > 0 ? `+${def.speedBonus}%` : def.speedBonus < 0 ? `${def.speedBonus}%` : '±0%';
    const tiles: [string, string, number | null, string][] = [
      ['Hull', `${def.hull}`, def.hull / BEST.hull, COLORS.text],
      ['Deckhands', `${def.hands}`, def.hands / BEST.hands, COLORS.text],
      ['Crew', `${def.crew.length}`, def.crew.length / BEST.crew, COLORS.text],
      ['Evasion', evasion, null, def.speedBonus > 0 ? COLORS.textGood : def.speedBonus < 0 ? COLORS.textWarn : COLORS.text],
    ];
    const statY = Math.max(n.y + 150, desc.y + desc.height + 16);
    const tw = Math.floor(w / tiles.length);
    tiles.forEach(([label, value, frac, color], j) => {
      const tx = x + j * tw;
      keep(this.add.text(tx, statY, label, { fontFamily: CAPS_FONT, fontSize: '15px', color: COLORS.textDim }));
      keep(this.add.text(tx, statY + 18, value, textStyle(26, color, { fontStyle: 'bold' })));
      if (frac !== null) drawBar(g, tx + 1, statY + 54, tw - 18, 5, frac, 0xc8a26a);
    });

    // Guns, with repeats counted: "2× 9-Pounder Long Gun".
    const counts = new Map<string, number>();
    for (const gun of def.guns) counts.set(weapon(gun.weapon).name, (counts.get(weapon(gun.weapon).name) ?? 0) + 1);
    const guns = [...counts].map(([name, k]) => (k > 1 ? `${k}× ${name}` : name)).join(', ');
    const melee = def.melee && def.melee !== 1 ? `\nBoarders fight ×${def.melee}` : '';
    const gy = statY + 72;
    keep(this.add.text(x, gy, 'Guns', { fontFamily: CAPS_FONT, fontSize: '15px', color: COLORS.textDim }));
    const gunText = keep(this.add.text(x + 70, gy, `${guns}${melee}`, textStyle(14, COLORS.text, { lineSpacing: 3, wordWrap: { width: w - 70 } })));

    const sy0 = gunText.y + gunText.height + 26;
    const cw = Math.floor(w / 3);
    SYSTEMS.forEach((id, j) => {
      const sx = x + (j % 3) * cw;
      const sy = sy0 + Math.floor(j / 3) * 34;
      keep(this.add.text(sx, sy, SYSTEM_NAMES[id], textStyle(12, COLORS.textDim)));
      drawPips(g, sx, sy + 17, def.systems[id] ?? 0, def.systems[id] ?? 0, 0, 9, 2);
    });

    // Who sails her.
    const cy = sy0 + 88;
    keep(this.add.text(x, cy, 'Ship’s company', { fontFamily: CAPS_FONT, fontSize: '15px', color: COLORS.textDim }));
    keep(this.add.text(x, cy + 20, def.crew.map((c) => c.name).join(' · '), titleStyle(16, COLORS.text, { fontStyle: 'italic', wordWrap: { width: w }, lineSpacing: 2 })));
  }

  private start(): void {
    const def = PLAYER_SHIPS[this.selected];
    if (this.locks[this.selected]) return;
    bumpProfile('voyages');
    this.registry.set('counted-win', false);
    const run = new Run(def.id, undefined, this.difficulty, this.captainId);
    // Tales from the last few voyages come round less often.
    run.recent = recentEvents();
    setRun(this, run);
    this.registry.set('chart-note', '');
    this.scene.start('SeaMap');
  }

  update(time: number): void {
    this.sea.draw(time);
    this.view?.draw(time);
  }
}

/** A dark wash rising from the foot of a portrait, so a name written over it reads. */
function shade(scene: Phaser.Scene): string {
  const key = 'select:shade';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 4, 120)!;
  const ctx = tex.getContext();
  const g = ctx.createLinearGradient(0, 0, 0, 120);
  g.addColorStop(0, 'rgba(5,9,13,0)');
  g.addColorStop(1, 'rgba(5,9,13,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 120);
  tex.refresh();
  return key;
}

/** A small iron padlock. */
function padlock(scene: Phaser.Scene): string {
  const key = 'select:padlock';
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
