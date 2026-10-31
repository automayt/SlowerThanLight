import Phaser from 'phaser';
import { COLORS, TITLE_FONT, textStyle } from './theme';
import { Button, gild } from './ui';

/** Ink on parchment. */
export const INK = COLORS.ink;
export const INK_RED = COLORS.inkRed;
/** Clean parchment, where no painted sheet is loaded. */
const PAPER = 0xe9dbb4;

/**
 * Words written out a few at a time, as if being spoken or penned. Wrapping is fixed up front, so words never
 * jump from one line to the next as they appear. `finish()` shows the rest at once.
 */
export class Typer {
  private readonly full: string;
  private shown = 0;
  private elapsed = 0;
  /** A breath after a sentence, in ms. */
  private hold = 0;
  private timer: Phaser.Time.TimerEvent | null;
  done = false;

  constructor(
    scene: Phaser.Scene,
    private readonly target: Phaser.GameObjects.Text,
    text: string,
    private readonly cps = 60,
    private readonly onDone?: () => void,
  ) {
    this.full = target.getWrappedText(text).join('\n');
    target.setText('');
    this.timer = scene.time.addEvent({ delay: 16, loop: true, callback: () => this.tick(16) });
    target.once(Phaser.GameObjects.Events.DESTROY, () => this.stop());
    if (!this.full.length) this.finish();
  }

  /** The height the words will take once all written: the text is laid out with its final wrapping. */
  static measure(target: Phaser.GameObjects.Text, text: string): number {
    const was = target.text;
    target.setText(text);
    const h = target.height;
    target.setText(was);
    return h;
  }

