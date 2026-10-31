import Phaser from 'phaser';

/**
 * The kit's icons. The painted ones (stations, shot, stores) come from the atlas in public/ui/icons.png, made with
 * the local ComfyUI (tools/art/gen_ui.py, finish_ui.py). The small marks between them (fire, wind, a hammer) are
 * drawn here once per game in the same manner: a warm fill with a dark keyline, so every icon reads on wood and on
 * parchment alike.
 */
export const PAINTED_ICONS = ['helm', 'sails', 'guns', 'bulwarks', 'pumps', 'surgeon', 'round', 'chain', 'grape', 'hot', 'gold', 'provisions', 'crew', 'hull'] as const;
export const DRAWN_ICONS = ['evasion', 'flood', 'board', 'fire', 'repair', 'fight', 'target', 'clock', 'log', 'flag', 'skull', 'moving', 'anchor', 'sabotage', 'heart', 'star', 'wrench', 'check', 'cross', 'hands'] as const;
export type IconName = (typeof PAINTED_ICONS)[number] | (typeof DRAWN_ICONS)[number];

/** Atlas texture key, loaded by preloadKit (ui.ts). */
export const ICON_ATLAS = 'ui:icons';
const S = 64;

/** Texture key and frame for an icon, painting the drawn ones on first use. */
export function iconFrame(scene: Phaser.Scene, name: IconName): { key: string; frame?: string } {
  const atlas = scene.textures.exists(ICON_ATLAS) ? scene.textures.get(ICON_ATLAS) : null;
  if (atlas?.has(name)) return { key: ICON_ATLAS, frame: name };
  const key = `uiicon:${name}`;
  if (!scene.textures.exists(key)) paint(scene, key, name);
  return { key };
}

/** An icon about `size` pixels across, centred on (x, y). */
export function icon(scene: Phaser.Scene, x: number, y: number, name: IconName, size = 24): Phaser.GameObjects.Image {
  const { key, frame } = iconFrame(scene, name);
  return scene.add.image(x, y, key, frame).setDisplaySize(size, size);
}

/** Show a different icon in an image made by icon(), keeping its size. */
export function setIcon(img: Phaser.GameObjects.Image, name: IconName): Phaser.GameObjects.Image {
  if (img.getData('icon') === name) return img;
  const { key, frame } = iconFrame(img.scene, name);
  const w = img.displayWidth;
  const h = img.displayHeight;
  img.setTexture(key, frame).setDisplaySize(w, h);
  img.setData('icon', name);
  return img;
}

const INK = '#1c0f05';

