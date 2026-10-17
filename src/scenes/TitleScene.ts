import Phaser from 'phaser';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { placeBackdrop } from '../render/art';
import { isMuted, playLoop, stopLoop, toggleMute } from '../render/sound';
import { setRun } from '../render/RunBar';
import { Button, Sea } from '../render/ui';
import { Run } from '../sim/Run';
import { disableSaving, loadRun, sceneFor } from './save';

export class TitleScene extends Phaser.Scene {
  private sea!: Sea;
  /** The open "How to play" sheet, if any. */
  private help: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Title');
  }

  init(): void {
    this.help = [];
  }

  create(): void {
    if (import.meta.env.DEV && this.devBattle()) return;
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
        .text(cx, 404, `${saved.def.name} · ${saved.sectorDef.name} · leg ${saved.legs.sailed} of ${saved.legs.total} · ${saved.gold} gold`, textStyle(14, COLORS.text, { backgroundColor: '#0b1622bb', padding: { x: 10, y: 4 } }))
        .setOrigin(0.5, 0);
    } else {
      new Button(this, cx - 110, 340, 220, 52, 'Set Sail', () => this.scene.start('ShipSelect'), { size: 22 });
    }

    new Button(this, SCREEN.w - 190, SCREEN.h - 58, 170, 38, 'Logbook', () => this.scene.start('Logbook'), { size: 16 });
    const sound = new Button(this, 20, SCREEN.h - 58, 150, 38, isMuted() ? 'Sound: off' : 'Sound: on', () => sound.setText(toggleMute(this.game) ? 'Sound: off' : 'Sound: on'), { size: 16 });
    playLoop(this, 'shanty', 0.35);
    stopLoop(this, 'creak');

    // The controls live behind a button, so the painting stays clear.
    new Button(this, cx - 85, SCREEN.h - 58, 170, 38, 'How to play', () => this.showHelp(), { size: 16 });
    this.input.keyboard!.on('keydown-ESC', () => this.closeHelp());
    this.input.keyboard!.on('keydown-ENTER', () => {
      if (this.help.length) this.closeHelp();
      else if (saved) resume();
      else this.scene.start('ShipSelect');
    });
  }

  /** The controls, written on a sheet of parchment over the title. */
  private showHelp(): void {
    if (this.help.length) return;
    const lines: [string, string][] = [
      ['Space', 'Pause. You can still give orders.'],
      ['Crew', 'Click crew, then a room, to move them. Shift-click selects several.'],
      ['Guns', 'Click a gun card, then an enemy room, to aim. Right-click a card to hold fire.'],
      ['Deckhands', 'They are your power: put them on Bulwarks, Sails, Pumps, the Surgeon and the guns.'],
      ['Boarding', 'Select crew, then click an enemy room to board her (if you are as fast as she is).'],
    ];
    const w = 720;
    const h = 380;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2 - 10;
    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setDepth(30).setInteractive();
    shade.on('pointerdown', () => this.closeHelp());
    this.help.push(shade, this.add.rectangle(x + 6, y + 8, w, h, 0x000000, 0.45).setOrigin(0).setDepth(31));
    if (this.textures.exists('art:tex-chart')) {
      const img = this.add.image(x + w / 2, y + h / 2, 'art:tex-chart').setDepth(31);
      const scale = Math.max(w / img.width, h / img.height);
      img.setScale(scale).setCrop((img.width - w / scale) / 2, (img.height - h / scale) / 2, w / scale, h / scale);
      // A pale wash quietens the chart's drawings under the writing.
      this.help.push(img, this.add.rectangle(x, y, w, h, 0xefe2bf, 0.6).setOrigin(0).setDepth(31));
    } else {
      this.help.push(this.add.rectangle(x, y, w, h, 0xd9c49a).setOrigin(0).setDepth(31));
    }
    const ink = '#2a170a';
    const frame = this.add.graphics().setDepth(32);
    frame.lineStyle(3, 0x2a170a, 1).strokeRect(x, y, w, h);
    frame.lineStyle(1, 0x2a170a, 0.6).strokeRect(x + 7, y + 7, w - 14, h - 14);
    this.help.push(frame);
    this.help.push(this.add.text(SCREEN.w / 2, y + 22, 'How to Play', { fontFamily: TITLE_FONT, fontSize: '32px', color: ink }).setOrigin(0.5, 0).setDepth(32));
    let ly = y + 80;
    for (const [key, text] of lines) {
      this.help.push(this.add.text(x + 40, ly, key, { fontFamily: TITLE_FONT, fontSize: '17px', color: '#7a1c12', fontStyle: 'bold' }).setDepth(32));
      const t = this.add.text(x + 170, ly, text, { fontFamily: TITLE_FONT, fontSize: '17px', color: ink, wordWrap: { width: w - 210 }, lineSpacing: 2 }).setDepth(32);
      this.help.push(t);
      ly += Math.max(26, t.height) + 12;
    }
    this.help.push(this.add.text(SCREEN.w / 2, y + h - 34, 'Click anywhere or press Esc to close', { fontFamily: TITLE_FONT, fontSize: '14px', color: ink, fontStyle: 'italic' }).setOrigin(0.5, 0).setAlpha(0.75).setDepth(32));
  }

  private closeHelp(): void {
    const items = this.help;
    this.help = [];
    // After this click finishes dispatching.
    this.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
  }

  /** Dev shortcut: `?battle=gull&foe=cutter` jumps straight into a fight. */
  private devBattle(): boolean {
    const params = new URLSearchParams(location.search);
    const ship = params.get('battle');
    if (!ship || this.registry.get('dev-battle-done')) return false;
    this.registry.set('dev-battle-done', true);
    disableSaving();
    const run = new Run(ship);
    const foe = params.get('foe') ?? 'cutter';
    run.encounter = { kind: 'battle', enemy: foe, name: 'HMS Diligence', boss: false, ambush: false, text: 'A sail on the horizon!' };
    run.status = 'battle';
    setRun(this, run);
    this.scene.start('Battle');
    return true;
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
