import Phaser from 'phaser';
import { cycleVolume, isMuted, isSoft, playSfx, SOUND_CHANGED } from './sound';
import { COLORS, SCREEN, textStyle, titleStyle } from './theme';

/** Gold edge of a hovered control. */
const HOVER_EDGE = 0xf2c45a;
/** Fill of a button in the instant it is pressed. */
const PRESSED = 0x132331;

export interface ButtonOptions {
  size?: number;
  color?: number;
  onRightClick?: () => void;
  /** Its keyboard shortcut, shown small at the right end ('Enter', 'Esc', '1'). The scene binds the key and calls press(). */
  hint?: string;
  /** Shown on hover. For a disabled button, say why it is disabled. */
  tip?: string;
}

/** A plaque of dark oiled wood with a brass rim: lit gold on hover, sunk when pressed, brass when on, grey when disabled. */
export class Button extends Phaser.GameObjects.Container {
  /** The hit area. Under the painted plaque it is clear; without WebGL it is the button. */
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  private readonly skin: Phaser.GameObjects.NineSlice | null = null;
  private readonly hintText: Phaser.GameObjects.Text | null = null;
  private enabled = true;
  private toggled = false;
  private hover = false;
  private pressed = false;
  private tip: string | null;
  private readonly baseColor: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, private readonly onClick: () => void, opts: ButtonOptions = {}) {
    super(scene, x, y);
    this.baseColor = opts.color ?? COLORS.button;
    this.tip = opts.tip ?? null;
    this.bg = scene.add.rectangle(0, 0, w, h, this.baseColor).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
    this.add(this.bg);
    if (painted(scene)) {
      const s = Math.min(BTN_SLICE, Math.floor(w / 2), Math.floor(h / 2));
      this.skin = scene.add.nineslice(0, 0, 'ui:btn', 'base', w, h, s, s, s, s).setOrigin(0);
      if (opts.color !== undefined) this.skin.setTint(opts.color);
      this.bg.setFillStyle(0x000000, 0.001).setStrokeStyle();
      this.add(this.skin);
    }
    this.label = scene.add.text(w / 2, h / 2, text, textStyle(opts.size ?? 14)).setOrigin(0.5).setShadow(0, 1, '#0a0502', 2, false, true);
    this.add(this.label);
    if (opts.hint) {
      this.hintText = scene.add.text(w - 8, h / 2, opts.hint, textStyle(12, '#c9b48a')).setOrigin(1, 0.5).setAlpha(0.8);
      this.add(this.hintText);
      // The label stays centred in the room the hint leaves.
      this.label.setX((w - this.hintText.width - 8) / 2);
    }
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', (p: Phaser.Input.Pointer) => {
      this.hover = true;
      this.refresh();
      if (this.tip) tooltip(scene).show(this.tip, p.x, p.y);
    });
    this.bg.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.tip) tooltip(scene).move(p.x, p.y);
    });
    this.bg.on('pointerout', () => {
      this.hover = false;
      this.refresh();
      if (this.tip) tooltip(scene).hide();
    });
    this.bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) this.press();
      else if (this.enabled && opts.onRightClick) {
        playSfx(scene, 'click', 0.35);
        opts.onRightClick();
      }
    });
    // A button destroyed under the pointer (a port rebuilding its stock) must not leave its tip behind.
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hover && this.tip) tooltips.get(scene)?.hide();
    });
    scene.add.existing(this);
  }

  /** Click it, from a key or the pointer: a brief pressed look, the click sound and the action. False if it is disabled. */
  press(): boolean {
    if (!this.enabled || !this.visible) return false;
    playSfx(this.scene, 'click', 0.35);
    this.pressed = true;
    this.refresh();
    this.scene.time.delayedCall(110, () => {
      this.pressed = false;
      if (this.bg.active) this.refresh();
    });
    this.onClick();
    return true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): this {
    if (on !== this.enabled) {
      this.enabled = on;
      this.refresh();
    }
    return this;
  }

  setOn(on: boolean): this {
    if (on !== this.toggled) {
      this.toggled = on;
      this.refresh();
    }
    return this;
  }

  setText(text: string): this {
    if (this.label.text !== text) this.label.setText(text);
    return this;
  }

  /** Change or clear the hover text, updating it in place if it is showing. */
  setTip(tip: string | null): this {
    if (tip === this.tip) return this;
    this.tip = tip;
    if (this.hover) {
      const p = this.scene.input.activePointer;
      if (tip) tooltip(this.scene).show(tip, p.x, p.y);
      else tooltips.get(this.scene)?.hide();
    }
    return this;
  }

  private refresh(): void {
    const lit = this.enabled && (this.hover || this.pressed);
    if (this.skin) {
      const frame = !this.enabled ? 'off' : this.pressed ? 'press' : this.toggled ? (this.hover ? 'onHover' : 'on') : this.hover ? 'hover' : 'base';
      if (this.skin.frame.name !== frame) this.skin.setFrame(frame);
    } else {
      const color = !this.enabled
        ? COLORS.buttonDisabled
        : this.pressed
          ? PRESSED
          : this.toggled
            ? COLORS.buttonActive
            : this.hover
              ? COLORS.buttonHover
              : this.baseColor;
      this.bg.setFillStyle(color);
      this.bg.setStrokeStyle(lit ? 1.5 : 1, lit ? HOVER_EDGE : COLORS.panelEdge);
    }
    if (this.bg.input) this.bg.input.cursor = this.enabled ? 'pointer' : 'default';
    this.label.setAlpha(this.enabled ? 1 : 0.45);
    this.label.setColor(lit && !this.toggled ? '#fff4d6' : COLORS.text);
    this.hintText?.setAlpha(this.enabled ? 0.8 : 0.3);
    // Pressed, the label sinks a pixel.
    this.label.setY(this.bg.height / 2 + (this.pressed ? 1 : 0));
  }
}

