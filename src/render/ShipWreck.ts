import Phaser from 'phaser';
import type { Crew, Ship } from '../sim/Ship';
import type { Vec } from '../sim/types';
import { CREW_H, CREW_W } from './CrewArt';
import { WIND } from './fx';
import { ART_SCALE, paintMasts, type EnsignArt, type ShipGeometry, type ShipPiece, type Spar } from './ShipArt';
import { motionScale } from './screen';
import { ensignDownAt, goneAt, leaps, mastFalls, waterline, type WreckKind } from './wreckPlan';

/**
 * A ship's death scene, seen from aloft. Sinking, she lists and settles by one end, the sea creeping up her deck
 * from it in a line of foam; her masts go by the board one after another, the hands run for the rail and go over
 * the side to strike out for the victor, and wreckage bobs up and drifts as she goes. Her colours go last, then a
 * burst of air. Blown up, her two halves fill from the break while burning timber rains into the sea round them
 * under a column of smoke.
 *
 * Everything here is render-only. The view hands over its hull images, masts, crew sprites and ensign when she is
 * lost and calls update() each frame; nothing heavy is redrawn that need not be (the hull is cropped, not repainted).
 */

/** What the battle does for the wreck: spray and sound where it happens, a jolt of the camera. */
export interface WreckHooks {
  splash(x: number, y: number, big: boolean): void;
  sound(name: string | readonly string[], volume: number, x: number): void;
  shake(ms: number, intensity: number): void;
  /** Embers and smoke off something burning, as the battle does for a burning room (`key` keeps its rate). */
  burn(key: string, r: Phaser.Geom.Rectangle, heat: number, dt: number): void;
}

export const NO_WRECK_HOOKS: WreckHooks = { splash: () => undefined, sound: () => undefined, shake: () => undefined, burn: () => undefined };

/** A piece of hull going under: the whole of her, or one half of her blown in two. */
export interface HullPiece {
  img: Phaser.GameObjects.Image;
  /** The tile x her hull on this piece runs between. */
  lo: number;
  hi: number;
  /** Which end the sea takes first. */
  wetLo: boolean;
  /** Tile x to x in this piece's texture (pixels); the textures are never flipped, so crops are simple. */
  tex: (x: number) => number;
}

export interface WreckHost {
  scene: Phaser.Scene;
  ship: Ship;
  geom: ShipGeometry;
  tile: number;
  flip: boolean;
  keyPrefix: string;
  pieces: HullPiece[];
  /** Scorch marks riding the hull, cropped with it. */
  marks: Phaser.GameObjects.RenderTexture | null;
  /** How much canvas each mast had set when she was lost. */
  set: number[];
  furls: { img: Phaser.GameObjects.Image; piece: ShipPiece }[];
  crew: { crew: Crew; sprite: Phaser.GameObjects.Image; prefix: string }[];
  strips: Phaser.GameObjects.Image[];
  ensign: EnsignArt;
  /** The rig's sway over the hull right now, in pixels. */
  roll: () => number;
  /** Where survivors swim for: the victor. */
  toward: Vec | null;
  hooks: WreckHooks;
}

/** Layers: under the hulls (things afloat), on her deck at the waterline, aloft, and in the air. */
const DEPTH = { ghost: 1.55, under: 1.6, flotsam: 1.63, swim: 1.66, wash: 1.67, fire: 1.69, surf: 2.6, sails: 4.98, mast: 5.1, debris: 8.9, debrisFire: 8.95, smoke: 9.45 } as const;
const FOAM = 0xe8f4f8;
/** Hull seen through a fathom of green water. */
const GHOST = 0x2f7c78;
/** Sea washing over her deck. */
const WASH = 0x3d8f88;
const CLOTH = 0xe6dcc0;
const CLOTH_SEAM = 0x9c8c6a;
const POLE = 0x5e3c1c;
const POLE_LIT = 0x9a6a3a;
const GHOST_ALPHA = [0.6, 0.46, 0.33, 0.21, 0.1];
const GHOST_STEP = 0.4;
const BELLY = { square: 0.5, gaff: 0.42, lateen: 0.5, lug: 0.42 } as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface Mast {
  spar: Spar;
  img: Phaser.GameObjects.Image;
  furl: { img: Phaser.GameObjects.Image; dx: number; dy: number } | null;
  piece: HullPiece;
  start: number;
  dur: number;
  /** Which way she falls, in the ship's own tiles (x along the keel, y athwartships). */
  dir: Vec;
  len: number;
  spin: number;
  set: number;
  state: 'up' | 'falling' | 'down';
  base: Vec;
  head: Vec;
  rot: number;
  scale: number;
  drift: Vec;
  downAt: number;
  sailGone: number;
}

interface Hand {
  sprite: Phaser.GameObjects.Image;
  prefix: string;
  id: number;
  piece: HullPiece;
  from: Vec;
  rail: Vec;
  water: Vec;
  run: number;
  jump: number;
  land: number;
  thrown: boolean;
  state: 'deck' | 'run' | 'leap' | 'swim';
  /** Screen points of the leap, fixed as it starts. */
  p0: Vec;
  p1: Vec;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  scale: number;
  face: number;
}

interface Flot {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  born: number;
  phase: number;
  heat: number;
  key: string;
  /** In the air: height above the water and how fast it is rising. */
  z: number;
  vz: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  t0: number;
  size: number;
  life: number;
}

interface Puff {
  img: Phaser.GameObjects.Image;
  t0: number;
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  s0: number;
  s1: number;
  peak: number;
}

export class ShipWreck {
  private readonly scene: Phaser.Scene;
  private readonly geom: ShipGeometry;
  private readonly T: number;
  private readonly u: number;
  private readonly mid: number;
  /** Side she lists to, and lets her masts fall to: -1 up the screen in her own frame, 1 down. */
  readonly listDir: number;
  private readonly under: Phaser.GameObjects.Graphics;
  private readonly wash: Phaser.GameObjects.Graphics;
  private readonly fire: Phaser.GameObjects.Graphics;
  private readonly surf: Phaser.GameObjects.Graphics;
  private readonly aloft: Phaser.GameObjects.Graphics;
  private readonly airFire: Phaser.GameObjects.Graphics;
  private readonly ghosts: Phaser.GameObjects.Image[][];
  private readonly masts: Mast[] = [];
  private readonly hands: Hand[] = [];
  private readonly flots: Flot[] = [];
  private readonly rings: Ring[] = [];
  private readonly puffs: Puff[] = [];
  private readonly keys: string[] = [];
  /** One-off moments: sounds and bursts at their time. */
  private readonly cues: { at: number; fn: () => void; done?: boolean }[] = [];
  private readonly calm: number;
  private readonly gone: number;
  private readonly ensignDown: number;
  /** When the sea reached her ensign staff, if it came over the stern first: her colours go down with it. */
  private staffWet = Infinity;
  /** Where she was last seen, for the swirl and the burst of air. */
  private lastSeen: Vec | null = null;
  private nextFlot = 1.3;
  private splashes = 0;
  private nextPuff = 0;
  private t = 0;
  /** Outline points with their outward normals, for the foam round what is left of her. */
  private readonly rim: { x: number; y: number; nx: number; ny: number }[];

