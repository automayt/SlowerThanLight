import Phaser from 'phaser';
import { SCREEN } from './theme';

/** The part of the world the main camera shows: the 1280x720 design area, or more of it on a wider or taller window. */
export function viewRect(scene: Phaser.Scene): Phaser.Geom.Rectangle {
  const cam = scene.cameras.main;
  const w = cam.width / cam.zoom;
  const h = cam.height / cam.zoom;
  const cx = cam.scrollX + cam.width / 2;
  const cy = cam.scrollY + cam.height / 2;
  // What the camera sees, and never less than the design area.
  const left = Math.min(0, cx - w / 2);
  const top = Math.min(0, cy - h / 2);
  return new Phaser.Geom.Rectangle(left, top, Math.max(SCREEN.w, cx + w / 2) - left, Math.max(SCREEN.h, cy + h / 2) - top);
}

/** A soft vertical shade, black at one end and clear at the other, painted once: stretched under text over a painting. */
function shadeTexture(scene: Phaser.Scene): string {
  const key = 'backdrop:shade';
  if (scene.textures.exists(key)) return key;
  // Six wide, not four: a power-of-two texture wraps, and its clear edge would pick up a dark line from the far end.
  const tex = scene.textures.createCanvas(key, 6, 256)!;
  const ctx = tex.getContext();
  const grd = ctx.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 6, 256);
  tex.refresh();
  return key;
}

/** A shade from clear (at `from`) to dark (at `to`); `to` may be above `from` to darken upward. */
export function shade(scene: Phaser.Scene, from: number, to: number, alpha = 1, depth = -8): Phaser.GameObjects.Image {
  const v = viewRect(scene);
  const img = scene.add.image(v.x, Math.min(from, to), shadeTexture(scene)).setOrigin(0).setDepth(depth).setAlpha(alpha);
  img.setDisplaySize(v.width, Math.abs(to - from));
  if (to < from) img.setFlipY(true);
  return img;
}

/**
 * A painting over the whole window, pushing in slowly as if the eye were drawn into it, with a soft vignette.
 * Returns null, drawing nothing, when the art is not loaded.
 */
export function paintedBackdrop(scene: Phaser.Scene, name: string, opts: { push?: number; seconds?: number; dim?: number } = {}): Phaser.GameObjects.Image | null {
  const key = `art:${name}`;
  if (!scene.textures.exists(key)) return null;
  const v = viewRect(scene);
  const img = scene.add.image(v.centerX, v.centerY, key).setDepth(-9);
  const base = Math.max(v.width / img.width, v.height / img.height) * 1.02;
  img.setScale(base);
  const push = opts.push ?? 0.09;
  // Drift a little toward one side as it pushes in, chosen by the picture so each has its own move.
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  const dx = ((h & 7) - 3.5) * 6;
  const dy = (((h >> 3) & 3) - 1.5) * 5;
  scene.tweens.add({ targets: img, scale: base * (1 + push), x: v.centerX + dx, y: v.centerY + dy, duration: (opts.seconds ?? 26) * 1000, ease: 'Sine.easeOut' });
  // A vignette: the corners darker, as in an old varnished canvas.
  const vig = scene.add.image(v.centerX, v.centerY, vignetteTexture(scene)).setDepth(-8.9);
  vig.setDisplaySize(v.width, v.height);
  if (opts.dim) scene.add.rectangle(v.x, v.y, v.width, v.height, 0x000000, opts.dim).setOrigin(0).setDepth(-8.8);
  return img;
}

function vignetteTexture(scene: Phaser.Scene): string {
  const key = 'backdrop:vignette';
  if (scene.textures.exists(key)) return key;
  const W = 256;
  const H = 144;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  const grd = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(8,4,0,0.62)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
  tex.refresh();
  return key;
}
