import Phaser from 'phaser';
import { SEA_EVENTS } from '../data/voyage';
import { placeArt } from '../render/art';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import type { EventRarity, SeaEventDef } from '../sim/types';
import { loadArtOnDemand } from './PreloadScene';
import { discovered } from './save';

const RARITY_COLOR: Record<EventRarity, string> = { common: COLORS.text, uncommon: '#9be37f', rare: '#8fc7ff', legendary: '#ffb347' };
const RARITY_HEX: Record<EventRarity, number> = { common: 0x8a7a5a, uncommon: 0x6fbf55, rare: 0x6aa8e8, legendary: 0xffa630 };
const ORDER: EventRarity[] = ['legendary', 'rare', 'uncommon', 'common'];

const COLS = 6;
const ROWS = 3;
const CARD = { w: 178, h: 100, gap: 14, labelH: 34 };
const GRID = { x: (SCREEN.w - (COLS * CARD.w + (COLS - 1) * CARD.gap)) / 2, y: 132 };

/** Every event you have met on any voyage, as a gallery of its paintings, and how many are still out there. */
export class LogbookScene extends Phaser.Scene {
  private sea!: Sea;
  private page = 0;
  private tales: SeaEventDef[] = [];
  private seen = new Set<string>();
  private pageObjects: Phaser.GameObjects.GameObject[] = [];
  private overlay: Phaser.GameObjects.GameObject[] = [];
  private pageLabel!: Phaser.GameObjects.Text;

  constructor() {
    super('Logbook');
  }

  init(): void {
    this.page = 0;
    this.pageObjects = [];
    this.overlay = [];
    this.seen = discovered();
    this.tales = SEA_EVENTS.filter((e) => e.pool !== 'chain').sort(
      (a, b) => ORDER.indexOf(a.rarity ?? 'common') - ORDER.indexOf(b.rarity ?? 'common') || a.title.localeCompare(b.title),
    );
  }

  preload(): void {
    // Paintings of every tale already found.
    for (const e of this.tales) if (this.seen.has(e.id)) loadArtOnDemand(this, `event-${e.id}`);
  }

  create(): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const { tales: events, seen } = this;
    const found = events.filter((e) => seen.has(e.id)).length;

    panel(this, 24, 16, SCREEN.w - 48, SCREEN.h - 32);
    this.add.text(SCREEN.w / 2, 26, 'The Captain’s Logbook', { fontFamily: TITLE_FONT, fontSize: '32px', color: COLORS.gold }).setOrigin(0.5, 0);
    this.add.text(SCREEN.w / 2, 68, `${found} of ${events.length} tales discovered across all your voyages`, textStyle(14, COLORS.textDim)).setOrigin(0.5, 0);
    const legend = ORDER.map((r) => `${r[0].toUpperCase()}${r.slice(1)}: ${events.filter((e) => (e.rarity ?? 'common') === r && seen.has(e.id)).length}/${events.filter((e) => (e.rarity ?? 'common') === r).length}`);
    legend.forEach((t, i) => this.add.text(SCREEN.w / 2 - 390 + i * 200, 96, t, textStyle(13, RARITY_COLOR[ORDER[i]], { fontStyle: 'bold' })));

    const pages = Math.ceil(events.length / (COLS * ROWS));
    const turn = (d: number) => {
      if (this.overlay.length) return;
      this.page = (this.page + d + pages) % pages;
      this.drawPage();
    };
    new Button(this, SCREEN.w / 2 - 330, SCREEN.h - 66, 60, 40, '◀', () => turn(-1), { size: 18 });
    new Button(this, SCREEN.w / 2 + 270, SCREEN.h - 66, 60, 40, '▶', () => turn(1), { size: 18 });
    this.pageLabel = this.add.text(SCREEN.w / 2 - 200, SCREEN.h - 54, '', textStyle(14, COLORS.textDim)).setOrigin(0.5, 0);

