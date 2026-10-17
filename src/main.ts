import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/latin-400-italic.css';
import '@fontsource/lora/latin-700.css';
import '@fontsource/lora/latin-700-italic.css';
import fell from '@fontsource/im-fell-english/files/im-fell-english-latin-400-normal.woff2?url';
import fellItalic from '@fontsource/im-fell-english/files/im-fell-english-latin-400-italic.woff2?url';
import fellCaps from '@fontsource/im-fell-english-sc/files/im-fell-english-sc-latin-400-normal.woff2?url';
import loraFigures from '@fontsource/lora/files/lora-latin-400-normal.woff2?url';
import loraItalicFigures from '@fontsource/lora/files/lora-latin-400-italic.woff2?url';
import Phaser from 'phaser';
import { toggleMute } from './render/sound';
import { FONT_FACES, SCREEN } from './render/theme';
import { BattleScene } from './scenes/BattleScene';
import { EventScene } from './scenes/EventScene';
import { HailScene } from './scenes/HailScene';
import { LogbookScene } from './scenes/LogbookScene';
import { PortScene } from './scenes/PortScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ResultScene } from './scenes/ResultScene';
import { RunEndScene } from './scenes/RunEndScene';
import { SeaMapScene } from './scenes/SeaMapScene';
import { ShipSelectScene } from './scenes/ShipSelectScene';
import { TitleScene } from './scenes/TitleScene';

const params = new URLSearchParams(location.search);

// The Fell types with Lora's lining figures in place of their old-style ones, which read as letters ("o free of 9").
// The later face wins for the characters in its range.
const FIGURES = 'U+0030-0039';
for (const face of [
  new FontFace('STL Fell', `url(${fell})`),
  new FontFace('STL Fell', `url(${loraFigures})`, { unicodeRange: FIGURES }),
  new FontFace('STL Fell', `url(${fellItalic})`, { style: 'italic' }),
  new FontFace('STL Fell', `url(${loraItalicFigures})`, { style: 'italic', unicodeRange: FIGURES }),
  new FontFace('STL Fell SC', `url(${fellCaps})`),
  new FontFace('STL Fell SC', `url(${loraFigures})`, { unicodeRange: FIGURES }),
])
  document.fonts.add(face);

// Phaser rasterises each text once, so the type must be ready before the first scene writes any.
// A slow or failed font load gives up after a few seconds and the fallbacks stand in.
const fonts = Promise.all(FONT_FACES.map((f) => document.fonts.load(f, 'Aa1'))).catch(() => undefined);
void Promise.race([fonts, new Promise((r) => setTimeout(r, 4000))]).then(start);

function start(): void {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: SCREEN.w,
    height: SCREEN.h,
    backgroundColor: '#0b1622',
    disableContextMenu: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    // `?timer` drives the loop with setTimeout, for embedded/headless browsers that throttle requestAnimationFrame.
    fps: { forceSetTimeOut: params.has('timer'), target: 60 },
    scene: [PreloadScene, TitleScene, ShipSelectScene, SeaMapScene, EventScene, HailScene, PortScene, BattleScene, ResultScene, RunEndScene, LogbookScene],
  });

  // Every scene fades in from the deep and sinks back into it on the way out, so screens follow one another instead of cutting.
  // M mutes on every screen; the battle binds its own.
  game.events.once('ready', () => {
    for (const scene of game.scene.scenes) {
      scene.events.on('create', () => {
        scene.cameras.main.fadeIn(260, 6, 20, 32);
        if (scene.scene.key !== 'Battle') scene.input.keyboard?.on('keydown-M', () => toggleMute(game));
      });
      if (scene.scene.key !== 'Preload') fadeOutOnStart(scene);
    }
  });

  if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
}

/** Make scene.start() fade the camera out first. Input stops at once, so nothing is clicked twice on the way out. */
function fadeOutOnStart(scene: Phaser.Scene): void {
  const plugin = scene.scene;
  const start = plugin.start.bind(plugin);
  let leaving = false;
  /** Whether a frame has been drawn since create: a scene that leaves from create() (the dev battle shortcut) has nothing to fade. */
  let shown = false;
  scene.events.on('create', () => {
    leaving = false;
    shown = false;
    scene.input.enabled = true;
    if (scene.input.keyboard) scene.input.keyboard.enabled = true;
    scene.events.once('postupdate', () => (shown = true));
  });
  plugin.start = (key?: string | Phaser.Scene, data?: object) => {
    if (leaving) return plugin;
    if (!shown || !scene.sys.isActive()) return start(key, data);
    leaving = true;
    scene.input.enabled = false;
    if (scene.input.keyboard) scene.input.keyboard.enabled = false;
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      start(key, data);
    };
    scene.cameras.main.fade(180, 6, 20, 32, true, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => t >= 1 && go());
    // In case the fade is cut short.
    scene.time.delayedCall(260, go);
    return plugin;
  };
}
