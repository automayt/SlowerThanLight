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

    // Everything is measured first, then stacked and centred, so a long epilogue pushes the rest down.
    const box = this.add.rectangle(cx - 340, 0, 680, 0, COLORS.panel, 0.93).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
    const title = this.add
      .text(cx, 0, run.endingTitle || (won ? 'Free on the Open Sea!' : 'The Voyage Ends'), { fontFamily: TITLE_FONT, fontSize: '46px', color: won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 5, align: 'center', wordWrap: { width: 620 } })
      .setOrigin(0.5, 0);
    const epilogue = run.endingTitle
      ? run.ending
      : won
      ? `HMS Relentless falls astern, and with her the last of the King's reach. ${run.def.name} sails west with ${run.gold} gold in her hold and a legend in her wake.`
      : `${run.ending} ${run.def.name} never saw the open ocean. Her story will be told in waterfront taverns, if it is told at all.`;
    const story = this.add.text(cx, 0, epilogue, textStyle(17, COLORS.text, { align: 'center', wordWrap: { width: 600 }, lineSpacing: 4 })).setOrigin(0.5, 0);

    const rows: [string, string][] = [
      ['Ship', `${run.def.name} (${run.def.className})`],
      ['Distance sailed', `${run.legs.sailed} of ${run.legs.total} legs (${run.sectorDef.name})`],
      ['Battles won', `${run.battlesWon}`],
      ['Plunder taken', `${run.plunderTaken} gold`],
      ['Gold in the hold', `${run.gold}`],
      ['Crew left', `${run.condition.crew.length}`],
    ];
    const ROW_H = 30;
    const pad = 28;
    const height = pad + title.height + 14 + story.height + 24 + rows.length * ROW_H + 20 + 44 + pad;
    let y = Math.max(12, (SCREEN.h - height) / 2);
    box.setPosition(cx - 340, y).setSize(680, height);
    y += pad;
    title.setY(y);
    y += title.height + 14;
    story.setY(y);
    y += story.height + 24;
    rows.forEach(([label, value]) => {
      this.add.text(cx - 230, y, label, textStyle(16, COLORS.textDim));
      this.add.text(cx + 230, y, value, textStyle(16, COLORS.text)).setOrigin(1, 0);
      y += ROW_H;
    });
    y += 20;

    const again = new Button(this, cx - 250, y, 230, 44, 'New Voyage', () => this.scene.start('ShipSelect', { shipId: run.def.id }), { size: 18, hint: 'Enter' });
    const home = new Button(this, cx + 20, y, 230, 44, 'Title Screen', () => this.scene.start('Title'), { size: 18, hint: 'Esc' });
    this.input.keyboard!.once('keydown-ENTER', () => again.press());
    this.input.keyboard!.once('keydown-ESC', () => home.press());
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
