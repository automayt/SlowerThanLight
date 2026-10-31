import Phaser from 'phaser';
import { coop } from '../net/CoopClient';
import { escHandled } from '../render/escape';
import { OPTIONS, screens } from '../render/options';
import { currentTextSpeed, setTextSpeed, TEXT_SPEED_NAMES, TEXT_SPEEDS, type Bus } from '../render/prefs';
import { isFullscreen, reducedMotion, setReducedMotion, toggleFullscreen } from '../render/screen';
import { audioPrefs, playSfx, setAudioPrefs, setMenuOpen, SOUND_CHANGED, toggleMute } from '../render/sound';
import { capsStyle, COLORS, SCREEN, textStyle, titleStyle } from '../render/theme';
import { Button, divider, drawBar, panel, ribbon } from '../render/ui';

const W = 900;
const H = 590;
const X = (SCREEN.w - W) / 2;
const Y = (SCREEN.h - H) / 2 + 6;
const LEFT = X + 44;
const SLIDER_X = X + 196;
const SLIDER_W = 210;
const RIGHT = X + 500;

type Level = 'master' | Bus;
const LEVELS: { id: Level; name: string; tip: string }[] = [
  { id: 'master', name: 'Master', tip: 'Everything together.' },
  { id: 'music', name: 'Music', tip: 'The music, and the stings for victory and defeat.' },
  { id: 'effects', name: 'Effects', tip: 'Guns, timbers, fire and water.' },
  { id: 'ambience', name: 'Ambience', tip: 'The sea, the wind, the harbour and the tavern.' },
  { id: 'ui', name: 'Interface', tip: 'Clicks and ticks of the buttons.' },
];

/** The keys, gathered from the screens that bind them. */
const CONTROLS: [string, [string, string][]][] = [
  [
    'Everywhere',
    [
      ['Esc', 'Options, or close a panel'],
      ['F11', 'Full screen'],
      ['M', 'Mute'],
      ['L', 'Standing at sea (chart, port)'],
      ['Enter', 'Go on, or the main choice'],
    ],
  ],
  [
    'The chart',
    [
      ['1-6', 'Sail to a mark in reach'],
      ['Click', 'Hurry her along'],
    ],
  ],
  [
    'Battle',
    [
      ['Space', 'Pause, and give orders'],
      ['1-4', 'Pick a gun to aim; Shift: change shot'],
      ['Q-O', 'Pick a hand; Shift adds'],
      ['Z X C', 'Rake her! · Crowd on sail! · Cold steel!'],
      ['B', 'Broadside: hold the guns to fire together'],
      ['F', 'Battle speed'],
      ['L', 'The battle log'],
      ['Right-click', 'Cancel aim and selection'],
    ],
  ],
  [
    'Port',
    [
      ['H', 'Harbour masters'],
      ['T', 'Tavern'],
    ],
  ],
];

interface Row {
  /** Highlight box, in design coordinates. */
  box: Phaser.Geom.Rectangle;
  /** Left/right: nudge or cycle. */
  adjust?: (dir: number, fine: boolean) => void;
  /** Enter/Space. */
  activate?: () => void;
}

/**
 * The options, over whatever is showing: a slider for each of the mixer's levels, reduced motion, full screen, the
 * speed dialogue is written out at, and the keys. Alone, it pauses the game beneath it; in co-op the voyage goes on
 * (the server keeps it), and only this player's input is held. Esc, Resume or a click outside closes it.
 */
export class OptionsScene extends Phaser.Scene {
  private rows: Row[] = [];
  private focus = 0;
  private focusBox!: Phaser.GameObjects.Graphics;
  /** Scenes paused under the options, and scenes whose input was held (co-op), with what to give back. */
  private paused: Phaser.Scene[] = [];
  private held = new Map<Phaser.Scene, { input: boolean; keys: boolean }>();
  private closing = false;
  private readonly sliders = new Map<Level, (v: number) => void>();
  private lastTick = 0;

  constructor() {
    super(OPTIONS);
  }

