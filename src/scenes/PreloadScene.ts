import Phaser from 'phaser';
import { bleed, visibleRect } from '../render/screen';
import { applySound, installMusicDirector, soundKey } from '../render/sound';
import { CAPS_FONT, COLORS, SCREEN, textStyle, titleStyle } from '../render/theme';

interface Manifest {
  files: string[];
  /** Audio only: music beds, which the music director streams in after the first screen is up. */
  music?: string[];
}

/**
 * Loads the painted illustrations listed in public/art/manifest.json. Backdrops load up front; event
 * vignettes load on demand when their event opens (see loadArtOnDemand). The game runs fine without any of them.
 */
export class PreloadScene extends Phaser.Scene {
  /** How far the loading has got, and how far the ship on the course line shows (catching up smoothly). */
  private progress = 0;
  private shown = 0;
  private loaded = false;
  private leaving = false;

  constructor() {
    super('Preload');
  }

  preload(): void {
    this.progress = 0;
    this.shown = 0;
    this.loaded = false;
    this.leaving = false;
    this.loadingScreen();
    this.load.on('progress', (p: number) => (this.progress = p));
    // Loaded as text: without a manifest the dev server answers with index.html, which must not crash the JSON parser.
    this.load.on('filecomplete-text-art-manifest', (_key: string, _type: string, data: string) => {
      const files = parseManifest(data);
      this.registry.set('art-files', files);
      for (const file of files) if (!file.startsWith('event-')) this.load.image(artKey(file), `art/${file}`);
    });
    this.load.text('art-manifest', 'art/manifest.json');
    this.load.on('filecomplete-text-audio-manifest', (_key: string, _type: string, data: string) => {
      for (const file of parseManifest(data, AUDIO)) this.load.audio(soundKey(file), `audio/${file}`);
      this.registry.set('music-files', parseManifest(data, AUDIO, 'music'));
    });
    this.load.text('audio-manifest', 'audio/manifest.json');
  }

  create(): void {
    applySound(this.game);
    installMusicDirector(this.game, (this.registry.get('music-files') as string[] | undefined) ?? []);
    // The ship makes her landfall at the end of the line, then the title sweeps in.
    this.loaded = true;
    this.progress = 1;
  }

