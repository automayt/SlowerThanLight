import Phaser from 'phaser';
import { cycleVolume, isMuted, isSoft, playSfx, SOUND_CHANGED } from './sound';
import { COLORS, SCREEN, textStyle } from './theme';

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

/** A flat rectangular button with hover, pressed, active and disabled states. */
export class Button extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
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
    this.label = scene.add.text(w / 2, h / 2, text, textStyle(opts.size ?? 14)).setOrigin(0.5);
    this.add([this.bg, this.label]);
    if (opts.hint) {
      this.hintText = scene.add.text(w - 8, h / 2, opts.hint, textStyle(12, COLORS.textDim)).setOrigin(1, 0.5).setAlpha(0.8);
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
    if (this.bg.input) this.bg.input.cursor = this.enabled ? 'pointer' : 'default';
    this.label.setAlpha(this.enabled ? 1 : 0.4);
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
        .lineStyle(1, COLORS.panelEdge, 1)
        .strokeRect(0, 0, w, h);
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

/** A framed panel: the outer rectangle carries an inner keyline that follows its depth, visibility and destruction. */
export class Panel extends Phaser.GameObjects.Rectangle {
  readonly keyline: Phaser.GameObjects.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOptions = {}) {
    super(scene, x, y, w, h, COLORS.panel, opts.modal ? 0.97 : 0.9);
    this.setOrigin(0).setStrokeStyle(1.5, COLORS.panelEdge);
    scene.add.existing(this);
    // Inner keyline, like a framed chart.
    this.keyline = scene.add.rectangle(x + 3, y + 3, w - 6, h - 6).setOrigin(0).setStrokeStyle(1, COLORS.panelInner, 0.9);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.keyline.destroy());
  }

  override setDepth(value: number): this {
    super.setDepth(value);
    // The keyline is still unset while the base constructor runs.
    this.keyline?.setDepth(value);
    return this;
  }

  override setVisible(value: boolean): this {
    super.setVisible(value);
    this.keyline?.setVisible(value);
    return this;
  }
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOptions = {}): Panel {
  return new Panel(scene, x, y, w, h, opts);
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
