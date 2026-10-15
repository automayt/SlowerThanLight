import Phaser from 'phaser';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import type { Run } from '../sim/Run';
import { saveRun } from './save';

const W = 720;
const H = 460;
const X = (SCREEN.w - W) / 2;
const Y = 110;

/** A text event: read the situation, make a choice, live with the result. */
export class EventScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private choiceButtons: Button[] = [];

  constructor() {
    super('Event');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    this.bar = new RunBar(this, run);
    this.choiceButtons = [];
    const ev = run.currentEvent();

    panel(this, X, Y, W, H);
    this.add.text(SCREEN.w / 2, Y + 20, ev.title, { fontFamily: TITLE_FONT, fontSize: '34px', color: COLORS.gold }).setOrigin(0.5, 0);
    this.add.text(X + 34, Y + 80, ev.text, textStyle(17, COLORS.text, { wordWrap: { width: W - 68 }, lineSpacing: 5 }));

    ev.choices.forEach((choice, i) => {
      const label = `${i + 1}. ${choice.label}${choice.cost ? `  (${choice.cost} gold)` : ''}`;
      const b = new Button(this, X + 34, Y + 220 + i * 54, W - 68, 44, label, () => this.choose(i), { size: 16 });
      b.label.setOrigin(0, 0.5).setX(16);
      b.setEnabled(run.canChoose(i));
      this.choiceButtons.push(b);
    });
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR'];
    ev.choices.forEach((_, i) => this.input.keyboard!.once(`keydown-${keys[i]}`, () => this.choiceButtons.length && run.canChoose(i) && this.choose(i)));
  }

  private choose(index: number): void {
    const run = this.run;
    if (!this.choiceButtons.length || !run.canChoose(index)) return;
    const result = run.chooseEvent(index);
    saveRun(run);
    for (const b of this.choiceButtons) b.destroy();
    this.choiceButtons = [];

    this.add.text(X + 34, Y + 220, result.effect.text, textStyle(17, COLORS.gold, { wordWrap: { width: W - 68 }, lineSpacing: 5, fontStyle: 'italic' }));
    if (result.changes.length) this.add.text(X + 34, Y + 300, result.changes.join('   ·   '), textStyle(15, COLORS.text, { wordWrap: { width: W - 68 } }));

    const battle = run.status === 'battle';
    const next = () => {
      this.registry.set('chart-note', result.effect.text);
      this.scene.start(battle ? 'Battle' : 'SeaMap');
    };
    new Button(this, SCREEN.w / 2 - 130, Y + H - 66, 260, 46, battle ? 'Beat to quarters!' : 'Continue', next, { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', next);
  }

  update(time: number): void {
    this.sea.draw(time);
    this.bar.refresh();
  }
}