  /**
   * Night at sea, the title, and a course pricked out across a chart line with a little ship sailing along it as the
   * art and sound come in. All drawn, nothing loaded: it is up before anything else is.
   */
  private loadingScreen(): void {
    const sky = this.add.graphics();
    const sea = this.add.graphics();
    const cx = SCREEN.w / 2;
    const HORIZON = 430;
    const LINE = { x0: 380, x1: 900, y: 520 };
    bleed(this, sky, (r) => {
      sky.clear();
      sky.fillGradientStyle(0x050b12, 0x050b12, 0x10263a, 0x10263a, 1).fillRect(r.x, r.y, r.width, HORIZON - r.y);
      // A low moon over the horizon, and its path on the water.
      for (let i = 6; i > 0; i--) sky.fillStyle(0xe8dcb8, 0.018).fillCircle(cx + 250, HORIZON - 120, 18 + i * 12);
      sky.fillStyle(0xf2e8c8, 0.85).fillCircle(cx + 250, HORIZON - 120, 18);
      sky.fillGradientStyle(0x0d2233, 0x0d2233, 0x050b12, 0x050b12, 1).fillRect(r.x, HORIZON, r.width, r.bottom - HORIZON);
    });
    this.add.text(cx, 236, 'Slower Than Light', titleStyle(64, COLORS.gold, { fontFamily: CAPS_FONT })).setOrigin(0.5).setShadow(0, 3, '#000000', 8, false, true);
    this.add.text(cx, 290, 'A pirate’s life, one broadside at a time', titleStyle(20, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(0.5);
    const note = this.add.text(cx, LINE.y + 34, 'Weighing anchor…', textStyle(14, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(0.5);
    const course = this.add.graphics();
    const ship = this.add.graphics();
    const notes = ['Weighing anchor…', 'Bending on sail…', 'Running out the guns…', 'Charting the shoals…', 'Making landfall…'];

    this.events.on(Phaser.Scenes.Events.UPDATE, (time: number, delta: number) => {
      const t = time / 1000;
      const dt = Math.min(0.1, delta / 1000);
      this.shown += (this.progress - this.shown) * Math.min(1, dt * 4);
      if (this.progress - this.shown < 0.004) this.shown = this.progress;
      const k = this.shown;
      note.setText(`${notes[Math.min(notes.length - 1, Math.floor(k * notes.length))]}  ${Math.round(k * 100)}%`);

      // Swell lines rolling across the dark water.
      const r = visibleRect();
      sea.clear();
      for (let row = 0; row < 9; row++) {
        const y = HORIZON + 14 + row * row * 4.2 + row * 6;
        const a = 0.05 + row * 0.018;
        sea.lineStyle(1 + row * 0.25, 0x6fa3c4, a);
        const step = 90 + row * 22;
        const off = ((t * (8 + row * 4) + row * 61) % step) - step;
        for (let x = r.x + off; x < r.right; x += step) sea.lineBetween(x, y + Math.sin(t + x * 0.01) * 1.5, x + step * 0.35, y + Math.sin(t + x * 0.01 + 1) * 1.5);
      }
      // The moon's path.
      for (let i = 0; i < 7; i++) {
        const y = HORIZON + 6 + i * 13;
        const w = 30 + i * 10 + Math.sin(t * 1.3 + i) * 8;
        sea.fillStyle(0xf2e8c8, 0.12 - i * 0.012).fillRect(cx + 250 - w / 2, y, w, 2);
      }

      // The course: pricked out ahead, inked in behind her.
      const x = LINE.x0 + (LINE.x1 - LINE.x0) * k;
      course.clear();
      course.fillStyle(0xc9b48a, 0.35);
      for (let px = x + 10; px < LINE.x1; px += 12) course.fillCircle(px, LINE.y, 1.6);
      course.lineStyle(2, 0xd9b467, 0.9).lineBetween(LINE.x0, LINE.y, x, LINE.y);
      course.fillStyle(0xd9b467, 1).fillCircle(LINE.x0, LINE.y, 4);
      course.lineStyle(2, 0xd9b467, 0.9).strokeCircle(LINE.x1, LINE.y, 6);
      course.lineBetween(LINE.x1 - 4, LINE.y - 4, LINE.x1 + 4, LINE.y + 4).lineBetween(LINE.x1 + 4, LINE.y - 4, LINE.x1 - 4, LINE.y + 4);
      drawShip(ship, x, LINE.y - 4 + Math.sin(t * 2.2) * 1.5, Math.sin(t * 1.6) * 0.05, t);

      if (this.loaded && !this.leaving && this.shown >= 1) {
        this.leaving = true;
        this.time.delayedCall(250, () => this.scene.start('Title'));
      }
    });
  }
}

/** A little ship in profile, under all plain sail, rocking on the course line at (x, y). */
function drawShip(g: Phaser.GameObjects.Graphics, x: number, y: number, tilt: number, t: number): void {
  g.clear();
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const P = (dx: number, dy: number) => new Phaser.Math.Vector2(x + dx * c - dy * s, y + dx * s + dy * c);
  // A thread of wake astern.
  g.lineStyle(1.5, 0xe8f4f8, 0.35).lineBetween(x - 22, y + 3, x - 52 - Math.sin(t * 3) * 4, y + 4);
  // Masts, then sails bellied forward, then the hull.
  g.lineStyle(1.6, 0x2a1a0c, 1);
  for (const [mx, h] of [
    [-8, 30],
    [4, 36],
    [15, 26],
  ]) {
    const a = P(mx, 0);
    const b = P(mx, -h);
    g.lineBetween(a.x, a.y, b.x, b.y);
    for (const [y0, y1, w] of [
      [-h + 3, -h * 0.55, 6],
      [-h * 0.5, -6, 8],
    ]) {
      g.fillStyle(0xe6dcc0, 1).fillPoints([P(mx - w, y0), P(mx + w + 2, y0 + 1), P(mx + w + 4, (y0 + y1) / 2), P(mx + w + 2, y1), P(mx - w, y1)], true);
    }
  }
  g.fillStyle(0x3a2412, 1).fillPoints([P(-24, -6), P(27, -6), P(33, -9), P(22, 4), P(-20, 4), P(-26, -3)], true);
  g.lineStyle(1, 0xd9b467, 0.8).lineBetween(P(-22, -3).x, P(-22, -3).y, P(26, -3).x, P(26, -3).y);
  // Bowsprit and a pennant streaming from the main.
  g.lineStyle(1.4, 0x2a1a0c, 1).lineBetween(P(27, -6).x, P(27, -6).y, P(40, -14).x, P(40, -14).y);
  const top = P(4, -36);
  g.lineStyle(1.6, 0x8e1b14, 1).lineBetween(top.x, top.y, top.x - 10, top.y + Math.sin(t * 7) * 1.5);
}

/** Queue a piece of art in a scene's preload() if the manifest lists it and it is not loaded yet. */
export function loadArtOnDemand(scene: Phaser.Scene, name: string): void {
  const files = (scene.registry.get('art-files') as string[] | undefined) ?? [];
  const file = files.find((f) => artKey(f) === `art:${name}`);
  if (file && !scene.textures.exists(artKey(file))) scene.load.image(artKey(file), `art/${file}`);
}

const AUDIO = /\.(ogg|mp3|wav|m4a)$/i;

/** Files of one kind listed in the manifest (under "files" unless told otherwise); none when it is missing or malformed. */
function parseManifest(text: string, kind = /\.(jpe?g|png|webp)$/i, list: keyof Manifest = 'files'): string[] {
  try {
    const files = (JSON.parse(text) as Manifest)[list];
    return Array.isArray(files) ? files.filter((f) => typeof f === 'string' && /^[\w-]+\.\w+$/.test(f) && kind.test(f)) : [];
  } catch {
    return [];
  }
}

/** Texture key for an art file: "event-storm.jpg" → "art:event-storm". */
export function artKey(file: string): string {
  return `art:${file.replace(/\.[a-z]+$/i, '')}`;
}
