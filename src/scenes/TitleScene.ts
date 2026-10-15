import Phaser from 'phaser';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
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
        .text(cx, 404, `${saved.def.name} · leg ${saved.node.col} of ${saved.chart.columns - 1} · ${saved.gold} gold`, textStyle(14, COLORS.textDim))
        .setOrigin(0.5, 0);
    } else {
      new Button(this, cx - 110, 340, 220, 52, 'Set Sail', () => this.scene.start('ShipSelect'), { size: 22 });
    }

    const help = [
      'Space — pause (you can still give orders)',
      'Click crew, then a room — move them. Shift-click selects several.',
      'Click a gun card, then an enemy room — aim. Right-click a card — hold fire.',
      'Hands are your power: put them on Sails, Pumps, the Surgeon and the guns.',
    ];
    this.add.text(cx, 470, help.join('\n'), textStyle(15, COLORS.textDim, { align: 'center', lineSpacing: 8 })).setOrigin(0.5, 0);

    this.input.keyboard!.once('keydown-ENTER', () => (saved ? resume() : this.scene.start('ShipSelect')));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