  constructor(
    private readonly host: WreckHost,
    readonly kind: WreckKind,
  ) {
    const { scene, geom, tile } = host;
    this.scene = scene;
    this.geom = geom;
    this.T = tile;
    this.u = tile * ART_SCALE;
    this.mid = host.ship.height / 2;
    this.calm = motionScale();
    this.listDir = Math.random() < 0.5 ? -1 : 1;
    this.gone = goneAt(kind);
    this.ensignDown = ensignDownAt(kind);
    wreckTextures(scene);

    this.under = scene.add.graphics().setDepth(DEPTH.under);
    this.wash = scene.add.graphics().setDepth(DEPTH.wash);
    this.fire = scene.add.graphics().setDepth(DEPTH.fire);
    this.surf = scene.add.graphics().setDepth(DEPTH.surf);
    this.aloft = scene.add.graphics().setDepth(DEPTH.sails);
    this.airFire = scene.add.graphics().setDepth(DEPTH.debrisFire);
    this.ghosts = host.pieces.map((pc) => GHOST_ALPHA.map(() => scene.add.image(0, 0, pc.img.texture.key).setDepth(DEPTH.ghost).setTint(GHOST).setVisible(false)));

    const mid = this.mid;
    this.rim = geom.outline.map((p) => {
      const nx = p.x - (geom.stern + geom.tip) / 2;
      const ny = p.y - mid;
      const len = Math.hypot(nx * 0.35, ny) || 1;
      return { x: p.x, y: p.y, nx: (nx * 0.35) / len, ny: ny / len };
    });

    this.setUpMasts();
    this.setUpCrew();
    for (const { img } of host.furls) img.setVisible(false);
    this.cue(0.15, () => this.sound('creak', 0.75));
    if (kind === 'sink') {
      this.cue(2.5, () => this.sound('creak', 0.6));
      this.cue(this.gone - 0.7, () => this.sound(['flood', 'sink'], 0.45));
    } else {
      this.cue(0.5, () => this.sound('fire', 0.45));
      this.cue(1.9, () => this.sound('creak', 0.55));
      this.cue(this.gone - 0.6, () => this.sound(['hiss', 'flood'], 0.4));
      this.blast();
    }
    this.cue(this.ensignDown + 0.1, () => this.airBurst());
  }

  /** How far she lists, 0..1. */
  list(age: number): number {
    if (this.kind !== 'sink') return 0;
    const k = clamp01((age - 0.2) / 2.4);
    return k * k * (3 - 2 * k) * (0.5 + 0.5 * this.calm);
  }

  destroy(): void {
    for (const o of [this.under, this.wash, this.fire, this.surf, this.aloft, this.airFire, ...this.ghosts.flat(), ...this.masts.map((m) => m.img), ...this.hands.map((h) => h.sprite), ...this.flots.map((f) => f.img), ...this.puffs.map((p) => p.img)]) o.destroy();
    for (const k of this.keys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }

  // --- Setting up -------------------------------------------------------------------------

  private cue(at: number, fn: () => void): void {
    this.cues.push({ at, fn });
  }

  private sound(name: string | readonly string[], volume: number, x?: number): void {
    const c = x ?? this.at(this.host.pieces[0], (this.geom.stern + this.geom.tip) / 2, this.mid).x;
    this.host.hooks.sound(name, volume, c);
  }

  private pieceFor(x: number): HullPiece {
    const ps = this.host.pieces;
    return ps.find((p) => x >= Math.min(p.lo, p.hi) - 0.01 && x <= Math.max(p.lo, p.hi) + 0.01) ?? ps[0];
  }

  /** How far along a piece from the end that goes first, 0..1. */
  private frac(p: HullPiece, x: number): number {
    return clamp01(p.wetLo ? (x - p.lo) / (p.hi - p.lo) : (p.hi - x) / (p.hi - p.lo));
  }

  /** Where the sea has got to on a piece, in tile x. */
  private waterX(p: HullPiece): number {
    const f = waterline(this.kind, this.t);
    return p.wetLo ? p.lo + f * (p.hi - p.lo) : p.hi - f * (p.hi - p.lo);
  }

  /** Whether a point of her (tile x) is still above water. */
  dry(x: number): boolean {
    const p = this.pieceFor(x);
    const w = this.waterX(p);
    return p.wetLo ? x > w : x < w;
  }

  /** A point of her deck (tiles) on screen, riding the piece it is on. */
  private at(p: HullPiece, x: number, y: number): Vec {
    const img = p.img;
    const lx = (p.tex(x) - img.originX * img.width) * img.scaleX;
    const ly = ((y + this.geom.padT) * this.u - img.originY * img.height) * img.scaleY;
    const c = Math.cos(img.rotation);
    const s = Math.sin(img.rotation);
    return { x: img.x + lx * c - ly * s, y: img.y + lx * s + ly * c };
  }

  private half(x: number): number {
    const g = this.geom;
    return g.half(Math.max(g.stern, Math.min(g.tip, x)));
  }

  private setUpMasts(): void {
    const { host, geom, T } = this;
    const pieces = paintMasts(this.scene, host.ship, geom, host.tile, `${host.keyPrefix}-wreck`);
    this.keys.push(...pieces.map((p) => p.key));
    const fracs = geom.spars.map((sp) => this.frac(this.pieceFor(sp.mast.x), sp.mast.x));
    const falls = mastFalls(this.kind, fracs);
    geom.spars.forEach((sp, i) => {
      const art = pieces[i];
      const img = this.scene.add
        .image(0, 0, art.key)
        .setScale(1 / ART_SCALE)
        .setFlipX(host.flip)
        .setOrigin((host.flip ? art.w - art.headX : art.headX) / art.w, art.headY / art.h)
        .setDepth(DEPTH.mast - 0.1);
      const piece = this.pieceFor(sp.mast.x);
      // The furled canvas (if her hands had it in) goes with its mast: kept as an offset from the masthead.
      const f = host.furls[i];
      let furl: Mast['furl'] = null;
      if (f && f.img.alpha > 0.05) {
        const texW = (geom.padL + host.ship.width + geom.padR) * this.u;
        const fx = (host.flip ? texW - f.piece.x - f.piece.w : f.piece.x) / ART_SCALE;
        const hx = (host.flip ? texW - (sp.mast.x + geom.padL) * this.u : (sp.mast.x + geom.padL) * this.u) / ART_SCALE;
        furl = { img: f.img, dx: fx - hx, dy: f.piece.y / ART_SCALE - ((sp.mast.y + geom.padT) * this.u) / ART_SCALE };
        f.img.setVisible(true).setDepth(DEPTH.mast - 0.05);
      }
      const fall = falls.find((fl) => fl.index === i)!;
      // Over the low side, raked toward the end that is going down; blown up, any way at all.
      const toLow = piece.wetLo ? -1 : 1;
      const dir =
        this.kind === 'sink'
          ? { x: toLow * rnd(0.05, 0.4), y: this.listDir }
          : (() => {
              const a = rnd(0, Math.PI * 2);
              return { x: Math.cos(a) * 0.6, y: Math.sin(a) >= 0 ? 1 : -1 };
            })();
      const n = Math.hypot(dir.x, dir.y);
      this.masts.push({
        spar: sp,
        img,
        furl,
        piece,
        start: fall.start,
        dur: fall.dur,
        dir: { x: dir.x / n, y: dir.y / n },
        len: T * Math.max(2, Math.min(3, geom.beam * 1.3)) * (sp.main ? 1 : 0.85),
        spin: (Math.random() < 0.5 ? -1 : 1) * rnd(1.1, 1.5),
        set: host.set[i] ?? 0,
        state: 'up',
        base: { x: 0, y: 0 },
        head: { x: 0, y: 0 },
        rot: 0,
        scale: 1,
        drift: { x: 0, y: 0 },
        downAt: 0,
        sailGone: 0,
      });
    });
  }

  private setUpCrew(): void {
    const { host } = this;
    const mid = this.mid;
    const list = host.crew;
    const pieces = list.map(({ crew }) => this.pieceFor(crew.pos.x));
    const rails = list.map(({ crew }) => {
      const side = Math.sign(crew.pos.y - mid) || this.listDir;
      const x = crew.pos.x;
      return { side, rail: { x, y: mid + side * (this.half(x) - 0.25) } };
    });
    const plan = leaps(
      this.kind,
      list.map(({ crew }, i) => this.frac(pieces[i], crew.pos.x)),
      list.map(({ crew }, i) => Math.abs(rails[i].rail.y - crew.pos.y)),
    );
    list.forEach(({ crew, sprite, prefix }, i) => {
      const { side, rail } = rails[i];
      const x = crew.pos.x + rnd(-0.3, 0.3);
      const lp = plan[i];
      this.hands.push({
        sprite,
        prefix,
        id: crew.id,
        piece: pieces[i],
        from: { x: crew.pos.x, y: crew.pos.y },
        rail,
        water: { x, y: mid + side * (this.half(x) + rnd(0.6, 1.1)) },
        run: lp.run,
        jump: lp.jump,
        land: lp.land,
        thrown: lp.thrown,
        state: 'deck',
        p0: { x: sprite.x, y: sprite.y },
        p1: { x: sprite.x, y: sprite.y },
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        phase: Math.random(),
        scale: sprite.scaleX,
        face: sprite.flipX ? -1 : 1,
      });
    });
  }

  /** Her magazine goes up: timber and spars and burning wreckage thrown out over the sea. */
  private blast(): void {
    const ps = this.host.pieces;
    const c0 = this.at(ps[0], ps[0].wetLo ? ps[0].lo : ps[0].hi, this.mid);
    const n = 14 + Math.round(this.host.ship.width);
    const kinds = ['wreck:plank', 'wreck:plank', 'wreck:timber', 'wreck:timber', 'wreck:spar', 'wreck:crate', 'wreck:barrel', 'wreck:hatch'];
    const mix = 0.55 + 0.45 * this.calm;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(60, 190);
      const f = this.addFlot(kinds[i % kinds.length], c0.x + rnd(-10, 10), c0.y + rnd(-8, 8), Math.cos(a) * v, Math.sin(a) * v * 0.75, i % 5 < 2 ? rnd(0.7, 1) : 0);
      f.z = 2;
      f.vz = rnd(140, 280) * mix;
      f.spin = (Math.random() < 0.5 ? -1 : 1) * rnd(4, 10) * mix;
      f.img.setDepth(DEPTH.debris);
    }
  }

