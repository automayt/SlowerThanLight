import Phaser from 'phaser';
import { playSfx } from './sound';
import { COLORS, textStyle } from './theme';

export interface ButtonOptions {
  size?: number;
  color?: number;
  onRightClick?: () => void;
}

/** A flat rectangular button with hover, active and disabled states. */
export class Button extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  private enabled = true;
  private toggled = false;
  private hover = false;
  private readonly baseColor: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, onClick: () => void, opts: ButtonOptions = {}) {
    super(scene, x, y);
    this.baseColor = opts.color ?? COLORS.button;
    this.bg = scene.add.rectangle(0, 0, w, h, this.baseColor).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
    this.label = scene.add.text(w / 2, h / 2, text, textStyle(opts.size ?? 14)).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', () => {
      this.hover = true;
      this.refresh();
    });
    this.bg.on('pointerout', () => {
      this.hover = false;
      this.refresh();
    });
    this.bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      playSfx(scene, 'click', 0.35);
      if (p.rightButtonDown()) opts.onRightClick?.();
      else onClick();
    });
    scene.add.existing(this);
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

  private refresh(): void {
    const color = !this.enabled
      ? COLORS.buttonDisabled
      : this.toggled
        ? COLORS.buttonActive
        : this.hover
          ? COLORS.buttonHover
          : this.baseColor;
    this.bg.setFillStyle(color);
    this.label.setAlpha(this.enabled ? 1 : 0.4);
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
