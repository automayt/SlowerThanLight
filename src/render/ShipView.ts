import Phaser from 'phaser';
import type { Crew, Ship } from '../sim/Ship';
import type { RoomDef, SystemId, Vec } from '../sim/types';
import { partyStrength, type BlowKind } from '../sim/Boarding';
import { CREW_ORIGIN, crewFrame, crewTextures, type CrewFrame } from './CrewArt';
import { ART_SCALE, paintFurls, paintShip, playerColours, repaintEnsign, type EnsignArt, type Ensign, type RigKind, type ShipGeometry, type ShipPiece, type Spar } from './ShipArt';
import { motionScale, reducedMotion } from './screen';
import { COLORS, TITLE_FONT, textStyle } from './theme';
import { NO_WRECK_HOOKS, ShipWreck, type HullPiece, type WreckHooks } from './ShipWreck';

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

export interface FinaleOptions {
  /** Where her people swim for when she goes down: the victor. */
  toward?: Vec | null;
  /** Spray, sound and camera for the death scene. */
  hooks?: WreckHooks;
}

export interface ShipViewOptions {
  showLabels?: boolean;
  flag?: Ensign;
}

/**
 * Draw order of a ship's layers. Projectiles and effects in the battle scene sit above these. Set sails sit under the
 * crew so they never hide who is where; furled canvas lies along the spars just under them.
 */
const DEPTH = { wake: 1, base: 2, over: 3, sails: 3.95, crew: 4, furl: 4.99, rig: 5, ui: 6 } as const;
/** The two sides of a melee in the read-out over a contested room: our people, and hers. */
const MELEE_OURS = 0x4fb0e8;
const MELEE_THEIRS = 0xe0452f;
/** Seconds a lunge takes (out and back), a pistol held levelled, and a heavy blow's stagger. */
const LUNGE_TIME = 0.26;
const AIM_TIME = 0.45;
const JOLT_TIME = 0.4;

