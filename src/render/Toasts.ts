import Phaser from 'phaser';
import type { IconName } from './icons';
import { escHandled } from './escape';
import { COLORS, SCREEN, TYPE, inkStyle } from './theme';
import { Button, panel, ribbon, Slip } from './ui';

/** One line of the Captain's Log, as written and as it reads on parchment. */
export interface LogEntry {
  text: string;
  /** The colour it was written in (light, for wood), which sets its tone. */
  color: string;
  count: number;
  /** Seconds into the fight when it was written, if known. */
  time?: number;
}

/** What a log line's colour says about it: good news, bad news, a note from the captain, or plain report. */
export type Tone = 'good' | 'bad' | 'note' | 'plain';

export function toneOf(color: string): Tone {
  if (color === COLORS.textGood) return 'good';
  if (color === COLORS.textWarn) return 'bad';
  if (color === COLORS.gold) return 'note';
  return 'plain';
}

const TONE_INK: Record<Tone, string> = { good: COLORS.inkGood, bad: COLORS.inkRed, note: COLORS.inkGold, plain: COLORS.ink };
const TONE_ICON: Record<Tone, IconName> = { good: 'check', bad: 'flag', note: 'star', plain: 'log' };

/** Which ship a line is about, from how it reads: toasts gather over that ship. */
export type Side = 'player' | 'enemy' | 'both';