    const back = () => (this.overlay.length ? this.closeOverlay() : this.scene.start('Title'));
    new Button(this, SCREEN.w / 2 - 90, SCREEN.h - 66, 180, 40, '← Back', back, { size: 16 });
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', back);
    kb.on('keydown-LEFT', () => turn(-1));
    kb.on('keydown-RIGHT', () => turn(1));
    this.drawPage();
  }

  private drawPage(): void {
    for (const o of this.pageObjects) o.destroy();
    this.pageObjects = [];
    const per = COLS * ROWS;
    const pages = Math.ceil(this.tales.length / per);
    this.pageLabel.setText(`Page ${this.page + 1} of ${pages}`);
    this.tales.slice(this.page * per, this.page * per + per).forEach((e, i) => {
      const x = GRID.x + (i % COLS) * (CARD.w + CARD.gap);
      const y = GRID.y + Math.floor(i / COLS) * (CARD.h + CARD.labelH + CARD.gap);
      const known = this.seen.has(e.id);
      const rarity = e.rarity ?? 'common';
      const frame = this.add.rectangle(x, y, CARD.w, CARD.h, 0x0b141c).setOrigin(0).setStrokeStyle(2, RARITY_HEX[rarity], known ? 1 : 0.4);
      this.pageObjects.push(frame);
      if (known) {
        const img = placeArt(this, `event-${e.id}`, x, y, CARD.w, CARD.h, false);
        if (img) this.pageObjects.push(img);
        this.pageObjects.push(this.add.rectangle(x, y, CARD.w, CARD.h).setOrigin(0).setStrokeStyle(2, RARITY_HEX[rarity], 1));
        frame.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.open(e));
        img?.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.open(e));
      } else {
        this.pageObjects.push(this.add.text(x + CARD.w / 2, y + CARD.h / 2, '?', { fontFamily: TITLE_FONT, fontSize: '40px', color: RARITY_COLOR[rarity] }).setOrigin(0.5).setAlpha(0.35));
      }
      this.pageObjects.push(
        this.add
          .text(x + CARD.w / 2, y + CARD.h + 5, known ? e.title : '? ? ?', textStyle(12, RARITY_COLOR[rarity], { align: 'center', wordWrap: { width: CARD.w }, fontStyle: known ? 'normal' : 'italic' }))
          .setOrigin(0.5, 0)
          .setAlpha(known ? 1 : 0.45),
      );
    });
  }

  /** Show one tale large: its painting and opening lines. */
  private open(e: SeaEventDef): void {
    if (this.overlay.length) return;
    const w = 760;
    const h = 660;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2;
    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.6).setOrigin(0).setDepth(30).setInteractive();
    shade.on('pointerdown', () => this.closeOverlay());
    const box = panel(this, x, y, w, h, { modal: true }).setDepth(31);
    const title = this.add.text(SCREEN.w / 2, y + 16, e.title, { fontFamily: TITLE_FONT, fontSize: '28px', color: RARITY_COLOR[e.rarity ?? 'common'] }).setOrigin(0.5, 0).setDepth(32);
    this.overlay = [shade, box, title];
    const artH = (w - 80) * 0.5625;
    const img = placeArt(this, `event-${e.id}`, x + 40, y + 62, w - 80, artH, false);
    if (img) this.overlay.push(img.setDepth(32), this.add.rectangle(x + 40, y + 62, w - 80, artH).setOrigin(0).setStrokeStyle(2, 0x2b1a0d).setDepth(32));
    const text = e.text.replaceAll('{crew2}', 'another hand').replaceAll('{crew}', 'one of the crew').replaceAll('{ship}', 'your ship');
    const body = this.add.text(x + 40, y + 62 + (w - 80) * 0.5625 + 14, text, textStyle(14, COLORS.text, { wordWrap: { width: w - 80 }, lineSpacing: 3 })).setDepth(32);
    this.overlay.push(body);
    const close = new Button(this, SCREEN.w / 2 - 70, y + h - 54, 140, 38, 'Close', () => this.closeOverlay(), { size: 15 }).setDepth(32);
    this.overlay.push(close);
  }

  private closeOverlay(): void {
    const items = this.overlay;
    this.overlay = [];
    // After this click finishes dispatching.
    this.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
