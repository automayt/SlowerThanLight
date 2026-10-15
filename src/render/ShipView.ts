import Phaser from 'phaser';
import type { Crew, Ship } from '../sim/Ship';
import type { Vec } from '../sim/types';
import { COLORS, textStyle } from './theme';
import { drawPips } from './ui';

export interface ShipViewState {
  selected?: Set<number>;
  hoverRoom?: string | null;
  /** Rooms aimed at, with the gun numbers aiming at them (enemy view). */
  targets?: Map<string, number[]>;
  /** Highlight rooms as aimable (a gun is selected). */
  aiming?: boolean;
}

/** Draws one ship top-down. The player's bow points right; `flip` turns the enemy to face left. */
export class ShipView {
  readonly g: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly nameText: Phaser.GameObjects.Text;

  constructor(
    readonly scene: Phaser.Scene,
    public ship: Ship,
    readonly ox: number,
    readonly oy: number,
    readonly tile: number,
    readonly flip: boolean,
    showLabels = true,
  ) {
    this.g = scene.add.graphics();
    for (const r of ship.rooms.values()) {
      const name = r.def.system ? r.def.system.toUpperCase() : '';
      if (!showLabels || !name) continue;
      const c = this.toScreen({ x: r.def.x + r.def.w / 2, y: r.def.y + 0.02 });
      const t = scene.add
        .text(c.x, c.y + 2, name, textStyle(Math.max(9, Math.round(tile * 0.24)), '#3a2614', { fontStyle: 'bold' }))
        .setOrigin(0.5, 0);
      this.labels.set(r.def.id, t);
    }
    const nx = this.toScreen({ x: ship.width / 2, y: 0 }).x;
    this.nameText = scene.add
      .text(nx, oy - tile * 0.95, `${ship.def.name}`, textStyle(Math.round(tile * 0.36), COLORS.gold, { fontStyle: 'bold' }))
      .setOrigin(0.5, 1);
    if (!showLabels) this.nameText.setVisible(false);
  }

  /** Tile coordinates (fractional) to screen pixels. */
  toScreen(p: Vec): Vec {
    const x = this.flip ? this.ship.width - p.x : p.x;
    return { x: this.ox + x * this.tile, y: this.oy + p.y * this.tile };
  }

  /** Screen pixels to fractional tile coordinates. */
  toTile(px: number, py: number): Vec {
    const x = (px - this.ox) / this.tile;
    return { x: this.flip ? this.ship.width - x : x, y: (py - this.oy) / this.tile };
  }

  roomAt(px: number, py: number): string | null {
    const t = this.toTile(px, py);
    return this.ship.roomAt(Math.floor(t.x), Math.floor(t.y))?.def.id ?? null;
  }

