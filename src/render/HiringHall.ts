import Phaser from 'phaser';
import { trait } from '../data/traits';
import { voyage } from '../net/voyage';
import type { Run } from '../sim/Run';
import { escHandled } from './escape';
import { COLORS, SCREEN, TYPE, inkStyle, titleStyle } from './theme';
import { Button, divider, panel, ribbon } from './ui';

/**
 * The hiring hall, over the port screen: the sailors looking for a berth, each with a background and a price.
 * Signing one on is a voyage command (the captain's, in co-op); `refresh` redraws after it is carried out.
 */
export class HiringHall {
  private frame: Phaser.GameObjects.GameObject[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  closed = false;
  private readonly w = 640;
  private readonly h = 400;
  private static readonly DEPTH = 50;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly run: Run,
    private readonly onClose: () => void = () => {},
  ) {
    const x = (SCREEN.w - this.w) / 2;
    const y = (SCREEN.h - this.h) / 2;
    const d = HiringHall.DEPTH;
    const shade = scene.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setDepth(d).setInteractive();
    shade.on('pointerdown', () => this.close());
    const close = new Button(scene, SCREEN.w / 2 - 70, y + this.h - 50, 140, 36, 'Close', () => this.close(), { size: 15, hint: 'Esc' }).setDepth(d + 1);
    const sheet = panel(scene, x, y, this.w, this.h, { modal: true, skin: 'parchment' }).setDepth(d);
    // The sheet swallows clicks: only the shade around it closes the hall.
    sheet.setInteractive();
    this.frame = [shade, sheet, close, ribbon(scene, SCREEN.w / 2, y + 2, 'The Hiring Hall', { size: 22, width: 300, depth: d + 2 })];
    scene.input.keyboard?.once('keydown-ESC', () => this.close());
    this.refresh();
  }

  /** Lay out the candidates from the run (again after each signing). */
  refresh(): void {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const { scene, run } = this;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(HiringHall.DEPTH + 1);
      this.objects.push(o);
      return o;
    };
    const x = (SCREEN.w - this.w) / 2 + 28;
    let y = (SCREEN.h - this.h) / 2 + 44;
    const hands = run.encounter.kind === 'port' ? (run.encounter.hands ?? []) : [];
    const full = run.condition.crew.length >= run.maxCrew;
    add(scene.add.text(x, y, full ? `Every bunk is taken (${run.condition.crew.length}/${run.maxCrew}).` : `Bunks free: ${run.maxCrew - run.condition.crew.length}`, inkStyle(TYPE.body, full ? COLORS.inkRed : COLORS.inkDim, { fontStyle: 'italic' })));
    y += 26;
    if (!hands.length) add(scene.add.text(x, y, 'Nobody else is looking for a berth today.', inkStyle(14, COLORS.inkDim, { fontStyle: 'italic' })));
    hands.forEach((c, i) => {
      const t = trait(c.trait);
      const price = run.handPrice(c);
      if (i > 0) add(divider(scene, SCREEN.w / 2, y - 12, this.w - 140, 0x6a4a22, 0.4));
      add(scene.add.text(x, y, `${c.name}, ${t.name}`, titleStyle(19, COLORS.ink)));
      add(scene.add.text(x, y + 26, t.blurb, inkStyle(TYPE.body, COLORS.ink, { wordWrap: { width: this.w - 230 } })));
      const why = run.portFeud ? 'Nobody here will sign on with you.' : full ? 'No bunk to spare.' : run.gold < price ? `You are ${price - run.gold} gold short.` : undefined;
      const b = add(new Button(scene, x + this.w - 56 - 150, y + 6, 150, 36, `Sign on · ${price}`, () => voyage(scene, { t: 'hire', pick: i }, `Sign on ${c.name}, ${t.name}`), { size: 14, tip: why ?? `Sign on ${c.name} for ${price} gold.`, icon: 'gold' }));
      b.setEnabled(run.canHire(i));
      y += 86;
    });
  }

  close(): void {
    if (this.closed) return;
    escHandled();
    this.closed = true;
    const items = [...this.frame, ...this.objects];
    // After this click finishes dispatching.
    this.scene.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
    this.onClose();
  }
}
