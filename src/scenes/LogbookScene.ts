import Phaser from 'phaser';
import { SEA_EVENTS } from '../data/voyage';
import { placeArt } from '../render/art';
import { playSfx } from '../render/sound';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, divider, frame, goldText, panel, Sea } from '../render/ui';
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
    // By rarity, and within each rarity the tales already found first, so the early pages are not all question marks.
    const seen = this.seen;
    this.tales = SEA_EVENTS.filter((e) => e.pool !== 'chain').sort(
      (a, b) =>
        ORDER.indexOf(a.rarity ?? 'common') - ORDER.indexOf(b.rarity ?? 'common') ||
        Number(seen.has(b.id)) - Number(seen.has(a.id)) ||
        a.title.localeCompare(b.title),
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
    const title = goldText(this, SCREEN.w / 2, 22, 'The Captain’s Logbook', 36).setOrigin(0.5, 0);
    for (const s of [-1, 1]) divider(this, SCREEN.w / 2 + s * (title.width / 2 + 80), title.y + title.height / 2 + 2, 110);
    this.add.text(SCREEN.w / 2, 68, `${found} of ${events.length} tales discovered across all your voyages`, textStyle(14, COLORS.textDim)).setOrigin(0.5, 0);
    const legend = ORDER.map((r) => `${r[0].toUpperCase()}${r.slice(1)}: ${events.filter((e) => (e.rarity ?? 'common') === r && seen.has(e.id)).length}/${events.filter((e) => (e.rarity ?? 'common') === r).length}`);
    // Centred as a row, spaced by the measured widths.
    const keys = legend.map((t, i) => this.add.text(0, 96, t, textStyle(14, RARITY_COLOR[ORDER[i]], { fontStyle: 'bold' })));
    const spacing = 48;
    let lx = (SCREEN.w - keys.reduce((n, k) => n + k.width, 0) - spacing * (keys.length - 1)) / 2;
    for (const k of keys) {
      k.setX(lx);
      lx += k.width + spacing;
    }

    const pages = Math.ceil(events.length / (COLS * ROWS));
    const turn = (d: number) => {
      if (this.overlay.length) return;
      this.page = (this.page + d + pages) % pages;
      playSfx(this, 'page', 0.5);
      this.drawPage();
    };
    // Page turning in the middle, the page number between the arrows; the way out at the left.
    const prev = new Button(this, SCREEN.w / 2 - 150, SCREEN.h - 66, 60, 40, '◀', () => turn(-1), { size: 18, tip: 'Previous page (←)' });
    const next = new Button(this, SCREEN.w / 2 + 90, SCREEN.h - 66, 60, 40, '▶', () => turn(1), { size: 18, tip: 'Next page (→)' });
    this.pageLabel = this.add.text(SCREEN.w / 2, SCREEN.h - 46, '', textStyle(15, COLORS.text)).setOrigin(0.5);

    const back = new Button(this, 48, SCREEN.h - 66, 160, 40, '← Back', () => this.scene.start('Title'), { size: 16, hint: 'Esc' });
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => (this.overlay.length ? this.closeOverlay() : back.press()));
    kb.on('keydown-ENTER', () => this.overlay.length && this.closeOverlay());
    kb.on('keydown-LEFT', () => !this.overlay.length && prev.press());
    kb.on('keydown-RIGHT', () => !this.overlay.length && next.press());
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
      const back = this.add.rectangle(x, y, CARD.w, CARD.h, 0x0b141c).setOrigin(0);
      this.pageObjects.push(back);
      if (known) {
        const img = placeArt(this, `event-${e.id}`, x, y, CARD.w, CARD.h, false);
        if (img) this.pageObjects.push(img);
        // The rarity as a keyline inside the brass frame.
        this.pageObjects.push(this.add.rectangle(x + 5, y + 5, CARD.w - 10, CARD.h - 10).setOrigin(0).setStrokeStyle(1.5, RARITY_HEX[rarity], rarity === 'common' ? 0 : 0.9));
        back.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.open(e));
        img?.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.open(e));
      } else {
        this.pageObjects.push(this.add.text(x + CARD.w / 2, y + CARD.h / 2, '?', { fontFamily: TITLE_FONT, fontSize: '40px', color: RARITY_COLOR[rarity] }).setOrigin(0.5).setAlpha(0.35));
      }
      const rim = frame(this, x - 2, y - 2, CARD.w + 4, CARD.h + 4);
      if (!known) rim.forEach((o) => (o as Phaser.GameObjects.Image).setAlpha(0.45));
      this.pageObjects.push(...rim);
      this.pageObjects.push(
        this.add
          .text(x + CARD.w / 2, y + CARD.h + 5, known ? e.title : '? ? ?', textStyle(13, RARITY_COLOR[rarity], { align: 'center', wordWrap: { width: CARD.w }, fontStyle: known ? 'normal' : 'italic' }))
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
    const title = goldText(this, SCREEN.w / 2, y + 12, e.title, 32).setOrigin(0.5, 0).setDepth(32);
    this.overlay = [shade, box, title];
    const artH = (w - 80) * 0.5625;
    const img = placeArt(this, `event-${e.id}`, x + 40, y + 62, w - 80, artH, false);
    if (img) this.overlay.push(img.setDepth(32), ...frame(this, x + 36, y + 58, w - 72, artH + 8, 32.1, false));
    const text = e.text.replaceAll('{crew2}', 'another hand').replaceAll('{crew}', 'one of the crew').replaceAll('{ship}', 'your ship');
    const body = this.add.text(x + 40, y + 62 + (w - 80) * 0.5625 + 14, text, textStyle(16, COLORS.text, { wordWrap: { width: w - 80 }, lineSpacing: 4 })).setDepth(32);
    this.overlay.push(body);
    const close = new Button(this, SCREEN.w / 2 - 80, y + h - 54, 160, 38, 'Close', () => this.closeOverlay(), { size: 15, hint: 'Esc' }).setDepth(32);
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
