import Phaser from 'phaser';
import type { PrizeShip } from '../sim/Run';
import { addTip } from './ui';

/**
 * A prize sailing in company, as the chart shows her: a smaller, weather-worn ship astern of yours with a tow line
 * between, your black flag over her struck colours. Painted once.
 */
export function chartPrize(scene: Phaser.Scene): string {
  const key = 'charticon:prize';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 64, 64)!;
  const ctx = tex.getContext();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#120804';
  ctx.lineWidth = 2;
  // A battered hull, a patch or two on her side.
  ctx.beginPath();
  ctx.moveTo(10, 44);
  ctx.lineTo(54, 44);
  ctx.lineTo(48, 53);
  ctx.lineTo(16, 53);
  ctx.closePath();
  ctx.fillStyle = '#5a4128';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(22, 46, 5, 3);
  ctx.fillRect(38, 47, 4, 3);
  // Shortened sail: a prize crew of one carries little canvas.
  ctx.fillStyle = '#d9cba4';
  for (const [x, h] of [
    [26, 24],
    [40, 28],
  ]) {
    ctx.fillRect(x - 0.75, 44 - h - 4, 1.5, h + 4);
    ctx.beginPath();
    ctx.moveTo(x - 7, 44 - h + 4);
    ctx.quadraticCurveTo(x + 1, 44 - h / 2, x - 7, 38);
    ctx.lineTo(x + 7, 38);
    ctx.quadraticCurveTo(x + 11, 44 - h / 2, x + 7, 44 - h + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Your black flag at the masthead, her own colours struck beneath it.
  ctx.fillStyle = '#111';
  ctx.fillRect(40, 8, 9, 6);
  ctx.fillStyle = '#b0242a';
  ctx.fillRect(40, 15, 7, 4);
  tex.refresh();
  return key;
}

/** The prize on the chart: she follows your ship on a tow line, a little astern and to leeward. */
export class TowedPrize {
  readonly img: Phaser.GameObjects.Image;
  private readonly line: Phaser.GameObjects.Graphics;
  private x: number | null = null;
  private y = 0;

  constructor(scene: Phaser.Scene, prize: () => PrizeShip | null) {
    this.line = scene.add.graphics().setDepth(3.93);
    this.img = scene.add.image(0, 0, chartPrize(scene)).setScale(0.56).setDepth(3.95).setOrigin(0.5, 1).setInteractive({ useHandCursor: false });
    addTip(this.img, () => {
      const p = prize();
      return p ? `${p.name}, your prize, in company: hull ${p.hull} of ${p.maxHull}${p.crew ? `, ${p.crew.name} her prize master` : ''}.\nSell her at a port's prize court. Run from a fight and she is retaken.` : '';
    });
  }

  /**
   * Keep station on your ship: astern of her where she lies, or along the passage behind her while she sails it
   * (`trail`, the point a little behind her on the inked line).
   */
  follow(ship: Phaser.GameObjects.Image, trail: { x: number; y: number; dx: number } | null, time: number, dt: number): void {
    const back = ship.flipX ? 1 : -1;
    const tx = trail ? trail.x : ship.x + back * 40;
    const ty = trail ? trail.y + 2 : ship.y + 7;
    if (this.x === null) {
      this.x = tx;
      this.y = ty;
    }
    const k = Math.min(1, dt * 5);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    const flip = trail ? trail.dx < 0 : ship.flipX;
    this.img.setPosition(this.x, this.y + Math.sin(time / 330 + 1.3) * 1.5).setAngle(Math.sin(time / 610 + 2) * 3).setFlipX(flip);
    // The tow line, sagging between her stern and the prize's bow.
    const sx = ship.x + back * 15;
    const sy = ship.y - 9;
    const bx = this.img.x - back * 14;
    const by = this.img.y - 7;
    const g = this.line.clear().lineStyle(1.6, 0x2a170a, 0.85);
    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(sx, sy), new Phaser.Math.Vector2((sx + bx) / 2, Math.max(sy, by) + 6), new Phaser.Math.Vector2(bx, by));
    g.strokePoints(curve.getPoints(10));
  }

  destroy(): void {
    this.img.destroy();
    this.line.destroy();
  }
}
