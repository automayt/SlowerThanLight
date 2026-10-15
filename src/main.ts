import Phaser from 'phaser';
import { SCREEN } from './render/theme';
import { BattleScene } from './scenes/BattleScene';
import { EventScene } from './scenes/EventScene';
import { PortScene } from './scenes/PortScene';
import { ResultScene } from './scenes/ResultScene';
import { RunEndScene } from './scenes/RunEndScene';
import { SeaMapScene } from './scenes/SeaMapScene';
import { ShipSelectScene } from './scenes/ShipSelectScene';
import { TitleScene } from './scenes/TitleScene';

const params = new URLSearchParams(location.search);

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
  scene: [TitleScene, ShipSelectScene, SeaMapScene, EventScene, PortScene, BattleScene, ResultScene, RunEndScene],
});

if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