/** Strips the ensign is cut into to make it ripple. */
const FLAG_STRIPS = 8;
/** Seconds to strike her colours and run up the victor's. */
const REHOIST_TIME = 1.6;
/** Canvas colour, its sunlit belly and its seams. */
const CLOTH = 0xe6dcc0;
const CLOTH_LIT = 0xf8f2e2;
const CLOTH_SEAM = 0x9c8c6a;
const PENNANT: Record<Ensign, number> = { pirate: 0x8e1b14, navy: 0xc8202a, spanish: 0xd9aa48, trade: 0x2a62a8, cutlasses: 0x8e1b14, hourglass: 0x8e1b14 };
/** How full each kind of sail bellies, in tiles. */
const BELLY: Record<RigKind, number> = { square: 0.5, gaff: 0.42, lateen: 0.5, lug: 0.42 };

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
  /** Where each sailor is drawn, off their tile: fighters step in toward their foe (eased, in pixels). */
  private readonly stepIn = new Map<number, { x: number; y: number }>();
  /** Melee moments by crew id (seconds): their last blow, the pistol they last fired, the heavy blow they took. */
  private readonly lunges = new Map<number, number>();
  private readonly aims = new Map<number, number>();
  private readonly jolts = new Map<number, number>();
  /** "3 v 2" over each contested room. */
  private readonly frayLabels = new Map<string, Phaser.GameObjects.Text>();
  private frameDt = 0;
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
  /** The masts sway against the hull as she rolls, a few pixels of parallax. */
  private roll = 0;
  /** Recoil from her own guns, easing back. */
  private kick = 0;
  private lastT = 0;
  private readonly sails: Phaser.GameObjects.Graphics;
  private readonly furls: { img: Phaser.GameObjects.Image; piece: ShipPiece }[];
  /** How far each mast's canvas is let fall and drawing, 0 (furled) to 1, easing toward what the hands allow. */
  private readonly set: number[];
  /** Shot-holes in her canvas: chain shot rips it, repairs mend it. */
  private rips = 0;
  /** The headsail, as a spar of its own, and the mast whose hands set it. */
  private readonly jib: { spar: Spar; mast: number } | null;
  private flag: Ensign;
  /** Her colours coming down and others going up in their place (a prize taken), from `t0` in seconds. */
  private rehoist: { t0: number; flag: Ensign; swapped: boolean } | null = null;
  private readonly ensign: EnsignArt;
  private readonly strips: Phaser.GameObjects.Image[] = [];
  /**
   * She yaws a little on the swell, turning about her middle. Everything of hers turns with her: the painted hull and
   * rig as images, the deck overlays as graphics drawn in her own (unturned) frame, and toScreen/toTile, so clicks
   * land on the room that is drawn under the pointer.
   */
  private yaw = 0;
  private yawKick = 0;
  private cos = 1;
  private sin = 0;
  private readonly pivot = { x: 0, y: 0 };
  /** Top-left of the painted hull before the yaw. */
  private left0 = 0;
  private top0 = 0;
  /** 0..1, easing in while she crowds on sail: she heels further, rolls deeper and throws a bigger wake. */
  private press = 0;
  /** Each gun's recoil: 1 the moment it fires, easing to 0 as the crew run it out again. */
  private readonly gunKick: number[] = [];
  /** Her stern half, once she has blown in two. */
  private wreck: Phaser.GameObjects.Image | null = null;
  /** Where she broke, in screen pixels from the left of her painted hull. */
  private breakX = 0;
  /** Her death scene, once she is going down or has blown up. */
  private wreckFx: ShipWreck | null = null;
  /** Listing, her deck seen foreshortened athwartships about the keel, and shifted toward the low side (pixels). */
  private sy = 1;
  private sdy = 0;

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
    const flag = opts.flag ?? (ship.side === 'player' ? playerColours() : 'navy');
    const prefix = `shipart:${viewCount++}`;
    const art = paintShip(scene, ship, tile, prefix, flag, flip);
    this.geom = art.geom;
    this.flag = flag;
    this.ensign = art.ensign;
    const furls = paintFurls(scene, ship, art.geom, tile, prefix);
    this.keys = [art.base, art.rig, art.ensign.key, ...furls.map((f) => f.key)];
    this.gunRoom = [...ship.rooms.values()].find((r) => r.def.system === 'guns')?.def;

    this.wake = scene.add.graphics().setDepth(DEPTH.wake);
    this.base = scene.add.image(0, 0, art.base).setOrigin(0).setScale(1 / ART_SCALE).setFlipX(flip).setDepth(DEPTH.base);
    this.over = scene.add.graphics().setDepth(DEPTH.over);
    this.sails = scene.add.graphics().setDepth(DEPTH.sails);
    this.furls = furls.map((piece) => ({ piece, img: scene.add.image(0, 0, piece.key).setOrigin(0).setScale(1 / ART_SCALE).setFlipX(flip).setDepth(DEPTH.furl) }));
    this.set = this.geom.spars.map((_, i) => this.sailTarget(i));
    const { jib, spars } = this.geom;
    const fore = spars.reduce((f, sp, i) => (sp.mast.x > spars[f].mast.x ? i : f), 0);
    this.jib = jib ? { spar: { ...spars[fore], a: jib.a, b: jib.b, belly: { x: 0, y: -1 }, kind: 'gaff', main: false }, mast: fore } : null;
    this.rig = scene.add.image(0, 0, art.rig).setOrigin(0).setScale(1 / ART_SCALE).setFlipX(flip).setDepth(DEPTH.rig);
    const ftex = scene.textures.get(art.ensign.key).getSourceImage();
    const sw = Math.ceil(ftex.width / FLAG_STRIPS);
    for (let i = 0; i < FLAG_STRIPS; i++) {
      this.strips.push(scene.add.image(0, 0, art.ensign.key).setOrigin(0).setScale(1 / ART_SCALE).setCrop(i * sw, 0, sw + 1, ftex.height).setDepth(DEPTH.rig));
    }
    this.ui = scene.add.graphics().setDepth(DEPTH.ui);

    this.updatePivot();
    if (showLabels) {
      for (const sys of ship.systems.values()) {
        this.badges.set(sys.id, scene.add.image(0, 0, systemIcon(scene, sys.id)).setScale(0.5).setDepth(DEPTH.ui).setOrigin(0.5));
      }
      const nx = this.pivot.x;
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
    const l = this.local(p);
    return this.turn(l.x, l.y);
  }

  /** Screen pixels to fractional tile coordinates. */
  toTile(px: number, py: number): Vec {
    const l = this.unturn(px, py);
    const x = (l.x - this.ox - this.fx) / this.tile;
    const mid = this.ship.height / 2;
    return { x: this.flip ? this.ship.width - x : x, y: mid + ((l.y - this.oy - this.bob - this.fy - this.sdy) / this.tile - mid) / this.sy };
  }

  /** Tile coordinates to pixels in her own frame, before the yaw: where her deck graphics draw. */
  private local(p: Vec): Vec {
    const x = this.flip ? this.ship.width - p.x : p.x;
    return { x: this.ox + this.fx + x * this.tile, y: this.deckY(p.y) };
  }

  /** Tile y to pixels in her frame: about the keel, squeezed and shifted as she lists. */
  private deckY(y: number): number {
    const mid = this.ship.height / 2;
    return this.oy + this.bob + this.fy + (mid + (y - mid) * this.sy) * this.tile + this.sdy;
  }

  /** Her frame to the screen: turned by the yaw about her middle. */
  private turn(x: number, y: number): Vec {
    const dx = x - this.pivot.x;
    const dy = y - this.pivot.y;
    return { x: this.pivot.x + dx * this.cos - dy * this.sin, y: this.pivot.y + dx * this.sin + dy * this.cos };
  }

  private unturn(x: number, y: number): Vec {
    const dx = x - this.pivot.x;
    const dy = y - this.pivot.y;
    return { x: this.pivot.x + dx * this.cos + dy * this.sin, y: this.pivot.y - dx * this.sin + dy * this.cos };
  }

  private updatePivot(): void {
    this.pivot.x = this.ox + this.fx + (this.ship.width * this.tile) / 2;
    this.pivot.y = this.oy + this.bob + this.fy + (this.ship.height * this.tile) / 2;
    this.cos = Math.cos(this.yaw);
    this.sin = Math.sin(this.yaw);
  }

  /** Put a graphics layer drawn in her frame where she is: turned about her middle. */
  private seat(g: Phaser.GameObjects.Graphics): void {
    const { x, y } = this.pivot;
    g.setRotation(this.yaw).setPosition(x - (x * this.cos - y * this.sin), y - (x * this.sin + y * this.cos));
  }

  /** Place an image whose origin falls at (x, y) in her frame. */
  private seatImage(img: Phaser.GameObjects.Image, x: number, y: number, rotation = 0): void {
    const p = this.turn(x, y);
    img.setPosition(p.x, p.y).setRotation(rotation + this.yaw);
  }

  private localCenter(roomId: string): Vec {
    return this.local(this.ship.roomCenter(roomId));
  }

  private localRoomRect(roomId: string): Phaser.Geom.Rectangle {
    const d = this.ship.room(roomId).def;
    return this.localRect(d.x, d.y, d.w, d.h);
  }

  private localTileRect(roomId: string, i: number): Phaser.Geom.Rectangle {
    const d = this.ship.room(roomId).def;
    return this.localRect(d.x + (i % d.w), d.y + Math.floor(i / d.w), 1, 1);
  }

  private localRect(x: number, y: number, w: number, h: number): Phaser.Geom.Rectangle {
    const a = this.local({ x, y });
    const b = this.local({ x: x + w, y: y + h });
    return new Phaser.Geom.Rectangle(Math.min(a.x, b.x), a.y, Math.abs(b.x - a.x), b.y - a.y);
  }

  /** A rectangle in her frame, moved to where its middle is on screen (the yaw is too slight to tilt it noticeably). */
  private onScreen(r: Phaser.Geom.Rectangle): Phaser.Geom.Rectangle {
    const c = this.turn(r.centerX, r.centerY);
    return r.setPosition(c.x - r.width / 2, c.y - r.height / 2);
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
    return this.onScreen(this.localRoomRect(roomId));
  }

  /** Screen rectangle of one tile of a room (`i` indexes the room's flames, row by row). */
  tileRect(roomId: string, i: number): Phaser.Geom.Rectangle {
    return this.onScreen(this.localTileRect(roomId, i));
  }

  /** Muzzle of the cannon that stands for gun `index`, run out through its port in the ship's side, and the way it points. */
  muzzle(index: number): { x: number; y: number; dx: number; dy: number } {
    const m = this.localMuzzle(index);
    const p = this.turn(m.x, m.y);
    return { x: p.x, y: p.y, dx: -m.dy * this.sin, dy: m.dy * this.cos };
  }

  private localMuzzle(index: number): { x: number; y: number; dy: number } {
    const guns = this.gunRoom;
    const mid = this.ship.height / 2;
    if (!guns) return { ...this.local({ x: this.ship.width / 2, y: mid }), dy: -1 };
    const col = index % guns.w;
    const top = Math.floor(index / guns.w) % 2 === 0 || guns.h === 1;
    const x = guns.x + col + 0.5;
    const side = this.geom.half(x) + 0.05;
    return { ...this.local({ x, y: top ? mid - side : mid + side }), dy: top ? -1 : 1 };
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

  /**
   * Begin the ship's exit: sinking, blowing apart, or sailing off. Going down or blown up, the death scene takes over
   * her hull, masts, crew and colours (see ShipWreck); `opts` says where survivors swim and how to make spray and noise.
   */
  startFinale(kind: Finale, nowMs: number, opts: FinaleOptions = {}): void {
    if (this.finale) return;
    this.finale = { kind, t0: nowMs / 1000 };
    this.nameText?.setVisible(false);
    for (const b of this.badges.values()) b.setVisible(false);
    if (kind === 'sail') return;
    const g = this.geom;
    const u = this.tile * ART_SCALE;
    const src = this.scene.textures.get(this.keys[0]).getSourceImage() as HTMLCanvasElement;
    const W = src.width;
    // Tile x to x in her hull as it shows (mirrored if she is flipped).
    const full = (x: number) => (this.flip ? W - (x + g.padL) * u : (x + g.padL) * u);
    let pieces: HullPiece[];
    if (kind === 'explode') {
      const at = this.breakUp(src);
      const cutX = this.ship.width * 0.55;
      // The bow and stern halves, each going under from the break; flipped, the bow is the left-hand piece.
      pieces = [
        { img: this.base, lo: cutX, hi: g.sprit, wetLo: true, tex: (x) => full(x) - (this.flip ? 0 : at) },
        { img: this.wreck!, lo: g.stern, hi: cutX, wetLo: false, tex: (x) => full(x) - (this.flip ? at : 0) },
      ];
    } else {
      if (this.flip) this.base.setTexture(this.mirrorKey()).setFlipX(false);
      // Settling by the head or by the stern.
      const byStern = Math.random() < 0.4;
      pieces = [{ img: this.base, lo: g.stern - 0.1, hi: g.sprit, wetLo: byStern, tex: full }];
    }
    this.rig.setVisible(false);
    this.placeImages();
    const crew = this.ship.crew.flatMap((c) => {
      const sprite = this.sprites.get(c.id);
      return sprite ? [{ crew: c, sprite, prefix: crewTextures(this.scene, c) }] : [];
    });
    this.sprites.clear();
    this.facing.clear();
    this.wreckFx = new ShipWreck(
      {
        scene: this.scene,
        ship: this.ship,
        geom: g,
        tile: this.tile,
        flip: this.flip,
        keyPrefix: `${this.keys[0]}`,
        pieces,
        marks: kind === 'sink' ? this.marks : null,
        set: [...this.set],
        furls: this.furls,
        crew,
        strips: this.strips,
        ensign: this.ensign,
        roll: () => this.roll,
        toward: opts.toward ?? null,
        hooks: opts.hooks ?? NO_WRECK_HOOKS,
      },
      kind,
    );
  }

  /** Her middle on screen. */
  center(): Vec {
    return { x: this.pivot.x, y: this.pivot.y };
  }

  /** Whether a point of her (screen pixels) is still above water: false once she is lost and it has gone under. */
  afloat(px: number, py: number): boolean {
    if (!this.wreckFx) return true;
    return this.finale?.kind === 'sink' && this.wreckFx.dry(this.toTile(px, py).x);
  }

  private mirrorKey(): string {
    const src = this.keys[0];
    const key = `${src}-mirror`;
    if (this.scene.textures.exists(key)) return key;
    const img = this.scene.textures.get(src).getSourceImage() as HTMLCanvasElement;
    const tex = this.scene.textures.createCanvas(key, img.width, img.height)!;
    const ctx = tex.getContext();
    ctx.translate(img.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    tex.refresh();
    this.keys.push(key);
    return key;
  }

  /**
   * Crack the hull in two at the waist: each half is cut out of her painted hull `src` into a texture of its own, as
   * it shows on screen (mirrored if she is flipped, so the halves need no flip), so the halves can part. Returns
   * where she broke, in pixels from the left of her hull as it shows.
   */
  private breakUp(src: HTMLCanvasElement): number {
    const g = this.geom;
    const cut = Math.round((this.ship.width * 0.55 + g.padL) * this.tile * ART_SCALE);
    const at = this.flip ? src.width - cut : cut;
    const half = (suffix: string, x: number, w: number) => {
      const key = `${this.keys[0]}-${suffix}`;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
      const tex = this.scene.textures.createCanvas(key, w, src.height)!;
      const ctx = tex.getContext();
      if (this.flip) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, src.width - x - w, 0, w, src.height, 0, 0, w, src.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else ctx.drawImage(src, x, 0, w, src.height, 0, 0, w, src.height);
      // Splintered timbers along the break, not a clean saw cut.
      const edge = x === 0 ? w : 0;
      const inward = x === 0 ? -1 : 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(edge, 0);
      for (let y = 0; y <= src.height; y += 9) ctx.lineTo(edge + inward * (2 + Math.random() * 16), y);
      ctx.lineTo(edge, src.height);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      tex.refresh();
      this.keys.push(key);
      return key;
    };
    const leftKey = half('left', 0, at);
    const rightKey = half('right', at, src.width - at);
    // Both halves pivot about the break, on the keel: the left-hand one by its right edge, the other by its left.
    const oy = (g.padT + this.ship.height / 2) / (g.padT + this.ship.height + g.padB);
    const [bowKey, sternKey] = this.flip ? [leftKey, rightKey] : [rightKey, leftKey];
    this.wreck = this.scene.add.image(0, 0, sternKey).setScale(1 / ART_SCALE).setDepth(DEPTH.base).setOrigin(this.flip ? 0 : 1, oy);
    this.base.setTexture(bowKey).setFlipX(false).setOrigin(this.flip ? 1 : 0, oy);
    this.breakX = at / ART_SCALE;
    this.marks?.setVisible(false);
    return at;
  }

  /**
   * Her own gun has fired out of the side facing `dy`: she gives a little the other way, and turns a touch about her
   * middle by where along her length it stands. The gun itself leaps back from its port and is run out again.
   */
  recoil(dy: number, gun?: number): void {
    this.kick = Math.max(-4, Math.min(4, this.kick - dy * 2.2));
    if (gun === undefined) return;
    this.gunKick[gun] = 1;
    const m = this.localMuzzle(gun);
    const arm = (m.x - this.pivot.x) / ((this.ship.width * this.tile) / 2 || 1);
    this.yawKick = Math.max(-0.012, Math.min(0.012, this.yawKick - Math.sign(dy) * arm * 0.004 * motionScale()));
  }

  /** A ball has torn through her canvas. */
  tearSail(): void {
    this.rips = Math.min(8, this.rips + 1);
  }

  destroy(): void {
    for (const o of [this.wake, this.over, this.sails, this.ui, this.base, this.wreck, this.rig, this.nameText, this.marks, this.marksPen, ...this.strips, ...this.furls.map((f) => f.img), ...this.badges.values(), ...this.sprites.values(), ...this.frayLabels.values()]) o?.destroy();
    for (const k of this.keys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    this.wreckFx?.destroy();
  }

  private placeImages(): void {
    const g = this.geom;
    const T = this.tile;
    const left = (this.flip ? this.ox - g.padR * T : this.ox - g.padL * T) + this.fx;
    const top = this.deckY(-g.padT);
    if (this.sy !== 1) this.base.setScale(1 / ART_SCALE, this.sy / ART_SCALE);
    this.left0 = left;
    this.top0 = top;
    if (this.wreck && this.finale) {
      // Blown in two: the halves part and fold away from the break.
      const k = Math.min(1, (this.scene.time.now / 1000 - this.finale.t0) / 3.2);
      const bow = this.flip ? -1 : 1;
      const px = left + this.breakX;
      const py = top + this.base.originY * this.base.displayHeight;
      const ease = 1 - Math.pow(1 - k, 2);
      this.seatImage(this.base, px + bow * ease * 16, py, bow * ease * 0.16);
      this.seatImage(this.wreck, px - bow * ease * 14, py + ease * 4, -bow * ease * 0.12);
    } else this.seatImage(this.base, left, top);
    this.seatImage(this.rig, left, top + this.roll);
    const texW = this.rig.width;
    for (const { img, piece } of this.furls) {
      this.seatImage(img, left + (this.flip ? texW - piece.x - piece.w : piece.x) / ART_SCALE, top + this.roll + piece.y / ART_SCALE);
    }
  }

  /** How much canvas mast `i` (main, fore, mizzen) should carry: the hands at the sails set the mainsail first. */
  private sailTarget(i: number): number {
    const fin = this.finale;
    if (fin) return fin.kind === 'sail' ? 1 : 0;
    const sails = this.ship.system('sails');
    if (!sails) return 1;
    const v = Math.max(0, Math.min(1, (this.ship.level('sails') / sails.max) * this.geom.spars.length - i));
    return v > 0 ? 0.55 + 0.45 * v : 0;
  }

  draw(timeMs: number, state: ShipViewState = {}): void {
    const t = timeMs / 1000;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.frameDt = dt;
    this.kick *= Math.exp(-dt * 7);
    this.yawKick *= Math.exp(-dt * 2.5);
    for (let i = 0; i < this.gunKick.length; i++) this.gunKick[i] = Math.max(0, (this.gunKick[i] ?? 0) - dt / 1.1);
    // Riding the swell: she rises and falls, yaws a little and rolls, the masts swinging over the hull. Crowding on
    // sail, she heels hard to leeward (the rig leans off up the screen) and everything works deeper.
    const sailing = (this.ship.orders?.sail.active ?? 0) > 0 && !this.finale;
    this.press += ((sailing ? 1 : 0) - this.press) * Math.min(1, dt * 1.2);
    const calm = motionScale();
    const p = this.press;
    this.bob = (Math.sin(t * 0.9 + this.phase) * 1.4 + Math.sin(t * 0.43 + this.phase * 2.3) * 0.9) * calm * (1 + 0.4 * p) + this.kick;
    this.yaw = (Math.sin(t * 0.52 + this.phase * 1.3) * 0.0065 + Math.sin(t * 1.17 + this.phase) * 0.0022) * calm * (1 + 0.7 * p) + this.yawKick;
    this.roll = (Math.sin(t * 0.7 + this.phase * 1.7) * (2.2 + 1.6 * p) - (1 + 5 * p)) * calm;
    const fin = this.finaleProgress(t);
    const wreck = this.wreckFx;
    if (wreck && fin) {
      // Listing: the deck foreshortened and pushed over toward the low side, the masts leaning out further over it.
      const list = wreck.list(fin.age);
      this.sy = 1 - 0.1 * list;
      this.sdy = wreck.listDir * list * this.tile * 0.15;
      this.roll = this.roll * (1 - list) + wreck.listDir * list * this.tile * 0.55;
    }
    this.updatePivot();
    this.placeImages();
    for (const g of [this.wake, this.over, this.sails, this.ui]) this.seat(g);
    if (this.nameText) {
      const n = this.turn(this.pivot.x, this.oy + this.bob + this.fy - (this.geom.beam - this.ship.height / 2) * this.tile - 22);
      this.nameText.setPosition(n.x, n.y);
    }

    if (wreck && fin) {
      // Her death scene has her hull, masts, crew and colours now; what was on her deck fades as the sea comes aboard.
      this.over.setAlpha(Math.max(0, 1 - fin.age / 1.4));
      if (fin.kind === 'sink') this.drawMarks(1);
      this.wake.clear();
      this.sails.clear();
      this.ui.clear();
      if (this.over.alpha > 0) this.drawOverlay(t, state);
      else this.over.clear();
      wreck.update(fin.age, dt);
      return;
    }

    const fade = fin && fin.kind !== 'sail' ? 1 - fin.k * 0.92 : 1;
    const rigFade = fin && fin.kind !== 'sail' ? Math.max(0, 1 - fin.k * 1.6) : 1;
    this.rig.setAlpha(rigFade);
    this.base.setAlpha(fade);
    this.wreck?.setAlpha(fade);
    this.over.setAlpha(fade);
    if (!this.wreck) this.drawMarks(fade);
    if (fin && fin.kind !== 'sail') {
      // Darken and drown the hull as she goes.
      const c = Math.round(255 - fin.k * 150);
      const tint = (c << 16) | (Math.round(255 - fin.k * 110) << 8) | Math.round(255 - fin.k * 70);
      this.base.setTint(tint);
      this.wreck?.setTint(tint);
      this.rig.setTint(tint);
    }

    this.drawWake(t);
    this.drawSails(t, dt, rigFade);
    this.drawOverlay(t, state);
    this.drawCrew(t, state, fade);
    if (fin) this.drawFinale();
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
      // Dead in the water, settling a little and drifting astern; the sea takes her from one end (see ShipWreck).
      const d = Math.min(1, age / 5);
      this.fy = kind === 'sink' ? d * this.tile * 0.12 : 0;
      this.fx = (this.flip ? 1 : -1) * d * this.tile * 0.25;
    }
    return { kind, k, age };
  }

  /** Sailing off, the markers and pips are gone; going down, the death scene draws everything (see ShipWreck). */
  private drawFinale(): void {
    this.ui.clear();
  }

  // --- Layers --------------------------------------------------------------

  private readonly tmp = { x: 0, y: 0 };

  /** Tile coordinates to screen, up among the rigging (riding the roll); reuses one point, so read it straight away. */
  private aloft(x: number, y: number): Vec {
    const p = this.tmp;
    p.x = this.ox + this.fx + (this.flip ? this.ship.width - x : x) * this.tile;
    p.y = this.deckY(y) + this.roll;
    return p;
  }

  /**
   * Canvas set and drawing: a bellied crescent hanging from each spar, breathing with the wind, fluttering at the leech
   * and holed where shot went through. Masts without hands furl their canvas; pennants stream from the mastheads and
   * the ensign ripples at the stern.
   */
  private drawSails(t: number, dt: number, alpha: number): void {
    const g = this.sails;
    const geo = this.geom;
    const mid = this.ship.height / 2;
    g.clear();
    const sys = this.ship.system('sails');
    if (sys && sys.damage === 0) this.rips = Math.max(0, this.rips - dt * 0.05);
    const holes = Math.floor(this.rips) + (sys?.damage ?? 0);
    const shotAway = !!sys && this.ship.capacity('sails') === 0;
    const n = geo.spars.length;

    geo.spars.forEach((sp, i) => {
      this.set[i] += (this.sailTarget(i) - this.set[i]) * Math.min(1, dt * 1.6);
      const s = this.set[i];
      const furl = this.furls[i].img;
      furl.setAlpha(Math.max(0, 1 - s * 1.8) * alpha);
      if (shotAway) furl.setTint(0x9a8a74);
      else furl.clearTint();
      if (s < 0.02 || alpha <= 0) return;
      const ph = this.phase + i * 1.9;
      const depth = BELLY[sp.kind] * (sp.main ? 1.15 : 1) * s * (1 + 0.07 * Math.sin(t * 1.6 + ph));
      const a = Math.min(1, s * 3) * alpha;
      this.crescent(g, sp, 1, depth, t, ph, a);
      // Square rig: the topsail above the course, narrower and shallower.
      if (sp.kind === 'square') this.crescent(g, sp, 0.74, depth * 0.62, t, ph + 1, a);
      for (let j = i; j < holes; j += n) {
        const u = 0.22 + ((j * 0.37) % 0.56);
        const v = 0.35 + ((j * 0.29) % 0.4);
        const d = depth * Math.pow(Math.sin(Math.PI * u), 0.75) * v;
        const p = this.aloft(sp.a.x + (sp.b.x - sp.a.x) * u + sp.belly.x * d, sp.a.y + (sp.b.y - sp.a.y) * u + sp.belly.y * d);
        g.fillStyle(0x3a2a18, 0.8 * a).fillEllipse(p.x, p.y, 5 + (j % 3), 4);
        g.lineStyle(1, CLOTH_SEAM, 0.8 * a).strokeEllipse(p.x, p.y, 6 + (j % 3), 5);
      }
    });

    // A headsail out to the bowsprit, set with the foremast.
    if (this.jib && alpha > 0) {
      const s = this.set[this.jib.mast];
      if (s > 0.02) this.crescent(g, this.jib.spar, 1, 0.28 * s, t, this.phase + 4, Math.min(1, s * 3) * alpha);
    }

    // Pennants streaming aft from the mastheads.
    const color = PENNANT[this.flag];
    for (const sp of geo.spars) {
      const len = sp.main ? 1.5 : 1.1;
      let px = 0;
      let py = 0;
      for (let k = 0; k <= 8; k++) {
        const f = k / 8;
        const p = this.aloft(sp.mast.x - f * len, mid + Math.sin(t * 6.5 - k * 0.9 + sp.mast.x) * 0.07 * f - f * 0.12);
        if (k > 0) g.lineStyle(2.6 * (1 - f) + 0.6, color, 0.95 * alpha).lineBetween(px, py, p.x, p.y);
        px = p.x;
        py = p.y;
      }
    }

    // The ensign, cut in strips that each ride a travelling wave.
    const staff = this.local({ x: geo.stern + 0.1, y: mid });
    const ftex = this.strips[0].texture.getSourceImage();
    const sw = Math.ceil(ftex.width / FLAG_STRIPS);
    const flyPx = ftex.width / ART_SCALE;
    const left = staff.x - this.ensign.hoistX / ART_SCALE;
    let top = staff.y - this.ensign.hoistY / ART_SCALE;
    let shown = alpha;
    // Struck and rehoisted: hers slides down the staff and fades, ours comes up it.
    const re = this.rehoist;
    if (re) {
      const k = (this.scene.time.now / 1000 - re.t0) / REHOIST_TIME;
      if (k >= 0.5 && !re.swapped) {
        re.swapped = true;
        this.flag = re.flag;
        repaintEnsign(this.scene, this.ensign.key, this.tile, re.flag, this.flip);
      }
      const low = k < 0.5 ? Math.min(1, k * 2) : Math.max(0, 2 - k * 2);
      top += low * this.tile * 0.7;
      shown *= 1 - 0.85 * low;
      if (k >= 1) this.rehoist = null;
    }
    this.strips.forEach((img, i) => {
      const d = Math.abs((i + 0.5) * sw - this.ensign.hoistX) / ART_SCALE;
      this.seatImage(img, left, top + (d / flyPx) * 2.4 * Math.sin(t * 7.5 - d * 0.16 + this.phase));
      img.setAlpha(shown);
    });
  }

  /** One bellied sail hanging from `sp`, over the middle `span` of its spar. */
  private crescent(g: Phaser.GameObjects.Graphics, sp: Spar, span: number, depth: number, t: number, ph: number, alpha: number): void {
    const N = 14;
    const k0 = (1 - span) / 2;
    const ax = sp.a.x + (sp.b.x - sp.a.x) * k0;
    const ay = sp.a.y + (sp.b.y - sp.a.y) * k0;
    const dx = (sp.b.x - sp.a.x) * span;
    const dy = (sp.b.y - sp.a.y) * span;
    const { x: nx, y: ny } = sp.belly;
    const curve = (u: number, k: number) => {
      // Fullest in the middle; the leech at either edge shivers.
      const edge = Math.abs(u - 0.5) * 2;
      const d = depth * k * Math.pow(Math.sin(Math.PI * u), 0.75) + 0.035 * edge * edge * Math.sin(t * 8 + u * 10 + ph) * Math.sin(Math.PI * u);
      return this.aloft(ax + dx * u + nx * d, ay + dy * u + ny * d);
    };
    const path = (k: number) => {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const p = curve(i / N, k);
        if (i) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
      }
      g.closePath();
    };
    g.fillStyle(CLOTH, 0.92 * alpha);
    path(1);
    g.fillPath();
    // Sunlit where she bellies fullest.
    g.fillStyle(CLOTH_LIT, 0.55 * alpha);
    path(0.6);
    g.fillPath();
    g.lineStyle(1, CLOTH_SEAM, 0.45 * alpha);
    for (let i = 1; i < 4; i++) {
      const u = i / 4;
      const r = this.aloft(ax + dx * u, ay + dy * u);
      const rx = r.x;
      const ry = r.y;
      const p = curve(u, 1);
      g.lineBetween(rx, ry, p.x, p.y);
    }
    g.lineStyle(1.4, 0x6b5a3a, 0.75 * alpha);
    path(1);
    g.strokePath();
  }

  /**
   * Scorches and hull scars build up over a fight; redrawing dozens of ellipses every frame cost more than the rest of
   * the deck overlay, so they are painted into a texture when one is added and the texture just follows the ship.
   */
  private drawMarks(alpha: number): void {
    if (!this.scorches.length && !this.scars.length) return;
    const T = this.tile;
    const left = this.left0;
    const top = this.top0;
    if (!this.marks) {
      // Between the deck art and the overlay, where the water and fire are drawn over them.
      this.marks = this.scene.add.renderTexture(left, top, Math.ceil(this.base.displayWidth), Math.ceil(this.base.displayHeight)).setOrigin(0).setDepth((DEPTH.base + DEPTH.over) / 2);
      this.marksPen = this.scene.make.graphics({}, false);
    }
    if (this.marksDirty) {
      this.marksDirty = false;
      const g = this.marksPen!.clear();
      const at = (x: number, y: number) => {
        const p = this.local({ x, y });
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
    this.marks.setPosition(this.base.x, this.base.y).setRotation(this.base.rotation).setAlpha(alpha);
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
        return this.local({ x: p.x + ((nx * 0.35) / len) * out, y: p.y + (ny / len) * out });
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
          return this.local({ x: p.x + ((nx * 0.35) / len) * off, y: p.y + (ny / len) * off });
        });
        g.lineStyle(2.5 + flash * 2, flash > 0 ? 0xffffff : 0xf0dca0, Math.min(1, alpha + flash * 0.6));
        g.strokePoints(ring, true);
      }
    }

    // Foam boiling off the bow, and a wake trailing astern: longer, whiter and faster with sail crowded on.
    const dir = this.flip ? -1 : 1;
    const press = this.press;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const k = (i + ((t * (0.9 + 0.6 * press)) % 1)) / 5;
        const x = geo.tip - 0.2 - k * (2.2 + 1.2 * press);
        const p = this.local({ x, y: mid + side * (geo.half(x) + 0.12 + k * (0.45 + 0.35 * press)) });
        g.fillStyle(0xe8f4f8, (0.3 + 0.18 * press) * (1 - k));
        g.fillEllipse(p.x, p.y, this.tile * (0.55 + k * 0.5) * (1 + 0.3 * press), this.tile * (0.18 + k * 0.2));
      }
    }
    const stern = this.local({ x: geo.stern, y: mid });
    const reach = 3.2 + 2.6 * press;
    const n = 6 + Math.round(3 * press);
    for (let i = 0; i < n; i++) {
      const k = (i + ((t * (0.8 + 0.5 * press)) % 1)) / n;
      g.fillStyle(0xe8f4f8, (0.22 + 0.1 * press) * (1 - k));
      g.fillEllipse(stern.x - dir * this.tile * (0.4 + k * reach), stern.y + Math.sin(t * 1.3 + i) * 3, this.tile * (0.5 + k * 0.9), this.tile * (0.25 + k * (0.5 + 0.4 * press)));
    }
    // Under a press of sail, two lines of broken water spread from her quarters.
    if (press > 0.02) {
      const half = geo.half(geo.stern + 0.3) * this.tile;
      for (const side of [-1, 1]) {
        g.lineStyle(2.5, 0xe8f4f8, 0.5 * press);
        g.beginPath();
        for (let i = 0; i <= 10; i++) {
          const k = i / 10;
          const x = stern.x - dir * this.tile * k * reach;
          const y = stern.y + side * (half + k * this.tile * 1.4) + Math.sin(t * 3 + k * 9 + side) * 2;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.strokePath();
      }
    }
  }

  private drawOverlay(t: number, state: ShipViewState): void {
    const g = this.over;
    const T = this.tile;
    const ship = this.ship;
    g.clear();

    for (const room of ship.rooms.values()) {
      const r = this.localRoomRect(room.def.id);
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
        const c = this.localCenter(room.def.id);
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
        // Fire lives on tiles: each burning tile glows and carries flames by its own heat, so a blaze can be seen
        // starting in a corner and creeping across the deck. Smoke hangs over the whole room by how much of it burns.
        const flames = room.flames;
        for (let i = 0; i < flames.length; i++) {
          const k = flames[i] / 100;
          if (k <= 0) continue;
          const tr = this.localTileRect(room.def.id, i);
          const seed = i * 1.7 + r.x * 0.01;
          g.fillStyle(0xff6a1a, 0.12 + 0.26 * k + 0.05 * Math.sin(t * 9 + seed)).fillRect(tr.x + 1, tr.y + 1, tr.width - 2, tr.height - 2);
          g.fillStyle(0xffc040, 0.05 + 0.12 * k).fillRect(tr.x + 4, tr.y + 4, tr.width - 8, tr.height - 8);
          // One tongue for a fresh flicker, up to three for a tile burning fierce.
          const n = k < 0.35 ? 1 : k < 0.7 ? 2 : 3;
          for (let j = 0; j < n; j++) {
            const fx = tr.x + tr.width * (0.25 + 0.5 * ((j * 0.618 + i * 0.29 + 0.13) % 1));
            const fy = tr.y + tr.height * (0.45 + 0.35 * ((j * 0.371 + i * 0.17 + 0.4) % 1));
            const s = T * (0.14 + 0.2 * k) * (1 + 0.15 * Math.sin(t * 11 + j * 3 + seed));
            flame(g, fx, fy, s, t + j + seed);
          }
          if (k > 0.4) {
            const kk = (t * 0.9 + i * 0.37) % 1;
            g.fillStyle(0xffb040, 0.9 * (1 - kk)).fillCircle(tr.centerX + Math.sin(t * 3 + seed) * 4, tr.bottom - T * 0.15 - kk * tr.height * 0.9, 1.5);
          }
        }
        const smoke = room.fire / 100;
        for (let i = 0; i < 3; i++) {
          const kk = (t * 0.45 + i / 3) % 1;
          g.fillStyle(0x2a2420, (0.12 + 0.25 * smoke) * (1 - kk)).fillCircle(r.centerX + Math.sin(t + i * 2) * T * 0.4, r.y + r.height * 0.4 - kk * T * 1.2, T * (0.15 + kk * 0.3));
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

    // Her guns' muzzles out through the ports, each leaping back when it fires and run out again as it is served.
    if (this.gunRoom && !this.finale) {
      for (let i = 0; i < ship.guns.length; i++) {
        const m = this.localMuzzle(i);
        const k = this.gunKick[i] ?? 0;
        const out = T * (0.2 * (1 - Math.pow(k, 0.6)) + 0.02);
        const y0 = m.y - m.dy * T * 0.06;
        const y1 = m.y + m.dy * out;
        const w = T * 0.13;
        g.fillStyle(0x161616, 1).fillRect(m.x - w / 2, Math.min(y0, y1), w, Math.abs(y1 - y0));
        g.fillStyle(0x6a6a66, 0.7).fillRect(m.x - w / 2 + 1, Math.min(y0, y1), 1.5, Math.abs(y1 - y0));
        g.fillStyle(0x0a0a0a, 1).fillEllipse(m.x, y1, w * 1.25, T * 0.06);
        // A wisp of smoke still curling from the port.
        if (k > 0.3) g.fillStyle(0xd8d4cc, (k - 0.3) * 0.5).fillCircle(m.x, y1 + m.dy * T * 0.12 * (1.3 - k), T * 0.1 * (1.6 - k));
      }
    }

    // Selection rings at the feet, under the crew.
    for (const c of ship.crew) {
      if (!state.selected?.has(c.id)) continue;
      const p = this.local(c.pos);
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
      // Face the way they walk; otherwise keep facing as they were (bow-ward to start).
      const f = this.facing.get(c.id) ?? { x: p.x, dir: (this.flip ? -1 : 1) * (c.side === this.ship.side ? 1 : -1) };
      if (Math.abs(p.x - f.x) > 0.3) f.dir = Math.sign(p.x - f.x);
      f.x = p.x;
      this.facing.set(c.id, f);

      // In a melee: square up to their foe, a step in toward them, and lunge on each blow.
      const foe = c.foe !== undefined && c.task === 'fight' && !c.waypoints.length ? this.ship.crew.find((x) => x.id === c.foe) : undefined;
      let want = { x: 0, y: 0 };
      let lunge = { x: 0, y: 0 };
      let frame: CrewFrame = crewFrame(c, t);
      if (foe) {
        const q = this.toScreen(foe.pos);
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(dx) > 1) f.dir = Math.sign(dx);
        const step = Math.min(T * 0.3, d * 0.3);
        want = { x: (dx / d) * step, y: (dy / d) * step * 0.6 };
        const since = t - (this.lunges.get(c.id) ?? -9);
        if (since < LUNGE_TIME && !reducedMotion()) {
          const reach = Math.sin((since / LUNGE_TIME) * Math.PI) * Math.min(T * 0.28, d * 0.3);
          lunge = { x: (dx / d) * reach, y: (dy / d) * reach * 0.5 };
        }
        frame = t - (this.aims.get(c.id) ?? -9) < AIM_TIME ? 'shoot' : since < LUNGE_TIME * 0.9 ? 'fight0' : 'fight1';
      } else if (c.waypoints.length && c.shaken) {
        // Broken and running: legs going twice as fast.
        frame = `walk${Math.floor(t * 14 + c.id) % 4}` as CrewFrame;
      }
      const at = this.stepIn.get(c.id) ?? { x: 0, y: 0 };
      const ease = Math.min(1, this.frameDt * 9);
      at.x += (want.x - at.x) * ease;
      at.y += (want.y - at.y) * ease;
      this.stepIn.set(c.id, at);
      let jx = 0;
      const jolt = t - (this.jolts.get(c.id) ?? -9);
      if (jolt < JOLT_TIME && !reducedMotion()) jx = Math.sin(jolt * 55) * 3.5 * (1 - jolt / JOLT_TIME);
      const key = `${prefix}:${frame}`;
      if (sprite.texture.key !== key) sprite.setTexture(key);
      sprite.setPosition(p.x + at.x + lunge.x + jx, fy + at.y + lunge.y).setDepth(DEPTH.crew + fy / 10000);
      sprite.setFlipX(f.dir < 0);
      sprite.setAlpha((c.hp <= 0 ? 0.4 : 1) * fade);
      if (state.selected?.has(c.id)) sprite.setTint(0xfff4c8);
      else sprite.clearTint();
    }
    for (const [id, s] of this.sprites) {
      if (live.has(id)) continue;
      this.sprites.delete(id);
      this.stepIn.delete(id);
      const dir = this.facing.get(id)?.dir ?? 1;
      this.facing.delete(id);
      if (state.alive && !state.alive.has(id)) {
        // Fallen: topple over, then fade away.
        s.setTint(0xb0a090);
        this.scene.tweens.add({ targets: s, angle: -88 * dir, y: s.y - 2, duration: 380, ease: 'Quad.easeIn' });
        // Name the fallen where they drop, so a death in the melee is not missed.
        const label = this.scene.add.text(s.x, s.y - T * 0.9, `† ${s.name}`, textStyle(12, s.getData('ours') ? '#ff8a7a' : '#e8e0cc', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(0.5).setDepth(DEPTH.ui + 6);
        label.setX(Phaser.Math.Clamp(label.x, label.width / 2 + 4, this.scene.scale.width - label.width / 2 - 4));
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
      const r = this.localRoomRect(sys.room);
      const bx = r.x + 11;
      const by = r.y + 11;
      const at = this.turn(bx, by);
      badge.setPosition(at.x, at.y);
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

    this.drawFrays(g);

    // Crew health and what they're doing, over their heads.
    for (const c of ship.crew) {
      const p = this.local(c.pos);
      const off = this.stepIn.get(c.id);
      if (off) {
        p.x += off.x;
        p.y += off.y;
      }
      const headY = p.y + T * 0.3 - T * 0.95;
      const hurt = c.hp < c.maxHp;
      if (hurt || state.selected?.has(c.id)) {
        const bw = T * 0.5;
        const frac = Math.max(0, c.hp / c.maxHp);
        g.fillStyle(0x000000, 0.75).fillRect(p.x - bw / 2 - 1, headY - 1, bw + 2, 5);
        g.fillStyle(frac > 0.6 ? 0x6fd35a : frac > 0.3 ? 0xe5c23a : 0xe0452f, 1).fillRect(p.x - bw / 2, headY, bw * frac, 3);
      }
      const icon = c.task === 'fire' ? 0xff7a2a : c.task === 'breach' ? 0x6fb8ff : c.task === 'repair' ? 0xf0b040 : c.task === 'sabotage' ? 0xb070ff : 0;
      // (No icon for a fight: the melee read-out over the room and their stance say it.)
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
        const c = this.localCenter(roomId);
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
      const p = this.local(mk.at);
      g.lineStyle(2, COLORS.select, 0.9 * (1 - k)).strokeEllipse(p.x, p.y + T * 0.3, T * (0.3 + k * 0.6), T * (0.12 + k * 0.24));
    }
    this.moveMarks = this.moveMarks.filter((mk) => t - mk.t0 < 0.9);
  }

  /**
   * Who is winning each melee aboard, at a glance: a tug-of-war bar along the room's foot (our strength against
   * hers) and the count, ours first.
   */
  private drawFrays(g: Phaser.GameObjects.Graphics): void {
    const ship = this.ship;
    const seen = new Set<string>();
    if (ship.crew.some((c) => c.side !== ship.side)) {
      for (const room of ship.rooms.values()) {
        const id = room.def.id;
        const here = ship.crew.filter((c) => c.room === id && !c.waypoints.length && c.hp > 0);
        const own = here.filter((c) => c.side === ship.side);
        const boarders = here.filter((c) => c.side !== ship.side);
        if (!own.length || !boarders.length) continue;
        seen.add(id);
        const mine = ship.side === 'player';
        const ours = mine ? own : boarders;
        const theirs = mine ? boarders : own;
        const a = partyStrength(ours, mine);
        const b = partyStrength(theirs, !mine);
        const k = a + b > 0 ? a / (a + b) : 0.5;
        let label = this.frayLabels.get(id);
        if (!label) {
          label = this.scene.add
            .text(0, 0, '', textStyle(12, '#f4ead0', { fontStyle: 'bold', stroke: '#0b1622', strokeThickness: 4 }))
            .setOrigin(1, 0.5)
            .setDepth(DEPTH.ui + 0.5);
          this.frayLabels.set(id, label);
        }
        const text = `${ours.length} v ${theirs.length}`;
        if (label.text !== text) label.setText(text);
        label.setColor(k >= 0.55 ? '#9fdcff' : k <= 0.45 ? '#ff9a88' : '#f4ead0');
        // The count and the bar side by side on the room's lower wall, clear of the feet of anyone standing there.
        const r = this.localRoomRect(id);
        const lw = label.width - 2;
        const w = Math.max(30, Math.min(64, r.width - 18 - lw));
        const x = r.centerX - (w + lw + 4) / 2 + lw + 4;
        const y = r.bottom - 1;
        g.fillStyle(0x0b1622, 0.85).fillRoundedRect(x - 3, y - 4, w + 6, 8, 3);
        g.fillStyle(MELEE_OURS, 1).fillRect(x, y - 2, w * k, 4);
        g.fillStyle(MELEE_THEIRS, 1).fillRect(x + w * k, y - 2, w * (1 - k), 4);
        g.fillStyle(0xffffff, 0.95).fillRect(x + w * k - 1, y - 4, 2, 8);
        const at = this.turn(x - 3, y);
        label.setPosition(at.x, at.y).setVisible(true);
      }
    }
    for (const [id, label] of this.frayLabels) if (!seen.has(id)) label.setVisible(false);
  }

  /** The colours she flies. */
  get colours(): Ensign {
    return this.rehoist?.flag ?? this.flag;
  }

  /** A prize taken: her colours come down and `flag` goes up in their place. */
  hoistColours(flag: Ensign): void {
    if (this.flag === flag || this.rehoist) return;
    this.rehoist = { t0: this.scene.time.now / 1000, flag, swapped: false };
  }

  /** A blow in a melee aboard: the striker lunges (or levels a pistol), and a heavy blow staggers its victim. */
  strike(from: number, to: number, kind: BlowKind): void {
    const t = this.scene.time.now / 1000;
    if (kind === 'shot' || kind === 'miss') this.aims.set(from, t);
    else this.lunges.set(from, t);
    if (kind === 'crit') this.jolts.set(to, t + 0.08);
  }

  /** Where a sailor aboard is drawn (their chest, with any step-in), or null if they are not aboard. */
  crewPoint(id: number): Vec | null {
    const s = this.sprites.get(id);
    if (!s) return null;
    return { x: s.x, y: s.y - this.tile * 0.42 };
  }

  /** A point on her rail `back` tiles aft of the stem, on her upper (-1) or lower (+1) side, on screen. */
  railPoint(back: number, side: number): Vec {
    const x = this.geom.tip - back;
    return this.toScreen({ x, y: this.ship.height / 2 + side * this.geom.half(x, 0.12) });
  }

  /** Which way a sailor aboard faces: 1 right, -1 left. */
  crewFacing(id: number): number {
    return this.facing.get(id)?.dir ?? 1;
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