/** A small note that follows the pointer. One per scene: get it with tooltip(scene). */
export class Tooltip {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.bg = scene.add.graphics().setDepth(1000).setVisible(false);
    this.text = scene.add
      .text(0, 0, '', textStyle(13, COLORS.text, { wordWrap: { width: 320 }, lineSpacing: 2, padding: { x: 10, y: 6 } }))
      .setDepth(1001)
      .setVisible(false);
  }

  get alive(): boolean {
    return this.text.active;
  }

  show(text: string, x: number, y: number): void {
    if (!this.alive) return;
    if (text !== this.text.text || !this.text.visible) {
      this.text.setText(text);
      const { width: w, height: h } = this.text;
      this.bg
        .clear()
        .fillStyle(0x000000, 0.35)
        .fillRect(3, 4, w, h)
        .fillStyle(COLORS.panel, 0.97)
        .fillRect(0, 0, w, h)
        .lineStyle(1.5, COLORS.panelEdge, 1)
        .strokeRect(0, 0, w, h)
        .lineStyle(1, COLORS.brass, 0.25)
        .strokeRect(3, 3, w - 6, h - 6);
    }
    this.move(x, y);
    this.bg.setVisible(true);
    this.text.setVisible(true);
  }

  /** Below and right of the pointer, flipped above or left where the screen runs out. */
  move(px: number, py: number): void {
    if (!this.alive) return;
    const { width: w, height: h } = this.text;
    const x = px + 14 + w > SCREEN.w - 6 ? px - 10 - w : px + 14;
    const y = py + 22 + h > SCREEN.h - 6 ? py - 10 - h : py + 22;
    const at = { x: Math.round(Phaser.Math.Clamp(x, 6, SCREEN.w - w - 6)), y: Math.round(Phaser.Math.Clamp(y, 6, SCREEN.h - h - 6)) };
    this.bg.setPosition(at.x, at.y);
    this.text.setPosition(at.x, at.y);
  }

  hide(): void {
    if (!this.alive) return;
    this.bg.setVisible(false);
    this.text.setVisible(false);
  }
}

