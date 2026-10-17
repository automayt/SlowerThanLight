import Phaser from 'phaser';
import { CAPS_FONT, COLORS, SCREEN, TITLE_FONT, textStyle, titleStyle } from '../render/theme';
import { placeArt } from '../render/art';
import { playLoop, stopLoop } from '../render/sound';
import { setRun } from '../render/RunBar';
import { Button, divider, frame, goldText, Sea, SoundButton } from '../render/ui';
import { Run } from '../sim/Run';
import { disableSaving, loadRun, sceneFor } from './save';

export class TitleScene extends Phaser.Scene {
  private sea!: Sea;
  private mist: { img: Phaser.GameObjects.Image; speed: number }[] = [];
  /** The open "How to play" sheet, if any. */
  private help: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Title');
  }

  init(): void {
    this.help = [];
  }

  preload(): void {
    if (!this.textures.exists('art:chart-paper')) this.load.image('art:chart-paper', 'art/chart-paper.jpg');
  }

  create(): void {
    if (import.meta.env.DEV && this.devBattle()) return;
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    this.mist = [];
    this.painting();
    const cx = SCREEN.w / 2;

    // The title rises out of the dusk, then its motto, then a brass rule drawn out from the middle.
    const title = goldText(this, cx, 204, 'Slower Than Light', 92, { fontFamily: CAPS_FONT }).setOrigin(0.5).setAlpha(0).setScale(0.94);
    const motto = this.add
      .text(cx, 256, 'A pirate’s life, one broadside at a time', titleStyle(26, COLORS.text, { fontStyle: 'italic' }))
      .setOrigin(0.5)
      .setShadow(0, 2, '#000000', 6, false, true)
      .setAlpha(0);
    const rule = divider(this, 0, 0, 400).setPosition(cx, 292).setAlpha(0).setScale(0, 1);
    this.tweens.add({ targets: title, alpha: 1, scale: 1, y: 186, duration: 1500, ease: 'Cubic.easeOut', delay: 150 });
    this.tweens.add({ targets: motto, alpha: 1, duration: 900, delay: 800 });
    this.tweens.add({ targets: rule, alpha: 1, scaleX: 1, duration: 900, delay: 1000, ease: 'Cubic.easeOut' });

    const saved = loadRun();
    const resume = () => {
      if (!saved) return;
      setRun(this, saved);
      this.registry.set('chart-note', `You take up the voyage again aboard ${saved.def.name}.`);
      this.scene.start(sceneFor(saved));
    };
    // Buttons float up into place one after another as the title settles.
    const entrance: (Phaser.GameObjects.Components.AlphaSingle & Phaser.GameObjects.Components.Transform)[] = [];
    let primary: Button;
    if (saved) {
      primary = new Button(this, cx - 240, 340, 230, 52, 'Continue Voyage', resume, { size: 22, hint: 'Enter' });
      const fresh = new Button(this, cx + 10, 340, 230, 52, 'New Voyage', () => this.scene.start('ShipSelect'), { size: 22 });
      const where = this.add
        .text(cx, 410, `${saved.def.name}  ·  ${saved.sectorDef.name}  ·  leg ${saved.legs.sailed} of ${saved.legs.total}  ·  ${saved.gold} gold`, textStyle(14, COLORS.text, { fontStyle: 'italic' }))
        .setOrigin(0.5, 0)
        .setShadow(0, 1, '#000000', 4, false, true);
      const plate = this.add.rectangle(cx, where.y - 5, where.width + 40, where.height + 10, 0x07111a, 0.72).setOrigin(0.5, 0).setStrokeStyle(1, COLORS.panelEdge, 0.6).setDepth(-1);
      entrance.push(primary, fresh, plate, where);
    } else {
      primary = new Button(this, cx - 115, 340, 230, 52, 'Set Sail', () => this.scene.start('ShipSelect'), { size: 22, hint: 'Enter' });
      entrance.push(primary);
    }

    // The controls live behind a button, so the painting stays clear.
    entrance.push(
      new SoundButton(this, 20, SCREEN.h - 58, 38),
      new Button(this, cx - 85, SCREEN.h - 58, 170, 38, 'How to Play', () => this.showHelp(), { size: 16, hint: 'H' }),
      new Button(this, SCREEN.w - 190, SCREEN.h - 58, 170, 38, 'Logbook', () => this.scene.start('Logbook'), { size: 16 }),
    );
    entrance.forEach((o, i) => {
      const y = o.y;
      o.setY(y + 18).setAlpha(0);
      this.tweens.add({ targets: o, y, alpha: 1, duration: 600, delay: 1300 + i * 90, ease: 'Cubic.easeOut' });
    });
    playLoop(this, 'shanty', 0.35);
    stopLoop(this, 'creak');

    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => this.closeHelp());
    kb.on('keydown-H', () => (this.help.length ? this.closeHelp() : this.showHelp()));
    kb.on('keydown-ENTER', () => {
      if (this.help.length) this.closeHelp();
      else primary.press();
    });
  }

  /**
   * The painting, alive: a slow drift and zoom, sea mist rolling over the swell, and glints of the low sun on the water.
   * Nothing is redrawn: the drift is a tween, the mist slides, the glints are short-lived sparks.
   */
  private painting(): void {
    const img = placeArt(this, 'title', 0, 0, SCREEN.w, SCREEN.h, false);
    if (!img) return;
    img.setDepth(-9);
    this.tweens.add({ targets: img, scale: img.scale * 1.06, x: img.x - 18, y: img.y - 8, duration: 26000, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

    const mist = mistTexture(this);
    for (let i = 0; i < 5; i++) {
      const m = this.add
        .image(Phaser.Math.Between(-200, SCREEN.w + 200), 470 + i * 46 + Phaser.Math.Between(-20, 20), mist)
        .setDepth(-8.5)
        .setAlpha(0.1 + (i % 3) * 0.05)
        .setScale(1.6 + Math.random() * 1.2, 0.7 + Math.random() * 0.5);
      this.mist.push({ img: m, speed: 6 + i * 3 + Math.random() * 4 });
    }

    // Shade towards the edges, so the eye goes to the ship and the title stays clear.
    this.add.image(SCREEN.w / 2, SCREEN.h / 2, vignetteTexture(this)).setDepth(-8).setDisplaySize(SCREEN.w, SCREEN.h);
    this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.12).setOrigin(0).setDepth(-8);

    // Glints on the water under the low sun.
    const spark = sparkTexture(this);
    this.time.addEvent({
      delay: 140,
      loop: true,
      callback: () => {
        const x = 470 + Math.random() * 360 + (Math.random() - 0.5) * 180;
        const y = 560 + Math.random() * 110;
        const g = this.add.image(x, y, spark).setDepth(-8.4).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.25 + Math.random() * 0.45);
        this.tweens.add({ targets: g, alpha: 0.75, duration: 260 + Math.random() * 200, yoyo: true, onComplete: () => g.destroy() });
      },
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
      ['Keys', 'Enter takes the main action, Esc goes back, number keys pick a numbered choice, M mutes the sound.'],
    ];
    const w = 720;
    const h = 440;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2 - 10;
    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setDepth(30).setInteractive();
    shade.on('pointerdown', () => this.closeHelp());
    this.help.push(shade, this.add.rectangle(x + 6, y + 8, w, h, 0x000000, 0.45).setOrigin(0).setDepth(31));
    const paper = placeArt(this, 'chart-paper', x, y, w, h, false);
    this.help.push(paper ? paper.setDepth(31) : this.add.rectangle(x, y, w, h, 0xd9c49a).setOrigin(0).setDepth(31));
    const ink = COLORS.ink;
    const rules = this.add.graphics().setDepth(32);
    rules.lineStyle(1, 0x2a170a, 0.6).strokeRect(x + 12, y + 12, w - 24, h - 24);
    this.help.push(rules, ...frame(this, x - 4, y - 4, w + 8, h + 8, 32, false));
    this.help.push(this.add.text(SCREEN.w / 2, y + 22, 'How to Play', { fontFamily: CAPS_FONT, fontSize: '34px', color: ink }).setOrigin(0.5, 0).setDepth(32));
    this.help.push(divider(this, SCREEN.w / 2, y + 66, 260, 0x2a170a, 0.7).setDepth(32));
    let ly = y + 86;
    for (const [key, text] of lines) {
      this.help.push(this.add.text(x + 40, ly, key, { fontFamily: CAPS_FONT, fontSize: '19px', color: COLORS.inkRed }).setDepth(32));
      const t = this.add.text(x + 170, ly, text, { fontFamily: TITLE_FONT, fontSize: '18px', color: ink, wordWrap: { width: w - 210 }, lineSpacing: 2 }).setDepth(32);
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

  update(time: number, delta: number): void {
    this.sea.draw(time);
    for (const m of this.mist) {
      m.img.x += (m.speed * delta) / 1000;
      if (m.img.x - m.img.displayWidth / 2 > SCREEN.w) m.img.x = -m.img.displayWidth / 2;
    }
  }
}

/** A soft bank of sea mist, painted once. */
function mistTexture(scene: Phaser.Scene): string {
  const key = 'title:mist';
  if (scene.textures.exists(key)) return key;
  const W = 512;
  const H = 160;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  for (let i = 0; i < 14; i++) {
    const x = 60 + Math.random() * (W - 120);
    const y = H / 2 + (Math.random() - 0.5) * 40;
    const r = 40 + Math.random() * 50;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(225,232,236,0.5)');
    g.addColorStop(1, 'rgba(225,232,236,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  tex.refresh();
  return key;
}

/** A dark vignette, clear in the middle. */
function vignetteTexture(scene: Phaser.Scene): string {
  const key = 'title:vignette';
  if (scene.textures.exists(key)) return key;
  const W = 640;
  const H = 360;
  const tex = scene.textures.createCanvas(key, W, H)!;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.45, W * 0.62);
  g.addColorStop(0, 'rgba(4,8,12,0)');
  g.addColorStop(1, 'rgba(4,8,12,0.72)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  tex.refresh();
  return key;
}

/** A four-pointed glint of sunlight. */
function sparkTexture(scene: Phaser.Scene): string {
  const key = 'title:spark';
  if (scene.textures.exists(key)) return key;
  const S = 48;
  const c = S / 2;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,240,200,0.9)');
  glow.addColorStop(0.25, 'rgba(255,220,150,0.35)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(255,248,225,0.9)';
  for (const [w, h] of [
    [c, 1.4],
    [1.4, c * 0.6],
  ]) {
    ctx.beginPath();
    ctx.ellipse(c, c, w, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.refresh();
  return key;
}
