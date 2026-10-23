import Phaser from 'phaser';
import { coop } from '../net/CoopClient';
import { placeBackdrop } from '../render/art';
import { currentRun } from '../render/RunBar';
import { CAPS_FONT, COLORS, SCREEN, textStyle } from '../render/theme';
import { Button, divider, gild, goldText, panel, Sea, waxSeal } from '../render/ui';
import { awardRenown, bumpProfile, clearSave, recordVoyage } from './save';
import { challenge, challengeRenown } from '../data/challenges';
import { highlights } from '../sim/chronicle';

/** The end of a voyage: escape to the open ocean, or a summary of how far you got. */
export class RunEndScene extends Phaser.Scene {
  private sea!: Sea;

  constructor() {
    super('RunEnd');
  }

  create(): void {
    const run = currentRun(this);
    clearSave();
    recordVoyage(run);
    const fame = awardRenown(run);
    if (run.status === 'won' && !this.registry.get('counted-win')) bumpProfile('wins');
    this.registry.set('counted-win', true);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const cx = SCREEN.w / 2;
    const won = run.status === 'won';
    placeBackdrop(this, won ? 'victory' : 'defeat', SCREEN.w, SCREEN.h, 0.25);

    // Everything is measured first, then stacked and centred, so a long epilogue pushes the rest down.
    const title = goldText(this, cx, 0, run.endingTitle || (won ? 'Free on the Open Sea!' : 'The Voyage Ends'), 50, { align: 'center', wordWrap: { width: 760 } }).setOrigin(0.5, 0);
    // A foul end is lettered in blood red rather than gold.
    if (!won) gild(title, ['#ffc2a8', '#ef6a4c', '#b8321e', '#7a1408']);
    const epilogue = run.endingTitle
      ? run.ending
      : won
      ? `HMS Relentless falls astern, and with her the last of the King's reach. ${run.def.name} sails west with ${run.gold} gold in her hold and a legend in her wake.`
      : `${run.ending} ${run.def.name} never saw the open ocean. Her story will be told in waterfront taverns, if it is told at all.`;
    const story = this.add.text(cx, 0, epilogue, textStyle(17, COLORS.text, { align: 'center', wordWrap: { width: 820 }, lineSpacing: 4 })).setOrigin(0.5, 0);

    const rows: [string, string][] = [
      ['Ship', `${run.def.name} (${run.def.className})`],
      ['Captain', run.captain.name],
      ['Renown', `+${fame.earned}  (${fame.total} in all)`],
      ['Distance sailed', `${run.legs.sailed} of ${run.legs.total} legs (${run.sectorDef.name})`],
      ['Battles won', `${run.battlesWon}`],
      ['Plunder taken', `${run.plunderTaken} gold`],
      ['Gold in the hold', `${run.gold}`],
      ['Crew left', `${run.condition.crew.length}`],
    ];
    if (run.challenges.length) rows.splice(3, 0, ['Hardships', `${run.challenges.map((id) => challenge(id).name).join(', ')} (+${Math.round((challengeRenown(run.challenges) - 1) * 100)}% renown)`]);
    if (fame.unlocked.length) rows.splice(3, 0, ['Will now sail with you', fame.unlocked.map((c) => c.name).join(', ')]);

    // Everything in the two columns is written first and measured, so long entries wrap without overlapping.
    const W = 960;
    const L = { x: cx - W / 2 + 36, w: 430 };
    const R = { x: cx + 24, w: W / 2 - 60 };
    const ledger = rows.map(([label, value]) => {
      const l = this.add.text(L.x, 0, label, { fontFamily: CAPS_FONT, fontSize: '17px', color: COLORS.textDim });
      const v = this.add.text(L.x + L.w, 0, value, textStyle(15, COLORS.text, { align: 'right', wordWrap: { width: L.w - l.width - 24 } })).setOrigin(1, 0);
      return { l, v, h: Math.max(30, v.height + 10) };
    });
    // The ship's log: the voyage's best stories, beside the ledger.
    const logHead = this.add.text(R.x, 0, 'From the Ship’s Log', { fontFamily: CAPS_FONT, fontSize: '19px', color: COLORS.gold });
    const tales = highlights(run.log, 6).map((t) => {
      const l = this.add.text(R.x, 0, t.label, { fontFamily: CAPS_FONT, fontSize: '14px', color: COLORS.textDim });
      const v = this.add.text(R.x, 0, t.text, textStyle(14, COLORS.text, { wordWrap: { width: R.w } }));
      return { l, v, h: 17 + v.height + 12 };
    });
    if (!tales.length) {
      const v = this.add.text(R.x, 0, 'A short voyage, and little to write.', textStyle(15, COLORS.textDim, { fontStyle: 'italic' }));
      tales.push({ l: v, v, h: 30 });
    }
    const sum = (xs: { h: number }[]) => xs.reduce((n, x) => n + x.h, 0);
    const body = Math.max(sum(ledger), 34 + sum(tales));
    const pad = 28;
    const height = pad + title.height + 30 + story.height + 24 + body + 20 + 44 + pad;
    let y = Math.max(12, (SCREEN.h - height) / 2);
    panel(this, cx - W / 2, y, W, height, { modal: true }).setDepth(-1);
    // The voyage's seal, pressed into the corner of the page.
    const seal = this.add.image(cx + W / 2 - 22, y + 22, waxSeal(this, won ? 'anchor' : 'skull')).setAngle(won ? 12 : -14).setAlpha(0).setScale(1.8);
    this.tweens.add({ targets: seal, alpha: 1, scale: 1, duration: 380, delay: 450, ease: 'Back.easeIn', onComplete: () => this.cameras.main.shake(120, 0.003) });
    y += pad;
    title.setY(y);
    y += title.height + 6;
    divider(this, cx, y + 6, 300);
    y += 24;
    story.setY(y);
    y += story.height + 24;
    // The ship's ledger on the left: dotted leaders from each entry to its figure.
    const top = y;
    const leaders = this.add.graphics().fillStyle(COLORS.brass, 0.45);
    for (const { l, v, h } of ledger) {
      l.setY(y);
      v.setY(y);
      // A figure that wraps fills its own line; only a one-line figure gets leaders.
      if (v.height <= 30) for (let dx = l.x + l.width + 10; dx < L.x + L.w - v.width - 8; dx += 7) leaders.fillCircle(dx, y + 15, 1);
      y += h;
    }
    // The ship's log on the right: what the taverns will tell of her.
    this.add.graphics().lineStyle(1, COLORS.brass, 0.35).lineBetween(cx + 6, top, cx + 6, top + body);
    logHead.setY(top);
    let ty = top + 34;
    for (const { l, v, h } of tales) {
      l.setY(ty);
      if (v !== l) v.setY(ty + 17);
      ty += h;
    }
    y = top + body + 20;

    // A co-op crew goes back to the lobby together to raise the next voyage.
    const link = coop();
    const again = link
      ? new Button(this, cx - 250, y, 230, 44, 'Back to the lobby', () => {
          link.send({ t: 'leave' });
          this.scene.start('CoopLobby');
        }, { size: 18, hint: 'Enter' })
      : new Button(this, cx - 250, y, 230, 44, 'New Voyage', () => this.scene.start('ShipSelect', { shipId: run.def.id }), { size: 18, hint: 'Enter' });
    const home = new Button(this, cx + 20, y, 230, 44, 'Title Screen', () => this.scene.start('Title'), { size: 18, hint: 'Esc' });
    this.input.keyboard!.once('keydown-ENTER', () => again.press());
    this.input.keyboard!.once('keydown-ESC', () => home.press());
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