const tooltips = new WeakMap<Phaser.Scene, Tooltip>();

/** The scene's tooltip, made on first use. */
export function tooltip(scene: Phaser.Scene): Tooltip {
  let tip = tooltips.get(scene);
  if (!tip || !tip.alive) {
    tip = new Tooltip(scene);
    tooltips.set(scene, tip);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => tooltips.delete(scene));
  }
  return tip;
}

/** Give any interactive object a hover tip. The text can be a function, read each time the tip opens. */
export function addTip(obj: Phaser.GameObjects.GameObject, text: string | (() => string)): void {
  const scene = obj.scene;
  obj.on('pointerover', (p: Phaser.Input.Pointer) => {
    const t = typeof text === 'string' ? text : text();
    if (t) tooltip(scene).show(t, p.x, p.y);
  });
  obj.on('pointermove', (p: Phaser.Input.Pointer) => tooltips.get(scene)?.move(p.x, p.y));
  obj.on('pointerout', () => tooltips.get(scene)?.hide());
}

/** The speaker: click to step through loud, soft and off. M toggles mute on every screen. */
export class SoundButton extends Button {
  private readonly icon: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, size = 34) {
    super(scene, x, y, size, size, '', () => cycleVolume(scene.game));
    this.icon = scene.add.graphics();
    this.add(this.icon);
    const redraw = () => this.draw(size);
    scene.game.events.on(SOUND_CHANGED, redraw);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.game.events.off(SOUND_CHANGED, redraw));
    this.draw(size);
  }

  private draw(size: number): void {
    const muted = isMuted();
    const soft = isSoft();
    this.setTip(`Sound: ${muted ? 'off' : soft ? 'soft' : 'on'}. Click to change, or press M to mute.`);
    const g = this.icon.clear();
    const s = size / 34;
    const cy = size / 2;
    const ink = 0xefe6d0;
    // Box and cone of the speaker.
    g.fillStyle(ink, muted ? 0.55 : 1);
    g.fillRect(8 * s, cy - 4 * s, 5 * s, 8 * s);
    g.fillTriangle(12 * s, cy - 4 * s, 19 * s, cy - 10 * s, 19 * s, cy + 10 * s);
    g.fillTriangle(12 * s, cy - 4 * s, 12 * s, cy + 4 * s, 19 * s, cy + 10 * s);
    if (muted) {
      g.lineStyle(2.5 * s, 0xe0452f, 1);
      g.lineBetween(22 * s, cy - 5 * s, 29 * s, cy + 5 * s);
      g.lineBetween(29 * s, cy - 5 * s, 22 * s, cy + 5 * s);
      return;
    }
    g.lineStyle(2 * s, ink, 1);
    const arcs = soft ? [5] : [5, 10];
    for (const r of arcs) {
      g.beginPath();
      g.arc(19 * s, cy, r * s, -Math.PI / 4, Math.PI / 4);
      g.strokePath();
    }
  }
}

/** Draws a row of small square pips: green for working, grey for unused, red for damaged. */
export function drawPips(g: Phaser.GameObjects.Graphics, x: number, y: number, on: number, max: number, damaged: number, size = 10, gap = 3): number {
  for (let i = 0; i < max; i++) {
    const px = x + i * (size + gap);
    const color = i >= max - damaged ? COLORS.pipDamaged : i < on ? COLORS.pipOn : COLORS.pipOff;
    g.fillStyle(color, 1).fillRect(px, y, size, size);
    g.lineStyle(1, 0x000000, 0.6).strokeRect(px, y, size, size);
  }
  return max * (size + gap);
}