/** Fill and keyline a path in the icon manner. */
function solid(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, line = 3.2): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = line + 2.4;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A stroke with a dark keyline under it. */
function inked(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = width + 3.2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function grad(ctx: CanvasRenderingContext2D, top: string, bottom: string, y0 = 8, y1 = 56): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

const IRON = ['#9a9a96', '#3a3a38'] as const;
const BRASS = ['#ffe9a8', '#b8862e'] as const;
const WOOD = ['#c98a4a', '#6a3a16'] as const;
const CREAM = ['#fff6dc', '#d8c28e'] as const;

function paint(scene: Phaser.Scene, key: string, name: IconName): void {
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const c = S / 2;
  ctx.save();
  switch (name) {
    case 'evasion':
      // Three gusts of wind.
      for (const [y, len, curl] of [
        [20, 40, 1],
        [32, 48, -1],
        [44, 34, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(8 + len, y);
        ctx.arc(8 + len, y - curl * 6, 6, Math.PI / 2 * curl, -Math.PI / 2 * curl, curl < 0);
        inked(ctx, '#e9f2f4', 4);
      }
      break;
    case 'flood':
      ctx.beginPath();
      ctx.moveTo(c, 6);
      ctx.bezierCurveTo(c + 18, 28, c + 20, 56, c, 57);
      ctx.bezierCurveTo(c - 20, 56, c - 18, 28, c, 6);
      solid(ctx, grad(ctx, '#8fd0ff', '#1f5fa8'));
      ctx.beginPath();
      ctx.ellipse(c - 6, 40, 3, 6, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
      break;
    case 'board':
    case 'anchor': {
      // A grapnel has three flukes; an anchor two and a stock.
      ctx.beginPath();
      ctx.arc(c, 12, 5.5, 0, Math.PI * 2);
      ctx.moveTo(c, 17);
      ctx.lineTo(c, 52);
      if (name === 'anchor') {
        ctx.moveTo(c - 13, 23);
        ctx.lineTo(c + 13, 23);
      }
      ctx.moveTo(c - 20, 36);
      ctx.quadraticCurveTo(c - 18, 52, c, 53);
      ctx.quadraticCurveTo(c + 18, 52, c + 20, 36);
      if (name === 'board') {
        ctx.moveTo(c, 52);
        ctx.lineTo(c, 58);
      }
      inked(ctx, '#c9c9c4', 4.5);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(c + s * 20, 36);
        ctx.lineTo(c + s * 24, 41);
        ctx.lineTo(c + s * 14, 41);
        ctx.closePath();
        solid(ctx, '#c9c9c4', 1.2);
      }
      break;
    }
    case 'fire':
      ctx.beginPath();
      ctx.moveTo(c, 4);
      ctx.bezierCurveTo(c + 6, 18, c + 22, 24, c + 18, 42);
      ctx.bezierCurveTo(c + 15, 56, c - 15, 60, c - 19, 42);
      ctx.bezierCurveTo(c - 21, 30, c - 10, 26, c - 8, 14);
      ctx.bezierCurveTo(c - 2, 20, c + 2, 14, c, 4);
      solid(ctx, grad(ctx, '#ffd35a', '#e0401a', 6, 58));
      ctx.beginPath();
      ctx.moveTo(c, 28);
      ctx.bezierCurveTo(c + 10, 38, c + 10, 54, c, 54);
      ctx.bezierCurveTo(c - 10, 54, c - 10, 40, c, 28);
      ctx.fillStyle = '#fff1a8';
      ctx.fill();
      break;
    case 'repair':
    case 'wrench':
      // A carpenter's mallet over a peg.
      ctx.translate(c, c);
      ctx.rotate(-0.7);
      ctx.beginPath();
      ctx.rect(-3.5, -6, 7, 34);
      solid(ctx, grad(ctx, WOOD[0], WOOD[1], -6, 28), 1.6);
      ctx.beginPath();
      ctx.rect(-15, -22, 30, 16);
      solid(ctx, grad(ctx, name === 'repair' ? '#b07a44' : IRON[0], name === 'repair' ? '#5a3214' : IRON[1], -22, -6), 1.6);
      break;
    case 'fight':
      // Crossed cutlasses.
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(c, c);
        ctx.scale(s, 1);
        ctx.rotate(-0.75);
        ctx.beginPath();
        ctx.moveTo(-3, -26);
        ctx.quadraticCurveTo(7, -6, 3, 14);
        ctx.lineTo(-3, 14);
        ctx.quadraticCurveTo(0, -4, -3, -26);
        solid(ctx, grad(ctx, '#f4f4f0', '#9a9a96', -26, 14), 1.4);
        ctx.beginPath();
        ctx.rect(-8, 14, 16, 4);
        solid(ctx, BRASS[1], 1.2);
        ctx.beginPath();
        ctx.rect(-2.5, 18, 5, 10);
        solid(ctx, WOOD[1], 1.2);
        ctx.restore();
      }
      break;
    case 'target':
      ctx.beginPath();
      ctx.arc(c, c, 19, 0, Math.PI * 2);
      inked(ctx, '#e0452f', 4);
      ctx.beginPath();
      ctx.arc(c, c, 8, 0, Math.PI * 2);
      inked(ctx, '#e0452f', 3.5);
      ctx.beginPath();
      ctx.moveTo(c, 4);
      ctx.lineTo(c, 18);
      ctx.moveTo(c, 46);
      ctx.lineTo(c, 60);
      ctx.moveTo(4, c);
      ctx.lineTo(18, c);
      ctx.moveTo(46, c);
      ctx.lineTo(60, c);
      inked(ctx, '#fff1d0', 3);
      break;
    case 'clock':
      // An hourglass.
      ctx.beginPath();
      ctx.moveTo(c - 14, 12);
      ctx.lineTo(c + 14, 12);
      ctx.quadraticCurveTo(c + 14, 28, c + 2, c);
      ctx.quadraticCurveTo(c + 14, 36, c + 14, 52);
      ctx.lineTo(c - 14, 52);
      ctx.quadraticCurveTo(c - 14, 36, c - 2, c);
      ctx.quadraticCurveTo(c - 14, 28, c - 14, 12);
      solid(ctx, 'rgba(230,240,240,0.85)', 1.8);
      ctx.beginPath();
      ctx.moveTo(c - 10, 52);
      ctx.quadraticCurveTo(c, 38, c + 10, 52);
      ctx.fillStyle = '#e8c070';
      ctx.fill();
      for (const y of [8, 52]) {
        ctx.beginPath();
        ctx.rect(c - 19, y, 38, 5);
        solid(ctx, grad(ctx, WOOD[0], WOOD[1], y, y + 5), 1.2);
      }
      break;
    case 'log':
      // A rolled log-book page.
      ctx.beginPath();
      ctx.rect(14, 12, 36, 40);
      solid(ctx, grad(ctx, CREAM[0], CREAM[1], 12, 52), 1.6);
      for (const y of [12, 52]) {
        ctx.beginPath();
        ctx.ellipse(c, y, 22, 5, 0, 0, Math.PI * 2);
        solid(ctx, grad(ctx, '#e8d2a0', '#a8844a', y - 5, y + 5), 1.4);
      }
      ctx.strokeStyle = 'rgba(60,35,15,0.75)';
      ctx.lineWidth = 2;
      for (const y of [24, 31, 38, 45]) {
        ctx.beginPath();
        ctx.moveTo(19, y);
        ctx.lineTo(y === 45 ? 36 : 45, y);
        ctx.stroke();
      }
      break;
    case 'flag':
      ctx.beginPath();
      ctx.moveTo(14, 6);
      ctx.lineTo(14, 60);
      inked(ctx, WOOD[0], 3.5);
      ctx.beginPath();
      ctx.moveTo(16, 9);
      ctx.quadraticCurveTo(34, 4, 54, 12);
      ctx.lineTo(48, 22);
      ctx.lineTo(56, 32);
      ctx.quadraticCurveTo(36, 26, 16, 34);
      ctx.closePath();
      solid(ctx, grad(ctx, '#e04a3a', '#8a1c1c', 6, 34), 1.6);
      break;
    case 'skull':
      ctx.beginPath();
      ctx.arc(c, 26, 17, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(c + 9, 48);
      ctx.lineTo(c - 9, 48);
      ctx.closePath();
      solid(ctx, grad(ctx, CREAM[0], CREAM[1], 9, 48), 1.6);
      ctx.fillStyle = INK;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(c + s * 7, 27, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(c, 33);
      ctx.lineTo(c - 3, 39);
      ctx.lineTo(c + 3, 39);
      ctx.fill();
      break;
    case 'moving':
      // A forward chevron, like a heading mark.
      ctx.beginPath();
      ctx.moveTo(12, 14);
      ctx.lineTo(34, c);
      ctx.lineTo(12, 50);
      ctx.moveTo(30, 14);
      ctx.lineTo(52, c);
      ctx.lineTo(30, 50);
      inked(ctx, '#f2e2b0', 6);
      break;
    case 'sabotage':
      // A powder keg's grenado with a lit fuse.
      ctx.beginPath();
      ctx.arc(c - 2, 38, 18, 0, Math.PI * 2);
      solid(ctx, grad(ctx, '#6a6a68', '#1a1a1a', 20, 56), 1.6);
      ctx.beginPath();
      ctx.moveTo(c + 10, 24);
      ctx.quadraticCurveTo(c + 14, 12, c + 22, 10);
      inked(ctx, '#c8a060', 3);
      ctx.beginPath();
      ctx.arc(c + 23, 9, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcf4a';
      ctx.fill();
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(c, 54);
      ctx.bezierCurveTo(c - 30, 34, c - 22, 6, c, 20);
      ctx.bezierCurveTo(c + 22, 6, c + 30, 34, c, 54);
      solid(ctx, grad(ctx, '#ff7a6a', '#a3221a', 10, 54));
      break;
    case 'star':
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 11 : 26;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(c + Math.cos(a) * r, c + 2 + Math.sin(a) * r);
      }
      ctx.closePath();
      solid(ctx, grad(ctx, BRASS[0], BRASS[1]), 1.6);
      break;
    case 'check':
      ctx.beginPath();
      ctx.moveTo(10, 34);
      ctx.lineTo(26, 50);
      ctx.lineTo(54, 14);
      inked(ctx, '#8fe070', 7);
      break;
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(14, 14);
      ctx.lineTo(50, 50);
      ctx.moveTo(50, 14);
      ctx.lineTo(14, 50);
      inked(ctx, '#e0452f', 7);
      break;
    case 'hands':
      // A coil of rope: what deckhands haul on.
      for (const r of [22, 15, 8]) {
        ctx.beginPath();
        ctx.ellipse(c, c + 4, r, r * 0.72, 0, 0, Math.PI * 2);
        inked(ctx, '#d8b878', 4);
      }
      ctx.beginPath();
      ctx.moveTo(c + 22, c + 4);
      ctx.quadraticCurveTo(c + 28, 14, c + 16, 8);
      inked(ctx, '#d8b878', 4);
      break;
    default: {
      // A painted icon whose atlas did not load: a plain brass disc stands in.
      ctx.beginPath();
      ctx.arc(c, c, 20, 0, Math.PI * 2);
      solid(ctx, grad(ctx, BRASS[0], BRASS[1]), 2);
    }
  }
  ctx.restore();
  tex.refresh();
}