  private addFlot(key: string, x: number, y: number, vx: number, vy: number, heat = 0): Flot {
    const size = (this.T / 42) * 0.5;
    const img = this.scene.add.image(x, y, key).setDepth(DEPTH.flotsam).setScale(size).setRotation(rnd(0, Math.PI * 2));
    const f: Flot = { img, x, y, vx, vy, spin: rnd(-0.4, 0.4), born: this.t, phase: rnd(0, 6), heat, key: `wreck:${this.host.keyPrefix}:${this.flots.length}`, z: 0, vz: 0, size };
    this.flots.push(f);
    return f;
  }

  private ring(x: number, y: number, size: number, life = 1.2): void {
    this.rings.push({ x, y, t0: this.t, size, life });
    if (this.rings.length > 40) this.rings.shift();
  }

  private splash(x: number, y: number, big: boolean, volume = 0): void {
    this.host.hooks.splash(x, y, big);
    this.ring(x, y, big ? 1.6 : 0.8);
    if (volume > 0 && (big || this.splashes++ < 7)) this.host.hooks.sound('splash', volume, x);
  }

  // --- Each frame -------------------------------------------------------------------------

  update(age: number, dt: number): void {
    this.t = age;
    for (const c of this.cues) {
      if (c.done || age < c.at) continue;
      c.done = true;
      c.fn();
    }
    for (const g of [this.under, this.wash, this.fire, this.surf, this.aloft, this.airFire]) g.clear();
    this.updateHull(age);
    this.updateMasts(age, dt);
    this.updateHands(age, dt);
    this.spawnFlotsam(age);
    this.updateFlotsam(age, dt);
    this.updateSmoke(age, dt);
    this.drawRings(age);
    this.updateEnsign(age);
    this.drawSwirl(age);
  }

  /** Crop each piece back to its waterline, with the drowned part showing green under the surface and foam along the edge. */
  private updateHull(age: number): void {
    const f = waterline(this.kind, age);
    const mid = this.mid;
    this.host.pieces.forEach((p, pi) => {
      const img = p.img;
      const gone = f >= 1;
      if (gone) {
        if (img.visible) this.lastSeen = this.at(p, p.wetLo ? p.hi - 0.6 : p.lo + 0.6, mid);
        img.setVisible(false);
        for (const gh of this.ghosts[pi]) gh.setVisible(false);
        if (pi === 0) this.host.marks?.setVisible(false);
        return;
      }
      const xw = this.waterX(p);
      const W = img.width;
      const tw = p.tex(xw);
      const dryUp = p.wetLo ? p.tex(p.hi) > p.tex(p.lo) : p.tex(p.lo) > p.tex(p.hi);
      const x0 = dryUp ? tw : 0;
      const x1 = dryUp ? W : tw;
      img.setCrop(Math.max(0, x0), 0, Math.max(0, Math.min(W, x1) - Math.max(0, x0)), img.height);
      // Wet, darkening timbers.
      const k = Math.min(1, f * 1.4);
      const tint = this.kind === 'explode' ? lerpColor(0xe0c8b4, 0x6e625a, Math.min(1, age / 2)) : lerpColor(0xffffff, 0xa8b2b0, k);
      img.setTint(tint);
      if (pi === 0 && this.host.marks && this.kind === 'sink') {
        const m = this.host.marks;
        m.setScale(1, img.scaleY * ART_SCALE);
        m.setCrop(Math.max(0, x0) / ART_SCALE, 0, Math.max(0, Math.min(W, x1) - Math.max(0, x0)) / ART_SCALE, m.height);
      }
      // The part under water, fading with depth.
      const step = p.wetLo ? -GHOST_STEP : GHOST_STEP;
      this.ghosts[pi].forEach((gh, i) => {
        const a = p.tex(xw + step * i);
        const b = p.tex(xw + step * (i + 1));
        const l = Math.max(0, Math.min(a, b));
        const r = Math.min(W, Math.max(a, b));
        if (r - l < 1) {
          gh.setVisible(false);
          return;
        }
        gh.setVisible(true)
          .setPosition(img.x, img.y)
          .setRotation(img.rotation)
          .setScale(img.scaleX, img.scaleY)
          .setOrigin(img.originX, img.originY)
          .setCrop(l, 0, r - l, img.height)
          .setAlpha(GHOST_ALPHA[i] * (1 - Math.max(0, f - 0.85) / 0.15));
      });
      this.drawWaterline(p, xw, age, pi);
      this.drawRim(p, xw, age);
      if (this.kind === 'sink') this.drawListWash(p, xw, age);
    });
  }