/** Horizontal fill bar. */
export function drawBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, frac: number, color: number, back = 0x1a232b): void {
  const fw = Math.max(0, Math.min(1, frac)) * w;
  g.fillStyle(0x000000, 0.6).fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(back, 1).fillRect(x, y, w, h);
  g.fillStyle(color, 1).fillRect(x, y, fw, h);
  // A sheen along the top half gives the bar some roundness.
  if (h >= 4) g.fillStyle(0xffffff, 0.22).fillRect(x, y, fw, Math.ceil(h * 0.4));
  g.fillStyle(0x000000, 0.18).fillRect(x, y + h - Math.max(1, Math.floor(h * 0.25)), fw, Math.max(1, Math.floor(h * 0.25)));
}

export interface PanelOptions {
  /** A dialog over the rest of the screen: near-opaque, so nothing behind ghosts through. */
  modal?: boolean;
}

type Part = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth & Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.AlphaSingle;

/**
 * A framed panel: dark lacquer with a faint grain, a brass rim with corner fittings, and a soft shadow.
 * The rectangle is the fill; the painted parts follow its depth, visibility, alpha and destruction.
 */
export class Panel extends Phaser.GameObjects.Rectangle {
  readonly keyline: Phaser.GameObjects.Rectangle;
  private readonly parts: Part[];
  private readonly shadow: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOptions = {}) {
    super(scene, x, y, w, h, COLORS.panel, opts.modal ? 0.97 : 0.9);
    this.setOrigin(0);
    // Made before the panel joins the display list, so it lies underneath.
    this.shadow = scene.add.rectangle(x + 4, y + 6, w, h, 0x000000, 0.38).setOrigin(0);
    scene.add.existing(this);
    this.parts = [];
    if (painted(scene)) {
      this.parts.push(scene.add.tileSprite(x, y, w, h, 'ui:grain').setOrigin(0).setAlpha(0.5));
      this.parts.push(scene.add.nineslice(x, y, 'ui:frame', undefined, w, h, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE).setOrigin(0));
      this.keyline = scene.add.rectangle(x + 3, y + 3, w - 6, h - 6).setOrigin(0).setVisible(false);
    } else {
      this.setStrokeStyle(1.5, COLORS.panelEdge);
      // Inner keyline, like a framed chart.
      this.keyline = scene.add.rectangle(x + 3, y + 3, w - 6, h - 6).setOrigin(0).setStrokeStyle(1, COLORS.panelInner, 0.9);
    }
    this.parts.push(this.keyline);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.shadow.destroy();
      this.parts.forEach((p) => p.destroy());
    });
  }

  // The parts are still unset while the base constructor runs.
  override setDepth(value: number): this {
    super.setDepth(value);
    this.shadow?.setDepth(value - 0.001);
    this.parts?.forEach((p) => p.setDepth(value));
    return this;
  }

  override setVisible(value: boolean): this {
    super.setVisible(value);
    this.shadow?.setVisible(value);
    this.parts?.forEach((p) => p.setVisible(value));
    return this;
  }

  override setAlpha(value: number): this {
    super.setAlpha(value);
    this.shadow?.setAlpha(value);
    this.parts?.forEach((p) => p.setAlpha(value));
    return this;
  }
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOptions = {}): Panel {
  return new Panel(scene, x, y, w, h, opts);
}

/** A brass frame and a soft shadow for a painting or a card: the panel's rim without its fill. */
export function frame(scene: Phaser.Scene, x: number, y: number, w: number, h: number, depth = 0): Phaser.GameObjects.GameObject[] {
  const shadow = scene.add.rectangle(x + 4, y + 6, w, h, 0x000000, 0.4).setOrigin(0).setDepth(depth - 0.001);
  if (!painted(scene)) return [shadow, scene.add.rectangle(x, y, w, h).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge).setDepth(depth)];
  return [shadow, scene.add.nineslice(x, y, 'ui:frame', undefined, w, h, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE).setOrigin(0).setDepth(depth)];
}

