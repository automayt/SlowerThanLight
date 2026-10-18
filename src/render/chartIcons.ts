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
      ctx.font = 'bold 32px "STL Fell", Georgia, serif';
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

/** A compass rose in sepia and red ink: sixteen points, a ring of degrees, a fleur-de-lis to the north. 256px, painted once. */
export function chartRose(scene: Phaser.Scene): string {
  const key = 'charticon:rose';
  if (scene.textures.exists(key)) return key;
  const S = 256;
  const c = S / 2;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const ink = '#2a170a';
  const red = '#8a1c1c';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  for (const r of [118, 112, 84]) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Degree ticks between the outer rings.
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const r0 = i % 4 === 0 ? 104 : 109;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * 112, c + Math.sin(a) * 112);
    ctx.stroke();
  }
  // Points, longest last so they lie on top: each half shaded, half plain, like an engraved rose.
  const point = (a: number, len: number, wide: number, dark: string, light: string) => {
    const tip = { x: c + Math.cos(a) * len, y: c + Math.sin(a) * len };
    for (const [side, fill] of [
      [-1, dark],
      [1, light],
    ] as const) {
      const sa = a + (side * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(sa) * wide, c + Math.sin(sa) * wide);
      ctx.lineTo(tip.x, tip.y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
    }
  };
  for (let i = 0; i < 16; i++) if (i % 2) point((i / 16) * Math.PI * 2 - Math.PI / 2, 66, 6, ink, '#efe2bf');
  for (let i = 0; i < 8; i += 2) point((i / 8) * Math.PI * 2 - Math.PI / 4, 82, 9, red, '#efe2bf');
  for (let i = 0; i < 4; i++) point((i / 4) * Math.PI * 2 - Math.PI / 2, 116, 13, ink, '#efe2bf');
  ctx.fillStyle = '#efe2bf';
  ctx.beginPath();
  ctx.arc(c, c, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.arc(c, c, 3, 0, Math.PI * 2);
  ctx.fill();
  // A fleur-de-lis crowning the north point.
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.moveTo(c, 0);
  ctx.quadraticCurveTo(c + 7, 6, c, 14);
  ctx.quadraticCurveTo(c - 7, 6, c, 0);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(c, 13);
    ctx.quadraticCurveTo(c + s * 12, 2, c + s * 9, 12);
    ctx.quadraticCurveTo(c + s * 6, 14, c, 15);
    ctx.fill();
  }
  tex.refresh();
  return key;
}

/** A sea serpent rising from the waves in three coils, drawn in ink. 220x120, painted once. */
export function chartSerpent(scene: Phaser.Scene): string {
  const key = 'charticon:serpent';
  if (scene.textures.exists(key)) return key;
  const W = 220;
  const H = 120;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  const ink = '#2a170a';
  const sea = 92;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // The coils: arches out of the water, back shaded, belly pale, with scale marks across.
  const coils: [number, number, number][] = [
    [62, 22, 30],
    [112, 20, 34],
    [158, 15, 26],
  ];
  for (const [x, r, h] of coils) {
    ctx.beginPath();
    ctx.moveTo(x - r, sea);
    ctx.bezierCurveTo(x - r, sea - h * 1.3, x + r, sea - h * 1.3, x + r, sea);
    ctx.lineTo(x + r - 9, sea);
    ctx.bezierCurveTo(x + r - 9, sea - h * 0.9, x - r + 9, sea - h * 0.9, x - r + 9, sea);
    ctx.closePath();
    ctx.fillStyle = 'rgba(70,52,30,0.55)';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineWidth = 0.8;
    for (let t = 0.12; t < 0.9; t += 0.1) {
      const a = Math.PI * (1 - t);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r - 8), sea - Math.sin(a) * h * 0.72);
      ctx.lineTo(x + Math.cos(a) * r, sea - Math.sin(a) * h * 0.98);
      ctx.stroke();
    }
  }
  // The tail fin, flicking up at the far end.
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(184, sea);
  ctx.quadraticCurveTo(196, sea - 14, 206, sea - 30);
  ctx.quadraticCurveTo(200, sea - 14, 214, sea - 22);
  ctx.quadraticCurveTo(204, sea - 6, 190, sea);
  ctx.closePath();
  ctx.fillStyle = 'rgba(70,52,30,0.55)';
  ctx.fill();
  ctx.stroke();
  // The neck and head, jaws open, rearing at the left.
  ctx.beginPath();
  ctx.moveTo(40, sea);
  ctx.bezierCurveTo(30, sea - 40, 14, sea - 52, 26, sea - 70);
  ctx.lineTo(10, sea - 74);
  ctx.lineTo(28, sea - 78);
  ctx.bezierCurveTo(44, sea - 82, 52, sea - 66, 50, sea - 50);
  ctx.bezierCurveTo(48, sea - 30, 56, sea - 12, 52, sea);
  ctx.closePath();
  ctx.fillStyle = 'rgba(70,52,30,0.55)';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(26, sea - 70);
  ctx.lineTo(4, sea - 62);
  ctx.lineTo(22, sea - 64);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(34, sea - 74, 2, 0, Math.PI * 2);
  ctx.fill();
  // A crest of spines down the neck.
  for (let i = 0; i < 5; i++) {
    const y = sea - 72 + i * 11;
    const x = 44 + i * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 9, y + 2);
    ctx.lineTo(x + 2, y + 7);
    ctx.stroke();
  }
  // Waves where it breaks the surface.
  ctx.lineWidth = 1.2;
  for (let row = 0; row < 3; row++) {
    ctx.beginPath();
    for (let x = 8 + row * 10; x < W - 8 - row * 6; x += 2) {
      const y = sea + 4 + row * 8 + Math.sin(x / 7 + row) * 2;
      if (x === 8 + row * 10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.8 - row * 0.25;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  tex.refresh();
  return key;
}

/** A little ship in profile for "you are here", painted once. */
export function chartShip(scene: Phaser.Scene, navy = false): string {
  const key = navy ? 'charticon:navyship' : 'charticon:ship';
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
  ctx.fillStyle = navy ? '#1c1f2a' : '#3b2412';
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
  // Black flag, or the King's red ensign.
  ctx.fillStyle = navy ? '#b0242a' : '#111';
  ctx.fillRect(40, 4, 9, 6);
  if (navy) {
    // A yellow band at the gunports.
    ctx.fillStyle = '#c9a23a';
    ctx.fillRect(12, 46, 40, 2);
  }
  tex.refresh();
  return key;
}