export function sideOf(text: string): Side {
  if (/^(We're|We |Our |Your |BOARDERS|Give the order)|\b(we're|our|us)\b|has fallen/.test(text)) return 'player';
  if (/^(Hit their|Enemy |Her |She |She's)|\b(her|their|she)\b|fires into her/i.test(text)) return 'enemy';
  return 'both';
}

/** A word that sums up a line, for its icon: fire, a hit, a fall, a boarding. */
function iconFor(text: string, tone: Tone): IconName {
  if (/\bfire\b|ablaze|burn/i.test(text) && !/fires into/i.test(text)) return 'fire';
  if (/holed|water|leak|flood/i.test(text)) return 'flood';
  if (/fallen|is down|sunk|goes down/i.test(text)) return 'skull';
  if (/board|grapple|swing|cold steel/i.test(text)) return 'board';
  if (/hit|fires into|critical|glances/i.test(text)) return 'round';
  return TONE_ICON[tone];
}

interface Toast {
  slip: Slip;
  side: Side;
  born: number;
  until: number;
  leaving: boolean;
  /** How many times the line has come up while this toast was showing. */
  count: number;
}

/** Where each stack of toasts stands: the bottom of the newest, over its ship and clear of the bottom panels and the alert. */
const STACK_X: Record<Side, number> = { player: 330, enemy: 950, both: SCREEN.w / 2 };
const STACK_BOTTOM = 466;
const MAX_PER_STACK = 3;
/** Narrow enough that the three stacks never touch. */
const TOAST_WRAP = 236;

/**
 * Short notes that pop up near the action, stack, and fade: the Captain's Log as it happens. Not interactive, so
 * they never get in the way of a click on the ships.
 */
export class Toasts {
  private readonly toasts: Toast[] = [];
  /** Where the stacks stand, raised while something else (a hint) holds the usual place. */
  private bottom = STACK_BOTTOM;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  push(text: string, color: string): void {
    const tone = toneOf(color);
    const side = sideOf(text);
    // A repeated line updates its toast rather than stacking a copy.
    const same = this.toasts.find((t) => !t.leaving && t.slip.getData('text') === text);
    if (same) {
      same.count++;
      same.slip.setLabel(`${text}  ×${same.count}`);
      same.until = this.scene.time.now + this.hold(text);
      this.layout(true);
      return;
    }
    const slip = new Slip(this.scene, 0, 0, text, { size: TYPE.body, wrap: TOAST_WRAP, icon: iconFor(text, tone), color: TONE_INK[tone] }).setDepth(this.depth);
    slip.setData('text', text);
    const now = this.scene.time.now;
    const toast: Toast = { slip, side, born: now, until: now + this.hold(text), leaving: false, count: 1 };
    this.toasts.push(toast);
    // Too many over one ship: the oldest makes way.
    const stack = this.toasts.filter((t) => t.side === side && !t.leaving);
    if (stack.length > MAX_PER_STACK) this.leave(stack[0], 160);
    this.layout(false);
    // In: rise a little and fade up.
    slip.setAlpha(0);
    slip.y += 14;
    this.scene.tweens.add({ targets: slip, alpha: 1, y: slip.y - 14, duration: 220, ease: 'Back.Out' });
  }

  /** Long enough to read: a beat plus time for every word. */
  private hold(text: string): number {
    return 2600 + Math.min(4000, text.split(' ').length * 220);
  }

  update(): void {
    const now = this.scene.time.now;
    for (const t of this.toasts) if (!t.leaving && now > t.until) this.leave(t, 420);
  }

  /** Raise the stacks to stand above `y` (or put them back, given null). */
  setFloor(y: number | null): void {
    const bottom = Math.min(STACK_BOTTOM, y ?? STACK_BOTTOM);
    if (bottom === this.bottom) return;
    this.bottom = bottom;
    this.layout(true);
  }

  /** Hide them all (while the scroll-back log is open, or the fight is over). */
  setVisible(on: boolean): void {
    for (const t of this.toasts) t.slip.setVisible(on);
  }

  private leave(t: Toast, ms: number): void {
    t.leaving = true;
    this.scene.tweens.add({
      targets: t.slip,
      alpha: 0,
      y: t.slip.y - 10,
      duration: ms,
      onComplete: () => {
        t.slip.destroy();
        const i = this.toasts.indexOf(t);
        if (i >= 0) this.toasts.splice(i, 1);
      },
    });
    this.layout(true);
  }

  /** Stack each side's toasts upward from the newest, sliding older ones up as new ones arrive. */
  private layout(animate: boolean): void {
    for (const side of ['player', 'enemy', 'both'] as const) {
      let bottom = this.bottom;
      const stack = this.toasts.filter((t) => t.side === side && !t.leaving);
      for (let i = stack.length - 1; i >= 0; i--) {
        const s = stack[i].slip;
        const x = Phaser.Math.Clamp(Math.round(STACK_X[side] - s.paperW / 2), 8, SCREEN.w - s.paperW - 8);
        const y = Math.round(bottom - s.paperH);
        bottom = y - 4;
        if (s.x === 0 && s.y === 0) s.setPosition(x, y);
        else if (animate || s.y !== y) {
          this.scene.tweens.killTweensOf(s);
          this.scene.tweens.add({ targets: s, x, y, alpha: 1, duration: 180, ease: 'Sine.Out' });
        }
      }
    }
  }
}

/**
 * The Captain's Log in full: every line of the fight on a sheet of parchment, newest at the foot, scrolled with the
 * wheel. A modal overlay; `onClose` runs once it is gone.
 */
export class LogBook {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  closed = false;
  private scroll = 0;
  private readonly body: Phaser.GameObjects.Container;
  private readonly viewH: number;
  private readonly contentH: number;
  private readonly thumb: Phaser.GameObjects.Graphics;
  private readonly track: { x: number; y: number; h: number };

  constructor(
    private readonly scene: Phaser.Scene,
    entries: readonly LogEntry[],
    depth: number,
    private readonly onClose: () => void = () => {},
  ) {
    const w = 660;
    const h = 540;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2;
    const shade = scene.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setDepth(depth).setInteractive();
    shade.on('pointerdown', () => this.close());
    const sheet = panel(scene, x, y, w, h, { modal: true, skin: 'parchment' }).setDepth(depth);
    // The sheet itself swallows clicks, so only the shade around it closes the log.
    sheet.setInteractive();
    this.objects.push(shade, sheet);
    this.objects.push(ribbon(scene, SCREEN.w / 2, y + 4, "Captain's Log", { size: 22, width: 300, depth: depth + 2 }));

    const left = x + 44;
    const top = y + 48;
    this.viewH = h - 48 - 70;
    const wrap = w - 44 - 64;
    this.body = scene.add.container(0, 0).setDepth(depth + 1);
    let cy = 0;
    if (!entries.length) this.body.add(scene.add.text(left, top, 'Nothing written yet.', inkStyle(TYPE.lead, COLORS.inkDim, { fontStyle: 'italic' })));
    for (const e of entries) {
      const tone = toneOf(e.color);
      const when = e.time !== undefined ? `${Math.floor(e.time / 60)}:${String(Math.floor(e.time % 60)).padStart(2, '0')}` : '';
      if (when) this.body.add(scene.add.text(left - 34, top + cy + 1, when, inkStyle(TYPE.small, COLORS.inkDim)));
      const t = scene.add.text(left + 6, top + cy, e.count > 1 ? `${e.text}  ×${e.count}` : e.text, inkStyle(TYPE.lead - 1, TONE_INK[tone], { wordWrap: { width: wrap }, lineSpacing: 2, fontStyle: tone === 'note' ? 'italic' : 'normal' }));
      this.body.add(t);
      // A short ruled line between entries, like a ledger.
      cy += t.height + 9;
    }
    this.contentH = cy;
    const maskShape = scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(left - 40, top - 4, wrap + 50, this.viewH + 8);
    this.body.setMask(maskShape.createGeometryMask());
    this.objects.push(this.body, maskShape);

    // A thin scroll bar down the right edge.
    this.track = { x: x + w - 34, y: top, h: this.viewH };
    const bar = scene.add.graphics().setDepth(depth + 1);
    bar.fillStyle(0x6a4a22, 0.18).fillRoundedRect(this.track.x, this.track.y, 6, this.track.h, 3);
    this.thumb = scene.add.graphics().setDepth(depth + 1);
    this.objects.push(bar, this.thumb);
    bar.setVisible(this.contentH > this.viewH);

    const close = new Button(scene, SCREEN.w / 2 - 80, y + h - 56, 160, 38, 'Close', () => this.close(), { size: 15, hint: 'L' }).setDepth(depth + 2);
    this.objects.push(close);
    // Open at the newest lines.
    this.setScroll(Math.max(0, this.contentH - this.viewH));
    const wheel = (_p: unknown, _o: unknown, _dx: number, dy: number) => this.setScroll(this.scroll + dy * 0.6);
    scene.input.on('wheel', wheel);
    const keys = scene.input.keyboard;
    const esc = () => (escHandled(), this.close());
    keys?.once('keydown-ESC', esc);
    this.objects.push({ destroy: () => (scene.input.off('wheel', wheel), keys?.off('keydown-ESC', esc)) } as unknown as Phaser.GameObjects.GameObject);
  }

  private setScroll(v: number): void {
    const max = Math.max(0, this.contentH - this.viewH);
    this.scroll = Phaser.Math.Clamp(v, 0, max);
    this.body.y = -this.scroll;
    const g = this.thumb.clear();
    if (max <= 0) return;
    const th = Math.max(30, (this.viewH / this.contentH) * this.track.h);
    const ty = this.track.y + (this.scroll / max) * (this.track.h - th);
    g.fillStyle(0x6a4a22, 0.6).fillRoundedRect(this.track.x, ty, 6, th, 3);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const items = this.objects;
    // After this click finishes dispatching.
    this.scene.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
    this.onClose();
  }
}
