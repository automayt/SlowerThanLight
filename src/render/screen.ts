import Phaser from 'phaser';
import { SCREEN } from './theme';

/**
 * The game fills the window. Every screen is still laid out on the 1280x720 design area (SCREEN), which each camera
 * zooms to fit and centres; the window's extra width or height shows more of the world round it, so backdrops reach
 * the real edges at any aspect ratio. The canvas is drawn at the screen's own pixel density (within a budget), so
 * text and vector art stay crisp on high-DPI and large screens instead of being stretched.
 *
 * Full-screen layers: anything added at (0, 0) with origin (0, 0) and exactly SCREEN.w x SCREEN.h (a painted
 * backdrop, a modal's shade, a vignette) is stretched to the visible edges automatically, and again whenever the
 * window changes. For anything else that should bleed to the edges, call bleed().
 */

/** How the design area maps onto the canvas: its size in canvas pixels, canvas pixels per design pixel, and density. */
export const view: { w: number; h: number; zoom: number; res: number; cssW: number; cssH: number; stamp: number } = {
  w: SCREEN.w,
  h: SCREEN.h,
  zoom: 1,
  res: 1,
  cssW: SCREEN.w,
  cssH: SCREEN.h,
  stamp: 0,
};

/** The most canvas pixels drawn per frame; a 4K window draws a little under its size and the browser scales it up. */
const MAX_PIXELS = 2560 * 1600;

function measure(parent: HTMLElement): { cssW: number; cssH: number; res: number; w: number; h: number } {
  const cssW = Math.max(320, parent.clientWidth || window.innerWidth);
  const cssH = Math.max(240, parent.clientHeight || window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const res = Math.max(0.5, Math.min(dpr, Math.sqrt(MAX_PIXELS / (cssW * cssH))));
  return { cssW, cssH, res, w: Math.round(cssW * res), h: Math.round(cssH * res) };
}

function apply(m: ReturnType<typeof measure>): void {
  view.w = m.w;
  view.h = m.h;
  view.res = m.res;
  view.cssW = m.cssW;
  view.cssH = m.cssH;
  view.zoom = Math.min(m.w / SCREEN.w, m.h / SCREEN.h);
  view.stamp++;
}

/** Scale settings for the game config: Phaser leaves the size to us, and the canvas is shown at CSS size. */
export function scaleConfig(parentId: string): Phaser.Types.Core.ScaleConfig {
  const m = measure(document.getElementById(parentId) ?? document.body);
  apply(m);
  return { mode: Phaser.Scale.NONE, width: m.w, height: m.h, zoom: 1 / m.res };
}

/** The part of design space on screen: the 1280x720 area plus whatever the window's shape adds round it. */
export function visibleRect(margin = 0): Phaser.Geom.Rectangle {
  const w = view.w / view.zoom;
  const h = view.h / view.zoom;
  return new Phaser.Geom.Rectangle(SCREEN.w / 2 - w / 2 - margin, SCREEN.h / 2 - h / 2 - margin, w + margin * 2, h + margin * 2);
}

/** A pointer's position (canvas pixels) in design coordinates, as the HUD and every unzoomed screen see it. */
export function toDesign(x: number, y: number): { x: number; y: number } {
  return { x: (x - view.w / 2) / view.zoom + SCREEN.w / 2, y: (y - view.h / 2) / view.zoom + SCREEN.h / 2 };
}

/** Fit a camera to the window, the design area centred; `zoom` scales it further about the point (cx, cy). */
export function fitCamera(cam: Phaser.Cameras.Scene2D.Camera, zoom = 1, cx = SCREEN.w / 2, cy = SCREEN.h / 2): void {
  if (cam.width !== view.w || cam.height !== view.h || cam.x !== 0 || cam.y !== 0) cam.setViewport(0, 0, view.w, view.h);
  cam.setZoom(view.zoom * zoom);
  cam.centerOn(cx, cy);
}

/** Cameras that a scene moves itself (the battle's), which the window fitting leaves alone. */
const managed = new WeakSet<Phaser.Cameras.Scene2D.Camera>();
export function manageCamera(cam: Phaser.Cameras.Scene2D.Camera, on = true): void {
  if (on) managed.add(cam);
  else managed.delete(cam);
}

// --- Text density -----------------------------------------------------------

/** Text is rasterised once, so it is drawn at the density it is shown at. */
function textResolution(): number {
  return Math.min(3, Math.max(1, Math.ceil(view.zoom * 2) / 2));
}
const autoRes = new WeakSet<Phaser.GameObjects.Text>();

function patchTextFactory(): void {
  const proto = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (x: number, y: number, text: string | string[], style?: Phaser.Types.GameObjects.Text.TextStyle) => Phaser.GameObjects.Text;
  };
  const make = proto.text;
  proto.text = function (this: Phaser.GameObjects.GameObjectFactory, x, y, text, style) {
    if (style?.resolution) return make.call(this, x, y, text, style);
    const t = make.call(this, x, y, text, { ...style, resolution: textResolution() });
    autoRes.add(t);
    return t;
  };
}

function eachObject(list: Phaser.GameObjects.GameObject[], fn: (o: Phaser.GameObjects.GameObject) => void): void {
  for (const o of list) {
    fn(o);
    if (o instanceof Phaser.GameObjects.Container) eachObject(o.list, fn);
  }
}

// --- Layers that bleed to the edges -------------------------------------------

type Fit = (r: Phaser.Geom.Rectangle) => void;
interface Bleed {
  obj: Phaser.GameObjects.GameObject | null;
  fit: Fit;
}
const bleeds = new WeakMap<Phaser.Scene, Bleed[]>();
const pending = new WeakMap<Phaser.Scene, Phaser.GameObjects.GameObject[]>();

