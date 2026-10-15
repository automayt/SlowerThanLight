import Phaser from 'phaser';
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
export function drawBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, frac: number, color: number, back = 0x222a30): void {
  g.fillStyle(back, 1).fillRect(x, y, w, h);
  g.fillStyle(color, 1).fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
  g.lineStyle(1, 0x000000, 0.7).strokeRect(x, y, w, h);
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, w, h, COLORS.panel, 0.92).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
}

/** Animated sea backdrop. Call `draw(time)` each frame. */
export class Sea {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, private readonly w: number, private readonly h: number) {
    this.g = scene.add.graphics().setDepth(-10);
  }

  draw(timeMs: number): void {
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
