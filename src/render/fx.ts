import Phaser from 'phaser';

/** The wind the smoke drifts on, in px/s² (the cloud shadows run the same way). */
export const WIND = { x: 14, y: -3 };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Ctx = CanvasRenderingContext2D;

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, paint: (ctx: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h)!;
  paint(tex.getContext());
  tex.refresh();
}

function radial(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][]): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [k, c] of stops) g.addColorStop(k, c);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A soft, lumpy puff: a few overlapping blobs so it doesn't read as a disc. */
function puff(ctx: Ctx, s: number, rgb: string, seed: number): void {
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + seed;
    const d = i ? s * 0.16 : 0;
    radial(ctx, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (i ? 0.26 : 0.34), [
      [0, `rgba(${rgb},0.5)`],
      [0.6, `rgba(${rgb},0.22)`],
      [1, `rgba(${rgb},0)`],
    ]);
  }
}

/** Effect textures, painted once per game on canvases (so they work on either renderer). */
export function fxTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, 'fx:smoke', 64, 64, (c) => puff(c, 64, '216,212,204', 0));
  canvasTexture(scene, 'fx:soot', 64, 64, (c) => puff(c, 64, '40,34,30', 1.3));
  canvasTexture(scene, 'fx:flash', 64, 64, (c) =>
    radial(c, 32, 32, 32, [
      [0, 'rgba(255,255,240,1)'],
      [0.2, 'rgba(255,230,140,0.85)'],
      [0.5, 'rgba(255,150,50,0.3)'],
      [0.75, 'rgba(255,110,30,0.08)'],
      [1, 'rgba(255,100,20,0)'],
    ]),
  );
  canvasTexture(scene, 'fx:spark', 8, 8, (c) =>
    radial(c, 4, 4, 4, [
      [0, 'rgba(255,255,220,1)'],
      [0.5, 'rgba(255,200,90,0.8)'],
      [1, 'rgba(255,140,40,0)'],
    ]),
  );
  canvasTexture(scene, 'fx:ember', 8, 8, (c) =>
    radial(c, 4, 4, 4, [
      [0, 'rgba(255,230,150,1)'],
      [0.45, 'rgba(255,120,30,0.9)'],
      [1, 'rgba(200,40,0,0)'],
    ]),
  );
  canvasTexture(scene, 'fx:drop', 10, 10, (c) =>
    radial(c, 5, 5, 5, [
      [0, 'rgba(250,253,255,1)'],
      [0.6, 'rgba(225,240,248,0.7)'],
      [1, 'rgba(225,240,248,0)'],
    ]),
  );
  canvasTexture(scene, 'fx:splinter', 12, 4, (c) => {
    c.fillStyle = '#c9a36a';
    c.fillRect(0, 0, 12, 4);
    c.fillStyle = '#6b4321';
    c.fillRect(0, 3, 12, 1);
    c.fillRect(0, 0, 1, 4);
  });
  canvasTexture(scene, 'fx:glint', 16, 16, (c) => {
    radial(c, 8, 8, 5, [
      [0, 'rgba(255,255,255,0.9)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(0, 7.5, 16, 1);
    c.fillRect(7.5, 3, 1, 10);
  });
  // A dark rim that pulls the eye in to the fight, and warm late-afternoon light from the upper left.
  canvasTexture(scene, 'fx:vignette', 320, 180, (c) => {
    const g = c.createRadialGradient(160, 92, 60, 160, 92, 200);
    g.addColorStop(0, 'rgba(4,10,18,0)');
    g.addColorStop(0.65, 'rgba(4,10,18,0.16)');
    g.addColorStop(1, 'rgba(4,10,18,0.55)');
    c.fillStyle = g;
    c.fillRect(0, 0, 320, 180);
  });
  canvasTexture(scene, 'fx:sun', 320, 180, (c) => {
    const g = c.createRadialGradient(40, 10, 0, 40, 10, 300);
    g.addColorStop(0, 'rgba(255,196,120,0.55)');
    g.addColorStop(0.5, 'rgba(255,170,90,0.16)');
    g.addColorStop(1, 'rgba(255,150,80,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 320, 180);
  });
}

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;
type Particle = Phaser.GameObjects.Particles.Particle;

/** Fade in fast, then out slowly: billowing smoke. */
const billow = (peak: number) => (_p: Particle, _k: string, t: number) => peak * (t < 0.08 ? t / 0.08 : Math.pow(1 - (t - 0.08) / 0.92, 1.4));

/**
 * The battle's particle effects: gunsmoke that drifts downwind, muzzle flashes, splinters, sparks, splashes, embers and
 * the smoke of burning rooms. Emitters are made once and fired on demand; every one caps how many it keeps alive.
 */
export class BattleFx {
  private readonly smoke: Emitter;
  private readonly soot: Emitter;
  private readonly flash: Emitter;
  private readonly bigFlash: Emitter;
  private readonly sparks: Emitter;
  private readonly embers: Emitter;
  private readonly splinters: Emitter;
  private readonly drops: Emitter;
  /** Direction the next burst of gunsmoke is blown out in. */
  private dir = { x: 0, y: -1 };
  /** Fractional particles owed to burning rooms, carried between frames. */
  private owed = new Map<string, number>();

  constructor(scene: Phaser.Scene) {
    fxTextures(scene);
    const add = (tex: string, depth: number, config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) =>
      scene.add.particles(0, 0, tex, { emitting: false, ...config }).setDepth(depth);
    this.smoke = add('fx:smoke', 9.5, {
      lifespan: { min: 2000, max: 3200 },
      speedX: { onEmit: () => this.dir.x * rnd(18, 60) + rnd(-18, 18) },
      speedY: { onEmit: () => this.dir.y * rnd(18, 60) + rnd(-18, 18) },
      accelerationX: WIND.x,
      accelerationY: WIND.y,
      scale: { start: 0.4, end: 1.9, ease: 'Quad.easeOut' },
      alpha: { onUpdate: billow(0.42) },
      rotate: { min: 0, max: 360 },
      maxAliveParticles: 120,
    });
    this.soot = add('fx:soot', 9.4, {
      lifespan: { min: 1600, max: 2800 },
      speedX: { min: -10, max: 10 },
      speedY: { min: -38, max: -16 },
      accelerationX: WIND.x,
      accelerationY: WIND.y,
      scale: { start: 0.35, end: 1.5, ease: 'Quad.easeOut' },
      alpha: { onUpdate: billow(0.55) },
      rotate: { min: 0, max: 360 },
      maxAliveParticles: 90,
    });
    this.flash = add('fx:flash', 11, {
      lifespan: { min: 110, max: 170 },
      scale: { start: 0.55, end: 0.95 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 24,
    });
    this.bigFlash = add('fx:flash', 11, {
      lifespan: { min: 220, max: 360 },
      scale: { start: 0.9, end: 2.1, ease: 'Quad.easeOut' },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 12,
    });
    this.sparks = add('fx:spark', 11, {
      lifespan: { min: 220, max: 520 },
      speed: { min: 60, max: 240 },
      scale: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 120,
    });
    this.embers = add('fx:ember', 9.6, {
      lifespan: { min: 900, max: 1700 },
      speedX: { min: -14, max: 14 },
      speedY: { min: -50, max: -18 },
      accelerationX: WIND.x * 1.6,
      scale: { start: 0.9, end: 0.2 },
      alpha: { onUpdate: (_p: Particle, _k: string, t: number) => (1 - t) * (0.65 + 0.35 * Math.sin(t * 40)) },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 140,
    });
    this.splinters = add('fx:splinter', 11, {
      lifespan: { min: 450, max: 850 },
      speed: { min: 70, max: 210 },
      scale: { min: 0.6, max: 1.2 },
      // Tumbling as they fly.
      rotate: { onEmit: () => rnd(0, 360), onUpdate: (_p: Particle, _k: string, _t: number, v: number) => v + 11 },
      alpha: { onUpdate: (_p: Particle, _k: string, t: number) => (t < 0.7 ? 1 : (1 - t) / 0.3) },
      maxAliveParticles: 120,
    });
    this.drops = add('fx:drop', 11, {
      lifespan: { min: 420, max: 760 },
      speed: { min: 40, max: 140 },
      angle: { min: 200, max: 340 },
      gravityY: 260,
      scale: { start: 0.8, end: 0.3 },
      alpha: { start: 0.95, end: 0 },
      maxAliveParticles: 120,
    });
  }

  /** Gunfire: a flash at the muzzle, a spit of sparks and a bank of smoke blown out of the side. */
  muzzle(x: number, y: number, dx: number, dy: number): void {
    this.flash.explode(1, x + dx * 6, y + dy * 6);
    this.flash.explode(1, x + dx * 14, y + dy * 14);
    this.sparks.explode(4, x + dx * 8, y + dy * 8);
    this.dir = { x: dx, y: dy };
    for (let i = 0; i < 6; i++) this.smoke.explode(1, x + dx * (8 + i * 5) + rnd(-6, 6), y + dy * (8 + i * 5) + rnd(-6, 6));
  }

  /** A ball striking home: splinters, a burst of light, dark smoke; hot shot sprays embers. */
  impact(x: number, y: number, hot: boolean, heavy: boolean): void {
    this.flash.explode(heavy ? 2 : 1, x, y);
    this.splinters.explode(heavy ? 12 : 7, x, y);
    this.sparks.explode(heavy ? 8 : 4, x, y);
    this.soot.explode(heavy ? 3 : 2, x, y);
    if (hot) this.embers.explode(14, x, y);
  }

  /** A ball glancing off stout sides, or stopped by the bulwarks. */
  glance(x: number, y: number): void {
    this.flash.explode(1, x, y);
    this.sparks.explode(7, x, y);
    this.splinters.explode(3, x, y);
  }

  /** A miss: a spout of white water. */
  splash(x: number, y: number): void {
    this.drops.explode(16, x, y);
    this.dir = { x: 0, y: -1 };
    this.smoke.explode(1, x, y);
  }

  /** A magazine going up: a fireball, burning debris and a column of black smoke. */
  explosion(x: number, y: number): void {
    this.bigFlash.explode(2, x, y);
    this.flash.explode(3, x + rnd(-20, 20), y + rnd(-14, 14));
    this.sparks.explode(26, x, y);
    this.splinters.explode(22, x, y);
    this.embers.explode(22, x, y);
    this.soot.explode(8, x, y);
  }

  /** Bubbles and spray where a ship has gone down. */
  churn(x: number, y: number): void {
    this.drops.explode(3, x, y);
  }

  /** Called every frame for each burning room: embers and smoke at a rate that grows with the fire. */
  burning(key: string, r: Phaser.Geom.Rectangle, k: number, dt: number): void {
    const owed = (this.owed.get(key) ?? 0) + dt * (2 + 7 * k);
    let n = Math.floor(owed);
    this.owed.set(key, owed - n);
    while (n-- > 0) {
      const x = r.x + Math.random() * r.width;
      const y = r.y + Math.random() * r.height;
      if (Math.random() < 0.3) this.soot.emitParticleAt(x, y, 1);
      else this.embers.emitParticleAt(x, y, 1);
    }
  }

  /** A fleck of fire trailing hot shot. */
  trail(x: number, y: number): void {
    if (Math.random() < 0.6) this.embers.emitParticleAt(x, y, 1);
  }
}
