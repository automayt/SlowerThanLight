import Phaser from 'phaser';
import { fitCamera, manageCamera, motionScale, reducedMotion, view } from './screen';
import { SCREEN } from './theme';

/** Anything at or above this depth (the HUD, banners, tooltips, the vignette) is on the fixed UI camera. */
export const UI_LAYER = 30;

/** How far a broadside leans the camera in, and a lone gun. */
const BROADSIDE_ZOOM = 0.055;
const SHOT_ZOOM = 0.012;
/** Two of one ship's guns within this long of each other make a broadside. */
const BROADSIDE_WINDOW = 0.5;
/** How far the camera pulls back while boarders swing across. */
const BOARD_PULL = 0.075;

const sine = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, k)));

/**
 * The battle's two cameras. The world camera watches the sea and the ships: it leans in on a broadside, shakes when
 * a ball strikes hard, and draws back to take in both ships while boarders go across. The UI camera over it never
 * moves, so the HUD stays put and readable. Which camera draws what goes by depth (UI_LAYER), sorted each frame, so
 * the HUD's own code needs no changes.
 */
export class BattleCamera {
  readonly world: Phaser.Cameras.Scene2D.Camera;
  readonly ui: Phaser.Cameras.Scene2D.Camera;
  /** The current lean-in: when it started, where it looks, and how far. */
  private punch = { t0: -10, x: SCREEN.w / 2, y: SCREEN.h / 2, amount: 0 };
  private lastShot: Record<string, number> = {};
  /** 0..1, easing toward 1 while boarders are crossing. */
  private board = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.world = scene.cameras.main;
    manageCamera(this.world);
    this.ui = scene.cameras.add(0, 0, view.w, view.h, false, 'ui');
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => manageCamera(this.world, false));
    this.fit(1, SCREEN.w / 2, SCREEN.h / 2);
  }

  /** A pointer's position in the world, as the ships see it (the world camera may be leaning in or drawn back). */
  worldPoint(ptr: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return this.world.getWorldPoint(ptr.x, ptr.y);
  }

  /** One of `side`'s guns has fired from (x, y) at a ship lying round (tx, ty). */
  shot(side: string, x: number, y: number, tx: number, ty: number): void {
    const now = this.scene.time.now / 1000;
    const broadside = now - (this.lastShot[side] ?? -10) < BROADSIDE_WINDOW;
    this.lastShot[side] = now;
    this.lean((x + tx) / 2, (y + ty) / 2, broadside ? BROADSIDE_ZOOM : SHOT_ZOOM);
  }

  /** Lean in toward (x, y) by `amount` (0.05 is a broadside); a stronger lean takes over from a weaker one. */
  lean(x: number, y: number, amount: number): void {
    const now = this.scene.time.now / 1000;
    const current = this.punch.amount * this.envelope(now);
    if (amount < current) return;
    // Already leaning in: carry on from the top rather than easing in again.
    const held = current > amount * 0.6;
    this.punch = { t0: held ? now - 0.25 : now, x, y, amount };
  }

  /** Shake the world (never the HUD), gentler when the player has asked for less motion. */
  shake(duration: number, intensity: number): void {
    const calm = reducedMotion();
    this.world.shake(calm ? duration * 0.5 : duration, intensity * motionScale());
  }

  flash(duration: number, r: number, g: number, b: number): void {
    this.world.flash(duration, r, g, b);
  }

  /** Each frame: sort the layers between the cameras, then ease the world camera toward where it should look. */
  update(timeMs: number, deltaMs: number, boarding: boolean): void {
    const worldId = this.world.id;
    const uiId = this.ui.id;
    for (const o of this.scene.children.list) {
      const d = (o as unknown as { depth?: number }).depth ?? 0;
      o.cameraFilter = d >= UI_LAYER ? worldId : uiId;
    }
    const dt = Math.min(0.1, deltaMs / 1000);
    this.board += ((boarding ? 1 : 0) - this.board) * Math.min(1, dt * 1.6);
    const motion = reducedMotion() ? 0 : 1;
    const e = this.envelope(timeMs / 1000) * motion;
    const zoom = (1 + this.punch.amount * e) * (1 - BOARD_PULL * sine(this.board) * motion);
    // Lean toward the action, but only part of the way: both ships stay in view.
    const k = 0.45 * e;
    this.fit(zoom, SCREEN.w / 2 + (this.punch.x - SCREEN.w / 2) * k, SCREEN.h / 2 + (this.punch.y - SCREEN.h / 2) * k);
  }

  private fit(zoom: number, x: number, y: number): void {
    fitCamera(this.world, zoom, x, y);
  }

  /** How far into the current lean: in quickly, a beat held, then a long ease back out. */
  private envelope(now: number): number {
    const t = now - this.punch.t0;
    if (t < 0 || t > 2) return 0;
    if (t < 0.25) return sine(t / 0.25);
    if (t < 0.6) return 1;
    return 1 - sine((t - 0.6) / 1.3);
  }
}
