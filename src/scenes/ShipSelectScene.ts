import Phaser from 'phaser';
import { PLAYER_SHIPS } from '../data/ships';
import { weapon } from '../data/weapons';
import { ShipView } from '../render/ShipView';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, Sea, drawPips } from '../render/ui';
import { setRun } from '../render/RunBar';
import { Run } from '../sim/Run';
import { Ship } from '../sim/Ship';
import { SYSTEM_NAMES, type SystemId } from '../sim/types';

const CARD_W = 396;
const CARD_H = 520;
const CARD_Y = 96;

export class ShipSelectScene extends Phaser.Scene {
  private sea!: Sea;
  private views: ShipView[] = [];
  private cards: Phaser.GameObjects.Rectangle[] = [];
  private pips!: Phaser.GameObjects.Graphics;
  private selected = 1;
  private launch!: Button;

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
    this.add.text(SCREEN.w / 2, 46, 'Choose Your Ship', { fontFamily: TITLE_FONT, fontSize: '40px', color: COLORS.gold, stroke: '#000000', strokeThickness: 5 }).setOrigin(0.5);
    this.pips = this.add.graphics().setDepth(2);

    PLAYER_SHIPS.forEach((def, i) => {
      const x = 22 + i * (CARD_W + 23);
      const card = this.add.rectangle(x, CARD_Y, CARD_W, CARD_H, COLORS.panel, 0.93).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
      card.setInteractive({ useHandCursor: true }).on('pointerdown', () => (this.selected = i));
      this.cards.push(card);

      this.add.text(x + 18, CARD_Y + 14, def.name, { fontFamily: TITLE_FONT, fontSize: '28px', color: COLORS.gold });
      this.add.text(x + 18, CARD_Y + 50, def.className, textStyle(15, COLORS.textDim, { fontStyle: 'italic' }));

      // Layout preview, centred in a fixed box.
      const ship = new Ship(def, 'player');
      const tile = 30;
      const boxH = 170;
      const widthPx = (ship.width + 2.2) * tile;
      const view = new ShipView(this, ship, x + (CARD_W - widthPx) / 2 + 0.6 * tile, CARD_Y + 82 + (boxH - ship.height * tile) / 2, tile, false, false);
      this.views.push(view);

      this.add.text(x + 18, CARD_Y + 262, def.description, textStyle(14, COLORS.text, { wordWrap: { width: CARD_W - 36 }, lineSpacing: 3 }));

      const guns = def.guns.map((g) => weapon(g.weapon).name).join(', ');
      const evasion = def.speedBonus > 0 ? `+${def.speedBonus}%` : def.speedBonus < 0 ? `${def.speedBonus}%` : '±0%';
      const stats = [`Hull  ${def.hull}`, `Hands  ${def.hands}`, `Crew  ${def.crew.length}`, `Hull speed  ${evasion} evasion`, `Guns  ${guns}`];
      this.add.text(x + 18, CARD_Y + 336, stats.join('\n'), textStyle(13, COLORS.text, { lineSpacing: 4, wordWrap: { width: CARD_W - 36 } }));

      const systems: SystemId[] = ['helm', 'sails', 'guns', 'pumps', 'surgeon'];
      systems.forEach((id, j) => {
        const sx = x + 18 + (j % 3) * 124;
        const sy = CARD_Y + 452 + Math.floor(j / 3) * 26;
        this.add.text(sx, sy, SYSTEM_NAMES[id], textStyle(12, COLORS.textDim));
        card.setData(`pip-${id}`, { x: sx, y: sy + 16, max: def.systems[id] ?? 0 });
      });
    });

    this.launch = new Button(this, SCREEN.w / 2 - 130, CARD_Y + CARD_H + 22, 260, 46, '', () => this.start(), { size: 20 });
    new Button(this, 22, CARD_Y + CARD_H + 30, 100, 32, '← Back', () => this.scene.start('Title'), { size: 14 });

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => (this.selected = (this.selected + PLAYER_SHIPS.length - 1) % PLAYER_SHIPS.length));
    kb.on('keydown-RIGHT', () => (this.selected = (this.selected + 1) % PLAYER_SHIPS.length));
    kb.on('keydown-ENTER', () => this.start());
  }

  private start(): void {
    setRun(this, new Run(PLAYER_SHIPS[this.selected].id));
    this.registry.set('chart-note', '');
    this.scene.start('SeaMap');
  }

  update(time: number): void {
    this.sea.draw(time);
    this.cards.forEach((c, i) => c.setStrokeStyle(i === this.selected ? 4 : 2, i === this.selected ? 0xf2c45a : COLORS.panelEdge));
    this.views.forEach((v) => v.draw(time));
    this.pips.clear();
    this.cards.forEach((c) => {
      for (const id of ['helm', 'sails', 'guns', 'pumps', 'surgeon']) {
        const p = c.getData(`pip-${id}`) as { x: number; y: number; max: number };
        drawPips(this.pips, p.x, p.y - 2, p.max, p.max, 0, 9, 2);
      }
    });
    this.launch.setText(`Set Sail in ${PLAYER_SHIPS[this.selected].name} →`);
  }
}