/** Keep something sized to the visible area: `fit` is called now and whenever the window changes, until `obj` is gone. */
export function bleed(scene: Phaser.Scene, obj: Phaser.GameObjects.GameObject | null, fit: Fit): void {
  let list = bleeds.get(scene);
  if (!list) {
    list = [];
    bleeds.set(scene, list);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bleeds.delete(scene));
  }
  list.push({ obj, fit });
  fit(visibleRect());
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/** Whether an object is a full-screen layer: at the origin, from its top-left corner, the design area's exact size. */
function fullScreen(o: Phaser.GameObjects.GameObject): o is Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image {
  if (!(o instanceof Phaser.GameObjects.Rectangle || o instanceof Phaser.GameObjects.Image) || o.parentContainer) return false;
  return near(o.x, 0) && near(o.y, 0) && o.originX === 0 && o.originY === 0 && near(o.displayWidth, SCREEN.w) && near(o.displayHeight, SCREEN.h);
}

function stretch(o: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Image): Fit {
  return (r) => {
    if (o instanceof Phaser.GameObjects.Rectangle) {
      o.setPosition(r.x, r.y).setSize(r.width, r.height);
      const hit = o.input?.hitArea as Phaser.Geom.Rectangle | undefined;
      if (hit) hit.setTo(0, 0, r.width, r.height);
    } else o.setPosition(r.x, r.y).setDisplaySize(r.width, r.height);
  };
}

function hookScene(scene: Phaser.Scene): void {
  // Anything the scene made before it was first seen here is checked too.
  const queue: Phaser.GameObjects.GameObject[] = [...scene.children.list];
  pending.set(scene, queue);
  scene.sys.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (o: Phaser.GameObjects.GameObject) => queue.push(o));
}

const fitted = new WeakMap<Phaser.Cameras.Scene2D.Camera, number>();

/** Per frame, before drawing: fit cameras after a resize, and stretch any full-screen layers added since. */
function prerender(game: Phaser.Game): void {
  for (const scene of game.scene.scenes) {
    // Loading screens are drawn too, so a scene counts from the moment it starts loading.
    const status = scene.sys.settings.status;
    if (!scene.sys.settings.visible || status < Phaser.Scenes.LOADING || status > Phaser.Scenes.RUNNING) continue;
    if (!pending.has(scene)) hookScene(scene);
    const queue = pending.get(scene)!;
    if (queue.length) {
      for (const o of queue) if (o.active && fullScreen(o)) bleed(scene, o, stretch(o));
      queue.length = 0;
    }
    const stamp = (scene.sys as unknown as { stlStamp?: number }).stlStamp;
    for (const cam of scene.cameras.cameras) {
      if (managed.has(cam) || fitted.get(cam) === view.stamp) continue;
      fitCamera(cam);
      fitted.set(cam, view.stamp);
    }
    if (stamp !== view.stamp) {
      (scene.sys as unknown as { stlStamp?: number }).stlStamp = view.stamp;
      const r = visibleRect();
      const list = bleeds.get(scene);
      if (list) {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i];
          if (b.obj && !b.obj.scene) list.splice(i, 1);
          else b.fit(r);
        }
      }
    }
  }
}

/** Re-measure the window; resize the canvas, refit every screen and redraw text at the new density. */
function onResize(game: Phaser.Game, parent: HTMLElement): void {
  const m = measure(parent);
  if (m.w === view.w && m.h === view.h && m.res === view.res && m.cssW === view.cssW) return;
  const oldRes = textResolution();
  apply(m);
  if (game.scale.zoom !== 1 / m.res) game.scale.setZoom(1 / m.res);
  game.scale.resize(m.w, m.h);
  const res = textResolution();
  if (res !== oldRes) {
    for (const scene of game.scene.scenes) {
      if (!scene.sys.isActive()) continue;
      eachObject(scene.children.list, (o) => {
        if (o instanceof Phaser.GameObjects.Text && autoRes.has(o)) o.setResolution(res);
      });
    }
  }
}

/** Fill the window from now on: follow its size, refit the screens each frame they need it, and bind F11. */
export function installScreen(game: Phaser.Game, parentId: string): void {
  const parent = document.getElementById(parentId) ?? document.body;
  let queued = false;
  const resize = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      onResize(game, parent);
    });
  };
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);
  // A change of display (dragging the window to another monitor) changes the density without a resize.
  const watchDensity = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => (resize(), watchDensity()), { once: true });
  watchDensity();
  game.events.on(Phaser.Core.Events.PRE_RENDER, () => prerender(game));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F11' || e.repeat) return;
    e.preventDefault();
    toggleFullscreen();
  });
}

patchTextFactory();

// --- Fullscreen ------------------------------------------------------------------

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

/** Into fullscreen or out of it. Needs a click or key press to have started it (browsers refuse otherwise). */
export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
}

// --- Motion --------------------------------------------------------------------

const MOTION_KEY = 'stl:reduced-motion';
const motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

function savedCalm(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === '1' || new URLSearchParams(location.search).has('calm');
  } catch {
    return false;
  }
}
let calm = savedCalm();

/** The player asked for less motion: the system setting, `?calm` in the address, or the saved flag (see setReducedMotion). */
export function reducedMotion(): boolean {
  return calm || !!motionQuery?.matches;
}

export function setReducedMotion(on: boolean): void {
  calm = on;
  try {
    if (on) localStorage.setItem(MOTION_KEY, '1');
    else localStorage.removeItem(MOTION_KEY);
  } catch {
    // Storage blocked: the setting lasts for this visit.
  }
}

/** How much of the decorative motion (camera moves, rolling ships, shake) to play: all of it, or a little. */
export function motionScale(): number {
  return reducedMotion() ? 0.3 : 1;
}