/** An ornamental rule: two tapering brass arms from a diamond. Static: draw it once. */
export function divider(scene: Phaser.Scene, cx: number, y: number, w: number, color: number = COLORS.brass, alpha = 0.85): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().fillStyle(color, alpha);
  for (const s of [-1, 1]) {
    g.fillTriangle(cx + s * 14, y - 1.3, cx + s * 14, y + 1.3, cx + (s * w) / 2, y);
    g.fillCircle(cx + s * 9.5, y, 1.7);
  }
  g.fillPoints([new Phaser.Math.Vector2(cx, y - 5), new Phaser.Math.Vector2(cx + 5, y), new Phaser.Math.Vector2(cx, y + 5), new Phaser.Math.Vector2(cx - 5, y)], true);
  return g;
}

/** A heading in gilt: the Fell face filled with a gold gradient, cut in dark ink, with a soft drop shadow. */
export function goldText(scene: Phaser.Scene, x: number, y: number, text: string, size: number, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, titleStyle(size, COLORS.gold, { stroke: '#1a0e05', strokeThickness: Math.max(2, Math.round(size / 10)), ...extra }));
  t.setShadow(0, Math.max(2, Math.round(size / 14)), '#000000', Math.max(3, Math.round(size / 6)), true, true);
  return gild(t);
}

/** Fill a text with the gilt gradient, top to bottom. Call again after changing its text. */
export function gild(t: Phaser.GameObjects.Text, colors: string[] = ['#fff3c4', '#f2c45a', '#d39b34', '#a8701c']): Phaser.GameObjects.Text {
  const grd = t.context.createLinearGradient(0, t.padding.top ?? 0, 0, t.height - (t.padding.bottom ?? 0));
  colors.forEach((c, i) => grd.addColorStop(i / (colors.length - 1), c));
  return t.setFill(grd);
}

/** A gold piece of eight, about `size` across. */
export function coin(scene: Phaser.Scene, x: number, y: number, size = 18): Phaser.GameObjects.Image {
  ensureKit(scene);
  return scene.add.image(x, y, 'ui:coin').setScale(size / 40);
}

/** Whether to use the painted kit: NineSlice draws only under WebGL, so the canvas renderer keeps the flat look. */
function painted(scene: Phaser.Scene): boolean {
  if (scene.sys.renderer?.type === Phaser.CANVAS) return false;
  ensureKit(scene);
  return true;
}

const BTN_SLICE = 9;
const FRAME_SLICE = 22;

/** Paint the kit's textures, once per game: button plaques, the panel frame, the grain and a coin. */
function ensureKit(scene: Phaser.Scene): void {
  const textures = scene.textures;
  if (textures.exists('ui:btn')) return;
  paintButtons(textures);
  paintFrame(textures);
  paintGrain(textures);
  paintCoin(textures);
}

/** A small seeded random, so the painted grain comes out the same every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PlaqueLook {
  top: string;
  bottom: string;
  rim: string;
  /** Inner glow, as the start of an rgba() colour. */
  glow?: string;
  sunk?: boolean;
}

const PLAQUES: Record<string, PlaqueLook> = {
  base: { top: '#4b3421', bottom: '#26180c', rim: '#9c7c40' },
  hover: { top: '#634529', bottom: '#33200e', rim: '#f2c45a', glow: 'rgba(242,196,90,' },
  press: { top: '#1c1209', bottom: '#2e1e10', rim: '#c9a256', sunk: true },
  on: { top: '#9c7432', bottom: '#5a3d14', rim: '#f6d98a' },
  onHover: { top: '#b08840', bottom: '#694819', rim: '#fff0b8', glow: 'rgba(255,232,160,' },
  off: { top: '#2d2824', bottom: '#1c1916', rim: '#4d4438' },
};