  /** Sea lapping over her deck from the waterline, a line of foam along it and bubbles boiling up behind. */
  private drawWaterline(p: HullPiece, xw: number, age: number, seed: number): void {
    const g = this.surf;
    const mid = this.mid;
    const T = this.T;
    const dry = p.wetLo ? 1 : -1;
    const geo = this.geom;
    // Only where there is hull across: past the bow or stern it is just the bowsprit, a little ring of foam.
    const hw = this.half(xw);
    if (xw > geo.tip - 0.05 || xw < geo.stern + 0.05) {
      const c = this.at(p, xw, mid);
      g.lineStyle(2, FOAM, 0.7).strokeEllipse(c.x, c.y, T * 0.5, T * 0.22);
      return;
    }
    // The last of her going: the foam thins away with her.
    const fade = clamp01((1 - waterline(this.kind, age)) / 0.12);
    // The sea runs up her deck and falls back, so the edge of the wet never sits still.
    const lap = (0.3 + 0.14 * Math.sin(age * 2.6 + seed * 2)) * (0.6 + 0.4 * this.calm);
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const xa = xw + (dry * lap * i) / bands;
      const xb = xw + (dry * lap * (i + 1)) / bands;
      const ha = this.half(xa);
      const hb = this.half(xb);
      const pts = [this.at(p, xa, mid - ha), this.at(p, xb, mid - hb), this.at(p, xb, mid + hb), this.at(p, xa, mid + ha)];
      g.fillStyle(WASH, 0.68 * Math.pow(1 - i / bands, 1.3) * fade).fillPoints(pts, true);
    }
    const N = 9;
    const across = (off: (v: number) => number) => {
      const pts: Vec[] = [];
      for (let i = 0; i <= N; i++) {
        const v = i / N;
        pts.push(this.at(p, xw + dry * off(v), mid - hw + 2 * hw * v));
      }
      return pts;
    };
    // Broken water right along the edge of her, hiding where the deck goes under.
    const edge = across((v) => 0.03 * Math.sin(age * 4 + v * 11 + seed));
    g.lineStyle(7, FOAM, 0.32 * fade).strokePoints(edge, false);
    g.lineStyle(2.4, FOAM, 0.8 * fade).strokePoints(edge, false);
    for (let i = 0; i < 11; i++) {
      const v = (i + 0.5) / 11;
      const q = this.at(p, xw + dry * 0.04 * Math.sin(i * 2.7 + age * 3), mid - hw + 2 * hw * v);
      const k = 0.5 + 0.5 * Math.sin(age * 6 + i * 2.3);
      g.fillStyle(FOAM, (0.45 + 0.35 * k) * fade).fillEllipse(q.x, q.y, (5 + (i % 3) * 3) * (0.8 + 0.4 * k), 4 + (i % 2) * 2);
    }
    // The thin front of each wash as it runs up the deck.
    const front = across((v) => lap * (0.85 + 0.12 * Math.sin(age * 5 + v * 9 + seed)) + 0.05 * Math.sin(age * 3.1 - v * 13));
    g.lineStyle(1.6, FOAM, 0.6 * fade).strokePoints(front, false);
    // Water breaking against her sides where it meets them.
    for (const s of [-1, 1]) {
      const q = this.at(p, xw + dry * lap * 0.3, mid + s * (hw + 0.1));
      const k = (age * 1.4 + (s > 0 ? 0.5 : 0)) % 1;
      g.fillStyle(FOAM, 0.55 * (1 - k)).fillEllipse(q.x, q.y + s * k * 3, 6 + k * 10, 3 + k * 4);
    }
    // Air boiling up from her flooded hull, just behind the line.
    for (let i = 0; i < 9; i++) {
      const k = (age * 0.9 + i / 9) % 1;
      const x = xw - dry * (0.15 + ((i * 0.37) % 1) * 0.9);
      const y = mid + (((i * 0.61) % 1) - 0.5) * 1.6 * this.half(x);
      const q = this.at(p, x, y);
      this.under.fillStyle(FOAM, 0.6 * (1 - k)).fillCircle(q.x, q.y - k * 4, 1.2 + k * 2.2);
    }
  }

  /** Heeled over, the sea washes along her low side: a band of water in over the rail and foam along it. */
  private drawListWash(p: HullPiece, xw: number, age: number): void {
    const list = this.list(age);
    if (list < 0.05) return;
    const g = this.surf;
    const s = this.listDir;
    const mid = this.mid;
    const geo = this.geom;
    const a = Math.max(geo.stern + 0.2, p.wetLo ? xw : p.lo);
    const b = Math.min(geo.tip - 0.3, p.wetLo ? p.hi : xw);
    if (b - a < 0.3) return;
    const N = 14;
    const outer: Vec[] = [];
    const inner: Vec[] = [];
    for (let i = 0; i <= N; i++) {
      const x = a + ((b - a) * i) / N;
      const h = this.half(x);
      const depth = (0.22 + 0.12 * Math.sin(age * 2.4 + x * 1.7)) * list;
      outer.push(this.at(p, x, mid + s * (h - 0.04)));
      inner.push(this.at(p, x, mid + s * (h - 0.04 - depth)));
    }
    g.fillStyle(WASH, 0.62 * list).fillPoints([...outer, ...inner.reverse()], true);
    g.lineStyle(1.8, FOAM, 0.7 * list).strokePoints(inner.reverse(), false);
    g.lineStyle(2.6, FOAM, 0.4 * list).strokePoints(outer, false);
  }

  /** Foam hugging what is still afloat of a piece. */
  private drawRim(p: HullPiece, xw: number, age: number): void {
    const dryEnd = (x: number) => (p.wetLo ? x > xw && x <= p.hi + 0.01 : x < xw && x >= p.lo - 0.01);
    const n = this.rim.length;
    let startAt = this.rim.findIndex((r) => !dryEnd(r.x));
    if (startAt < 0) startAt = 0;
    for (let ring = 0; ring < 2; ring++) {
      const pts: Vec[] = [];
      for (let j = 1; j <= n; j++) {
        const i = (startAt + j) % n;
        const r = this.rim[i];
        if (!dryEnd(r.x)) {
          if (pts.length > 1) break;
          pts.length = 0;
          continue;
        }
        const out = 0.1 + ring * 0.13 + 0.05 * Math.sin(age * 2.2 + i * 0.7 + ring);
        pts.push(this.at(p, r.x + r.nx * out, r.y + r.ny * out));
      }
      if (pts.length > 1) this.under.lineStyle(2 - ring * 0.6, FOAM, 0.34 - ring * 0.1).strokePoints(pts, false);
    }
  }

  private updateMasts(age: number, dt: number): void {
    const roll = this.host.roll();
    const mid = this.mid;
    for (const m of this.masts) {
      const sp = m.spar;
      const p = m.piece;
      if (m.state !== 'down') {
        m.base = this.at(p, sp.mast.x, mid);
        const tip = this.at(p, sp.mast.x + m.dir.x, mid + m.dir.y);
        const dl = Math.hypot(tip.x - m.base.x, tip.y - m.base.y) || 1;
        const dx = (tip.x - m.base.x) / dl;
        const dy = (tip.y - m.base.y) / dl;
        const k = clamp01((age - m.start) / m.dur);
        if (k > 0 && m.state === 'up') {
          m.state = 'falling';
          this.sound('mast', 0.6, m.base.x);
        }
        const fall = (Math.PI / 2) * k * k;
        const reach = m.len * Math.sin(fall);
        // Labouring as she goes: the masts working against their stays before they part.
        const work = m.state === 'up' ? Math.sin(age * 3.3 + sp.mast.x) * 0.025 * this.calm * Math.min(1, age) : 0;
        m.rot = p.img.rotation + work + m.spin * k * k * (0.5 + 0.5 * this.calm);
        m.scale = 1 - 0.15 * Math.sin(fall);
        m.head = { x: m.base.x + dx * reach, y: m.base.y + dy * reach + roll * Math.cos(fall) };
        if (k >= 1) {
          m.state = 'down';
          m.downAt = age;
          m.drift = { x: dx * 7 + WIND.x * 0.3, y: dy * 7 };
          m.img.setDepth(DEPTH.flotsam + 0.005);
          m.furl?.img.setDepth(DEPTH.flotsam + 0.006);
          this.splash(m.head.x, m.head.y, true, 0.55);
          const mx = m.base.x + (m.head.x - m.base.x) * 0.7;
          const my = m.base.y + (m.head.y - m.base.y) * 0.7;
          this.host.hooks.splash(mx, my, false);
          this.ring(mx, my, 1.2);
          if (this.calm >= 1) this.host.hooks.shake(140, 0.0025);
        }
      } else {
        // Afloat and drifting, rising and falling on the swell, the rigging dragging it slowly round.
        for (const pt of [m.base, m.head]) {
          pt.x += m.drift.x * dt;
          pt.y += m.drift.y * dt;
        }
        m.drift.x += (WIND.x * 0.3 - m.drift.x) * Math.min(1, dt * 0.6);
        m.drift.y *= 1 - Math.min(1, dt * 0.6);
        m.rot += 0.04 * dt * Math.sign(m.spin);
      }
      const bob = m.state === 'down' ? Math.sin(age * 1.7 + sp.mast.x) * 1.2 * this.calm : 0;
      const hy = m.head.y + bob;
      m.img.setPosition(m.head.x, hy).setRotation(m.rot).setScale(m.scale / ART_SCALE);
      const soak = m.state === 'down' ? clamp01((age - m.downAt) / 2) : 0;
      m.img.setTint(lerpColor(0xffffff, 0x7f9a96, soak));
      if (m.furl) {
        const c = Math.cos(m.rot);
        const s = Math.sin(m.rot);
        const fx = m.furl.dx * m.scale;
        const fy = m.furl.dy * m.scale;
        m.furl.img
          .setPosition(m.head.x + fx * c - fy * s, hy + fx * s + fy * c)
          .setRotation(m.rot)
          .setScale(m.scale / ART_SCALE)
          .setTint(lerpColor(0xffffff, 0x8fa6a0, soak));
      }
      // The mast itself, seen lengthwise as it goes over, and lying in the water once down.
      const g = m.state === 'down' ? this.under : this.aloft;
      const len = Math.hypot(m.head.x - m.base.x, hy - m.base.y);
      if (len > 3) {
        const w = this.T * (m.spar.main ? 0.17 : 0.14) * (m.state === 'down' ? 0.9 : 1);
        g.lineStyle(w, m.state === 'down' ? 0x47321c : POLE, 1).lineBetween(m.base.x, m.base.y, m.head.x, hy);
        g.lineStyle(w * 0.3, POLE_LIT, 0.6).lineBetween(m.base.x, m.base.y - w * 0.2, m.head.x, hy - w * 0.2);
        if (m.state === 'down') {
          // Foam where the water washes along it.
          g.lineStyle(w + 5, FOAM, 0.16 + 0.08 * Math.sin(age * 2 + m.spar.mast.x)).lineBetween(m.base.x, m.base.y, m.head.x, hy);
        }
      }
      this.drawSlackSail(m, hy, age);
    }
  }

  /** Her canvas, all the wind gone out of it: slatting from the yard, falling with the mast and spreading on the sea. */
  private drawSlackSail(m: Mast, hy: number, age: number): void {
    if (m.set < 0.05) return;
    const sp = m.spar;
    const flipS = this.host.flip ? -1 : 1;
    const T = this.T * m.scale;
    const c = Math.cos(m.rot);
    const s = Math.sin(m.rot);
    const rel = (v: Vec) => {
      const x = (v.x - sp.mast.x) * flipS * T;
      const y = (v.y - sp.mast.y) * T;
      return { x: m.head.x + x * c - y * s, y: hy + x * s + y * c };
    };
    const a = rel(sp.a);
    const b = rel(sp.b);
    const bx = sp.belly.x * flipS * c - sp.belly.y * s;
    const by = sp.belly.x * flipS * s + sp.belly.y * c;
    if (m.state === 'down') {
      // Spread on the sea from the yard back along the mast, soaking and going under.
      const k = clamp01((age - m.downAt) / 2.2);
      const tx = m.base.x - m.head.x;
      const ty = m.base.y - hy;
      const tl = Math.hypot(tx, ty) || 1;
      const reach = Math.min(tl * 0.4, T * 0.9) * (0.6 + 0.4 * k);
      const ux = (tx / tl) * reach;
      const uy = (ty / tl) * reach;
      const N = 8;
      const pts: Vec[] = [a];
      for (let i = 0; i <= N; i++) {
        const v = 1 - i / N;
        const w = 0.28 * Math.sin(v * 7 + age * 1.5 + sp.mast.x) + 0.12 * Math.sin(v * 17 - age);
        pts.push({ x: a.x + (b.x - a.x) * v + ux * (0.75 + w + 0.25 * Math.sin(Math.PI * v)), y: a.y + (b.y - a.y) * v + uy * (0.75 + w + 0.25 * Math.sin(Math.PI * v)) });
      }
      pts.push(a);
      pts.splice(1, 0, b);
      const alpha = 0.42 * (1 - k);
      if (alpha <= 0.01) return;
      const g = this.under;
      g.fillStyle(lerpColor(CLOTH, 0x8fb4aa, k * 0.8), alpha).fillPoints(pts, true);
      g.lineStyle(1, CLOTH_SEAM, alpha * 0.8);
      for (let i = 1; i < 4; i++) {
        const v = i / 4;
        const r = { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
        g.lineBetween(r.x, r.y, r.x + ux * 0.8, r.y + uy * 0.8);
      }
      g.lineStyle(1.4, FOAM, alpha * 0.6).strokePoints(pts, true);
      return;
    }
    const fall = clamp01((age - m.start) / m.dur);
    const slack = 1 - 0.75 * clamp01(age / 1.4);
    const depth = BELLY[sp.kind] * m.set * slack * (1 - fall * 0.6) * T;
    const alpha = 0.92;
    const flutter = 0.07 * (0.5 + 0.5 * this.calm);
    const g = this.aloft;
    const N = 12;
    const pts: Vec[] = [];
    for (let i = 0; i <= N; i++) {
      const v = i / N;
      const edge = Math.abs(v - 0.5) * 2;
      const d = depth * Math.pow(Math.sin(Math.PI * v), 0.75) + flutter * T * (0.4 + edge) * Math.sin(age * 13 + v * 9 + sp.mast.x);
      pts.push({ x: a.x + (b.x - a.x) * v + bx * d, y: a.y + (b.y - a.y) * v + by * d });
    }
    g.fillStyle(CLOTH, alpha).fillPoints(pts, true);
    g.lineStyle(1.2, CLOTH_SEAM, 0.7 * alpha).strokePoints(pts, true);
  }

  private updateHands(age: number, dt: number): void {
    const T = this.T;
    const mix = 0.55 + 0.45 * this.calm;
    for (const h of this.hands) {
      const s = h.sprite;
      if (h.state === 'deck' || h.state === 'run') {
        if (age >= h.run && h.state === 'deck') h.state = 'run';
        const k = h.state === 'run' && !h.thrown ? clamp01((age - h.run) / Math.max(0.01, h.jump - h.run)) : 0;
        const x = h.from.x + (h.rail.x - h.from.x) * k;
        const y = h.from.y + (h.rail.y - h.from.y) * k;
        const p = this.at(h.piece, x, y + 0.3);
        if (Math.abs(p.x - s.x) > 0.3) h.face = Math.sign(p.x - s.x);
        s.setPosition(p.x, p.y).setFlipX(h.face < 0);
        const frame = h.state === 'run' ? `${h.prefix}:walk${Math.floor(age * 12 + h.id) % 4}` : `${h.prefix}:idle${Math.floor(age * 1.1 + h.id * 0.37) % 2}`;
        if (s.texture.key !== frame) s.setTexture(frame);
        if (age >= h.jump) {
          h.state = 'leap';
          h.p0 = { x: s.x, y: s.y };
          if (h.thrown) {
            const c = this.at(h.piece, h.piece.wetLo ? h.piece.lo : h.piece.hi, this.mid);
            let dx = s.x - c.x;
            let dy = s.y - c.y;
            const d = Math.hypot(dx, dy) || 1;
            dx /= d;
            dy /= d;
            const r = T * rnd(1.4, 2.4);
            h.p1 = { x: s.x + dx * r, y: s.y + dy * r * 0.8 + (dy >= 0 ? T : -T) * 0.6 };
          } else h.p1 = this.at(h.piece, h.water.x, h.water.y);
          h.face = Math.sign(h.p1.x - h.p0.x) || h.face;
        }
        continue;
      }
      if (h.state === 'leap') {
        const k = clamp01((age - h.jump) / Math.max(0.01, h.land - h.jump));
        const height = (h.thrown ? T * 1.4 : T * 0.55) * mix;
        const x = h.p0.x + (h.p1.x - h.p0.x) * k;
        const y = h.p0.y + (h.p1.y - h.p0.y) * k - Math.sin(Math.PI * k) * height;
        const frame = `${h.prefix}:${h.thrown ? 'fight1' : 'walk1'}`;
        if (s.texture.key !== frame) s.setTexture(frame);
        s.setPosition(x, y)
          .setScale(h.scale * (1 + 0.3 * Math.sin(Math.PI * k)))
          .setRotation(h.thrown ? (age - h.jump) * 7 * h.face * mix : h.face * k * 1.3)
          .setFlipX(h.face < 0)
          .setDepth(4.5 + y / 10000);
        if (k >= 1) this.enterWater(h);
        continue;
      }
      // Swimming: head and shoulders above the water, striking out for the victor.
      h.phase += dt * 1.6;
      const sp = Math.hypot(h.vx, h.vy);
      if (this.host.toward && sp > 0) {
        const d = Math.hypot(this.host.toward.x - h.x, this.host.toward.y - h.y);
        // Treading water once alongside.
        if (d < T * 0.9) {
          h.vx *= 1 - Math.min(1, dt * 2);
          h.vy *= 1 - Math.min(1, dt * 2);
        }
      }
      const surge = 0.65 + 0.35 * Math.max(0, Math.sin(h.phase * Math.PI * 2));
      h.x += h.vx * dt * surge;
      h.y += h.vy * dt * surge;
      const up = clamp01((age - h.land) / 0.35);
      const bob = Math.sin(h.phase * Math.PI * 2) * 1.2 * mix;
      s.setPosition(h.x, h.y + bob + (1 - up) * 4)
        .setAlpha(up)
        .setRotation(Math.sin(h.phase * Math.PI * 2) * 0.1 * mix)
        .setFlipX(h.vx < 0);
      this.drawSwimmer(h, age, up);
    }
  }

  private enterWater(h: Hand): void {
    const s = h.sprite;
    h.state = 'swim';
    h.x = h.p1.x;
    h.y = h.p1.y;
    this.splash(h.x, h.y, false, 0.22);
    // Only the head and shoulders show above the water.
    const frame = `${h.prefix}:idle0`;
    if (s.texture.key !== frame) s.setTexture(frame);
    const cut = 0.4;
    s.setCrop(0, 0, CREW_W, CREW_H * cut)
      .setOrigin(0.5, cut)
      .setScale(h.scale)
      .setRotation(0)
      .setDepth(DEPTH.swim)
      .setAlpha(0);
    // Away from the wreck, toward the victor if there is one to swim for.
    const goal = this.host.toward;
    let ax: number;
    let ay: number;
    if (goal) {
      const off = rnd(-1.6, 1.6) * this.T;
      ax = goal.x - h.x;
      ay = goal.y + off - h.y;
    } else {
      ax = h.p1.x - h.p0.x;
      ay = h.p1.y - h.p0.y;
    }
    const d = Math.hypot(ax, ay) || 1;
    const v = rnd(26, 34) * (this.T / 42);
    h.vx = (ax / d) * v;
    h.vy = (ay / d) * v;
  }

  private drawSwimmer(h: Hand, age: number, up: number): void {
    const g = this.under;
    const w = this.wash;
    const T = this.T;
    const k = (age * 0.8 + h.phase * 0.13) % 1;
    g.lineStyle(1.4, FOAM, 0.42 * (1 - k) * up).strokeEllipse(h.x, h.y, T * (0.3 + k * 0.6), T * (0.12 + k * 0.24));
    // A little wake behind, opening out.
    const sp = Math.hypot(h.vx, h.vy);
    if (sp > 2) {
      const bx = -h.vx / sp;
      const by = -h.vy / sp;
      const nx = -by;
      const ny = bx;
      const L = T * 0.45;
      g.lineStyle(1.2, FOAM, 0.32 * up);
      for (const s of [-1, 1]) g.lineBetween(h.x + bx * T * 0.1, h.y + by * T * 0.1, h.x + bx * L + nx * s * T * 0.16, h.y + by * L + ny * s * T * 0.16);
    }
    // The water round the shoulders, and the splash of each stroke.
    w.fillStyle(FOAM, 0.6 * up).fillEllipse(h.x, h.y, T * 0.36, T * 0.1);
    w.fillStyle(0x2a6e6c, 0.5 * up).fillEllipse(h.x, h.y + T * 0.04, T * 0.3, T * 0.06);
    const st = (h.phase * 2) % 1;
    const side = Math.floor(h.phase * 2) % 2 ? 1 : -1;
    const dir = h.vx >= 0 ? 1 : -1;
    w.fillStyle(FOAM, 0.75 * (1 - st) * up).fillCircle(h.x + dir * T * 0.16 + side * 2, h.y + side * T * 0.05 - st * 2, 1.4 + st * 1.6);
  }

  /** Wreckage working up out of her as she goes: planks, casks, a hatch cover, a spar. */
  private spawnFlotsam(age: number): void {
    if (age < this.nextFlot || age > this.gone + 0.3) return;
    const p = this.host.pieces[Math.floor(Math.random() * this.host.pieces.length)];
    const xw = this.waterX(p);
    const x = xw + (p.wetLo ? -1 : 1) * rnd(0, 0.5);
    const y = this.mid + rnd(-1, 1) * (this.half(xw) + 0.3);
    const q = this.at(p, x, y);
    const first = this.flots.filter((f) => f.z <= 0 && f.vz === 0).length;
    const order = ['wreck:plank', 'wreck:barrel', 'wreck:hatch', 'wreck:plank', 'wreck:crate', 'wreck:spar', 'wreck:plank', 'wreck:barrel', 'wreck:timber', 'wreck:plank'];
    const key = order[first % order.length];
    const out = Math.atan2(q.y - this.at(p, x, this.mid).y, 0.001) + rnd(-0.8, 0.8);
    const f = this.addFlot(key, q.x, q.y, Math.cos(out) * rnd(4, 12), Math.sin(out) * rnd(6, 14), this.kind === 'explode' && Math.random() < 0.35 ? 0.7 : 0);
    f.img.setAlpha(0);
    this.ring(q.x, q.y, 0.7, 1);
    this.nextFlot = age + (age > this.gone - 1.2 ? rnd(0.12, 0.25) : rnd(0.28, 0.5));
  }

  private updateFlotsam(age: number, dt: number): void {
    const mix = 0.55 + 0.45 * this.calm;
    for (const f of this.flots) {
      const img = f.img;
      if (f.vz !== 0 || f.z > 0) {
        // Thrown up by the blast: arcing, tumbling, and down into the sea with a splash.
        f.vz -= 520 * dt;
        f.z += f.vz * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        img.rotation += f.spin * dt;
        if (f.z <= 0) {
          f.z = 0;
          f.vz = 0;
          f.vx *= 0.08;
          f.vy *= 0.08;
          f.spin = rnd(-0.3, 0.3);
          f.born = age - 1;
          img.setDepth(DEPTH.flotsam);
          this.splash(f.x, f.y, false, this.splashes < 5 ? 0.16 : 0);
        } else {
          img.setPosition(f.x, f.y - f.z).setScale(f.size * (1 + f.z / 260));
          if (f.heat > 0) {
            flame(this.airFire, f.x, f.y - f.z, this.T * 0.2, age * 1.3 + f.phase);
            this.host.hooks.burn(f.key, new Phaser.Geom.Rectangle(f.x - 4, f.y - f.z - 4, 8, 8), f.heat, dt);
          }
          continue;
        }
      }
      // Afloat: drifting off on the swell, turning slowly, rising and falling.
      f.vx += (WIND.x * 0.28 - f.vx) * Math.min(1, dt * 0.35);
      f.vy *= 1 - Math.min(1, dt * 0.35);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      img.rotation += f.spin * dt;
      const pop = clamp01((age - f.born) / 0.4);
      const bob = Math.sin(age * 1.6 + f.phase) * 1.1 * mix;
      img.setPosition(f.x, f.y + bob).setScale(f.size * (0.6 + 0.4 * pop), f.size * (0.6 + 0.4 * pop) * (1 + 0.04 * Math.sin(age * 2.3 + f.phase)));
      img.setAlpha(pop);
      const w = img.displayWidth;
      this.under.fillStyle(FOAM, 0.16 * pop + 0.08 * Math.sin(age * 2 + f.phase)).fillEllipse(f.x, f.y + bob + 1, w * 0.9 + 6, img.displayHeight * 0.6 + 6);
      if (f.heat > 0.05) {
        // Some burn on to the waterline; the rest gutter out.
        f.heat = f.phase > 3 ? Math.max(0.3, f.heat - dt * 0.05) : f.heat - dt * 0.25;
        flame(this.fire, f.x, f.y + bob, this.T * (0.14 + 0.12 * f.heat), age + f.phase);
        this.host.hooks.burn(f.key, new Phaser.Geom.Rectangle(f.x - 5, f.y + bob - 5, 10, 10), f.heat, dt);
      }
    }
  }

  /** Blown up: a column of black smoke over the wreck, and steam where the burning halves meet the sea. */
  private updateSmoke(age: number, dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      const k = (age - p.t0) / p.life;
      if (k >= 1) {
        p.img.destroy();
        this.puffs.splice(i, 1);
        continue;
      }
      p.vx += WIND.x * dt * 0.8;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.img
        .setPosition(p.x, p.y)
        .setScale(p.s0 + (p.s1 - p.s0) * Math.sqrt(k))
        .setAlpha(p.peak * (k < 0.12 ? k / 0.12 : Math.pow(1 - (k - 0.12) / 0.88, 1.3)));
      p.img.rotation += dt * 0.2;
    }
    if (this.kind !== 'explode') return;
    const ps = this.host.pieces;
    const T = this.T;
    // Flames along the broken ends until the water puts them out.
    if (waterline(this.kind, age) < 1) {
      for (const p of ps) {
        const xw = this.waterX(p);
        const hw = this.half(xw);
        for (let i = 0; i < 3; i++) {
          const q = this.at(p, xw + (p.wetLo ? 1 : -1) * (0.25 + 0.1 * i), this.mid + (i - 1) * hw * 0.55);
          flame(this.surf, q.x, q.y, T * 0.24 * (1 - clamp01((age - 2) / 2)), age + i * 1.7);
        }
      }
    }
    if (age < this.nextPuff || age > 5.6) return;
    const c = ps.length > 1 ? mean(this.at(ps[0], ps[0].lo, this.mid), this.at(ps[1], ps[1].hi, this.mid)) : this.at(ps[0], (ps[0].lo + ps[0].hi) / 2, this.mid);
    const strength = 1 - clamp01((age - 2.5) / 3.5) * 0.6;
    this.nextPuff = age + 0.07;
    if (this.puffs.length > 46) return;
    const img = this.scene.add.image(0, 0, Math.random() < 0.85 ? 'fx:soot' : 'fx:smoke').setDepth(DEPTH.smoke).setRotation(rnd(0, 6));
    this.puffs.push({ img, t0: age, life: rnd(2.6, 3.6), x: c.x + rnd(-T, T) * 0.6, y: c.y + rnd(-T, T) * 0.3, vx: rnd(-6, 6), vy: -rnd(60, 90), s0: rnd(0.35, 0.5), s1: rnd(1.6, 2.3), peak: rnd(0.5, 0.7) * strength });
    // Steam off the burning ends as the sea takes them.
    if (Math.random() < 0.25 && age > 1.6 && age < this.gone) {
      const p = ps[Math.floor(Math.random() * ps.length)];
      const q = this.at(p, this.waterX(p), this.mid + rnd(-1, 1) * this.half(this.waterX(p)));
      const st = this.scene.add.image(0, 0, 'fx:smoke').setDepth(DEPTH.smoke - 0.01);
      this.puffs.push({ img: st, t0: age, life: rnd(1.4, 2), x: q.x, y: q.y, vx: rnd(-6, 6), vy: -rnd(18, 30), s0: 0.4, s1: 1.4, peak: 0.4 });
    }
  }

  private drawRings(age: number): void {
    const T = this.T;
    for (const r of this.rings) {
      const k = (age - r.t0) / r.life;
      if (k < 0 || k >= 1) continue;
      for (let i = 0; i < 2; i++) {
        const kk = clamp01(k * 1.2 - i * 0.2);
        if (kk <= 0) continue;
        this.under.lineStyle(2 - i * 0.6, FOAM, 0.6 * (1 - kk)).strokeEllipse(r.x, r.y, T * r.size * (0.3 + kk * 1.3), T * r.size * (0.14 + kk * 0.6));
      }
    }
  }

  /** Her colours, last of all: the ensign hangs on as she goes, then is gone too. */
  private updateEnsign(age: number): void {
    const { strips, ensign } = this.host;
    if (!strips.length) return;
    const p = this.pieceFor(this.geom.stern + 0.1);
    const staff = this.at(p, this.geom.stern + 0.1, this.mid);
    // Going down by the stern, the sea takes her colours with the taffrail rather than leaving them standing in it.
    if (this.staffWet === Infinity && !this.dry(this.geom.stern + 0.1)) this.staffWet = age;
    const k = clamp01((age - Math.min(this.ensignDown, this.staffWet + 0.35)) / 0.5);
    const rot = p.img.rotation;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const ftex = strips[0].texture.getSourceImage();
    const sw = Math.ceil(ftex.width / strips.length);
    const flyPx = ftex.width / ART_SCALE;
    // Hanging limper as she goes.
    const amp = 2.4 * (1 - 0.5 * clamp01(age / 4)) * (0.5 + 0.5 * this.calm);
    strips.forEach((img, i) => {
      const d = Math.abs((i + 0.5) * sw - ensign.hoistX) / ART_SCALE;
      const lx = -ensign.hoistX / ART_SCALE;
      const ly = -ensign.hoistY / ART_SCALE + (d / flyPx) * amp * Math.sin(age * 6 - d * 0.16) + k * 3;
      img.setPosition(staff.x + lx * c - ly * s, staff.y + lx * s + ly * c).setRotation(rot).setAlpha(1 - k);
      img.setTint(lerpColor(0xffffff, 0x6f8f8a, k));
    });
    if (!this.dry(this.geom.stern + 0.1) && k < 1) {
      const kk = (age * 1.2) % 1;
      this.under.lineStyle(1.6, FOAM, 0.55 * (1 - kk) * (1 - k)).strokeEllipse(staff.x, staff.y, this.T * (0.25 + kk * 0.5), this.T * (0.1 + kk * 0.22));
    }
    if (k > 0 && !this.lastSeen) this.lastSeen = staff;
  }

  private airBurst(): void {
    const at = this.lastSeen ?? this.at(this.host.pieces[0], this.geom.stern, this.mid);
    this.lastSeen = at;
    this.splash(at.x, at.y, true, 0.5);
    this.ring(at.x + 8, at.y - 3, 1.1, 1.6);
    for (let i = 0; i < 4; i++) {
      const a = rnd(0, Math.PI * 2);
      const f = this.addFlot(i % 2 ? 'wreck:plank' : 'wreck:barrel', at.x + Math.cos(a) * 8, at.y + Math.sin(a) * 5, Math.cos(a) * rnd(10, 20), Math.sin(a) * rnd(8, 14), this.kind === 'explode' && i === 0 ? 0.6 : 0);
      f.img.setAlpha(0);
    }
  }

  /** The water closing over her: a slow swirl and air boiling up where she was. */
  private drawSwirl(age: number): void {
    const at = this.lastSeen;
    if (!at || age < this.gone) return;
    const k = clamp01((age - this.gone) / 1.8);
    const T = this.T;
    const g = this.under;
    for (let i = 0; i < 4; i++) {
      const r = T * (0.5 + i * 0.32) * (1 - 0.35 * k);
      const a0 = age * (2.2 - i * 0.3) + i * 1.7;
      g.lineStyle(2 - i * 0.3, FOAM, 0.55 * (1 - k) * (1 - i * 0.18));
      g.beginPath();
      for (let j = 0; j <= 10; j++) {
        const a = a0 + (j / 10) * 2.2;
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r * 0.45;
        if (j) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.strokePath();
    }
    const burst = clamp01((age - this.ensignDown - 0.1) / 1.4);
    if (burst > 0 && burst < 1) {
      for (let i = 0; i < 14; i++) {
        const kk = (burst * 1.6 + i / 14) % 1;
        const x = at.x + Math.sin(i * 7.3) * T * 0.5 * (0.4 + kk);
        const y = at.y + Math.cos(i * 3.1) * T * 0.22 * (0.4 + kk) - kk * 3;
        g.fillStyle(FOAM, 0.7 * (1 - kk) * (1 - burst)).fillCircle(x, y, 1.5 + kk * 3);
      }
      g.fillStyle(FOAM, 0.3 * (1 - burst)).fillEllipse(at.x, at.y, T * (0.6 + burst), T * (0.25 + burst * 0.4));
    }
  }
}

