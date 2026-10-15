import Phaser from 'phaser';

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