function paintButtons(textures: Phaser.Textures.TextureManager): void {
  const W = 44;
  const H = 32;
  const names = Object.keys(PLAQUES);
  const tex = textures.createCanvas('ui:btn', W * names.length, H)!;
  const ctx = tex.getContext();
  const rand = seeded(7);
  names.forEach((name, i) => {
    const look = PLAQUES[name];
    const ox = i * W;
    ctx.save();
    ctx.translate(ox, 0);
    // A dark outer edge, then the wood.
    roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 4);
    ctx.fillStyle = 'rgba(8,4,2,0.9)';
    ctx.fill();
    const wood = ctx.createLinearGradient(0, 1, 0, H - 1);
    wood.addColorStop(0, look.top);
    wood.addColorStop(1, look.bottom);
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 3);
    ctx.fillStyle = wood;
    ctx.fill();
    // Grain runs along the plaque, so stretching it keeps it straight.
    ctx.save();
    ctx.clip();
    for (let k = 0; k < 9; k++) {
      ctx.strokeStyle = rand() < 0.5 ? `rgba(0,0,0,${0.08 + rand() * 0.1})` : `rgba(255,220,170,${0.03 + rand() * 0.05})`;
      ctx.lineWidth = 0.6 + rand();
      const y = 3 + rand() * (H - 6);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + rand() * 1.5 - 0.75);
      ctx.stroke();
    }
    if (look.glow) {
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = `${look.glow}${0.34 - k * 0.08})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(2.5 + k, 2.5 + k, W - 5 - 2 * k, H - 5 - 2 * k);
      }
    }
    ctx.restore();
    // A bevel: light along the top, shadow along the bottom; the other way round when sunk.
    ctx.fillStyle = look.sunk ? 'rgba(0,0,0,0.45)' : 'rgba(255,238,200,0.22)';
    ctx.fillRect(3, 2.5, W - 6, 1);
    ctx.fillStyle = look.sunk ? 'rgba(255,238,200,0.1)' : 'rgba(0,0,0,0.4)';
    ctx.fillRect(3, H - 3.5, W - 6, 1);
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 3);
    ctx.strokeStyle = look.rim;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    tex.add(name, 0, ox, 0, W, H);
  });
  tex.refresh();
}

/** The panel's rim: shadow falling inward, a brass moulding, a keyline and fittings at the corners. The middle is clear. */
function paintFrame(textures: Phaser.Textures.TextureManager): void {
  const S = 64;
  const tex = textures.createCanvas('ui:frame', S, S)!;
  const ctx = tex.getContext();
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.34 * (1 - i / 14) ** 2})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(i + 0.5, i + 0.5, S - 2 * i - 1, S - 2 * i - 1);
  }
  ctx.strokeStyle = 'rgba(5,3,1,0.9)';
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  const brass = ctx.createLinearGradient(0, 0, 0, S);
  brass.addColorStop(0, '#f1d58e');
  brass.addColorStop(0.5, '#b08a42');
  brass.addColorStop(1, '#7a5a26');
  ctx.strokeStyle = brass;
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, S - 4, S - 4);
  ctx.strokeStyle = 'rgba(5,3,1,0.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(3.5, 3.5, S - 7, S - 7);
  ctx.strokeStyle = 'rgba(217,180,103,0.4)';
  ctx.strokeRect(6.5, 6.5, S - 13, S - 13);
  // Corner fittings: a brass bracket over the keyline, and a rivet.
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    ctx.save();
    ctx.translate(sx > 0 ? 0 : S, sy > 0 ? 0 : S);
    ctx.scale(sx, sy);
    ctx.fillStyle = '#c9a256';
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(19, 4);
    ctx.lineTo(16.5, 8);
    ctx.lineTo(8, 8);
    ctx.lineTo(8, 16.5);
    ctx.lineTo(4, 19);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(5,3,1,0.65)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,240,192,0.9)';
    ctx.beginPath();
    ctx.arc(6, 6, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  tex.refresh();
}

/** A tile of fine fibrous grain, laid over a panel's fill so it reads as an oiled board rather than flat colour. */
function paintGrain(textures: Phaser.Textures.TextureManager): void {
  const S = 128;
  const tex = textures.createCanvas('ui:grain', S, S)!;
  const ctx = tex.getContext();
  const rand = seeded(11);
  for (let k = 0; k < 150; k++) {
    const y = rand() * S;
    ctx.strokeStyle = rand() < 0.45 ? `rgba(190,170,130,${0.05 + rand() * 0.06})` : `rgba(0,0,0,${0.1 + rand() * 0.12})`;
    ctx.lineWidth = 0.5 + rand() * 1.2;
    const x = rand() * S;
    const len = 20 + rand() * 90;
    const bend = rand() * 2 - 1;
    // Drawn twice, a tile apart, so the tile wraps without a seam.
    for (const dx of [0, -S]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.quadraticCurveTo(x + dx + len / 2, y + bend, x + dx + len, y);
      ctx.stroke();
    }
  }
  tex.refresh();
}

function paintCoin(textures: Phaser.Textures.TextureManager): void {
  const S = 40;
  const c = S / 2;
  const tex = textures.createCanvas('ui:coin', S, S)!;
  const ctx = tex.getContext();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(c + 1, c + 2, c - 2, 0, Math.PI * 2);
  ctx.fill();
  const face = ctx.createRadialGradient(c - 6, c - 7, 2, c, c, c);
  face.addColorStop(0, '#fff2b8');
  face.addColorStop(0.45, '#f0c24e');
  face.addColorStop(1, '#9a6a14');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6a440c';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(106,68,12,0.7)';
  ctx.beginPath();
  ctx.arc(c, c, c - 6, 0, Math.PI * 2);
  ctx.stroke();
  // The cross of a piece of eight.
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c, c - 8);
  ctx.lineTo(c, c + 8);
  ctx.moveTo(c - 8, c);
  ctx.lineTo(c + 8, c);
  ctx.stroke();
  tex.refresh();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Animated sea backdrop. Call `draw(time)` each frame. */
export class Sea {
  private readonly g: Phaser.GameObjects.Graphics;
  /** The painted sea, when its texture is loaded; otherwise a drawn gradient with wave marks. */
  private readonly img: Phaser.GameObjects.Image | null = null;

  /** `dim` darkens the painting so text on top stays readable (0 for the battle, where the sea is the stage). */
  constructor(scene: Phaser.Scene, private readonly w: number, private readonly h: number, dim = 0.4) {
    this.g = scene.add.graphics().setDepth(-10);
    if (scene.textures.exists('art:tex-sea')) {
      this.img = scene.add.image(w / 2, h / 2, 'art:tex-sea').setDepth(-10);
      this.img.setScale(Math.max(w / this.img.width, h / this.img.height) * 1.04);
      if (dim > 0) scene.add.rectangle(0, 0, w, h, 0x061420, dim).setOrigin(0).setDepth(-9.5);
    }
  }

  draw(timeMs: number): void {
    if (this.img) {
      // A slow drift, as if the swell were moving under you.
      this.img.setPosition(this.w / 2 + Math.sin(timeMs / 4000) * 8, this.h / 2 + Math.cos(timeMs / 5200) * 5);
      return;
    }
    const g = this.g;
    const t = timeMs / 1000;
    g.clear();
    g.fillGradientStyle(COLORS.seaLight, COLORS.seaLight, COLORS.seaDeep, COLORS.seaDeep, 1);
    g.fillRect(0, 0, this.w, this.h);
    g.lineStyle(2, COLORS.wave, 0.35);
    for (let row = 0; row < 14; row++) {
      const y = 30 + row * 52;
      const offset = ((t * (12 + (row % 3) * 6) + row * 47) % 120) - 120;
      for (let x = offset; x < this.w; x += 120) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 18, y - 5);
        g.lineTo(x + 36, y);
        g.strokePath();
      }
    }
  }
}
