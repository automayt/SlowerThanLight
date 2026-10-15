import Phaser from 'phaser';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { placeBackdrop } from '../render/art';
import { isMuted, playLoop, toggleMute } from '../render/sound';
import { setRun } from '../render/RunBar';
import { Button, Sea } from '../render/ui';
import { loadRun, sceneFor } from './save';

export class TitleScene extends Phaser.Scene {
  private sea!: Sea;

  constructor() {
    super('Title');
  }

  create(): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    placeBackdrop(this, 'title', SCREEN.w, SCREEN.h, 0.3);
    const cx = SCREEN.w / 2;

    this.add
      .text(cx, 190, 'SLOWER THAN LIGHT', { fontFamily: TITLE_FONT, fontSize: '72px', color: COLORS.gold, stroke: '#000000', strokeThickness: 8 })
      .setOrigin(0.5);
    this.add.text(cx, 262, 'A pirate’s life, one broadside at a time', { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.text, fontStyle: 'italic' }).setOrigin(0.5);

    const saved = loadRun();
    const resume = () => {
      if (!saved) return;
      setRun(this, saved);
      this.registry.set('chart-note', `You take up the voyage again aboard ${saved.def.name}.`);
      this.scene.start(sceneFor(saved));
    };
    if (saved) {
      new Button(this, cx - 230, 340, 220, 52, 'Continue Voyage', resume, { size: 22 });
      new Button(this, cx + 10, 340, 220, 52, 'New Voyage', () => this.scene.start('ShipSelect'), { size: 22 });
      this.add
        .text(cx, 404, `${saved.def.name} · leg ${saved.node.col} of ${saved.chart.columns - 1} · ${saved.gold} gold`, textStyle(14, COLORS.text, { backgroundColor: '#0b1622bb', padding: { x: 10, y: 4 } }))
        .setOrigin(0.5, 0);
    } else {
      new Button(this, cx - 110, 340, 220, 52, 'Set Sail', () => this.scene.start('ShipSelect'), { size: 22 });
    }

    new Button(this, SCREEN.w - 190, SCREEN.h - 58, 170, 38, 'Logbook', () => this.scene.start('Logbook'), { size: 16 });
    const sound = new Button(this, 20, SCREEN.h - 58, 150, 38, isMuted() ? 'Sound: off' : 'Sound: on', () => sound.setText(toggleMute(this.game) ? 'Sound: off' : 'Sound: on'), { size: 16 });
    playLoop(this, 'shanty', 0.35);

    const help = [
      'Space — pause (you can still give orders)',
      'Click crew, then a room — move them. Shift-click selects several.',
      'Click a gun card, then an enemy room — aim. Right-click a card — hold fire.',
      'Hands are your power: put them on Sails, Pumps, the Surgeon and the guns.',
      'Select crew, then click an enemy room to BOARD her (if you are as fast as she is).',
    ];
    this.add
      .text(cx, 470, help.join('\n'), textStyle(15, COLORS.text, { align: 'center', lineSpacing: 8, backgroundColor: '#0b1622bb', padding: { x: 16, y: 10 } }))
      .setOrigin(0.5, 0);

    this.input.keyboard!.once('keydown-ENTER', () => (saved ? resume() : this.scene.start('ShipSelect')));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
