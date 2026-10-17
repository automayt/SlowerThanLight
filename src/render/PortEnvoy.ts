import Phaser from 'phaser';
import { power } from '../data/powers';
import { tierName } from '../sim/Diplomacy';
import { describeCommission, type Run } from '../sim/Run';
import { Ledger, standingBar } from './Ledger';
import { playSfx } from './sound';
import { COLORS, TITLE_FONT, textStyle } from './theme';
import { Button } from './ui';

/**
 * The harbour's masters, in a block of the port screen: who holds the port and how they regard you (which sets
 * the prices), a gift for goodwill, and the work they offer. `onChange` runs after anything that costs gold.
 */
export class PortEnvoy {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private ledger: Ledger | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly run: Run,
    private readonly x: number,
    private readonly y: number,
    private readonly w: number,
    private readonly onChange: () => void,
  ) {
    this.draw();
  }

  get open(): boolean {
    return !!this.ledger;
  }

  openLedger(): void {
    if (!this.ledger) this.ledger = new Ledger(this.scene, this.run, () => (this.ledger = null));
  }

  /** Redraw from the run (after a purchase elsewhere changes the purse). */
  draw(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const { scene, run, x, w } = this;
    const enc = run.encounter;
    const id = run.portPower;
    if (enc.kind !== 'port' || !id) return;
    const p = power(id);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.objects.push(o), o);
    let y = this.y;

    add(scene.add.text(x, y, `HARBOUR MASTERS · ${p.name.toUpperCase()}`, { fontFamily: TITLE_FONT, fontSize: '15px', color: p.color, fontStyle: 'bold' }));
    y += 24;
    for (const o of standingBar(scene, x, y + 4, w, 10, run.standing[id])) add(o);
    y += 20;
    const rate = run.portRate;
    const prices = rate === 1 ? 'fair prices' : rate < 1 ? `prices ${Math.round((1 - rate) * 100)}% off` : `prices ${Math.round((rate - 1) * 100)}% up`;
    const feud = run.portFeud ? ' · no one will sign on' : '';
    add(scene.add.text(x, y, `${tierName(run.tier(id))} (${run.standing[id]}): ${prices}${feud}`, textStyle(13, run.portFeud ? COLORS.textWarn : COLORS.text)));
    y += 22;

    for (const line of enc.welcome ?? []) {
      y += add(scene.add.text(x, y, line, textStyle(13, COLORS.textGood, { wordWrap: { width: w } }))).height + 2;
    }

    const half = (w - 8) / 2;
    const gift = add(
      new Button(scene, x, y + 4, half, 32, `Gift ${run.giftPrice()} gold`, () => this.gift(), {
        size: 13,
        tip: enc.gifted ? 'You have paid your respects this visit.' : run.gold < run.giftPrice() ? `You are ${run.giftPrice() - run.gold} gold short.` : `Goodwill with ${p.short}.`,
      }),
    );
    gift.setEnabled(run.canGift());
    add(new Button(scene, x + half + 8, y + 4, half, 32, 'Standing at sea', () => this.openLedger(), { size: 13, hint: 'L' }));
    y += 44;

    const offer = enc.commission;
    if (run.commission) {
      y += add(scene.add.text(x, y, `In hand: ${describeCommission(run.commission)}`, textStyle(12, COLORS.gold, { wordWrap: { width: w }, fontStyle: 'italic' }))).height + 4;
    }
    if (offer) {
      y += add(scene.add.text(x, y, `Offered: ${describeCommission(offer)}`, textStyle(12, COLORS.text, { wordWrap: { width: w } }))).height + 4;
      const take = add(new Button(scene, x, y, w, 30, 'Take the commission', () => this.take(), { size: 13, tip: run.commission ? 'Finish the work in hand first.' : `Standing with ${p.short} rises when it is done.` }));
      take.setEnabled(run.canTakeCommission());
    } else if (!run.commission) {
      add(scene.add.text(x, y, run.portFeud ? 'Nobody here will give you work.' : 'No work on offer.', textStyle(12, COLORS.textDim, { fontStyle: 'italic' })));
    }
  }

  private gift(): void {
    if (!this.run.gift().length) return;
    playSfx(this.scene, 'coins', 0.5);
    this.onChange();
    this.draw();
  }

  private take(): void {
    if (!this.run.takeCommission()) return;
    this.onChange();
    this.draw();
  }
}
