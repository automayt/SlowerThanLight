import Phaser from 'phaser';
import { power } from '../data/powers';
import { harbourLine, portraitFor } from '../data/portraits';
import { Dialogue } from './Dialogue';
import { tierName } from '../sim/Diplomacy';
import { describeCommission, type Run } from '../sim/Run';
import { openLedger, standingBar } from './Ledger';
import { playSfx } from './sound';
import { COLORS, SCREEN, inkOf, inkStyle, titleStyle } from './theme';
import { Button, panel, ribbon } from './ui';
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
  private readonly w = 620;
  private readonly h = 440;
  /** The greeting is typed out once, not again on every redraw. */
  private greeted = false;
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
    const sheet = panel(scene, this.x, this.y, this.w, this.h, { modal: true, skin: 'parchment' }).setDepth(d);
    // The sheet swallows clicks: only the shade around it closes the envoy.
    sheet.setInteractive();
    this.frame = [shade, sheet, close, ribbon(scene, SCREEN.w / 2, this.y + 2, 'The Harbour Masters', { size: 22, width: 340, depth: d + 2 })];
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

    y += 22;
    const master = add(new Dialogue(scene, { x, y, w, portrait: portraitFor({ power: id }), name: 'The harbour master', role: `${enc.name}, for ${p.short}`, text: harbourLine(run.tier(id)), portraitH: 112, size: 15 }));
    if (this.greeted) master.skip();
    this.greeted = true;
    y += master.fullHeight + 14;
    add(scene.add.text(x, y, `${enc.name} answers to ${p.short}.`, titleStyle(18, inkOf(p.color, 0.55))));
    y += 28;
    for (const o of standingBar(scene, x, y + 4, w, 10, run.standing[id])) add(o);
    y += 22;
    add(scene.add.text(x, y, `${harbourTerms(run)}  (${run.standing[id] > 0 ? '+' : ''}${run.standing[id]})`, inkStyle(13, run.portFeud ? COLORS.inkRed : COLORS.ink)));
    y += 30;

    const half = (w - 10) / 2;
    const short = run.giftPrice() - run.gold;
    const gift = add(
      new Button(scene, x, y, half, 34, `Pay respects · ${run.giftPrice()}`, () => voyage(scene, { t: 'gift' }, `Pay our respects to ${p.short}`), {
        size: 13,
        icon: 'gold',
        tip: enc.gifted ? 'You have paid your respects this visit.' : short > 0 ? `You are ${short} gold short.` : `A gift buys goodwill with ${p.short}.`,
      }),
    );
    gift.setEnabled(run.canGift());
    add(new Button(scene, x + half + 10, y, half, 34, 'Standing at sea', () => openLedger(scene, run), { size: 13, hint: 'L', icon: 'flag' }));
    y += 48;

    if (run.commission) {
      y += add(scene.add.text(x, y, `In hand: ${describeCommission(run.commission)}`, inkStyle(13, COLORS.inkGold, { wordWrap: { width: w }, fontStyle: 'italic' }))).height + 6;
    }
    const offer = enc.commission;
    if (offer) {
      y += add(scene.add.text(x, y, `Work on offer: ${describeCommission(offer)}`, inkStyle(13, COLORS.ink, { wordWrap: { width: w } }))).height + 6;
      const take = add(new Button(scene, x, y, w, 32, 'Take the commission', () => voyage(scene, { t: 'commission' }, `Take ${p.short}'s commission`), { size: 14, tip: run.commission ? 'Finish the work in hand first.' : `${p.name} will think better of you when it is done.` }));
      take.setEnabled(run.canTakeCommission());
    } else if (!run.commission) {
      add(scene.add.text(x, y, run.portFeud ? 'Nobody here will give you work.' : 'No work on offer.', inkStyle(13, COLORS.inkDim, { fontStyle: 'italic' })));
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
