import Phaser from 'phaser';
import type { Crew, Ship } from '../sim/Ship';
import type { RoomDef, SystemId, Vec } from '../sim/types';
import { CREW_ORIGIN, crewFrame, crewTextures } from './CrewArt';
import { ART_SCALE, paintShip, type Ensign, type ShipGeometry } from './ShipArt';
import { COLORS, TITLE_FONT, textStyle } from './theme';

export interface ShipViewState {
  selected?: Set<number>;
  hoverRoom?: string | null;
  /** Guns aimed at rooms on this ship: ours (bold reticle) or the enemy's (a warning marker), with how loaded each is. */
  targets?: AimMark[];
  /** Highlight rooms as aimable (a gun is selected). */
  aiming?: boolean;
  /** Every crew member still alive on either side; anyone who drops out of this has died rather than crossed over. */
  alive?: Set<number>;
}

export interface AimMark {
  room: string;
  /** Gun number shown on the marker (1-based). */
  gun: number;
  /** 0..1 loaded. */
  charge: number;
  hostile: boolean;
}

/** How a ship leaves the fight: going down, or sailing off over the horizon. */
export type Finale = 'sink' | 'explode' | 'sail';

export interface ShipViewOptions {
  showLabels?: boolean;
  flag?: Ensign;
}

/** Draw order of a ship's layers. Projectiles and effects in the battle scene sit above these. */
const DEPTH = { wake: 1, base: 2, over: 3, crew: 4, rig: 5, ui: 6 } as const;

let viewCount = 0;

interface Scorch {
  x: number;
  y: number;
  r: number;
  rot: number;
}

/** Draws one ship top-down. The player's bow points right; `flip` turns the enemy to face left. */
export class ShipView {
  private readonly wake: Phaser.GameObjects.Graphics;
  private readonly over: Phaser.GameObjects.Graphics;
  private readonly ui: Phaser.GameObjects.Graphics;
  private readonly base: Phaser.GameObjects.Image;
  private readonly rig: Phaser.GameObjects.Image;
  private readonly nameText: Phaser.GameObjects.Text | null;
  private readonly badges = new Map<SystemId, Phaser.GameObjects.Image>();
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();
  private readonly facing = new Map<number, { x: number; dir: number }>();
  private readonly scorches: Scorch[] = [];
  private readonly scars: Scorch[] = [];
  /** Scorches and hull scars, painted into a texture only when one is added, which then rides with the ship. */
  private marks: Phaser.GameObjects.RenderTexture | null = null;
  private marksPen: Phaser.GameObjects.Graphics | null = null;
  private marksDirty = false;
  /** The gun deck's room, where the muzzles are. */
  private readonly gunRoom: RoomDef | undefined;
  private moveMarks: { at: Vec; t0: number }[] = [];
  /** When a bulwark last stopped a ball, for the flash. */
  private blockedAt = -10;
  private finale: { kind: Finale; t0: number } | null = null;
  /** When the ship started sailing into view, if she is still arriving. */
  private arrival: number | null = null;
  /** Offsets applied while the ship sinks or sails away. */
  private fx = 0;
  private fy = 0;
  private readonly geom: ShipGeometry;
  private readonly keys: string[];
  private readonly phase = Math.random() * 10;
  private bob = 0;