  crewAt(px: number, py: number): Crew | null {
    let best: Crew | null = null;
    let bestD = this.tile * 0.4;
    for (const c of this.ship.crew) {
      const s = this.toScreen(c.pos);
      const d = Math.hypot(s.x - px, s.y - py);
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

  destroy(): void {
    this.g.destroy();
    this.nameText.destroy();
    for (const t of this.labels.values()) t.destroy();
  }

  draw(timeMs: number, state: ShipViewState = {}): void {
    const g = this.g;
    const T = this.tile;
    const ship = this.ship;
    g.clear();

    this.drawHull();

    for (const room of ship.rooms.values()) {
      const r = this.roomRect(room.def.id);
      const sys = room.def.system ? ship.system(room.def.system) : undefined;
      const base = ship.side === 'enemy' ? COLORS.deckEnemy : sys ? COLORS.deckSystem : COLORS.deck;
      g.fillStyle(base, 1).fillRect(r.x, r.y, r.width, r.height);

      // Plank lines.
      g.lineStyle(1, 0x000000, 0.08);
      for (let y = r.y + T / 4; y < r.bottom; y += T / 4) g.lineBetween(r.x, y, r.right, y);

      if (room.water > 0) g.fillStyle(COLORS.water, 0.15 + (room.water / 100) * 0.6).fillRect(r.x, r.y, r.width, r.height);

      if (room.fire > 0) {
        const flicker = 0.25 + 0.1 * Math.sin(timeMs / 90 + r.x);
        g.fillStyle(COLORS.fire, flicker + (room.fire / 100) * 0.35).fillRect(r.x, r.y, r.width, r.height);
        const flames = Math.ceil((room.fire / 100) * room.def.w * room.def.h);
        for (let i = 0; i < flames; i++) {
          const fx = r.x + ((i * 0.618 * r.width + 9) % (r.width - 10)) + 5;
          const fy = r.y + r.height * (0.35 + 0.4 * ((i * 0.37) % 1));
          const h = T * (0.25 + 0.08 * Math.sin(timeMs / 120 + i * 2));
          g.fillStyle(COLORS.fireCore, 0.9).fillTriangle(fx - 5, fy + h / 2, fx + 5, fy + h / 2, fx, fy - h / 2);
        }
      }

      if (room.breach) {
        const c = this.roomCenter(room.def.id);
        g.fillStyle(COLORS.breach, 1).fillEllipse(c.x + T * 0.3, c.y + T * 0.15, T * 0.34, T * 0.22);
        g.lineStyle(2, COLORS.water, 0.9).strokeEllipse(c.x + T * 0.3, c.y + T * 0.15, T * 0.44, T * 0.3);
      }

      if (sys?.id === 'sails') {
        const c = this.roomCenter(room.def.id);
        g.fillStyle(0x3b2412, 1).fillCircle(c.x, c.y, T * 0.16);
        g.lineStyle(2, 0xeeeeee, 0.5).lineBetween(c.x, r.y + 3, c.x, r.bottom - 3);
      }
      if (sys?.id === 'guns') {
        for (let i = 0; i < room.def.w; i++) {
          const gx = r.x + T * (i + 0.5) - T * 0.1;
          g.fillStyle(0x1a1a1a, 1).fillRect(gx, r.y - T * 0.18, T * 0.2, T * 0.26);
          g.fillRect(gx, r.bottom - T * 0.08, T * 0.2, T * 0.26);
        }
      }
      if (sys?.id === 'helm') {
        const c = this.roomCenter(room.def.id);
        g.lineStyle(3, 0x4a2c14, 1).strokeCircle(c.x, c.y + T * 0.15, T * 0.22);
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          g.lineBetween(c.x, c.y + T * 0.15, c.x + Math.cos(ang) * T * 0.3, c.y + T * 0.15 + Math.sin(ang) * T * 0.3);
        }
      }

      if (state.hoverRoom === room.def.id) g.fillStyle(0xffffff, state.aiming ? 0.18 : 0.12).fillRect(r.x, r.y, r.width, r.height);

      const damaged = sys && sys.damage > 0;
      g.lineStyle(damaged ? 3 : 2, damaged ? COLORS.pipDamaged : COLORS.roomEdge, 1).strokeRect(r.x, r.y, r.width, r.height);

      if (sys) {
        const level = ship.level(sys.id);
        const pip = Math.max(5, Math.round(T * 0.16));
        const w = sys.max * (pip + 2);
        drawPips(g, r.centerX - w / 2, r.bottom - pip - 4, level, sys.max, sys.damage, pip, 2);
      }
    }

    for (const d of ship.doors) {
      const a = this.toScreen({ x: d.ta.x + 0.5, y: d.ta.y + 0.5 });
      const b = this.toScreen({ x: d.tb.x + 0.5, y: d.tb.y + 0.5 });
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const vertical = Math.abs(a.x - b.x) > Math.abs(a.y - b.y);
      g.fillStyle(COLORS.door, 1);
      if (vertical) g.fillRect(mx - 2, my - T * 0.22, 4, T * 0.44);
      else g.fillRect(mx - T * 0.22, my - 2, T * 0.44, 4);
    }

    if (state.targets) {
      for (const [roomId, guns] of state.targets) {
        if (!ship.rooms.has(roomId)) continue;
        const c = this.roomCenter(roomId);
        const rad = T * 0.32;
        g.lineStyle(2, COLORS.aim, 0.95).strokeCircle(c.x, c.y, rad);
        g.lineBetween(c.x - rad * 1.4, c.y, c.x - rad * 0.5, c.y).lineBetween(c.x + rad * 0.5, c.y, c.x + rad * 1.4, c.y);
        g.lineBetween(c.x, c.y - rad * 1.4, c.x, c.y - rad * 0.5).lineBetween(c.x, c.y + rad * 0.5, c.x, c.y + rad * 1.4);
        guns.forEach((_, i) => g.fillStyle(COLORS.aim, 1).fillCircle(c.x + rad + 6 + i * 11, c.y - rad - 4, 5));
      }
    }

    for (const c of ship.crew) this.drawCrew(c, state.selected?.has(c.id) ?? false);
  }

  private drawHull(): void {
    const g = this.g;
    const w = this.ship.width;
    const h = this.ship.height;
    const pts: Vec[] = [
      { x: -0.45, y: -0.25 },
      { x: w * 0.55, y: -0.4 },
      { x: w + 0.4, y: -0.2 },
      { x: w + 1.1, y: h * 0.25 },
      { x: w + 1.6, y: h / 2 },
      { x: w + 1.1, y: h * 0.75 },
      { x: w + 0.4, y: h + 0.2 },
      { x: w * 0.55, y: h + 0.4 },
      { x: -0.45, y: h + 0.25 },
      { x: -0.6, y: h / 2 },
    ].map((p) => this.toScreen(p));
    g.fillStyle(0x000000, 0.25).fillPoints(
      pts.map((p) => ({ x: p.x + 6, y: p.y + 8 })),
      true,
    );
    g.fillStyle(COLORS.hull, 1).fillPoints(pts, true);
    g.lineStyle(3, COLORS.hullEdge, 1).strokePoints(pts, true);
  }

  private drawCrew(c: Crew, selected: boolean): void {
    const g = this.g;
    const T = this.tile;
    const p = this.toScreen(c.pos);
    const r = T * 0.22;
    if (selected) g.lineStyle(3, COLORS.select, 1).strokeCircle(p.x, p.y, r + 4);
    g.fillStyle(c.side === 'player' ? COLORS.playerCrew : COLORS.enemyCrew, 1).fillCircle(p.x, p.y, r);
    g.lineStyle(2, 0x1a1208, 1).strokeCircle(p.x, p.y, r);
    if (c.task === 'fight') g.lineStyle(2, 0xff4040, 0.9).strokeCircle(p.x, p.y, r + 2);
    if (c.side === 'player') {
      // Red bandana.
      g.fillStyle(0xb8322a, 1).fillRect(p.x - r * 0.8, p.y - r * 0.55, r * 1.6, r * 0.4);
    } else {
      // Bicorne hat.
      g.fillStyle(0x111111, 1).fillTriangle(p.x - r, p.y - r * 0.2, p.x + r, p.y - r * 0.2, p.x, p.y - r * 1.1);
    }
    const frac = c.hp / c.maxHp;
    const bw = T * 0.5;
    g.fillStyle(0x000000, 0.7).fillRect(p.x - bw / 2, p.y + r + 2, bw, 4);
    g.fillStyle(frac > 0.6 ? 0x6fd35a : frac > 0.3 ? 0xe5c23a : 0xe0452f, 1).fillRect(p.x - bw / 2, p.y + r + 2, bw * frac, 4);
    if (c.task === 'fire' || c.task === 'breach' || c.task === 'repair') {
      const icon = c.task === 'fire' ? COLORS.fire : c.task === 'breach' ? COLORS.water : 0xf0a030;
      g.fillStyle(icon, 1).fillCircle(p.x + r * 0.9, p.y - r * 0.9, 4);
    }
  }
}
