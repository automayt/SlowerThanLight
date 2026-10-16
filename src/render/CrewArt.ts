import Phaser from 'phaser';
import type { Crew } from '../sim/Ship';
import type { Side } from '../sim/types';

/**
 * Little sailors, painted once per look into canvas textures (at 2x for crispness) and animated by swapping frames.
 * Frames face right; sprites flip to face left.
 */

export type CrewStyle = 'pirate' | 'navy' | 'merchant';
export type CrewFrame = 'idle0' | 'idle1' | 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'work0' | 'work1' | 'fight0' | 'fight1';
const FRAMES: CrewFrame[] = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', 'work0', 'work1', 'fight0', 'fight1'];

/** Frame size in canvas pixels; shown at half size. */
export const CREW_W = 56;
export const CREW_H = 76;
/** Where the feet are, as a fraction of the frame. */
export const CREW_ORIGIN = { x: 0.5, y: 0.93 };

type Hat = 'bandana' | 'tricorn' | 'bicorne' | 'round' | 'cap' | 'none';

interface Look {
  skin: string;
  hair: string;
  beard: boolean;
  shirt: string;
  stripes?: string;
  coat?: string;
  coatTrim?: string;
  crossbelts?: boolean;
  sash?: string;
  trousers: string;
  hat: Hat;
  hatColor: string;
  weapon: 'cutlass' | 'musket';
}

const SKIN = ['#f2cba8', '#e2b08a', '#c98f62', '#a46a43', '#7a4b2e', '#5a3622'];
const HAIR = ['#1d1510', '#3b2414', '#6b4423', '#a8742f', '#8c3b1c', '#cfc6b8'];

let enemyStyle: CrewStyle = 'navy';

