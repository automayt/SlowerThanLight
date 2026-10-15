import Phaser from 'phaser';
import { SEA_EVENTS } from '../data/voyage';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import type { EventRarity } from '../sim/types';
import { discovered } from './save';

const RARITY_COLOR: Record<EventRarity, string> = { common: COLORS.text, uncommon: '#9be37f', rare: '#8fc7ff', legendary: '#ffb347' };
const ORDER: EventRarity[] = ['legendary', 'rare', 'uncommon', 'common'];

/** Every event you have met on any voyage, and how many are still out there. */
export class LogbookScene extends Phaser.Scene {
  private sea!: Sea;

  constructor() {
    super('Logbook');
  }

  create(): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const seen = discovered();
    const events = SEA_EVENTS.filter((e) => e.pool !== 'chain').sort(
      (a, b) => ORDER.indexOf(a.rarity ?? 'common') - ORDER.indexOf(b.rarity ?? 'common') || a.title.localeCompare(b.title),
    );
    const found = events.filter((e) => seen.has(e.id)).length;

    panel(this, 24, 16, SCREEN.w - 48, SCREEN.h - 32);
    this.add.text(SCREEN.w / 2, 26, 'The Captain’s Logbook', { fontFamily: TITLE_FONT, fontSize: '32px', color: COLORS.gold }).setOrigin(0.5, 0);
    this.add.text(SCREEN.w / 2, 68, `${found} of ${events.length} tales discovered across all your voyages`, textStyle(14, COLORS.textDim)).setOrigin(0.5, 0);

    const legend = ORDER.map((r) => `${r[0].toUpperCase()}${r.slice(1)}: ${events.filter((e) => (e.rarity ?? 'common') === r && seen.has(e.id)).length}/${events.filter((e) => (e.rarity ?? 'common') === r).length}`);
    legend.forEach((t, i) => this.add.text(60 + i * 200, 96, t, textStyle(13, RARITY_COLOR[ORDER[i]], { fontStyle: 'bold' })));

    const cols = 3;
    const perCol = Math.ceil(events.length / cols);
    const colW = (SCREEN.w - 120) / cols;
    const rowH = Math.min(19, (SCREEN.h - 210) / perCol);
    events.forEach((e, i) => {
      const x = 60 + Math.floor(i / perCol) * colW;
      const y = 128 + (i % perCol) * rowH;
      const known = seen.has(e.id);
      const color = RARITY_COLOR[e.rarity ?? 'common'];
      this.add.text(x, y, known ? e.title : '? ? ?', textStyle(13, color, { fontStyle: known ? 'normal' : 'italic' })).setAlpha(known ? 1 : 0.45);
    });

    const back = () => this.scene.start('Title');
    new Button(this, SCREEN.w / 2 - 90, SCREEN.h - 66, 180, 40, '← Back', back, { size: 16 });
    this.input.keyboard!.once('keydown-ESC', back);
    this.input.keyboard!.once('keydown-ENTER', back);
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