function mean(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function lerpColor(a: number, b: number, k: number): number {
  const t = clamp01(k);
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function flame(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, t: number): void {
  if (s <= 0.5) return;
  const sway = Math.sin(t * 7) * s * 0.15;
  const flick = 1 + 0.15 * Math.sin(t * 11);
  const layers: [number, number, number][] = [
    [0xd8341a, 1, 0.9],
    [0xff8a1f, 0.72, 0.95],
    [0xffd24a, 0.42, 1],
  ];
  for (const [color, k, a] of layers) {
    const w = s * 0.55 * k;
    const h = s * 1.15 * k * flick;
    g.fillStyle(color, a);
    g.fillCircle(x, y, w);
    g.fillTriangle(x - w, y, x + w, y, x + sway, y - h - w * 0.4);
  }
}

// --- Wreckage art -----------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, paint: (c: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  paint(tex.getContext());
  tex.refresh();
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const INK = '#2a1708';

/** Floating wreckage, painted once a game at twice the size it is shown. */
export function wreckTextures(scene: Phaser.Scene): void {
  canvas(scene, 'wreck:plank', 64, 14, (c) => {
    c.beginPath();
    c.moveTo(3, 3);
    c.lineTo(52, 3);
    c.lineTo(56, 1);
    c.lineTo(58, 5);
    c.lineTo(62, 6);
    c.lineTo(57, 9);
    c.lineTo(60, 12);
    c.lineTo(3, 11);
    c.closePath();
    c.fillStyle = '#b4834a';
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = 'rgba(90,55,25,0.6)';
    c.lineWidth = 1;
    for (const y of [5.5, 8.5]) {
      c.beginPath();
      c.moveTo(6, y);
      c.lineTo(50, y + 0.5);
      c.stroke();
    }
    c.fillStyle = '#3a2410';
    c.fillRect(10, 6, 2, 2);
    c.fillRect(44, 6, 2, 2);
  });
  canvas(scene, 'wreck:timber', 52, 24, (c) => {
    // A torn-off run of planking, three strakes wide, splintered at both ends.
    const tones = ['#9c6c3a', '#b07c44', '#8e6234'];
    for (let i = 0; i < 3; i++) {
      const y = 3 + i * 6;
      c.beginPath();
      c.moveTo(4 + i * 3, y);
      c.lineTo(44 - i * 4, y);
      c.lineTo(49 - i * 2, y + 3);
      c.lineTo(43 - i * 4, y + 6);
      c.lineTo(2 + i * 2, y + 6);
      c.lineTo(5 + i * 3, y + 3);
      c.closePath();
      c.fillStyle = tones[i];
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 1.2;
      c.stroke();
    }
    c.fillStyle = 'rgba(20,10,4,0.55)';
    c.fillRect(30, 4, 10, 14);
  });
  canvas(scene, 'wreck:barrel', 40, 26, (c) => {
    rrect(c, 2, 2, 36, 22, 9);
    const g = c.createLinearGradient(0, 2, 0, 24);
    g.addColorStop(0, '#b07a44');
    g.addColorStop(0.5, '#8a5a2c');
    g.addColorStop(1, '#5e3a1a');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = '#2e2a26';
    c.lineWidth = 2.4;
    for (const x of [8, 15, 25, 32]) {
      c.beginPath();
      c.moveTo(x, 3);
      c.lineTo(x, 23);
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,220,170,0.3)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(6, 8);
    c.lineTo(34, 8);
    c.stroke();
  });
  canvas(scene, 'wreck:crate', 28, 28, (c) => {
    c.fillStyle = '#a07040';
    c.fillRect(2, 2, 24, 24);
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.strokeRect(2, 2, 24, 24);
    c.strokeStyle = 'rgba(70,40,15,0.8)';
    c.lineWidth = 1;
    for (const y of [8, 14, 20]) {
      c.beginPath();
      c.moveTo(3, y);
      c.lineTo(25, y);
      c.stroke();
    }
    c.strokeStyle = '#5a3a1a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(4, 4);
    c.lineTo(24, 24);
    c.stroke();
  });
  canvas(scene, 'wreck:hatch', 36, 36, (c) => {
    c.fillStyle = '#7a5428';
    c.fillRect(2, 2, 32, 32);
    c.strokeStyle = INK;
    c.lineWidth = 1.6;
    c.strokeRect(2, 2, 32, 32);
    c.fillStyle = '#20140a';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) c.fillRect(6 + i * 7, 6 + j * 7, 4.5, 4.5);
    c.strokeStyle = 'rgba(255,220,170,0.25)';
    c.lineWidth = 1;
    c.strokeRect(4, 4, 28, 28);
  });
  canvas(scene, 'wreck:spar', 96, 12, (c) => {
    const g = c.createLinearGradient(0, 2, 0, 10);
    g.addColorStop(0, '#a87644');
    g.addColorStop(0.5, '#6b4423');
    g.addColorStop(1, '#3e2512');
    rrect(c, 2, 2, 92, 8, 4);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1.4;
    c.stroke();
    c.fillStyle = '#2e2a26';
    c.fillRect(20, 2, 3, 8);
    c.fillRect(74, 2, 3, 8);
    // A trailing end of rope.
    c.strokeStyle = '#c9b48a';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(94, 6);
    c.quadraticCurveTo(90, 11, 84, 10);
    c.stroke();
  });
}
