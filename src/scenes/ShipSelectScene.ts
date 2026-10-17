import Phaser from 'phaser';
import { PLAYER_SHIPS, SHIP_UNLOCKS } from '../data/ships';
import { weapon } from '../data/weapons';
import { placeArt } from '../render/art';
import { setRun } from '../render/RunBar';
import { shipGeometry } from '../render/ShipArt';
import { ShipView } from '../render/ShipView';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, Sea, drawPips } from '../render/ui';
import { DIFFICULTY, Run, type Difficulty } from '../sim/Run';
import { Ship } from '../sim/Ship';
import { SYSTEM_NAMES, type ShipDef, type SystemId } from '../sim/types';
import { bumpProfile, profile } from './save';

const GAP = 16;
const MARGIN = 22;
const CARD_W = Math.floor((SCREEN.w - 2 * MARGIN - (PLAYER_SHIPS.length - 1) * GAP) / PLAYER_SHIPS.length);
const CARD_H = 540;
const CARD_Y = 84;
const SYSTEMS: SystemId[] = ['helm', 'sails', 'guns', 'pumps', 'surgeon'];

/** Why a ship is still locked (with progress), or null if it can be sailed. */
function lockReason(def: ShipDef): string | null {
  const unlock = SHIP_UNLOCKS[def.id];
  if (!unlock) return null;
  const have = profile().captures;
  return have >= unlock.captures ? null : `${unlock.text} (${have}/${unlock.captures})`;
}

export class ShipSelectScene extends Phaser.Scene {
  private sea!: Sea;
  private views: ShipView[] = [];
  private cards: Phaser.GameObjects.Rectangle[] = [];
  private pips!: Phaser.GameObjects.Graphics;
  private selected = 1;
  private launch!: Button;
  private difficulty: Difficulty = 'normal';

  constructor() {
    super('ShipSelect');
  }

  init(data: { shipId?: string }): void {
    const i = PLAYER_SHIPS.findIndex((s) => s.id === data.shipId);
    this.selected = i >= 0 ? i : 1;
    this.views = [];
    this.cards = [];
  }

  create(): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    this.add.text(SCREEN.w / 2, 40, 'Choose Your Ship', { fontFamily: TITLE_FONT, fontSize: '38px', color: COLORS.gold, stroke: '#000000', strokeThickness: 5 }).setOrigin(0.5);
    this.pips = this.add.graphics().setDepth(2);

    PLAYER_SHIPS.forEach((def, i) => {
      const x = MARGIN + i * (CARD_W + GAP);
      const card = this.add.rectangle(x, CARD_Y, CARD_W, CARD_H, COLORS.panel, 0.93).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
      card.setInteractive({ useHandCursor: true }).on('pointerdown', () => (this.selected = i));
      this.cards.push(card);

      // A painted portrait across the top of the card, when there is one.
      const portrait = placeArt(this, `ship-${def.id}`, x + 2, CARD_Y + 2, CARD_W - 4, 116, false);
      if (portrait) this.add.rectangle(x + 2, CARD_Y + 70, CARD_W - 4, 48, 0x000000, 0.55).setOrigin(0);
      const nameY = portrait ? CARD_Y + 72 : CARD_Y + 14;
      this.add.text(x + 14, nameY, def.name, { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, stroke: '#000000', strokeThickness: 3 });
      this.add.text(x + 14, nameY + 28, def.className, textStyle(13, COLORS.text, { fontStyle: 'italic' }));

      // Layout preview, centred in a fixed box.
      const ship = new Ship(def, 'player');
      const boxY = CARD_Y + 126;
      const boxH = 132;
      // Fit the whole painted ship, ensign to bowsprit, inside the card.
      const geo = shipGeometry(ship);
      const spanW = geo.padL - 0.25 + geo.tip + 1.2;
      const spanH = geo.beam * 2 + 0.2;
      const tile = Math.min(26, (CARD_W - 16) / spanW, (boxH - 6) / spanH);
      const left = x + (CARD_W - spanW * tile) / 2 + (geo.padL - 0.25) * tile;
      const view = new ShipView(this, ship, left, boxY + (boxH - ship.height * tile) / 2, tile, false, false);
      this.views.push(view);
      if (this.views.length === 1) this.events.once('shutdown', () => this.views.forEach((v) => v.destroy()));

      this.add.text(x + 14, CARD_Y + 266, def.description, textStyle(13, COLORS.text, { wordWrap: { width: CARD_W - 28 }, lineSpacing: 2 }));

      const guns = def.guns.map((g) => weapon(g.weapon).name).join(', ');
      const evasion = def.speedBonus > 0 ? `+${def.speedBonus}%` : def.speedBonus < 0 ? `${def.speedBonus}%` : '±0%';
      const melee = def.melee && def.melee !== 1 ? `   Boarders ×${def.melee}` : '';
      const stats = [`Hull ${def.hull}   Hands ${def.hands}   Crew ${def.crew.length}${melee}`, `Hull speed ${evasion} evasion`, `Guns: ${guns}`];
      this.add.text(x + 14, CARD_Y + 370, stats.join('\n'), textStyle(12, COLORS.text, { lineSpacing: 4, wordWrap: { width: CARD_W - 28 } }));

      SYSTEMS.forEach((id, j) => {
        const sx = x + 14 + (j % 3) * Math.floor((CARD_W - 28) / 3);
        const sy = CARD_Y + 464 + Math.floor(j / 3) * 30;
        this.add.text(sx, sy, SYSTEM_NAMES[id], textStyle(11, COLORS.textDim));
        card.setData(`pip-${id}`, { x: sx, y: sy + 15, max: def.systems[id] ?? 0 });
      });

      const locked = lockReason(def);
      if (locked) {
        this.add.rectangle(x, CARD_Y, CARD_W, CARD_H, 0x05090d, 0.86).setOrigin(0).setDepth(3);
        this.add.text(x + CARD_W / 2, CARD_Y + CARD_H / 2 - 30, 'LOCKED', { fontFamily: TITLE_FONT, fontSize: '30px', color: COLORS.textWarn }).setOrigin(0.5).setDepth(4);
        this.add
          .text(x + CARD_W / 2, CARD_Y + CARD_H / 2 + 10, locked, textStyle(14, COLORS.text, { align: 'center', wordWrap: { width: CARD_W - 40 }, backgroundColor: '#05090d', padding: { x: 8, y: 4 } }))
          .setOrigin(0.5, 0)
          .setDepth(4);
      }
    });

