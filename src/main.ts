import Phaser from 'phaser';
import { SCREEN } from './render/theme';
import { BattleScene } from './scenes/BattleScene';
import { ResultScene } from './scenes/ResultScene';
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
  scene: [TitleScene, ShipSelectScene, BattleScene, ResultScene],
});

if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
