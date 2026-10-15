import Phaser from 'phaser';
import { placeBackdrop } from '../render/art';
import { currentRun } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, Sea } from '../render/ui';
import { bumpProfile, clearSave } from './save';

/** The end of a voyage: escape to the open ocean, or a summary of how far you got. */
export class RunEndScene extends Phaser.Scene {
  private sea!: Sea;

  constructor() {
    super('RunEnd');
  }

  create(): void {
    const run = currentRun(this);
    clearSave();
    if (run.status === 'won' && !this.registry.get('counted-win')) bumpProfile('wins');
    this.registry.set('counted-win', true);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const cx = SCREEN.w / 2;
    const won = run.status === 'won';
    placeBackdrop(this, won ? 'victory' : 'defeat', SCREEN.w, SCREEN.h, 0.25);

    this.add.rectangle(cx - 340, 100, 680, 480, COLORS.panel, 0.93).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
    this.add
      .text(cx, 160, run.endingTitle || (won ? 'Free on the Open Sea!' : 'The Voyage Ends'), { fontFamily: TITLE_FONT, fontSize: '46px', color: won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5);
    const epilogue = run.endingTitle
      ? run.ending
      : won
      ? `HMS Relentless falls astern, and with her the last of the King's reach. ${run.def.name} sails west with ${run.gold} gold in her hold and a legend in her wake.`
      : `${run.ending} ${run.def.name} never saw the open ocean. Her story will be told in waterfront taverns, if it is told at all.`;
    this.add.text(cx, 210, epilogue, textStyle(17, COLORS.text, { align: 'center', wordWrap: { width: 600 }, lineSpacing: 4 })).setOrigin(0.5, 0);

    const rows: [string, string][] = [
      ['Ship', `${run.def.name} (${run.def.className})`],
      ['Distance sailed', `${run.node.col} of ${run.chart.columns - 1} legs`],
      ['Battles won', `${run.battlesWon}`],
      ['Plunder taken', `${run.plunderTaken} gold`],
      ['Gold in the hold', `${run.gold}`],
      ['Crew left', `${run.condition.crew.length}`],
    ];
    rows.forEach(([label, value], i) => {
      const y = 320 + i * 30;
      this.add.text(cx - 230, y, label, textStyle(16, COLORS.textDim));
      this.add.text(cx + 230, y, value, textStyle(16, COLORS.text)).setOrigin(1, 0);
    });

    const again = () => this.scene.start('ShipSelect', { shipId: run.def.id });
    new Button(this, cx - 250, 516, 230, 44, 'New Voyage', again, { size: 18 });
    new Button(this, cx + 20, 516, 230, 44, 'Title Screen', () => this.scene.start('Title'), { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', again);
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