  constructor(
    readonly scene: Phaser.Scene,
    public ship: Ship,
    readonly ox: number,
    readonly oy: number,
    readonly tile: number,
    readonly flip: boolean,
    showLabelsOrOpts: boolean | ShipViewOptions = true,
  ) {
    const opts: ShipViewOptions = typeof showLabelsOrOpts === 'boolean' ? { showLabels: showLabelsOrOpts } : showLabelsOrOpts;
    const showLabels = opts.showLabels ?? true;
    const flag = opts.flag ?? (ship.side === 'player' ? 'pirate' : 'navy');
    const art = paintShip(scene, ship, tile, `shipart:${viewCount++}`, flag);
    this.geom = art.geom;
    this.keys = [art.base, art.rig];
    this.gunRoom = [...ship.rooms.values()].find((r) => r.def.system === 'guns')?.def;

    this.wake = scene.add.graphics().setDepth(DEPTH.wake);
    this.base = scene.add.image(0, 0, art.base).setOrigin(0).setScale(1 / ART_SCALE).setFlipX(flip).setDepth(DEPTH.base);
    this.over = scene.add.graphics().setDepth(DEPTH.over);
    this.rig = scene.add.image(0, 0, art.rig).setOrigin(0).setScale(1 / ART_SCALE).setFlipX(flip).setDepth(DEPTH.rig).setAlpha(0.9);
    this.ui = scene.add.graphics().setDepth(DEPTH.ui);

    if (showLabels) {
      for (const sys of ship.systems.values()) {
        this.badges.set(sys.id, scene.add.image(0, 0, systemIcon(scene, sys.id)).setScale(0.5).setDepth(DEPTH.ui).setOrigin(0.5));
      }
      const nx = this.toScreen({ x: ship.width / 2, y: 0 }).x;
      this.nameText = scene.add
        .text(nx, oy - (this.geom.beam - ship.height / 2) * tile - 22, ship.def.name, {
          fontFamily: TITLE_FONT,
          fontSize: `${Math.round(tile * 0.48)}px`,
          color: COLORS.gold,
          stroke: '#0b1622',
          strokeThickness: 5,
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.ui);
    } else {
      this.nameText = null;
    }
    this.placeImages();
  }

  /** Tile coordinates (fractional) to screen pixels. */
  toScreen(p: Vec): Vec {
    const x = this.flip ? this.ship.width - p.x : p.x;
    return { x: this.ox + this.fx + x * this.tile, y: this.oy + this.bob + this.fy + p.y * this.tile };
  }

  /** Screen pixels to fractional tile coordinates. */
  toTile(px: number, py: number): Vec {
    const x = (px - this.ox - this.fx) / this.tile;
    return { x: this.flip ? this.ship.width - x : x, y: (py - this.oy - this.bob - this.fy) / this.tile };
  }

  roomAt(px: number, py: number): string | null {
    const t = this.toTile(px, py);
    return this.ship.roomAt(Math.floor(t.x), Math.floor(t.y))?.def.id ?? null;
  }

  crewAt(px: number, py: number): Crew | null {
    let best: Crew | null = null;
    let bestD = this.tile * 0.45;
    for (const c of this.ship.crew) {
      const s = this.toScreen(c.pos);
      // Aim at the body, which stands a little above the tile centre.
      const d = Math.hypot(s.x - px, s.y - this.tile * 0.05 - py);
      if (d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  roomCenter(roomId: string): Vec {
    return this.toScreen(this.ship.roomCenter(roomId));
  }

  /** Screen rectangle of a room. */
  roomRect(roomId: string): Phaser.Geom.Rectangle {
    const d = this.ship.room(roomId).def;
    const a = this.toScreen({ x: d.x, y: d.y });
    const b = this.toScreen({ x: d.x + d.w, y: d.y + d.h });
    return new Phaser.Geom.Rectangle(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y);
  }

  /** Muzzle of the cannon that stands for gun `index`, and the way it points. */
  muzzle(index: number): { x: number; y: number; dx: number; dy: number } {
    const guns = this.gunRoom;
    if (!guns) {
      const c = this.toScreen({ x: this.ship.width / 2, y: this.ship.height / 2 });
      return { ...c, dx: 0, dy: -1 };
    }
    const col = index % guns.w;
    const top = Math.floor(index / guns.w) % 2 === 0 || guns.h === 1;
    const p = this.toScreen({ x: guns.x + col + 0.5, y: top ? guns.y + 0.3 - 0.4 : guns.y + guns.h - 0.3 + 0.4 });
    return { x: p.x, y: p.y, dx: 0, dy: top ? -1 : 1 };
  }

  /** Leave a scorch mark where a ball struck. */
  addScorch(roomId: string): void {
    const d = this.ship.room(roomId).def;
    this.scorches.push({
      x: d.x + 0.2 + Math.random() * (d.w - 0.4),
      y: d.y + 0.2 + Math.random() * (d.h - 0.4),
      r: 0.18 + Math.random() * 0.16,
      rot: Math.random() * Math.PI,
    });
    if (this.scorches.length > 40) this.scorches.shift();
    this.marksDirty = true;
  }

  /** A cannonball through the side leaves a ragged scar in the planking near the room it struck. */
  addHullScar(roomId: string): void {
    const d = this.ship.room(roomId).def;
    const g = this.geom;
    const mid = this.ship.height / 2;
    const x = Math.max(g.stern + 0.4, Math.min(g.tip - 0.7, d.x + d.w / 2 + (Math.random() - 0.5) * d.w * 0.8));
    const side = d.y + d.h / 2 < mid ? -1 : d.y + d.h / 2 > mid ? 1 : Math.random() < 0.5 ? -1 : 1;
    this.scars.push({ x, y: mid + side * (g.half(x) - 0.1), r: 0.12 + Math.random() * 0.1, rot: Math.random() * Math.PI });
    if (this.scars.length > 30) this.scars.shift();
    this.marksDirty = true;
  }

  /** Sail in from off-screen over the next couple of seconds. */
  arrive(nowMs: number): void {
    this.arrival = nowMs / 1000;
    this.fx = (this.flip ? 1 : -1) * 600;
  }

  /** Begin the ship's exit: sinking, blowing apart, or sailing off. */
  startFinale(kind: Finale, nowMs: number): void {
    if (this.finale) return;
    this.finale = { kind, t0: nowMs / 1000 };
    this.nameText?.setVisible(false);
    for (const b of this.badges.values()) b.setVisible(false);
  }

  destroy(): void {
    for (const o of [this.wake, this.over, this.ui, this.base, this.rig, this.nameText, this.marks, this.marksPen, ...this.badges.values(), ...this.sprites.values()]) o?.destroy();
    for (const k of this.keys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
  }

  private placeImages(): void {
    const g = this.geom;
    const T = this.tile;
    const left = (this.flip ? this.ox - g.padR * T : this.ox - g.padL * T) + this.fx;
    const top = this.oy + this.bob + this.fy - g.padT * T;
    this.base.setPosition(left, top);
    this.rig.setPosition(left, top);
  }

  draw(timeMs: number, state: ShipViewState = {}): void {
    const t = timeMs / 1000;
    this.bob = Math.sin(t * 0.9 + this.phase) * 1.4;
    const fin = this.finaleProgress(t);
    this.placeImages();
    if (this.nameText) this.nameText.setY(this.oy + this.bob - (this.geom.beam - this.ship.height / 2) * this.tile - 22);

    const sails = this.ship.system('sails');
    const fade = fin && fin.kind !== 'sail' ? 1 - fin.k * 0.92 : 1;
    this.rig.setAlpha((sails ? 0.6 + 0.4 * (this.ship.capacity('sails') / sails.max) : 1) * (fin && fin.kind !== 'sail' ? Math.max(0, 1 - fin.k * 1.6) : 1));
    this.base.setAlpha(fade);
    this.over.setAlpha(fade);
    this.drawMarks(fade);
    if (fin && fin.kind !== 'sail') {
      // Darken and drown the hull as she goes.
      const c = Math.round(255 - fin.k * 150);
      const tint = (c << 16) | (Math.round(255 - fin.k * 110) << 8) | Math.round(255 - fin.k * 70);
      this.base.setTint(tint);
      this.rig.setTint(tint);
    }

    this.drawWake(t);
    this.drawOverlay(t, state);
    this.drawCrew(t, state, fade);
    if (fin) this.drawFinale(fin);
    else this.drawUi(t, state);
  }

  private finaleProgress(t: number): { kind: Finale; k: number; age: number } | null {
    if (this.arrival !== null && !this.finale) {
      const k = Math.min(1, (t - this.arrival) / 2.2);
      // Ease out: running in fast, then rounding up alongside.
      this.fx = (this.flip ? 1 : -1) * Math.pow(1 - k, 3) * 600;
      if (k >= 1) this.arrival = null;
      return null;
    }
    if (!this.finale) return null;
    const age = t - this.finale.t0;
    const { kind } = this.finale;
    const k = Math.max(0, Math.min(1, age / (kind === 'sail' ? 3 : 3.2)));
    if (kind === 'sail') {
      this.fx = (this.flip ? 1 : -1) * k * k * 520;
      this.fy = 0;
    } else {
      // Settle, then slide under.
      this.fy = Math.pow(k, 1.6) * this.tile * 0.9;
      this.fx = (this.flip ? 1 : -1) * k * this.tile * 0.3;
    }
    return { kind, k, age };
  }

  /** Smoke, fire and swirling water as she goes down; the markers and pips are gone by now. */
  private drawFinale(fin: { kind: Finale; k: number; age: number }): void {
    const g = this.ui;
    const T = this.tile;
    const geo = this.geom;
    const mid = this.ship.height / 2;
    g.clear();
    if (fin.kind === 'sail') return;
    const c = this.toScreen({ x: (geo.stern + geo.tip) / 2, y: mid });
    const len = (geo.tip - geo.stern) * T;
    // Churning water closing over her.
    for (let i = 0; i < 3; i++) {
      const kk = (fin.age * 0.6 + i / 3) % 1;
      g.lineStyle(2.5, 0xe8f4f8, 0.5 * (1 - kk) * Math.min(1, fin.k * 3));
      g.strokeEllipse(c.x, c.y, len * (0.8 + kk * 0.5), geo.beam * 2 * T * (0.9 + kk * 0.6));
    }
    for (let i = 0; i < 14; i++) {
      const kk = (fin.age * 0.8 + i / 14) % 1;
      const bx = c.x + Math.sin(i * 7.3) * len * 0.42;
      const by = c.y + Math.cos(i * 3.1) * geo.beam * T * 0.8 - kk * 10;
      g.fillStyle(0xe8f4f8, 0.6 * (1 - kk) * fin.k).fillCircle(bx, by, 2 + kk * 3);
    }
    // Black smoke boiling up from the wreck.
    for (let i = 0; i < 8; i++) {
      const kk = (fin.age * 0.35 + i / 8) % 1;
      const sx = c.x + Math.sin(i * 2.4) * len * 0.3 + kk * 30;
      const sy = c.y - kk * 140;
      g.fillStyle(0x1c1a18, 0.42 * (1 - kk) * (1 - fin.k * 0.5)).fillCircle(sx, sy, 10 + kk * 34);
    }
    if (fin.kind === 'explode' && fin.age < 1.6) {
      for (let i = 0; i < 6; i++) {
        const kk = (fin.age * 1.8 + i / 6) % 1;
        const ex = c.x + Math.sin(i * 5.1) * len * 0.35;
        const ey = c.y + Math.cos(i * 2.7) * geo.beam * T * 0.5;
        g.fillStyle(0xffc040, 0.8 * (1 - kk)).fillCircle(ex, ey, 6 + kk * 26);
        g.fillStyle(0xff5a1f, 0.6 * (1 - kk)).fillCircle(ex, ey, 3 + kk * 16);
      }
    }
  }

  // --- Layers --------------------------------------------------------------

  /**
   * Scorches and hull scars build up over a fight; redrawing dozens of ellipses every frame cost more than the rest of
   * the deck overlay, so they are painted into a texture when one is added and the texture just follows the ship.
   */
  private drawMarks(alpha: number): void {
    if (!this.scorches.length && !this.scars.length) return;
    const T = this.tile;
    const left = this.base.x;
    const top = this.base.y;
    if (!this.marks) {
      // Between the deck art and the overlay, where the water and fire are drawn over them.
      this.marks = this.scene.add.renderTexture(left, top, Math.ceil(this.base.displayWidth), Math.ceil(this.base.displayHeight)).setOrigin(0).setDepth((DEPTH.base + DEPTH.over) / 2);
      this.marksPen = this.scene.make.graphics({}, false);
    }
    if (this.marksDirty) {
      this.marksDirty = false;
      const g = this.marksPen!.clear();
      const at = (x: number, y: number) => {
        const p = this.toScreen({ x, y });
        return { x: p.x - left, y: p.y - top };
      };
      for (const s of this.scorches) {
        const p = at(s.x, s.y);
        g.fillStyle(0x140a04, 0.32).fillEllipse(p.x, p.y, s.r * T * 2, s.r * T * 1.4);
        g.fillStyle(0x140a04, 0.25).fillEllipse(p.x + Math.cos(s.rot) * 4, p.y + Math.sin(s.rot) * 3, s.r * T, s.r * T * 0.8);
      }
      for (const s of this.scars) {
        const p = at(s.x, s.y);
        const pts: Vec[] = [];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + s.rot;
          const rr = s.r * T * (0.7 + 0.35 * Math.sin(i * 2.9 + s.rot * 3));
          pts.push({ x: p.x + Math.cos(a) * rr * 1.3, y: p.y + Math.sin(a) * rr * 0.75 });
        }
        g.fillStyle(0x0a0604, 0.9).fillPoints(pts, true);
        g.lineStyle(1.5, 0xd2aa72, 0.85);
        for (let i = 0; i < 4; i++) {
          const a = s.rot + i * 1.6;
          g.lineBetween(p.x + Math.cos(a) * s.r * T * 0.8, p.y + Math.sin(a) * s.r * T * 0.45, p.x + Math.cos(a) * s.r * T * 1.5, p.y + Math.sin(a) * s.r * T * 0.8);
        }
      }
      this.marks.clear().draw(g, 0, 0);
    }
    this.marks.setPosition(left, top).setAlpha(alpha);
  }

  private drawWake(t: number): void {
    const g = this.wake;
    const geo = this.geom;
    const mid = this.ship.height / 2;
    g.clear();
    // Foam hugging the hull.
    for (let ring = 0; ring < 3; ring++) {
      const pts = geo.outline.map((p, i) => {
        const nx = p.x - (geo.stern + geo.tip) / 2;
        const ny = p.y - mid;
        const len = Math.hypot(nx * 0.35, ny) || 1;
        const out = 0.1 + ring * 0.12 + 0.05 * Math.sin(t * 2.2 + i * 0.7 + ring);
        return this.toScreen({ x: p.x + ((nx * 0.35) / len) * out, y: p.y + (ny / len) * out });
      });
      g.lineStyle(2 - ring * 0.5, 0xe8f4f8, 0.32 - ring * 0.09);
      g.strokePoints(pts, true);
    }
    // Bulwark layers: pale rings standing off the hull, one per layer, the next one filling as it recharges.
    const flash = Math.max(0, 1 - (t - this.blockedAt) / 0.5);
    const max = this.ship.level('bulwarks');
    if (!this.finale) {
      for (let i = 0; i < max; i++) {
        const ready = i < this.ship.layers;
        const charging = i === this.ship.layers;
        const alpha = ready ? 0.42 + 0.08 * Math.sin(t * 2 + i) : charging ? 0.25 * this.ship.layerCharge : 0;
        if (alpha <= 0 && flash <= 0) continue;
        const off = 0.42 + i * 0.16;
        const ring = geo.outline.map((p) => {
          const nx = p.x - (geo.stern + geo.tip) / 2;
          const ny = p.y - mid;
          const len = Math.hypot(nx * 0.35, ny) || 1;
          return this.toScreen({ x: p.x + ((nx * 0.35) / len) * off, y: p.y + (ny / len) * off });
        });
        g.lineStyle(2.5 + flash * 2, flash > 0 ? 0xffffff : 0xf0dca0, Math.min(1, alpha + flash * 0.6));
        g.strokePoints(ring, true);
      }
    }

    // Foam boiling off the bow, and a wake trailing astern.
    const dir = this.flip ? -1 : 1;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const k = (i + ((t * 0.9) % 1)) / 5;
        const x = geo.tip - 0.2 - k * 2.2;
        const p = this.toScreen({ x, y: mid + side * (geo.half(x) + 0.12 + k * 0.45) });
        g.fillStyle(0xe8f4f8, 0.3 * (1 - k));
        g.fillEllipse(p.x, p.y, this.tile * (0.55 + k * 0.5), this.tile * (0.18 + k * 0.2));
      }
    }
    const stern = this.toScreen({ x: geo.stern, y: mid });
    for (let i = 0; i < 6; i++) {
      const k = (i + ((t * 0.8) % 1)) / 6;
      g.fillStyle(0xe8f4f8, 0.22 * (1 - k));
      g.fillEllipse(stern.x - dir * this.tile * (0.4 + k * 3.2), stern.y + Math.sin(t * 1.3 + i) * 3, this.tile * (0.5 + k * 0.9), this.tile * (0.25 + k * 0.5));
    }
  }

  private drawOverlay(t: number, state: ShipViewState): void {
    const g = this.over;
    const T = this.tile;
    const ship = this.ship;
    g.clear();

    for (const room of ship.rooms.values()) {
      const r = this.roomRect(room.def.id);
      const sys = room.def.system ? ship.system(room.def.system) : undefined;

      if (room.water >= 1) {
        // Water reads as a level: a faint wash over the room that deepens with it, and the water itself
        // filling the room from the bottom edge up to a tide line, so a few inches look like a few inches.
        const level = Math.min(1, room.water / 100);
        g.fillStyle(0x1f7fc4, 0.04 + level * 0.2).fillRect(r.x, r.y, r.width, r.height);
        const top = r.bottom - Math.max(2, r.height * level);
        const wave = (x: number, y: number) => y + Math.sin(t * 3 + x * 0.25 + y) * 1.4;
        const waterline = (y: number) => {
          g.beginPath();
          for (let x = r.x + 2; x <= r.right - 2; x += 4) {
            if (x === r.x + 2) g.moveTo(x, wave(x, y));
            else g.lineTo(x, wave(x, y));
          }
          g.strokePath();
        };
        g.fillStyle(0x1f7fc4, 0.3 + level * 0.3).fillRect(r.x, top, r.width, r.bottom - top);
        g.lineStyle(1.5, 0xd8f0ff, 0.25 + level * 0.25);
        for (let y = top + 9; y < r.bottom - 3; y += 9) waterline(y);
        g.lineStyle(2, 0xe8f6ff, 0.85);
        waterline(top);
      }

      if (room.breach) {
        const c = this.roomCenter(room.def.id);
        const hx = c.x + T * 0.25;
        const hy = c.y + T * 0.12;
        const pts: Vec[] = [];
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const rr = T * (0.17 + 0.06 * Math.sin(i * 2.7));
          pts.push({ x: hx + Math.cos(a) * rr * 1.2, y: hy + Math.sin(a) * rr * 0.8 });
        }
        g.fillStyle(0x0a0d10, 1).fillPoints(pts, true);
        g.lineStyle(2, 0xc9a36a, 0.8);
        for (let i = 0; i < 5; i++) {
          const a = i * 1.3;
          g.lineBetween(hx + Math.cos(a) * T * 0.16, hy + Math.sin(a) * T * 0.1, hx + Math.cos(a) * T * 0.3, hy + Math.sin(a) * T * 0.2);
        }
        for (let i = 0; i < 4; i++) {
          const k = (t * 1.6 + i / 4) % 1;
          g.fillStyle(0xcfeaff, 0.6 * (1 - k)).fillCircle(hx + Math.sin(i * 2.1) * T * 0.15 * k, hy - T * 0.05 - k * T * 0.25, 2 + k * 3);
        }
      }

      if (room.fire > 0) {
        const k = room.fire / 100;
        g.fillStyle(0xff6a1a, 0.14 + 0.22 * k + 0.05 * Math.sin(t * 9 + r.x)).fillRect(r.x, r.y, r.width, r.height);
        g.fillStyle(0xffc040, 0.08 + 0.1 * k).fillRect(r.x + 3, r.y + 3, r.width - 6, r.height - 6);
        const n = Math.max(2, Math.ceil(k * room.def.w * room.def.h * 2));
        for (let i = 0; i < n; i++) {
          const fx = r.x + T * 0.2 + (((i * 0.618 + 0.13) % 1) * (r.width - T * 0.4));
          const fy = r.y + T * 0.3 + (((i * 0.371 + 0.4) % 1) * (r.height - T * 0.45));
          const s = T * (0.22 + 0.16 * k) * (1 + 0.15 * Math.sin(t * 11 + i * 3));
          flame(g, fx, fy, s, t + i);
        }
        for (let i = 0; i < 6; i++) {
          const kk = (t * 0.9 + i / 6) % 1;
          g.fillStyle(0xffb040, 0.9 * (1 - kk)).fillCircle(r.x + ((i * 0.37 + 0.2) % 1) * r.width + Math.sin(t * 3 + i) * 4, r.bottom - T * 0.2 - kk * r.height * 0.9, 1.6);
        }
        for (let i = 0; i < 3; i++) {
          const kk = (t * 0.45 + i / 3) % 1;
          g.fillStyle(0x2a2420, 0.3 * (1 - kk)).fillCircle(r.centerX + Math.sin(t + i * 2) * T * 0.4, r.y + r.height * 0.4 - kk * T * 1.2, T * (0.15 + kk * 0.3));
        }
      }

      if (sys && sys.damage > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        g.lineStyle(2, 0xe0452f, 0.45 + 0.35 * pulse).strokeRect(r.x + 2, r.y + 2, r.width - 4, r.height - 4);
        if (ship.capacity(sys.id) === 0) {
          // Sparks and a wisp of smoke from a wrecked station.
          for (let i = 0; i < 2; i++) {
            const kk = (t * 0.6 + i / 2) % 1;
            g.fillStyle(0x3a3530, 0.25 * (1 - kk)).fillCircle(r.centerX + T * 0.2 * (i - 0.5), r.centerY - kk * T * 0.8, T * (0.1 + kk * 0.2));
          }
        }
      }

      if (state.hoverRoom === room.def.id) {
        g.fillStyle(0xffffff, state.aiming ? 0.14 : 0.1).fillRect(r.x, r.y, r.width, r.height);
        g.lineStyle(2, state.aiming ? COLORS.aim : 0xf2c45a, 0.9).strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      }
    }

    // Selection rings at the feet, under the crew.
    for (const c of ship.crew) {
      if (!state.selected?.has(c.id)) continue;
      const p = this.toScreen(c.pos);
      const fy = p.y + T * 0.3;
      g.lineStyle(2.5, COLORS.select, 0.95).strokeEllipse(p.x, fy, T * 0.62, T * 0.24);
      g.fillStyle(COLORS.select, 0.18).fillEllipse(p.x, fy, T * 0.62, T * 0.24);
    }
  }

  private drawCrew(t: number, state: ShipViewState, fade = 1): void {
    const T = this.tile;
    const live = new Set<number>();
    const scale = (T / 42) * 0.5;
    for (const c of this.ship.crew) {
      live.add(c.id);
      let sprite = this.sprites.get(c.id);
      const prefix = crewTextures(this.scene, c);
      if (!sprite) {
        sprite = this.scene.add.image(0, 0, `${prefix}:idle0`).setOrigin(CREW_ORIGIN.x, CREW_ORIGIN.y).setScale(scale).setName(c.name).setData('ours', c.side === 'player');
        this.sprites.set(c.id, sprite);
      }
      const p = this.toScreen(c.pos);
      const fy = p.y + T * 0.3;
      const frame = `${prefix}:${crewFrame(c, t)}`;
      if (sprite.texture.key !== frame) sprite.setTexture(frame);
      sprite.setPosition(p.x, fy).setDepth(DEPTH.crew + fy / 10000);

      // Face the way they walk; otherwise keep facing as they were (bow-ward to start).
      const f = this.facing.get(c.id) ?? { x: p.x, dir: (this.flip ? -1 : 1) * (c.side === this.ship.side ? 1 : -1) };
      if (Math.abs(p.x - f.x) > 0.3) f.dir = Math.sign(p.x - f.x);
      f.x = p.x;
      this.facing.set(c.id, f);
      sprite.setFlipX(f.dir < 0);
      sprite.setAlpha((c.hp <= 0 ? 0.4 : 1) * fade);
      if (state.selected?.has(c.id)) sprite.setTint(0xfff4c8);
      else sprite.clearTint();
    }
    for (const [id, s] of this.sprites) {
      if (live.has(id)) continue;
      this.sprites.delete(id);
      const dir = this.facing.get(id)?.dir ?? 1;
      this.facing.delete(id);
      if (state.alive && !state.alive.has(id)) {
        // Fallen: topple over, then fade away.
        s.setTint(0xb0a090);
        this.scene.tweens.add({ targets: s, angle: -88 * dir, y: s.y - 2, duration: 380, ease: 'Quad.easeIn' });
        // Name the fallen where they drop, so a death in the melee is not missed.
        const label = this.scene.add.text(s.x, s.y - T * 0.9, `† ${s.name}`, textStyle(12, s.getData('ours') ? '#ff8a7a' : '#e8e0cc', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(0.5).setDepth(DEPTH.ui + 6);
        this.scene.tweens.add({ targets: label, y: label.y - 22, alpha: 0, delay: 600, duration: 1400, onComplete: () => label.destroy() });
        this.scene.tweens.add({ targets: s, alpha: 0, delay: 1400, duration: 900, onComplete: () => s.destroy() });
      } else s.destroy();
    }
  }

  private drawUi(t: number, state: ShipViewState): void {
    const g = this.ui;
    const T = this.tile;
    const ship = this.ship;
    g.clear();

    // System badges and power pips at each station's top-left corner.
    for (const [id, badge] of this.badges) {
      const sys = ship.system(id)!;
      const r = this.roomRect(sys.room);
      const bx = r.x + 11;
      const by = r.y + 11;
      badge.setPosition(bx, by);
      const out = ship.level(id) === 0;
      badge.setTint(sys.damage > 0 && ship.capacity(id) === 0 ? 0xff6a5a : out ? 0x9a9a9a : 0xffffff);
      const level = ship.level(id);
      const pip = 5;
      for (let i = 0; i < sys.max; i++) {
        const px = bx + 13 + i * (pip + 2);
        const py = by - pip / 2;
        const color = i >= sys.max - sys.damage ? COLORS.pipDamaged : i < level ? COLORS.pipOn : 0x2c2f33;
        g.fillStyle(0x000000, 0.55).fillRect(px - 1, py - 1, pip + 2, pip + 2);
        g.fillStyle(color, 1).fillRect(px, py, pip, pip);
      }
    }

    // Crew health and what they're doing, over their heads.
    for (const c of ship.crew) {
      const p = this.toScreen(c.pos);
      const headY = p.y + T * 0.3 - T * 0.95;
      const hurt = c.hp < c.maxHp;
      if (hurt || state.selected?.has(c.id)) {
        const bw = T * 0.5;
        const frac = Math.max(0, c.hp / c.maxHp);
        g.fillStyle(0x000000, 0.75).fillRect(p.x - bw / 2 - 1, headY - 1, bw + 2, 5);
        g.fillStyle(frac > 0.6 ? 0x6fd35a : frac > 0.3 ? 0xe5c23a : 0xe0452f, 1).fillRect(p.x - bw / 2, headY, bw * frac, 3);
      }
      const icon = c.task === 'fire' ? 0xff7a2a : c.task === 'breach' ? 0x6fb8ff : c.task === 'repair' ? 0xf0b040 : c.task === 'fight' ? 0xff4040 : c.task === 'sabotage' ? 0xb070ff : 0;
      if (icon) {
        const ix = p.x + T * 0.3;
        const iy = headY - 5;
        g.fillStyle(0x0b1622, 0.85).fillCircle(ix, iy, 5.5);
        g.fillStyle(icon, 1).fillCircle(ix, iy, 3.6);
      }
      if (c.side !== ship.side) {
        // Boarders get a coloured pennant so you can tell friend from foe in a melee.
        g.fillStyle(c.side === 'player' ? 0x151515 : 0xb3261e, 1).fillTriangle(p.x - 2, headY - 14, p.x - 2, headY - 6, p.x + 8, headY - 10);
      }
    }

    // Aim markers, one per targeted room, with a pip per gun that fills as it loads.
    if (state.targets?.length) {
      const byRoom = new Map<string, AimMark[]>();
      for (const m of state.targets) if (ship.rooms.has(m.room)) byRoom.set(m.room, [...(byRoom.get(m.room) ?? []), m]);
      for (const [roomId, marks] of byRoom) {
        const c = this.roomCenter(roomId);
        const hostile = marks[0].hostile;
        const rad = T * (hostile ? 0.26 : 0.34);
        const color = hostile ? 0xff8a3a : COLORS.aim;
        const ready = Math.max(...marks.map((m) => m.charge));
        const alpha = hostile ? 0.5 + (ready > 0.85 ? 0.45 * (0.5 + 0.5 * Math.sin(t * 14)) : 0) : 0.95;
        const spin = t * (hostile ? -1 : 1.5);
        g.lineStyle(2, color, alpha);
        for (let i = 0; i < 4; i++) {
          const a0 = spin + (i * Math.PI) / 2 + 0.25;
          g.beginPath();
          g.arc(c.x, c.y, rad, a0, a0 + Math.PI / 2 - 0.5);
          g.strokePath();
        }
        if (!hostile) {
          g.lineBetween(c.x - rad * 1.35, c.y, c.x - rad * 0.55, c.y).lineBetween(c.x + rad * 0.55, c.y, c.x + rad * 1.35, c.y);
          g.lineBetween(c.x, c.y - rad * 1.35, c.x, c.y - rad * 0.55).lineBetween(c.x, c.y + rad * 0.55, c.x, c.y + rad * 1.35);
        } else {
          g.fillStyle(color, alpha).fillCircle(c.x, c.y, 2.5);
        }
        marks.forEach((m, i) => {
          const px = c.x + rad + 8 + i * 14;
          const py = c.y - rad - 4;
          g.fillStyle(0x0b1622, 0.9).fillCircle(px, py, 6.5);
          g.lineStyle(2.5, m.charge >= 1 ? 0xffe066 : color, hostile ? 0.85 : 1);
          g.beginPath();
          g.arc(px, py, 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, Math.min(1, m.charge)));
          g.strokePath();
          g.fillStyle(color, hostile ? 0.8 : 1).fillCircle(px, py, 2.4);
        });
      }
    }

    // Where ordered crew are headed.
    for (const mk of this.moveMarks) {
      const k = (t - mk.t0) / 0.9;
      if (k >= 1) continue;
      const p = this.toScreen(mk.at);
      g.lineStyle(2, COLORS.select, 0.9 * (1 - k)).strokeEllipse(p.x, p.y + T * 0.3, T * (0.3 + k * 0.6), T * (0.12 + k * 0.24));
    }
    this.moveMarks = this.moveMarks.filter((mk) => t - mk.t0 < 0.9);
  }

  /** Light up the bulwark rings: a ball was stopped. */
  flashBlock(): void {
    this.blockedAt = this.scene.time.now / 1000;
  }

  /** Flash a marker where a crew member has been sent. */
  markMove(at: Vec): void {
    this.moveMarks.push({ at: { x: at.x + 0.5, y: at.y + 0.5 }, t0: this.scene.time.now / 1000 });
  }
}

function flame(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, t: number): void {
  const sway = Math.sin(t * 7) * s * 0.15;
  const layers: [number, number, number][] = [
    [0xd8341a, 1, 0.9],
    [0xff8a1f, 0.72, 0.95],
    [0xffd24a, 0.42, 1],
  ];
  for (const [color, k, a] of layers) {
    const w = s * 0.55 * k;
    const h = s * 1.15 * k;
    g.fillStyle(color, a);
    g.fillCircle(x, y, w);
    g.fillTriangle(x - w, y, x + w, y, x + sway, y - h - w * 0.4);
  }
}

/** A round parchment badge with a station's symbol, painted once per system. */
function systemIcon(scene: Phaser.Scene, id: SystemId): string {
  const key = `sysicon:${id}`;
  if (scene.textures.exists(key)) return key;
  const S = 40;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const c = S / 2;
  ctx.beginPath();
  ctx.arc(c, c, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#e9dcb8';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2a170a';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, 14.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(80,50,20,0.5)';
  ctx.stroke();
  ctx.strokeStyle = '#2a170a';
  ctx.fillStyle = '#2a170a';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  switch (id) {
    case 'helm':
      ctx.beginPath();
      ctx.arc(c, c, 7, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.lineTo(c + Math.cos(a) * 11, c + Math.sin(a) * 11);
        ctx.stroke();
      }
      break;
    case 'sails':
      ctx.beginPath();
      ctx.moveTo(c - 1, 8);
      ctx.lineTo(c - 1, 32);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(c + 1, 10);
      ctx.quadraticCurveTo(c + 14, 19, c + 1, 29);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(c - 3, 12);
      ctx.quadraticCurveTo(c - 11, 20, c - 3, 27);
      ctx.closePath();
      ctx.fill();
      break;
    case 'guns':
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(-0.5);
      ctx.fillRect(-11, -3.5, 20, 7);
      ctx.beginPath();
      ctx.arc(-11, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(c - 3, c + 6, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'pumps':
      ctx.beginPath();
      ctx.moveTo(c, 8);
      ctx.bezierCurveTo(c + 9, 18, c + 9, 30, c, 30);
      ctx.bezierCurveTo(c - 9, 30, c - 9, 18, c, 8);
      ctx.fillStyle = '#2e6fa8';
      ctx.fill();
      ctx.stroke();
      break;
    case 'surgeon':
      ctx.fillStyle = '#b3261e';
      ctx.fillRect(c - 3.5, 9, 7, 22);
      ctx.fillRect(c - 11, c - 3.5, 22, 7);
      break;
    case 'bulwarks':
      ctx.beginPath();
      ctx.moveTo(c - 10, 9);
      ctx.lineTo(c + 10, 9);
      ctx.lineTo(c + 10, 20);
      ctx.quadraticCurveTo(c + 9, 28, c, 32);
      ctx.quadraticCurveTo(c - 9, 28, c - 10, 20);
      ctx.closePath();
      ctx.fillStyle = '#8a5a30';
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#e9dcb8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(c - 7, 15);
      ctx.lineTo(c + 7, 15);
      ctx.moveTo(c - 7, 21);
      ctx.lineTo(c + 7, 21);
      ctx.stroke();
      break;
  }
  tex.refresh();
  return key;
}
