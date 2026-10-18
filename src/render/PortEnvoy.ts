import Phaser from 'phaser';
import { power } from '../data/powers';
import { tierName } from '../sim/Diplomacy';
import { describeCommission, type Run } from '../sim/Run';
import { openLedger, standingBar } from './Ledger';
import { playSfx } from './sound';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from './theme';
import { Button, panel } from './ui';
import { voyage } from '../net/voyage';

/** How the harbour's masters regard you and what it does to prices, in a line. */
export function harbourTerms(run: Run): string {
  const id = run.portPower;
  if (!id) return '';
  const rate = run.portRate;
  const prices = rate === 1 ? 'fair prices' : rate < 1 ? `prices ${Math.round((1 - rate) * 100)}% off` : `prices ${Math.round((rate - 1) * 100)}% up`;
  return `${power(id).name} · ${tierName(run.tier(id))} · ${prices}${run.portFeud ? ' · no one will sign on' : ''}`;
}

/**
 * The harbour's masters, as an overlay on the port screen: who holds the port and how they regard you (which sets
 * the prices), a gift for goodwill, and the work they offer. `onChange` runs after anything that costs gold.
 */
export class PortEnvoy {
  private frame: Phaser.GameObjects.GameObject[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  closed = false;
  private readonly x: number;
  private readonly y: number;
  private readonly w = 560;
  private readonly h = 320;
  private static readonly DEPTH = 50;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly run: Run,
    private readonly onChange: () => void,
    private readonly onClose: () => void = () => {},
  ) {
    this.x = (SCREEN.w - this.w) / 2;
    this.y = (SCREEN.h - this.h) / 2;
    const d = PortEnvoy.DEPTH;
    const shade = scene.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setDepth(d).setInteractive();
    shade.on('pointerdown', () => this.close());
    const close = new Button(scene, SCREEN.w / 2 - 70, this.y + this.h - 50, 140, 36, 'Close', () => this.close(), { size: 15, hint: 'Esc' }).setDepth(d + 1);
    this.frame = [shade, panel(scene, this.x, this.y, this.w, this.h, { modal: true }).setDepth(d), close];
    scene.input.keyboard?.once('keydown-ESC', () => this.close());
    this.draw();
  }

  /** Lay out the contents from the run (again after each purchase). */
  private draw(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const { scene, run } = this;
    const enc = run.encounter;
    const id = run.portPower;
    if (enc.kind !== 'port' || !id) return;
    const p = power(id);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(PortEnvoy.DEPTH + 1);
      this.objects.push(o);
      return o;
    };
    const x = this.x + 28;
    const w = this.w - 56;
    let y = this.y + 18;

    add(scene.add.text(SCREEN.w / 2, y, 'The Harbour Masters', { fontFamily: TITLE_FONT, fontSize: '26px', color: COLORS.gold }).setOrigin(0.5, 0));
    y += 40;
    add(scene.add.text(x, y, `${enc.name} answers to ${p.short}.`, { fontFamily: TITLE_FONT, fontSize: '17px', color: p.color }));
    y += 28;
    for (const o of standingBar(scene, x, y + 4, w, 10, run.standing[id])) add(o);
    y += 22;
    add(scene.add.text(x, y, `${harbourTerms(run)}  (${run.standing[id] > 0 ? '+' : ''}${run.standing[id]})`, textStyle(13, run.portFeud ? COLORS.textWarn : COLORS.text)));
    y += 30;

    const half = (w - 10) / 2;
    const short = run.giftPrice() - run.gold;
    const gift = add(
      new Button(scene, x, y, half, 34, `Pay your respects: ${run.giftPrice()} gold`, () => voyage(scene, { t: 'gift' }, `Pay our respects to ${p.short}`), {
        size: 13,
        tip: enc.gifted ? 'You have paid your respects this visit.' : short > 0 ? `You are ${short} gold short.` : `A gift buys goodwill with ${p.short}.`,
      }),
    );
    gift.setEnabled(run.canGift());
    add(new Button(scene, x + half + 10, y, half, 34, 'Standing at sea', () => openLedger(scene, run), { size: 13, hint: 'L' }));
    y += 48;

    if (run.commission) {
      y += add(scene.add.text(x, y, `In hand: ${describeCommission(run.commission)}`, textStyle(13, COLORS.gold, { wordWrap: { width: w }, fontStyle: 'italic' }))).height + 6;
    }
    const offer = enc.commission;
    if (offer) {
      y += add(scene.add.text(x, y, `Work on offer: ${describeCommission(offer)}`, textStyle(13, COLORS.text, { wordWrap: { width: w } }))).height + 6;
      const take = add(new Button(scene, x, y, w, 32, 'Take the commission', () => voyage(scene, { t: 'commission' }, `Take ${p.short}'s commission`), { size: 14, tip: run.commission ? 'Finish the work in hand first.' : `${p.name} will think better of you when it is done.` }));
      take.setEnabled(run.canTakeCommission());
    } else if (!run.commission) {
      add(scene.add.text(x, y, run.portFeud ? 'Nobody here will give you work.' : 'No work on offer.', textStyle(13, COLORS.textDim, { fontStyle: 'italic' })));
    }
  }

  /** Carry out a gift (the port screen calls this when the command comes back). */
  gift(): void {
    if (!this.run.gift().length) return;
    playSfx(this.scene, 'coins', 0.5);
    this.onChange();
    this.scene.time.delayedCall(0, () => !this.closed && this.draw());
  }

  take(): void {
    if (!this.run.takeCommission()) return;
    this.onChange();
    this.scene.time.delayedCall(0, () => !this.closed && this.draw());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const items = [...this.frame, ...this.objects];
    // After this click finishes dispatching.
    this.scene.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
    this.onClose();
  }
}