  private tick(ms: number): void {
    if (this.hold > 0) {
      this.hold -= ms;
      return;
    }
    this.elapsed += ms;
    const n = Math.min(this.full.length, Math.floor((this.elapsed / 1000) * this.cps));
    if (n <= this.shown) return;
    this.shown = n;
    const part = this.full.slice(0, n);
    this.target.setText(part);
    // A pause at the end of a sentence reads as breath.
    if (/[.!?…]["”’]?$/.test(part) && n < this.full.length) this.hold = 160;
    if (n >= this.full.length) this.finish();
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    this.stop();
    if (this.target.active) this.target.setText(this.full);
    this.onDone?.();
  }

  private stop(): void {
    this.timer?.remove(false);
    this.timer = null;
  }
}

/**
 * Call `skip` on any click or key press in the scene (skipping words being typed never blocks a choice: the choice
 * itself still goes through). Returns the function that stops listening.
 */
export function onAnyInput(scene: Phaser.Scene, skip: () => void): () => void {
  const pointer = () => skip();
  const key = () => skip();
  scene.input.on('pointerdown', pointer);
  scene.input.keyboard?.on('keydown', key);
  const off = () => {
    scene.input.off('pointerdown', pointer);
    scene.input.keyboard?.off('keydown', key);
  };
  scene.events.once('shutdown', off);
  return off;
}

/**
 * A sheet of parchment: the painted chart paper (cropped, never stretched) with darkened, worn edges and an inked
 * keyline. Its parts are returned so a container can hold them.
 */
export function parchment(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.GameObject[] {
  const parts: Phaser.GameObjects.GameObject[] = [];
  parts.push(scene.add.rectangle(x + 5, y + 7, w, h, 0x000000, 0.45).setOrigin(0));
  const key = scene.textures.exists('art:chart-paper') ? 'art:chart-paper' : scene.textures.exists('art:tex-chart') ? 'art:tex-chart' : null;
  if (key) {
    const img = scene.add.image(x + w / 2, y + h / 2, key).setTint(0xfff4dc);
    const s = Math.max(w / img.width, h / img.height);
    img.setScale(s);
    img.setCrop((img.width - w / s) / 2, (img.height - h / s) / 2, w / s, h / s);
    parts.push(img);
    // Ease the chart's own markings back so words read cleanly on it.
    parts.push(scene.add.rectangle(x, y, w, h, PAPER, 0.45).setOrigin(0));
  } else {
    parts.push(scene.add.rectangle(x, y, w, h, PAPER).setOrigin(0));
  }
  const g = scene.add.graphics();
  for (let i = 0; i < 8; i++) g.lineStyle(3, 0x3a2410, 0.04 + i * 0.012).strokeRect(x + i * 2, y + i * 2, w - i * 4, h - i * 4);
  g.lineStyle(1.2, 0x2a170a, 0.55).strokeRect(x + 7, y + 7, w - 14, h - 14);
  parts.push(g);
  return parts;
}

export interface DialogueOptions {
  x: number;
  y: number;
  /** Width of the whole thing: portrait, plate and speech. */
  w: number;
  /** Portrait height (its width is four-fifths of it). The speech grows below it if it needs to. */
  portraitH?: number;
  /** Art name of the face (see data/portraits.ts). A dark silhouette stands in when it is not loaded. */
  portrait: string;
  /** The name on the plate. */
  name: string;
  /** A line under the name, in small italic: their post or their ship. */
  role?: string;
  text: string;
  /** Speech in ink on parchment (true, the default), or in light type on a dark ground. */
  onParchment?: boolean;
  /** Letters a second. */
  cps?: number;
  size?: number;
  onDone?: () => void;
  /** Start speaking at once (the default), or wait for say(). */
  autoStart?: boolean;
}

/**
 * Someone speaking: their painted portrait in a brass frame, a gilt name plate, and their words typed out beside it.
 * A container: position, depth, alpha and destroy act on all of it. A click or key finishes the words at once.
 */
export class Dialogue extends Phaser.GameObjects.Container {
  private readonly speech: Phaser.GameObjects.Text;
  private typer: Typer | null = null;
  private readonly offInput: () => void;
  readonly portraitW: number;
  readonly portraitH: number;
  /** Height of the whole, with the words all written. */
  readonly fullHeight: number;

  constructor(scene: Phaser.Scene, private readonly opts: DialogueOptions) {
    super(scene, opts.x, opts.y);
    const ph = (this.portraitH = opts.portraitH ?? 132);
    const pw = (this.portraitW = Math.round(ph * 0.8));
    this.portrait(opts.portrait, pw, ph);

    // The name plate: gilt on dark wood, at the head of the speech.
    const sx = pw + 16;
    const name = gild(scene.add.text(sx + 12, 4, opts.name, { fontFamily: TITLE_FONT, fontSize: '21px', color: COLORS.gold, stroke: '#1a0e05', strokeThickness: 2 }));
    const role = opts.role ? scene.add.text(sx + 12, 4 + name.height - 2, opts.role, textStyle(12, '#d9c7a0', { fontStyle: 'italic' })) : null;
    const plateW = Math.min(opts.w - sx, Math.max(name.width, role?.width ?? 0) + 26);
    const plateH = name.height + (role ? role.height - 2 : 0) + 8;
    const plate = scene.add.graphics();
    plate.fillStyle(0x000000, 0.35).fillRoundedRect(sx + 2, 3, plateW, plateH, 5);
    plate.fillStyle(0x2a1a0e, 0.96).fillRoundedRect(sx, 0, plateW, plateH, 5);
    plate.lineStyle(1.5, COLORS.brass, 0.9).strokeRoundedRect(sx, 0, plateW, plateH, 5);
    plate.lineStyle(1, COLORS.brass, 0.35).strokeRoundedRect(sx + 3, 3, plateW - 6, plateH - 6, 3);
    this.add(plate);
    this.add(name);
    if (role) this.add(role);

    const ink = opts.onParchment ?? true;
    const size = opts.size ?? 16;
    this.speech = scene.add.text(sx + 4, plateH + 10, '', textStyle(size, ink ? INK : COLORS.text, { wordWrap: { width: opts.w - sx - 8 }, lineSpacing: 4, fontStyle: 'italic' }));
    this.add(this.speech);
    this.fullHeight = Math.max(ph, this.speech.y + Typer.measure(this.speech, opts.text));
    this.setSize(opts.w, this.fullHeight);
    scene.add.existing(this);
    this.offInput = onAnyInput(scene, () => this.skip());
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.offInput());
    if (opts.autoStart ?? true) this.say(opts.text, opts.onDone);
  }

  /** Type a new line in place of the last. */
  say(text: string, onDone?: () => void): void {
    this.typer?.finish();
    this.typer = new Typer(this.scene, this.speech, text, this.opts.cps ?? 55, onDone);
  }

  /** Show the rest of the words at once. */
  skip(): void {
    this.typer?.finish();
  }

  get typing(): boolean {
    return !!this.typer && !this.typer.done;
  }

  /** Bottom of the speech as it stands now (it grows as words are written). */
  get speechBottom(): number {
    return this.y + this.speech.y + this.speech.height;
  }

  private portrait(name: string, pw: number, ph: number): void {
    const scene = this.scene;
    const key = `art:${name}`;
    // Shadow and a dark mount behind the face.
    this.add(scene.add.rectangle(4, 6, pw, ph, 0x000000, 0.45).setOrigin(0));
    this.add(scene.add.rectangle(0, 0, pw, ph, 0x1a120a).setOrigin(0));
    if (scene.textures.exists(key)) {
      const img = scene.add.image(pw / 2, ph / 2, key);
      const s = Math.max(pw / img.width, ph / img.height);
      img.setScale(s);
      img.setCrop((img.width - pw / s) / 2, (img.height - ph / s) / 2, pw / s, ph / s);
      this.add(img);
    } else {
      // A silhouette, head and shoulders, for a face not painted yet.
      const g = scene.add.graphics();
      g.fillStyle(0x3a2a1a, 1).fillCircle(pw / 2, ph * 0.4, pw * 0.2);
      g.fillRoundedRect(pw * 0.1, ph * 0.66, pw * 0.8, ph * 0.34, { tl: pw * 0.3, tr: pw * 0.3, bl: 0, br: 0 });
      this.add(g);
    }
    // A brass frame with a dark inner keyline.
    const f = scene.add.graphics();
    f.lineStyle(4, 0x6b4a1c, 1).strokeRect(-2, -2, pw + 4, ph + 4);
    f.lineStyle(2, COLORS.brass, 1).strokeRect(-2, -2, pw + 4, ph + 4);
    f.lineStyle(1, 0x000000, 0.6).strokeRect(1, 1, pw - 2, ph - 2);
    for (const [cx, cy] of [
      [-2, -2],
      [pw + 2, -2],
      [-2, ph + 2],
      [pw + 2, ph + 2],
    ])
      f.fillStyle(COLORS.brass, 1).fillCircle(cx, cy, 3.2);
    this.add(f);
  }
}

/** A small framed portrait (a cameo beside a heading), `h` tall. Nothing when the face is not loaded. */
export function cameo(scene: Phaser.Scene, name: string, x: number, y: number, h: number): Phaser.GameObjects.GameObject[] {
  const key = `art:${name}`;
  if (!scene.textures.exists(key)) return [];
  const w = Math.round(h * 0.8);
  const img = scene.add.image(x + w / 2, y + h / 2, key);
  const s = Math.max(w / img.width, h / img.height);
  img.setScale(s);
  img.setCrop((img.width - w / s) / 2, (img.height - h / s) / 2, w / s, h / s);
  const f = scene.add.graphics();
  f.lineStyle(3, 0x6b4a1c, 1).strokeRect(x - 1, y - 1, w + 2, h + 2);
  f.lineStyle(1.5, COLORS.brass, 1).strokeRect(x - 1, y - 1, w + 2, h + 2);
  return [img, f];
}

export interface CaptainOption {
  /** The number on its seal (and its key). */
  num: number;
  label: string;
  /** What it means or costs, in small gold italic under the order. */
  sub?: string;
  /** Made possible by your ship, crew or friends: blue type and blue wax. */
  special?: boolean;
  enabled?: boolean;
  tip?: string;
}

/** One of the captain's options: a wax seal with its number, the order, and what it may cost, on a wooden plaque. */
export function captainOption(scene: Phaser.Scene, x: number, y: number, w: number, o: CaptainOption, onClick: () => void): Button {
  const textW = w - 64;
  const text = scene.add.text(0, 0, o.label, textStyle(16, o.special ? SPECIAL_COLOR : COLORS.text, { wordWrap: { width: textW }, lineSpacing: 2 }));
  const sub = o.sub ? scene.add.text(0, 0, o.sub, textStyle(13, COLORS.gold, { fontStyle: 'italic', wordWrap: { width: textW } })) : null;
  const h = Math.max(46, 10 + text.height + (sub ? 2 + sub.height : 0) + 10);
  const b = new Button(scene, x, y, w, h, '', onClick, { tip: o.tip });
  b.label.setVisible(false);
  // Red wax for an ordinary order, blue for one your ship or crew make possible.
  const seal = scene.add.graphics();
  const wax = o.special ? 0x2f5a8e : 0x8a1c1c;
  seal.fillStyle(0x000000, 0.35).fillCircle(25, h / 2 + 2, 14);
  seal.fillStyle(wax, 1).fillCircle(24, h / 2, 14);
  seal.lineStyle(1.5, 0x000000, 0.3).strokeCircle(24, h / 2, 10.5);
  seal.lineStyle(1, 0xffffff, 0.18).strokeCircle(24, h / 2, 14);
  const num = scene.add.text(24, h / 2, `${o.num}`, { fontFamily: TITLE_FONT, fontSize: '18px', color: '#f4e6c4' }).setOrigin(0.5);
  text.setPosition(48, 10);
  sub?.setPosition(48, 10 + text.height + 2);
  b.add(sub ? [seal, num, text, sub] : [seal, num, text]);
  const on = o.enabled ?? true;
  b.setEnabled(on);
  if (!on) [text, sub, num, seal].forEach((p) => p?.setAlpha(0.4));
  return b;
}

/** The colour of a choice your ship, fittings, crew or friends make possible. */
export const SPECIAL_COLOR = '#8fc7ff';