/** How the enemy's crew dress for this fight. */
export function setEnemyStyle(style: CrewStyle): void {
  enemyStyle = style;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(items: T[], n: number): T {
  return items[n % items.length];
}

function lookFor(name: string, side: Side, home: string): Look {
  const style: CrewStyle = side === 'player' ? 'pirate' : enemyStyle;
  const h = hash(name);
  const lower = name.toLowerCase();
  const skin = pick(SKIN, h);
  const hair = pick(HAIR, h >>> 3);
  const beard = ((h >>> 7) & 3) === 0;
  const trousers = pick(['#3d3328', '#2c3440', '#5b4a32', '#4a2e22'], h >>> 9);
  const officer = home === 'helm' || /captain|lt\.|lieutenant|commodore|master/.test(lower);

  if (style === 'navy') {
    if (/marine/.test(lower)) {
      return { skin, hair, beard: false, shirt: '#efe9da', coat: '#b3261e', coatTrim: '#efe9da', crossbelts: true, trousers: '#efe9da', hat: 'tricorn', hatColor: '#151515', weapon: 'musket' };
    }
    if (officer) {
      return { skin, hair, beard: false, shirt: '#efe9da', coat: '#1d2f5a', coatTrim: '#d8b14a', trousers: '#efe9da', hat: 'bicorne', hatColor: '#141414', weapon: 'cutlass' };
    }
    return {
      skin,
      hair,
      beard,
      shirt: pick(['#efe9da', '#d9d2c0'], h >>> 4),
      stripes: (h >>> 11) & 1 ? '#2b3f6e' : undefined,
      coat: (h >>> 5) & 1 ? '#25386a' : undefined,
      trousers: '#e5dfcf',
      hat: 'round',
      hatColor: '#1b1b1b',
      weapon: 'cutlass',
    };
  }
  if (style === 'merchant') {
    return {
      skin,
      hair,
      beard,
      shirt: pick(['#e8e0cc', '#c9b98f', '#9fb0a0'], h >>> 4),
      coat: officer ? '#4b3a2a' : undefined,
      coatTrim: officer ? '#8a7350' : undefined,
      trousers,
      hat: officer ? 'tricorn' : pick<Hat>(['cap', 'none', 'round'], h >>> 5),
      hatColor: pick(['#3b2f25', '#5a4a36', '#1b1b1b'], h >>> 6),
      weapon: 'cutlass',
    };
  }
  // Pirates: a ragged, colourful lot.
  if (officer) {
    return { skin, hair, beard: true, shirt: '#efe6d0', coat: '#5c1a1a', coatTrim: '#d8b14a', sash: '#1d1d1d', trousers: '#2a2420', hat: 'tricorn', hatColor: '#141414', weapon: 'cutlass' };
  }
  const shirts = ['#efe6d0', '#b5382e', '#3f6e8c', '#d8b45a', '#6f7f4a', '#e9e2d0'];
  return {
    skin,
    hair,
    beard,
    shirt: pick(shirts, h >>> 4),
    stripes: (h >>> 12) % 3 === 0 ? '#b5382e' : undefined,
    coat: (h >>> 13) % 4 === 0 ? '#4a3524' : undefined,
    sash: pick(['#b5382e', '#2f5b8a', '#d8b45a', '#3a3a3a'], h >>> 14),
    trousers,
    hat: pick<Hat>(['bandana', 'bandana', 'none', 'cap', 'tricorn'], h >>> 5),
    hatColor: pick(['#b5382e', '#1d1d1d', '#2f5b8a', '#6f7f4a', '#d8b45a'], h >>> 8),
    weapon: 'cutlass',
  };
}

/** Texture key prefix for a crew member's look, painting the frames on first use. */
export function crewTextures(scene: Phaser.Scene, c: Pick<Crew, 'name' | 'side' | 'home'>): string {
  const look = lookFor(c.name, c.side, c.home);
  const id = `crew:${hash(JSON.stringify(look)).toString(36)}`;
  if (scene.textures.exists(`${id}:idle0`)) return id;
  for (const f of FRAMES) {
    const key = `${id}:${f}`;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const tex = scene.textures.createCanvas(key, CREW_W, CREW_H)!;
    paintFrame(tex.getContext(), look, f);
    tex.refresh();
  }
  return id;
}

/** Which frame a crew member shows right now. */
export function crewFrame(c: Crew, timeS: number): CrewFrame {
  const phase = c.id * 0.37;
  if (c.waypoints.length) return `walk${Math.floor(timeS * 8 + phase * 4) % 4}` as CrewFrame;
  if (c.task === 'fight') return `fight${Math.floor(timeS * 3 + phase) % 2}` as CrewFrame;
  if (c.task === 'fire' || c.task === 'breach' || c.task === 'repair' || c.task === 'sabotage') return `work${Math.floor(timeS * 4 + phase) % 2}` as CrewFrame;
  return `idle${Math.floor(timeS * 1.1 + phase) % 2}` as CrewFrame;
}

// --- Painting ----------------------------------------------------------------

const INK = '#1a110a';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillInk(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function limb(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, ang: number, width: number, color: string, end?: string): { x: number; y: number } {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  rr(ctx, -width / 2, 0, width, len, width / 2);
  fillInk(ctx, color);
  if (end) {
    ctx.beginPath();
    ctx.arc(0, len, width * 0.55, 0, Math.PI * 2);
    fillInk(ctx, end);
  }
  ctx.restore();
  return { x: x - Math.sin(ang) * len, y: y + Math.cos(ang) * len };
}

function paintFrame(ctx: CanvasRenderingContext2D, k: Look, f: CrewFrame): void {
  const cx = CREW_W / 2;
  const ground = CREW_H * CREW_ORIGIN.y;
  const walk = f.startsWith('walk') ? Number(f[4]) : -1;
  const bob = walk === 1 || walk === 3 ? -2 : f === 'idle1' ? 1 : 0;
  const swing = walk >= 0 ? [0.45, 0, -0.45, 0][walk] : 0;

  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, ground, 13, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const hipY = ground - 18 + bob;
  const shoulderY = hipY - 19;
  const headY = shoulderY - 11;

  // Legs.
  const legL = walk >= 0 ? swing : 0;
  for (const [dx, ang] of [
    [-4, legL],
    [4, -legL],
  ] as const) {
    ctx.save();
    ctx.translate(cx + dx, hipY);
    ctx.rotate(ang * 0.8);
    rr(ctx, -3.6, 0, 7.2, 17, 3);
    fillInk(ctx, k.trousers);
    rr(ctx, -3.8, 13, 8.4, 5, 2);
    fillInk(ctx, '#2a1a10');
    ctx.restore();
  }

  // Back arm (behind the body).
  const armSwing = walk >= 0 ? -swing : 0;
  const sleeve = k.coat ?? k.shirt;
  if (f.startsWith('work')) limb(ctx, cx - 8, shoulderY + 3, 13, f === 'work0' ? 2.4 : 2.0, 6, sleeve, k.skin);
  else if (!f.startsWith('fight')) limb(ctx, cx - 9, shoulderY + 3, 14, armSwing * 0.8 + 0.12, 6, sleeve, k.skin);

  // Torso.
  rr(ctx, cx - 10, shoulderY, 20, hipY - shoulderY + 2, 6);
  fillInk(ctx, k.shirt);
  if (k.stripes) {
    ctx.save();
    rr(ctx, cx - 10, shoulderY, 20, hipY - shoulderY + 2, 6);
    ctx.clip();
    ctx.fillStyle = k.stripes;
    for (let y = shoulderY + 3; y < hipY + 2; y += 5) ctx.fillRect(cx - 10, y, 20, 2.2);
    ctx.restore();
  }
  if (k.coat) {
    // Open coat with tails.
    ctx.beginPath();
    ctx.moveTo(cx - 10, shoulderY + 2);
    ctx.lineTo(cx - 3, shoulderY + 1);
    ctx.lineTo(cx - 2, hipY + 6);
    ctx.lineTo(cx - 11, hipY + 7);
    ctx.closePath();
    fillInk(ctx, k.coat);
    ctx.beginPath();
    ctx.moveTo(cx + 10, shoulderY + 2);
    ctx.lineTo(cx + 4, shoulderY + 1);
    ctx.lineTo(cx + 3, hipY + 6);
    ctx.lineTo(cx + 11, hipY + 7);
    ctx.closePath();
    fillInk(ctx, k.coat);
    if (k.coatTrim) {
      ctx.strokeStyle = k.coatTrim;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, shoulderY + 2);
      ctx.lineTo(cx - 2.6, hipY + 5);
      ctx.moveTo(cx + 4.5, shoulderY + 2);
      ctx.lineTo(cx + 3.6, hipY + 5);
      ctx.stroke();
    }
  }
  if (k.crossbelts) {
    ctx.strokeStyle = '#f4f0e4';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - 8, shoulderY + 2);
    ctx.lineTo(cx + 8, hipY - 1);
    ctx.moveTo(cx + 8, shoulderY + 2);
    ctx.lineTo(cx - 8, hipY - 1);
    ctx.stroke();
  }
  // Belt or sash.
  ctx.fillStyle = k.sash ?? '#2a1a10';
  ctx.fillRect(cx - 10, hipY - 4, 20, 4);
  if (k.sash) ctx.fillRect(cx - 12, hipY - 3, 4, 8);
  ctx.fillStyle = '#d8b14a';
  ctx.fillRect(cx + 1, hipY - 4, 3, 4);

  // Head.
  ctx.beginPath();
  ctx.arc(cx + 1, headY, 9.5, 0, Math.PI * 2);
  fillInk(ctx, k.skin);
  // Hair at the back and sides.
  if (k.hat !== 'bandana') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + 1, headY, 9.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = k.hair;
    ctx.fillRect(cx - 10, headY - 11, 9, 20);
    ctx.fillRect(cx - 10, headY - 11, 22, 6);
    ctx.restore();
  }
  if (k.beard) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + 1, headY, 9.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = k.hair;
    ctx.beginPath();
    ctx.ellipse(cx + 4, headY + 7, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Face, looking right.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx + 6, headY - 1, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,50,30,0.5)';
  ctx.beginPath();
  ctx.arc(cx + 9.5, headY + 2, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 1, headY, 9.5, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();

  paintHat(ctx, k, cx + 1, headY);

  // Front arm, holding whatever the job needs.
  if (f.startsWith('fight')) {
    const lunge = f === 'fight0';
    const hand = limb(ctx, cx + 6, shoulderY + 3, 14, lunge ? -1.9 : -1.2, 6, sleeve, k.skin);
    ctx.strokeStyle = '#d9dde2';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    if (k.weapon === 'musket') {
      ctx.strokeStyle = '#5a3a1e';
      ctx.lineWidth = 3.5;
      ctx.lineTo(hand.x + 20, hand.y - 3);
    } else ctx.quadraticCurveTo(hand.x + 10, hand.y - (lunge ? 2 : 10), hand.x + 17, hand.y - (lunge ? 6 : 16));
    ctx.stroke();
    limb(ctx, cx - 8, shoulderY + 3, 13, 0.3, 6, sleeve, k.skin);
  } else if (f.startsWith('work')) {
    const up = f === 'work0';
    const hand = limb(ctx, cx + 7, shoulderY + 3, 14, up ? -2.5 : -1.3, 6, sleeve, k.skin);
    // Mallet.
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(up ? -0.6 : 0.5);
    ctx.fillStyle = '#6b4321';
    ctx.fillRect(-1.2, -9, 2.4, 10);
    rr(ctx, -4.5, -13, 9, 5, 1.5);
    fillInk(ctx, '#3b3b3b');
    ctx.restore();
  } else {
    limb(ctx, cx + 8, shoulderY + 3, 14, -armSwing * 0.8 - 0.12, 6, sleeve, k.skin);
  }
}