  create(): void {
    this.rows = [];
    this.focus = 0;
    this.closing = false;
    this.paused = [];
    this.held = new Map();
    this.sliders.clear();
    this.holdGame();
    setMenuOpen(this.game, true);

    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setInteractive();
    shade.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const at = this.cameras.main.getWorldPoint(p.x, p.y);
      if (!new Phaser.Geom.Rectangle(X, Y, W, H).contains(at.x, at.y)) this.close();
    });
    panel(this, X, Y, W, H, { modal: true });
    ribbon(this, SCREEN.w / 2, Y + 2, 'Options', { size: 24, width: 280 });
    this.focusBox = this.add.graphics().setDepth(5);

    // Sound.
    let y = Y + 56;
    this.add.text(LEFT, y, 'Sound', capsStyle(18));
    y += 44;
    for (const level of LEVELS) {
      this.slider(level, y);
      y += 40;
    }
    const mute = this.toggle(LEFT, y - 10, 'Sound', () => toggleMute(this.game), () => (audioPrefs().muted ? 'Muted' : 'On'), 'M mutes on every screen.');
    const redraw = () => {
      mute();
      for (const level of LEVELS) this.sliders.get(level.id)?.(audioPrefs()[level.id]);
    };
    this.game.events.on(SOUND_CHANGED, redraw);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(SOUND_CHANGED, redraw));
    y += 44;

    // Display and words.
    this.add.text(LEFT, y, 'Display', capsStyle(18));
    y += 32;
    this.toggle(LEFT, y, 'Reduced motion', () => setReducedMotion(!reducedMotion()), () => (reducedMotion() ? 'On' : 'Off'), 'Calmer camera and ships: less shake, roll and sweep. Follows your system setting until you choose.');
    y += 42;
    const full = this.toggle(LEFT, y, 'Full screen', () => toggleFullscreen(), () => (isFullscreen() ? 'On' : 'Off'), 'F11 does the same on any screen.');
    const onFull = () => this.time.delayedCall(50, full);
    document.addEventListener('fullscreenchange', onFull);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener('fullscreenchange', onFull));
    y += 42;
    const step = (dir: number) => {
      const i = TEXT_SPEEDS.indexOf(currentTextSpeed());
      setTextSpeed(TEXT_SPEEDS[(i + dir + TEXT_SPEEDS.length) % TEXT_SPEEDS.length]);
    };
    this.toggle(LEFT, y, 'Text speed', () => step(1), () => TEXT_SPEED_NAMES[currentTextSpeed()], 'How fast words are written out in tales and talk.', step);

    // The keys.
    this.add.graphics().lineStyle(1, COLORS.brass, 0.35).lineBetween(RIGHT - 26, Y + 58, RIGHT - 26, Y + H - 92);
    this.controls();

    // Resume.
    divider(this, SCREEN.w / 2, Y + H - 78, 300);
    const resume = new Button(this, SCREEN.w / 2 - 110, Y + H - 62, 220, 42, 'Resume', () => this.close(), { size: 18, hint: 'Esc' });
    this.rows.push({ box: new Phaser.Geom.Rectangle(resume.x - 4, resume.y - 4, 228, 50), activate: () => resume.press() });
    if (coop()) this.add.text(SCREEN.w / 2, Y + H - 92, 'Sailing together: the voyage goes on while you are here.', textStyle(12, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => {
      escHandled();
      this.close();
    });
    kb.on('keydown-UP', () => this.move(-1));
    kb.on('keydown-DOWN', () => this.move(1));
    kb.on('keydown-LEFT', (e: KeyboardEvent) => this.rows[this.focus]?.adjust?.(-1, e.shiftKey));
    kb.on('keydown-RIGHT', (e: KeyboardEvent) => this.rows[this.focus]?.adjust?.(1, e.shiftKey));
    kb.on('keydown-ENTER', () => this.rows[this.focus]?.activate?.());
    kb.on('keydown-SPACE', () => this.rows[this.focus]?.activate?.());
    this.drawFocus();
  }

  /** Pause the game beneath (alone), or hold this player's input (in co-op, where the server keeps the voyage going). */
  private holdGame(): void {
    const together = !!coop();
    for (const s of screens(this.game)) {
      if (together) this.holdInput(s);
      else if (s.sys.isActive()) {
        s.scene.pause();
        this.paused.push(s);
      }
    }
  }

  private holdInput(s: Phaser.Scene): void {
    if (this.held.has(s) || !s.input) return;
    this.held.set(s, { input: s.input.enabled, keys: s.input.keyboard?.enabled ?? true });
    s.input.enabled = false;
    if (s.input.keyboard) s.input.keyboard.enabled = false;
  }

  update(): void {
    // In co-op the server may move everyone to a new screen while the options are up: hold that one's keys too.
    if (coop()) for (const s of screens(this.game)) if (s.sys.isActive()) this.holdInput(s);
  }

  private close(): void {
    if (this.closing) return;
    this.closing = true;
    setMenuOpen(this.game, false);
    const paused = this.paused;
    const held = this.held;
    // After this step, so the key that closed the options is not seen again by the screen beneath.
    this.game.events.once(Phaser.Core.Events.POST_STEP, () => {
      for (const s of paused) if (s.sys.isPaused()) s.scene.resume();
      for (const [s, was] of held) {
        if (!s.sys.isActive() || !s.input) continue;
        s.input.enabled = was.input;
        if (s.input.keyboard) s.input.keyboard.enabled = was.keys;
      }
    });
    this.scene.stop();
  }

  private move(dir: number): void {
    this.focus = (this.focus + dir + this.rows.length) % this.rows.length;
    playSfx(this, 'hover', { volume: 0.3, detune: false });
    this.drawFocus();
  }

  private drawFocus(): void {
    const r = this.rows[this.focus]?.box;
    const g = this.focusBox.clear();
    if (!r) return;
    g.lineStyle(1.5, COLORS.brass, 0.85).strokeRoundedRect(r.x, r.y, r.width, r.height, 5);
    g.fillStyle(COLORS.brass, 0.06).fillRoundedRect(r.x, r.y, r.width, r.height, 5);
  }

  /** One of the mixer's levels: a brass slider, dragged or nudged with the arrow keys. */
  private slider(level: (typeof LEVELS)[number], y: number): void {
    const index = this.rows.length;
    this.add.text(LEFT, y, level.name, titleStyle(19, COLORS.text)).setOrigin(0, 0.5);
    const g = this.add.graphics();
    const pct = this.add.text(SLIDER_X + SLIDER_W + 22, y, '', textStyle(13, COLORS.textDim)).setOrigin(0, 0.5);
    const draw = (v: number) => {
      g.clear();
      drawBar(g, SLIDER_X, y - 4, SLIDER_W, 8, v, 0xd9b467);
      const kx = SLIDER_X + v * SLIDER_W;
      g.fillStyle(0x000000, 0.45).fillCircle(kx + 1, y + 2, 10);
      g.fillStyle(0x6a4a1c, 1).fillCircle(kx, y, 10);
      g.fillStyle(0xe8c878, 1).fillCircle(kx, y, 8);
      g.fillStyle(0xfff0c0, 0.7).fillCircle(kx - 2.5, y - 2.5, 3);
      pct.setText(`${Math.round(v * 100)}%`);
    };
    this.sliders.set(level.id, draw);
    draw(audioPrefs()[level.id]);
    const set = (v: number) => {
      const value = Math.round(Phaser.Math.Clamp(v, 0, 1) * 100) / 100;
      if (value === audioPrefs()[level.id]) return;
      setAudioPrefs(this.game, { [level.id]: value });
      this.tick(level.id);
    };
    const zone = this.add.zone(SLIDER_X - 12, y - 16, SLIDER_W + 24, 32).setOrigin(0).setInteractive({ useHandCursor: true });
    const fromPointer = (p: Phaser.Input.Pointer) => set((this.cameras.main.getWorldPoint(p.x, p.y).x - SLIDER_X) / SLIDER_W);
    let dragging = false;
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragging = true;
      this.focus = index;
      this.drawFocus();
      fromPointer(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => dragging && p.isDown && fromPointer(p));
    this.input.on('pointerup', () => (dragging = false));
    this.input.on('gameout', () => (dragging = false));
    this.rows.push({
      box: new Phaser.Geom.Rectangle(LEFT - 10, y - 20, SLIDER_X + SLIDER_W + 70 - LEFT, 40),
      adjust: (dir, fine) => set(audioPrefs()[level.id] + dir * (fine ? 0.01 : 0.05)),
    });
    const tip = this.add.zone(LEFT, y - 14, 130, 28).setOrigin(0).setInteractive();
    tip.on('pointerdown', () => {
      this.focus = index;
      this.drawFocus();
    });
  }

  /** Let the player hear the level they are setting: a tick on that bus (music and ambience are playing already). */
  private tick(level: Level): void {
    const now = performance.now();
    if (now - this.lastTick < 90 || level === 'music' || level === 'ambience') return;
    this.lastTick = now;
    if (level === 'effects') playSfx(this, ['hit-wood', 'click'], { volume: 0.4, bus: 'effects' });
    else playSfx(this, 'click', { volume: 0.5, bus: 'ui', detune: false });
  }

  /** A setting shown as "Name: value" on a button; Enter or a click changes it. Returns its redraw. */
  private toggle(x: number, y: number, name: string, change: () => void, value: () => string, tip: string, adjust?: (dir: number) => void): () => void {
    const index = this.rows.length;
    const b = new Button(this, x, y, 330, 36, '', () => {
      change();
      this.focus = index;
      this.drawFocus();
      redraw();
    }, { size: 15, tip });
    b.label.setOrigin(0, 0.5).setX(14);
    const redraw = () => {
      if (!b.active) return;
      const v = value();
      b.setText(`${name}: ${v}`);
      b.setOn(v === 'On');
    };
    redraw();
    this.rows.push({
      box: new Phaser.Geom.Rectangle(x - 4, y - 4, 338, 44),
      activate: () => b.press(),
      adjust: adjust
        ? (dir) => {
            adjust(dir);
            playSfx(this, 'click', 0.35);
            redraw();
          }
        : undefined,
    });
    return redraw;
  }

  /** The keys, in columns of key and meaning. */
  private controls(): void {
    let y = Y + 58;
    this.add.text(RIGHT, y, 'Keys', capsStyle(18));
    y += 32;
    for (const [head, keys] of CONTROLS) {
      this.add.text(RIGHT, y, head, textStyle(13, COLORS.gold, { fontStyle: 'bold italic' }));
      y += 19;
      for (const [key, what] of keys) {
        const cap = this.add.text(RIGHT + 4, y, key, textStyle(11, '#e8d6a8', { fontStyle: 'bold', backgroundColor: '#120a04d9', padding: { x: 4, y: 1 } }));
        this.add.text(RIGHT + 96, y, what, textStyle(12, COLORS.text, { wordWrap: { width: X + W - 40 - RIGHT - 96 } }));
        y += Math.max(18, cap.height + 2);
      }
      y += 4;
    }
  }
}
