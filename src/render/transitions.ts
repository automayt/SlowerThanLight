import Phaser from 'phaser';
import { reducedMotion, visibleRect } from './screen';

/**
 * Screens change behind a sail: a great sheet of canvas, bellied by the wind, sweeps in across the window, the next
 * screen is made behind it, and it sweeps on and off the far side. Every scene.start() and scene.restart() goes this
 * way once installTransitions() has run, so scenes need no changes of their own; the co-op director's moves between
 * screens pass through the same calls. With reduced motion it is a short fade through the dark instead.
 */
export const TRANSITION = 'Transition';

const COVER_MS = 380;
const REVEAL_MS = 460;
const CALM_COVER_MS = 160;
const CALM_REVEAL_MS = 220;
/** Longest to wait behind the sail for the next screen (one that loads art first) before showing it anyway. */
const HOLD_MAX_MS = 2500;

const CANVAS = 0xcbbb92;
const CANVAS_LIT = 0xe6dbbb;
const CANVAS_SHADE = 0x6e5c3c;
const SEAM = 0x8c7852;
const ROPE = 0x4a3820;
const ROPE_LIT = 0xa58c5e;
const DUSK = 0x06141f;

type Phase = 'idle' | 'cover' | 'hold' | 'reveal';

const sine = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, k)));

class TransitionScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private phase: Phase = 'idle';
  private t = 0;
  private then: (() => void) | null = null;
  /** Frames the next screen has had since it was made, while the sail hides it. */
  private ready = -1;
  private calm = false;

  constructor() {
    super({ key: TRANSITION });
  }

  create(): void {
    this.g = this.add.graphics();
  }

  /** Sweep the sail in; once the window is covered, run `then` (which starts the next screen). */
  cover(then: () => void): void {
    if (this.phase === 'cover' || this.phase === 'hold') {
      this.then = then;
      return;
    }
    this.calm = reducedMotion();
    this.phase = 'cover';
    // Caught mid-reveal, the sail turns back from where it is.
    this.t = 0;
    this.then = then;
    this.ready = -1;
    this.scene.bringToTop();
  }

  /** A new screen has been made behind the sail; it is shown once it has drawn. False if nothing was covering it. */
  arrive(): boolean {
    if (this.phase !== 'cover' && this.phase !== 'hold') return false;
    this.ready = 0;
    return true;
  }

  update(_time: number, delta: number): void {
    if (this.phase === 'idle') return;
    this.t += Math.min(delta, 50);
    const coverMs = this.calm ? CALM_COVER_MS : COVER_MS;
    const revealMs = this.calm ? CALM_REVEAL_MS : REVEAL_MS;
    if (this.phase === 'cover' && this.t >= coverMs) {
      this.phase = 'hold';
      this.t = 0;
      const then = this.then;
      this.then = null;
      then?.();
    } else if (this.phase === 'hold') {
      if (this.ready >= 0) this.ready++;
      if (this.ready >= 2 || this.t > HOLD_MAX_MS) {
        this.phase = 'reveal';
        this.t = 0;
      }
    } else if (this.phase === 'reveal' && this.t >= revealMs) {
      this.phase = 'idle';
      this.g.clear();
      return;
    }
    const s = this.phase === 'cover' ? sine(this.t / coverMs) - 1 : this.phase === 'hold' ? 0 : sine(this.t / revealMs);
    if (this.calm) this.drawDark(1 - Math.abs(s));
    else this.drawSail(s);
  }

  private drawDark(alpha: number): void {
    const r = visibleRect(8);
    this.g.clear().fillStyle(DUSK, alpha).fillRect(r.x, r.y, r.width, r.height);
  }

  /**
   * The sail at `s`: -1 wholly off to the left, 0 covering the window, 1 gone off to the right. Its luff and leech
   * both belly forward with the wind; seams run down it, a reef band crosses it, and it throws a shadow ahead.
   */
  private drawSail(s: number): void {
    const g = this.g.clear();
    const r = visibleRect(6);
    const belly = Math.min(150, r.width * 0.09);
    const span = r.width + belly * 2;
    const lead = r.right + belly + s * (span + belly * 2);
    const trail = lead - span;
    const N = 18;
    const top = r.y - 10;
    const H = r.height + 20;
    const edge = (mid: number, u: number) => mid - belly * (1 - Math.sin(Math.PI * u));
    const curve = (mid: number, from = 0, to = 1): Phaser.Math.Vector2[] => {
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= N; i++) {
        const u = from + ((to - from) * i) / N;
        pts.push(new Phaser.Math.Vector2(edge(mid, u), top + u * H));
      }
      return pts;
    };
    /** The stretch of canvas between two edge curves (by their middles), filled. */
    const band = (a: number, b: number, color: number, alpha: number) => {
      g.fillStyle(color, alpha).fillPoints([...curve(a), ...curve(b).reverse()], true);
    };

    // Its shadow, thrown ahead onto the screen it is passing over.
    if (s < 0.999) {
      band(lead, lead + 70, DUSK, 0.16);
      band(lead, lead + 34, DUSK, 0.2);
    }
    band(trail, lead, CANVAS, 1);
    // Sunlight in the belly, shade towards the edges where the cloth turns away.
    band(trail + span * 0.22, lead - span * 0.3, CANVAS_LIT, 0.45);
    band(trail + span * 0.34, lead - span * 0.42, CANVAS_LIT, 0.4);
    band(lead - 90, lead, CANVAS_SHADE, 0.22);
    band(lead - 34, lead, CANVAS_SHADE, 0.28);
    band(trail, trail + 60, CANVAS_SHADE, 0.2);

    // Cloths sewn edge to edge: a doubled seam every few feet.
    for (let x = trail + 64; x < lead - 20; x += 64) {
      g.lineStyle(1.6, SEAM, 0.55).strokePoints(curve(x));
      g.lineStyle(1, SEAM, 0.25).strokePoints(curve(x + 4));
    }
    // A reef band across it, with its reef points hanging.
    for (const u of [0.2, 0.31]) {
      const y = top + u * H;
      const x0 = edge(trail, u);
      const x1 = edge(lead, u);
      g.lineStyle(5, CANVAS_SHADE, 0.18).lineBetween(x0, y + 3, x1, y + 3);
      g.lineStyle(1.6, SEAM, 0.6).lineBetween(x0, y, x1, y);
      if (u > 0.25) continue;
      g.lineStyle(1.4, ROPE, 0.75);
      for (let x = x0 + 22; x < x1 - 10; x += 38) g.lineBetween(x, y, x + 2, y + 13);
    }
    // Boltropes along both edges.
    g.lineStyle(6, ROPE, 1).strokePoints(curve(lead));
    g.lineStyle(1.5, ROPE_LIT, 0.8).strokePoints(curve(lead - 1.5));
    g.lineStyle(6, ROPE, 1).strokePoints(curve(trail));
    g.lineStyle(1.5, ROPE_LIT, 0.8).strokePoints(curve(trail + 1.5));
  }
}

