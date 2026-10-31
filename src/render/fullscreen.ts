import Phaser from 'phaser';
import { isFullscreen, toggleFullscreen } from './screen';
import { Button } from './ui';

/** Four corner brackets: pointing out to go fullscreen, in to leave it. F11 does the same on any screen. */
export class FullscreenButton extends Button {
  private readonly icon: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, size = 34) {
    super(scene, x, y, size, size, '', () => toggleFullscreen());
    this.icon = scene.add.graphics();
    this.add(this.icon);
    const redraw = () => this.draw(size);
    document.addEventListener('fullscreenchange', redraw);
    this.once(Phaser.GameObjects.Events.DESTROY, () => document.removeEventListener('fullscreenchange', redraw));
    this.draw(size);
  }

  private draw(size: number): void {
    if (!this.icon.active) return;
    const full = isFullscreen();
    this.setTip(full ? 'Leave full screen (F11 or Esc).' : 'Full screen (F11).');
    const g = this.icon.clear();
    const s = size / 34;
    const c = size / 2;
    const r = 9 * s;
    const arm = 5 * s;
    g.lineStyle(2.4 * s, 0xefe6d0, 1);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      // Out: brackets at the corners opening outward. In: the same brackets turned to point at the middle.
      const x = c + sx * r;
      const y = c + sy * r;
      const d = full ? 1 : -1;
      g.beginPath();
      g.moveTo(x + d * sx * arm, y);
      g.lineTo(x, y);
      g.lineTo(x, y + d * sy * arm);
      g.strokePath();
    }
  }
}
