import Phaser from 'phaser';
import { bleed } from './screen';
import { SCREEN } from './theme';

/**
 * Place a painted illustration so it covers the box (cropping the overflow), with a thin frame.
 * Returns null, drawing nothing, when that piece of art was not loaded.
 */
export function placeArt(scene: Phaser.Scene, name: string, x: number, y: number, w: number, h: number, frame = true): Phaser.GameObjects.Image | null {
  const key = `art:${name}`;
  if (!scene.textures.exists(key)) return null;
  const img = scene.add.image(x + w / 2, y + h / 2, key);
  const scale = Math.max(w / img.width, h / img.height);
  img.setScale(scale);
  // Crop in texture pixels to the part that falls inside the box.
  const cw = w / scale;
  const ch = h / scale;
  img.setCrop((img.width - cw) / 2, (img.height - ch) / 2, cw, ch);
  if (frame) scene.add.rectangle(x, y, w, h).setOrigin(0).setStrokeStyle(2, 0x2b1a0d, 1);
  // A painting that fills the screen covers the whole window, however wide or tall.
  else if (x === 0 && y === 0 && w === SCREEN.w && h === SCREEN.h) bleed(scene, img, (r) => cover(img, r.x, r.y, r.width, r.height));
  return img;
}

/** A full-screen painted backdrop, dimmed so text on top stays readable. */
export function placeBackdrop(scene: Phaser.Scene, name: string, w: number, h: number, dim = 0.35): boolean {
  const img = placeArt(scene, name, 0, 0, w, h, false);
  if (!img) return false;
  img.setDepth(-9);
  if (dim > 0) scene.add.rectangle(0, 0, w, h, 0x000000, dim).setOrigin(0).setDepth(-8);
  return true;
}

/** Scale and crop an image to cover a box, centred. */
function cover(img: Phaser.GameObjects.Image, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / img.width, h / img.height);
  img.setPosition(x + w / 2, y + h / 2).setScale(scale);
  const cw = w / scale;
  const ch = h / scale;
  img.setCrop((img.width - cw) / 2, (img.height - ch) / 2, cw, ch);
}