/**
 * Put the sail between screens: make scene.start() and scene.restart() on every scene (but `skip`) cover the window
 * first. Input on the old screen stops at once, so nothing is clicked twice on the way out; a second start while the
 * sail is still coming in replaces the first (the last word wins, as the co-op director needs).
 */
export function installTransitions(game: Phaser.Game, skip: string[] = []): void {
  game.scene.add(TRANSITION, TransitionScene, true);
  const sail = game.scene.getScene(TRANSITION) as TransitionScene;
  for (const scene of game.scene.scenes) if (scene !== sail && !skip.includes(scene.scene.key)) wrap(scene, sail);
}

function wrap(scene: Phaser.Scene, sail: TransitionScene): void {
  const plugin = scene.scene;
  const start = plugin.start.bind(plugin);
  const restart = plugin.restart.bind(plugin);
  /** What leaving will do, once the sail covers the window (the latest request). */
  let leave: (() => void) | null = null;
  /** Whether a frame has been drawn since create: a scene that leaves from create() (the dev battle shortcut) has nothing to hide. */
  let shown = false;
  scene.events.on(Phaser.Scenes.Events.CREATE, () => {
    leave = null;
    shown = false;
    scene.input.enabled = true;
    if (scene.input.keyboard) scene.input.keyboard.enabled = true;
    scene.events.once(Phaser.Scenes.Events.POST_UPDATE, () => (shown = true));
    // Not reached behind the sail (the first screen, or one the co-op director started cold): fade up from the deep.
    if (!sail.arrive()) scene.cameras.main.fadeIn(240, 6, 20, 32);
  });
  const go = (fn: () => void): Phaser.Scenes.ScenePlugin => {
    if (leave) {
      leave = fn;
      return plugin;
    }
    if (!shown || !scene.sys.isActive()) {
      fn();
      return plugin;
    }
    leave = fn;
    scene.input.enabled = false;
    if (scene.input.keyboard) scene.input.keyboard.enabled = false;
    let gone = false;
    const done = () => {
      if (gone) return;
      gone = true;
      leave?.();
    };
    sail.cover(done);
    // In case the sail never finishes (its scene stopped): leave anyway.
    scene.time.delayedCall(COVER_MS + 600, done);
    return plugin;
  };
  plugin.start = (key?: string | Phaser.Scene, data?: object) => go(() => start(key, data));
  plugin.restart = (data?: object) => go(() => restart(data));
}