    this.launch = new Button(this, SCREEN.w / 2 - 150, CARD_Y + CARD_H + 18, 300, 44, '', () => this.start(), { size: 19 });
    new Button(this, MARGIN, CARD_Y + CARD_H + 24, 100, 32, '← Back', () => this.scene.start('Title'), { size: 14 });

    const levels = Object.keys(DIFFICULTY) as Difficulty[];
    const saved = this.registry.get('difficulty') as Difficulty | undefined;
    this.difficulty = saved && levels.includes(saved) ? saved : 'normal';
    const blurb = this.add.text(SCREEN.w - MARGIN, CARD_Y + CARD_H + 62, '', textStyle(12, COLORS.textDim)).setOrigin(1, 0);
    const label = () => `Difficulty: ${DIFFICULTY[this.difficulty].label}`;
    const diff = new Button(this, SCREEN.w - MARGIN - 200, CARD_Y + CARD_H + 24, 200, 32, label(), () => {
      this.difficulty = levels[(levels.indexOf(this.difficulty) + 1) % levels.length];
      this.registry.set('difficulty', this.difficulty);
      diff.setText(label());
      blurb.setText(DIFFICULTY[this.difficulty].blurb);
    }, { size: 14 });
    blurb.setText(DIFFICULTY[this.difficulty].blurb);

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => (this.selected = (this.selected + PLAYER_SHIPS.length - 1) % PLAYER_SHIPS.length));
    kb.on('keydown-RIGHT', () => (this.selected = (this.selected + 1) % PLAYER_SHIPS.length));
    kb.on('keydown-ENTER', () => this.start());
  }

  private start(): void {
    const def = PLAYER_SHIPS[this.selected];
    if (lockReason(def)) return;
    bumpProfile('voyages');
    this.registry.set('counted-win', false);
    setRun(this, new Run(def.id, undefined, this.difficulty));
    this.registry.set('chart-note', '');
    this.scene.start('SeaMap');
  }

  update(time: number): void {
    this.sea.draw(time);
    this.cards.forEach((c, i) => c.setStrokeStyle(i === this.selected ? 4 : 2, i === this.selected ? 0xf2c45a : COLORS.panelEdge));
    this.views.forEach((v) => v.draw(time));
    this.pips.clear();
    this.cards.forEach((c) => {
      for (const id of SYSTEMS) {
        const p = c.getData(`pip-${id}`) as { x: number; y: number; max: number };
        drawPips(this.pips, p.x, p.y - 2, p.max, p.max, 0, 8, 2);
      }
    });
    const def = PLAYER_SHIPS[this.selected];
    const locked = lockReason(def);
    this.launch.setEnabled(!locked).setText(locked ? `${def.name} is locked` : `Set Sail in ${def.name} →`);
  }
}