function paintHat(ctx: CanvasRenderingContext2D, k: Look, x: number, y: number): void {
  switch (k.hat) {
    case 'bandana':
      ctx.beginPath();
      ctx.arc(x, y, 9.8, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(x + 9.8, y - 1);
      ctx.lineTo(x - 9.8, y - 1);
      ctx.closePath();
      fillInk(ctx, k.hatColor);
      // Knot and tails behind.
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 3);
      ctx.lineTo(x - 16, y - 1);
      ctx.lineTo(x - 14, y + 4);
      ctx.closePath();
      fillInk(ctx, k.hatColor);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const [dx, dy] of [
        [-3, -6],
        [3, -7],
        [6, -3],
      ]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case 'tricorn':
      ctx.beginPath();
      ctx.moveTo(x - 15, y - 5);
      ctx.quadraticCurveTo(x, y - 2, x + 15, y - 5);
      ctx.lineTo(x + 9, y - 13);
      ctx.quadraticCurveTo(x, y - 20, x - 9, y - 13);
      ctx.closePath();
      fillInk(ctx, k.hatColor);
      ctx.strokeStyle = '#d8b14a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x - 13, y - 6);
      ctx.quadraticCurveTo(x, y - 3.5, x + 13, y - 6);
      ctx.stroke();
      return;
    case 'bicorne':
      ctx.beginPath();
      ctx.moveTo(x - 17, y - 6);
      ctx.quadraticCurveTo(x, y - 26, x + 17, y - 6);
      ctx.quadraticCurveTo(x, y - 9, x - 17, y - 6);
      ctx.closePath();
      fillInk(ctx, k.hatColor);
      ctx.fillStyle = '#d8b14a';
      ctx.beginPath();
      ctx.arc(x + 4, y - 12, 2.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'round':
      ctx.beginPath();
      ctx.ellipse(x, y - 7, 13, 3.5, 0, 0, Math.PI * 2);
      fillInk(ctx, k.hatColor);
      rr(ctx, x - 7.5, y - 16, 15, 9, 3);
      fillInk(ctx, k.hatColor);
      ctx.fillStyle = '#3a4f80';
      ctx.fillRect(x - 7, y - 10, 14, 2);
      return;
    case 'cap':
      ctx.beginPath();
      ctx.arc(x, y - 2, 10, Math.PI, Math.PI * 2);
      ctx.closePath();
      fillInk(ctx, k.hatColor);
      ctx.beginPath();
      ctx.arc(x - 4, y - 12, 3, 0, Math.PI * 2);
      fillInk(ctx, k.hatColor);
      return;
    case 'none':
      return;
  }
}
