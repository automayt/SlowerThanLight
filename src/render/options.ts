import Phaser from 'phaser';
import { escPressed, wasEscHandled } from './escape';
import { Button } from './ui';

/** The options overlay's scene key (see scenes/OptionsScene.ts). */
export const OPTIONS = 'Options';

/** Scenes that are not screens of their own: never paused under the options, never the screen the options open over. */
export const NOT_SCREENS = new Set(['AudioDirector', 'Preload', 'CoopDirector', OPTIONS, 'Transition']);

/** The screens showing (running, or paused under the options), top first. */
export function screens(game: Phaser.Game): Phaser.Scene[] {
  return game.scene
    .getScenes(false)
    .filter((s) => !NOT_SCREENS.has(s.scene.key) && s.sys.settings.status >= Phaser.Scenes.RUNNING && s.sys.settings.status <= Phaser.Scenes.PAUSED)
    .reverse();
}

export function optionsOpen(game: Phaser.Game): boolean {
  const s = game.scene.getScene(OPTIONS);
  return !!s && (s.sys.isActive() || s.sys.settings.status === Phaser.Scenes.CREATING);
}

/** Whether the options may open now: over a screen that is up and listening (not loading, not mid-transition). */
function canOpen(game: Phaser.Game): boolean {
  if (optionsOpen(game) || game.scene.isActive('Preload')) return false;
  const top = screens(game)[0];
  return !!top && top.sys.isActive() && top.input.enabled && top.input.keyboard?.enabled !== false;
}

/** Open the options over whatever is showing. */
export function openOptions(game: Phaser.Game): void {
  if (!canOpen(game)) return;
  game.scene.run(OPTIONS);
  game.scene.bringToTop(OPTIONS);
}

/**
 * Esc on any screen opens the options, unless the screen used the key itself (it calls escHandled()). The press is
 * noted as it happens, then Phaser hands it to the scenes; after the step, an Esc nobody handled opens the options.
 */
export function installOptions(game: Phaser.Game): void {
  let pending = false;
  // In the capture phase, so the press is noted before Phaser (listening on the window too) hands it to the scenes.
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.repeat) return;
      pending = true;
      escPressed();
    },
    true,
  );
  game.events.on(Phaser.Core.Events.POST_STEP, () => {
    if (!pending) return;
    pending = false;
    if (!wasEscHandled()) openOptions(game);
  });
}

/** A brass cog: the options (Esc does the same on any screen). */
export class OptionsButton extends Button {
  private readonly icon: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, size = 34) {
    super(scene, x, y, size, size, '', () => openOptions(scene.game), { tip: 'Options: sound, motion, text speed and keys (Esc).' });
    this.icon = scene.add.graphics();
    this.add(this.icon);
    const s = size / 34;
    const c = size / 2;
    const g = this.icon;
    const ink = 0xefe6d0;
    // Eight square teeth round a wheel, with the axle hole cut out.
    g.fillStyle(ink, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const pts = [-0.32, 0.32].flatMap((da) => [new Phaser.Math.Vector2(c + Math.cos(a + da * 0.55) * 8 * s, c + Math.sin(a + da * 0.55) * 8 * s), new Phaser.Math.Vector2(c + Math.cos(a + da * 0.42) * 12.5 * s, c + Math.sin(a + da * 0.42) * 12.5 * s)]);
      g.fillPoints([pts[0], pts[1], pts[3], pts[2]], true);
    }
    g.fillCircle(c, c, 9 * s);
    g.fillStyle(0x2a1a0e, 1).fillCircle(c, c, 3.6 * s);
  }
}
