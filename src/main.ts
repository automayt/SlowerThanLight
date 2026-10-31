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
import { installScreen, scaleConfig } from './render/screen';
import { toggleMute } from './render/sound';
import { FONT_FACES } from './render/theme';
import { installTransitions } from './render/transitions';
import { BattleScene } from './scenes/BattleScene';
import { EventScene } from './scenes/EventScene';
import { HailScene } from './scenes/HailScene';
import { CoopLobbyScene } from './scenes/CoopLobbyScene';
import { LogbookScene } from './scenes/LogbookScene';
import { PortScene } from './scenes/PortScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ResultScene } from './scenes/ResultScene';
import { RunEndScene } from './scenes/RunEndScene';
import { SeaMapScene } from './scenes/SeaMapScene';
import { HarbourScene } from './scenes/HarbourScene';
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
    backgroundColor: '#0b1622',
    disableContextMenu: true,
    // The canvas fills the window at the screen's own pixel density; each camera fits the 1280x720 design area to it.
    scale: scaleConfig('game'),
    // `?timer` drives the loop with setTimeout, for embedded/headless browsers that throttle requestAnimationFrame.
    fps: { forceSetTimeOut: params.has('timer'), target: 60 },
    scene: [PreloadScene, TitleScene, HarbourScene, SeaMapScene, EventScene, HailScene, PortScene, BattleScene, ResultScene, RunEndScene, LogbookScene, CoopLobbyScene],
  });

  installScreen(game, 'game');
  // Screens change behind a sail sweeping across (see transitions.ts). M mutes on every screen; the battle binds its own.
  game.events.once('ready', () => {
    for (const scene of game.scene.scenes) {
      scene.events.on('create', () => {
        if (scene.scene.key !== 'Battle') scene.input.keyboard?.on('keydown-M', () => toggleMute(game));
      });
    }
    installTransitions(game);
  });

  if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
}
