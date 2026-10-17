import Phaser from 'phaser';
import type { NodeKind } from '../sim/SeaChart';

/** Wax-seal colours for each kind of chart node. */
export const SEAL: Record<NodeKind, number> = {
  start: 0x6f6a5c,
  battle: 0x9a2a1e,
  event: 0x2f5a7e,
  port: 0x3f6e3a,
  empty: 0x6a7884,
  boss: 0x2a0d0a,
  exit: 0xa8862e,
};

const INK = '#f4ead2';

/** A cream symbol for a chart node, painted once into a 48x48 canvas (shown at half size). */
export function chartIcon(scene: Phaser.Scene, kind: NodeKind): string {
  const key = `charticon:${kind}`;
  if (scene.textures.exists(key)) return key;
  const S = 48;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const c = S / 2;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'start':
    case 'port': {
      // Anchor.
      ctx.beginPath();
      ctx.arc(c, 11, 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c, 15);
      ctx.lineTo(c, 38);
      ctx.moveTo(c - 8, 20);
      ctx.lineTo(c + 8, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, 26, 12, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c - 13, 30);
      ctx.lineTo(c - 11, 36);
      ctx.lineTo(c - 6, 33);
      ctx.moveTo(c + 13, 30);
      ctx.lineTo(c + 11, 36);
      ctx.lineTo(c + 6, 33);
      ctx.stroke();
      break;
    }
    case 'battle': {
      // Crossed cutlasses.
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(s * 0.75);
        ctx.beginPath();
        ctx.moveTo(0, -15);
        ctx.quadraticCurveTo(4 * s, 0, 0, 11);
        ctx.stroke();
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-5, 11);
        ctx.lineTo(5, 11);
        ctx.moveTo(0, 11);
        ctx.lineTo(0, 17);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'event': {
      ctx.font = 'bold 30px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', c, c + 2);
      break;
    }
    case 'empty': {
      for (const dy of [-6, 4]) {
        ctx.beginPath();
        for (let x = 8; x <= 40; x += 2) {
          const y = c + dy + Math.sin((x / 32) * Math.PI * 2) * 3;
          if (x === 8) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'boss': {
      // Skull.
      ctx.beginPath();
      ctx.arc(c, c - 4, 11, Math.PI * 0.9, Math.PI * 2.1);
      ctx.lineTo(c + 7, c + 10);
      ctx.lineTo(c - 7, c + 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a0d0a';
      ctx.beginPath();
      ctx.arc(c - 4.5, c - 3, 3.2, 0, Math.PI * 2);
      ctx.arc(c + 4.5, c - 3, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(c - 4, c + 6, 2, 4);
      ctx.fillRect(c + 2, c + 6, 2, 4);
      break;
    }
    case 'exit': {
      // Compass point toward the next waters.
      ctx.beginPath();
      ctx.moveTo(c + 15, c);
      ctx.lineTo(c - 6, c - 9);
      ctx.lineTo(c - 2, c);
      ctx.lineTo(c - 6, c + 9);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(c - 14, c);
      ctx.lineTo(c - 4, c);
      ctx.stroke();
      break;
    }
  }
  tex.refresh();
  return key;
}

/** A little ship in profile for "you are here", painted once. */
export function chartShip(scene: Phaser.Scene): string {
  const key = 'charticon:ship';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 64, 64)!;
  const ctx = tex.getContext();
  ctx.lineJoin = 'round';
  // Hull.
  ctx.beginPath();
  ctx.moveTo(8, 44);
  ctx.lineTo(56, 44);
  ctx.lineTo(50, 54);
  ctx.lineTo(14, 54);
  ctx.closePath();
  ctx.fillStyle = '#3b2412';
  ctx.fill();
  ctx.strokeStyle = '#120804';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Masts and sails.
  ctx.fillStyle = '#efe4c6';
  for (const [x, h] of [
    [24, 30],
    [40, 34],
  ]) {
    ctx.fillRect(x - 0.75, 44 - h - 4, 1.5, h + 4);
    ctx.beginPath();
    ctx.moveTo(x - 9, 44 - h + 2);
    ctx.quadraticCurveTo(x + 2, 44 - h / 2, x - 9, 40);
    ctx.lineTo(x + 9, 40);
    ctx.quadraticCurveTo(x + 14, 44 - h / 2, x + 9, 44 - h + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Black flag.
  ctx.fillStyle = '#111';
  ctx.fillRect(40, 4, 9, 6);
  tex.refresh();
  return key;
}
