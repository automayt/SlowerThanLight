import Phaser from 'phaser';
import { ICON_ATLAS, iconFrame, type IconName } from './icons';
import { cycleVolume, isMuted, isSoft, playSfx, SOUND_CHANGED } from './sound';
import { bleed, toDesign } from './screen';
import { COLORS, SCREEN, textStyle, titleStyle, TYPE } from './theme';

/** Gold edge of a hovered control. */
const HOVER_EDGE = 0xf2c45a;
/** Fill of a button in the instant it is pressed. */
const PRESSED = 0x140c06;

/**
 * Text is drawn at twice its size and shown at its own, so it stays crisp when the canvas is scaled up to a large
 * window. Applies to every Text that does not ask for a resolution of its own.
 */
export const TEXT_RESOLUTION = 2;
{
  const proto = Phaser.GameObjects.TextStyle.prototype as unknown as { setStyle: (...a: unknown[]) => unknown; resolution: number; __crisp?: boolean };
  if (!proto.__crisp) {
    proto.__crisp = true;
    const setStyle = proto.setStyle;
    proto.setStyle = function (this: { resolution: number }, ...args: unknown[]) {
      const out = setStyle.apply(this, args);
      if (!this.resolution) this.resolution = TEXT_RESOLUTION;
      return out;
    };
  }
}

/**
 * Queue the kit's painted textures (oiled walnut, parchment, the icon atlas) in a scene's preload(). The kit falls back
 * to drawn textures for any that fail to load.
 */
export function preloadKit(scene: Phaser.Scene): void {
  if (!scene.textures.exists('ui:wood')) scene.load.image('ui:wood', 'ui/wood.jpg');
  if (!scene.textures.exists('ui:parchment')) scene.load.image('ui:parchment', 'ui/parchment.png');
  if (!scene.textures.exists(ICON_ATLAS)) scene.load.atlas(ICON_ATLAS, 'ui/icons.png', 'ui/icons.json');
}

export interface ButtonOptions {
  size?: number;
  color?: number;
  onRightClick?: () => void;
  /** Its keyboard shortcut, shown as a small keycap at the right end ('Enter', 'Esc', '1'). The scene binds the key and calls press(). */
  hint?: string;
  /** Shown on hover. For a disabled button, say why it is disabled. */
  tip?: string;
  /** A painted icon before the label (or alone, centred, when the label is empty). */
  icon?: IconName;
}

/** A plaque of oiled walnut in a brass rim: lit gold on hover, sunk when pressed, gilt when on, grey when disabled. */
export class Button extends Phaser.GameObjects.Container {
  /** The hit area. Under the painted plaque it is clear; without WebGL it is the button. */
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  /** The icon, when the button was given one. */
  readonly iconImage: Phaser.GameObjects.Image | null = null;
  private readonly skin: Phaser.GameObjects.NineSlice | null = null;
  private readonly hintText: Phaser.GameObjects.Text | null = null;
  private readonly hintCap: Phaser.GameObjects.Graphics | null = null;
  private enabled = true;
  private toggled = false;
  private hover = false;
  private pressed = false;
  private tip: string | null;
  private readonly baseColor: number;
  /** Where the label sits when not pressed. */
  private labelY: number;
  private iconY = 0;
  /** The room the label has between the icon and the keycap, and the size it was asked for. */
  private readonly labelRoom: number;
  private readonly labelSize: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string, private readonly onClick: () => void, opts: ButtonOptions = {}) {
    super(scene, x, y);
    this.baseColor = opts.color ?? COLORS.button;
    this.tip = opts.tip ?? null;
    this.bg = scene.add.rectangle(0, 0, w, h, this.baseColor).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
    this.add(this.bg);
    if (painted(scene)) {
      const s = Math.min(BTN_SLICE, Math.floor(w / 2), Math.floor(h / 2));
      this.skin = scene.add.nineslice(0, 0, 'ui:btn', 'base', w, h, s, s, s, s).setOrigin(0);
      if (opts.color !== undefined) this.skin.setTint(opts.color);
      this.bg.setFillStyle(0x000000, 0.001).setStrokeStyle();
      this.add(this.skin);
    }
    this.labelY = h / 2;
    this.label = scene.add
      .text(w / 2, h / 2, text, textStyle(opts.size ?? 14, COLORS.text))
      .setOrigin(0.5)
      .setShadow(0, 1, '#0a0502', 2, false, true);
    this.add(this.label);
    // Room on the right for the keycap, on the left for the icon; the label centres in what is left.
    let left = 0;
    let right = w;
    if (opts.hint) {
      const capSize = Math.max(10, Math.min(12, Math.round(h * 0.42)));
      this.hintText = scene.add.text(0, h / 2, opts.hint, textStyle(capSize, '#e8d6a8', { fontStyle: 'bold' })).setOrigin(0.5);
      const cw = Math.max(this.hintText.width + 8, capSize + 6);
      const ch = capSize + 6;
      const cx = w - 6 - cw;
      this.hintCap = scene.add.graphics();
      this.hintCap.fillStyle(0x000000, 0.45).fillRoundedRect(cx, h / 2 - ch / 2 + 1, cw, ch, 3);
      this.hintCap.fillStyle(0x120a04, 0.85).fillRoundedRect(cx, h / 2 - ch / 2, cw, ch, 3);
      this.hintCap.lineStyle(1, COLORS.brass, 0.45).strokeRoundedRect(cx + 0.5, h / 2 - ch / 2 + 0.5, cw - 1, ch - 1, 3);
      this.hintText.setX(cx + cw / 2);
      this.add([this.hintCap, this.hintText]);
      right = cx - 2;
    }
    if (opts.icon) {
      const { key, frame } = iconFrame(scene, opts.icon);
      const size = Math.min(h - 8, 30);
      const alone = !text;
      const ix = alone ? (left + right) / 2 : left + 6 + size / 2;
      this.iconY = h / 2;
      this.iconImage = scene.add.image(ix, h / 2, key, frame).setDisplaySize(size, size);
      this.add(this.iconImage);
      if (!alone) left = ix + size / 2;
    }
    this.label.setX((left + right) / 2);
    this.labelRoom = right - left - 10;
    this.labelSize = opts.size ?? 14;
    this.fitLabel();
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerover', (p: Phaser.Input.Pointer) => {
      this.hover = true;
      this.refresh();
      if (this.tip) tooltip(scene).show(this.tip, p.x, p.y);
    });
    this.bg.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.tip) tooltip(scene).move(p.x, p.y);
    });
    this.bg.on('pointerout', () => {
      this.hover = false;
      this.refresh();
      if (this.tip) tooltip(scene).hide();
    });
    this.bg.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.rightButtonDown()) this.press();
      else if (this.enabled && opts.onRightClick) {
        playSfx(scene, 'click', 0.35);
        opts.onRightClick();
      }
    });
    // A button destroyed under the pointer (a port rebuilding its stock) must not leave its tip behind.
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      if (this.hover && this.tip) tooltips.get(scene)?.hide();
    });
    scene.add.existing(this);
  }

  /** Click it, from a key or the pointer: a brief pressed look, the click sound and the action. False if it is disabled. */
  press(): boolean {
    if (!this.enabled || !this.visible) return false;
    playSfx(this.scene, 'click', 0.35);
    this.pressed = true;
    this.refresh();
    this.scene.time.delayedCall(110, () => {
      this.pressed = false;
      if (this.bg.active) this.refresh();
    });
    this.onClick();
    return true;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): this {
    if (on !== this.enabled) {
      this.enabled = on;
      this.refresh();
    }
    return this;
  }

  setOn(on: boolean): this {
    if (on !== this.toggled) {
      this.toggled = on;
      this.refresh();
    }
    return this;
  }

  setText(text: string): this {
    if (this.label.text !== text) {
      this.label.setText(text);
      this.fitLabel();
    }
    return this;
  }

  /** Shrink the label a point at a time until it fits between the icon and the keycap (never below 10px). */
  private fitLabel(): void {
    const size = parseInt(String(this.label.style.fontSize), 10);
    if (size !== this.labelSize && this.label.width * (this.labelSize / size) <= this.labelRoom) this.label.setFontSize(this.labelSize);
    for (let s = parseInt(String(this.label.style.fontSize), 10); this.label.width > this.labelRoom && s > 10; s--) this.label.setFontSize(s - 1);
  }

  /** Show a different icon (a button made with one). */
  setIcon(name: IconName): this {
    if (!this.iconImage || this.iconImage.getData('icon') === name) return this;
    const { key, frame } = iconFrame(this.scene, name);
    const w = this.iconImage.displayWidth;
    const h = this.iconImage.displayHeight;
    this.iconImage.setTexture(key, frame).setDisplaySize(w, h).setData('icon', name);
    return this;
  }

  /** Change or clear the hover text, updating it in place if it is showing. */
  setTip(tip: string | null): this {
    if (tip === this.tip) return this;
    this.tip = tip;
    if (this.hover) {
      const p = this.scene.input.activePointer;
      if (tip) tooltip(this.scene).show(tip, p.x, p.y);
      else tooltips.get(this.scene)?.hide();
    }
    return this;
  }

  private refresh(): void {
    const lit = this.enabled && (this.hover || this.pressed);
    if (this.skin) {
      const frame = !this.enabled ? 'off' : this.pressed ? 'press' : this.toggled ? (this.hover ? 'onHover' : 'on') : this.hover ? 'hover' : 'base';
      if (this.skin.frame.name !== frame) this.skin.setFrame(frame);
    } else {
      const color = !this.enabled
        ? COLORS.buttonDisabled
        : this.pressed
          ? PRESSED
          : this.toggled
            ? COLORS.buttonActive
            : this.hover
              ? COLORS.buttonHover
              : this.baseColor;
      this.bg.setFillStyle(color);
      this.bg.setStrokeStyle(lit ? 1.5 : 1, lit ? HOVER_EDGE : COLORS.panelEdge);
    }
    if (this.bg.input) this.bg.input.cursor = this.enabled ? 'pointer' : 'default';
    this.label.setAlpha(this.enabled ? 1 : 0.45);
    const color = lit && !this.toggled ? '#fff4d6' : this.toggled ? '#fff6e0' : COLORS.text;
    if (this.label.style.color !== color) this.label.setColor(color);
    this.hintText?.setAlpha(this.enabled ? 1 : 0.4);
    this.hintCap?.setAlpha(this.enabled ? 1 : 0.4);
    this.iconImage?.setAlpha(this.enabled ? 1 : 0.4);
    // Pressed, the face sinks a pixel.
    const dy = this.pressed ? 1 : 0;
    this.label.setY(this.labelY + dy);
    this.iconImage?.setY(this.iconY + dy);
  }
}

/** A small slip of parchment that follows the pointer. One per scene: get it with tooltip(scene). */
export class Tooltip {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly paper: Phaser.GameObjects.NineSlice | null;
  private readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.bg = scene.add.graphics().setDepth(1000).setVisible(false);
    const paper = painted(scene) && scene.textures.exists('ui:parchment');
    this.paper = paper ? scene.add.nineslice(0, 0, 'ui:parchment', undefined, 64, 32, 18, 18, 18, 18).setOrigin(0).setDepth(1000).setVisible(false) : null;
    this.text = scene.add
      .text(0, 0, '', textStyle(TYPE.body, paper ? COLORS.ink : COLORS.text, { wordWrap: { width: 320 }, lineSpacing: 2, padding: { x: 12, y: 8 } }))
      .setDepth(1001)
      .setVisible(false);
  }

  get alive(): boolean {
    return this.text.active;
  }

  show(text: string, x: number, y: number): void {
    if (!this.alive) return;
    if (text !== this.text.text || !this.text.visible) {
      this.text.setText(text);
      const { width: w, height: h } = this.text;
      this.bg.clear().fillStyle(0x000000, 0.35).fillRect(4, 5, w - 2, h - 2);
      if (this.paper) {
        const s = Math.min(18, Math.floor(h / 2), Math.floor(w / 2));
        this.paper.setSlices(w, h, s, s, s, s);
        this.paper.setSize(w, h);
      } else {
        this.bg
          .fillStyle(COLORS.panel, 0.97)
          .fillRect(0, 0, w, h)
          .lineStyle(1.5, COLORS.panelEdge, 1)
          .strokeRect(0, 0, w, h)
          .lineStyle(1, COLORS.brass, 0.25)
          .strokeRect(3, 3, w - 6, h - 6);
      }
    }
    this.move(x, y);
    this.bg.setVisible(true);
    this.paper?.setVisible(true);
    this.text.setVisible(true);
  }

  /** Below and right of the pointer, flipped above or left where the screen runs out. */
  move(px: number, py: number): void {
    if (!this.alive) return;
    // Pointer pixels to the design area the screens are laid out on.
    ({ x: px, y: py } = toDesign(px, py));
    const { width: w, height: h } = this.text;
    const x = px + 14 + w > SCREEN.w - 6 ? px - 10 - w : px + 14;
    const y = py + 22 + h > SCREEN.h - 6 ? py - 10 - h : py + 22;
    const at = { x: Math.round(Phaser.Math.Clamp(x, 6, SCREEN.w - w - 6)), y: Math.round(Phaser.Math.Clamp(y, 6, SCREEN.h - h - 6)) };
    this.bg.setPosition(at.x, at.y);
    this.paper?.setPosition(at.x, at.y);
    this.text.setPosition(at.x, at.y);
  }

  hide(): void {
    if (!this.alive) return;
    this.bg.setVisible(false);
    this.paper?.setVisible(false);
    this.text.setVisible(false);
  }
}

const tooltips = new WeakMap<Phaser.Scene, Tooltip>();

/** The scene's tooltip, made on first use. */
export function tooltip(scene: Phaser.Scene): Tooltip {
  let tip = tooltips.get(scene);
  if (!tip || !tip.alive) {
    tip = new Tooltip(scene);
    tooltips.set(scene, tip);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => tooltips.delete(scene));
  }
  return tip;
}

/** Give any interactive object a hover tip. The text can be a function, read each time the tip opens. */
export function addTip(obj: Phaser.GameObjects.GameObject, text: string | (() => string)): void {
  const scene = obj.scene;
  obj.on('pointerover', (p: Phaser.Input.Pointer) => {
    const t = typeof text === 'string' ? text : text();
    if (t) tooltip(scene).show(t, p.x, p.y);
  });
  obj.on('pointermove', (p: Phaser.Input.Pointer) => tooltips.get(scene)?.move(p.x, p.y));
  obj.on('pointerout', () => tooltips.get(scene)?.hide());
}

/** A clear hit box over a stretch of the screen that shows a tip on hover (for icons and meters, which are not interactive). */
export function tipZone(scene: Phaser.Scene, x: number, y: number, w: number, h: number, text: string | (() => string)): Phaser.GameObjects.Zone {
  const zone = scene.add.zone(x, y, w, h).setOrigin(0).setInteractive();
  addTip(zone, text);
  return zone;
}

/** A small keycap, as on the buttons, for a key that has no button of its own. */
export function keycap(scene: Phaser.Scene, x: number, y: number, key: string, size = 10): Phaser.GameObjects.Text {
  return scene.add.text(x, y, key, textStyle(size, '#e8d6a8', { fontStyle: 'bold', backgroundColor: '#120a04d9', padding: { x: 3, y: 1 } }));
}

/** The speaker: click to step through loud, soft and off. M toggles mute on every screen. */
export class SoundButton extends Button {
  private readonly icon: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, size = 34) {
    super(scene, x, y, size, size, '', () => cycleVolume(scene.game));
    this.icon = scene.add.graphics();
    this.add(this.icon);
    const redraw = () => this.draw(size);
    scene.game.events.on(SOUND_CHANGED, redraw);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.game.events.off(SOUND_CHANGED, redraw));
    this.draw(size);
  }

  private draw(size: number): void {
    const muted = isMuted();
    const soft = isSoft();
    this.setTip(`Sound: ${muted ? 'off' : soft ? 'soft' : 'on'}. Click to change, or press M to mute.`);
    const g = this.icon.clear();
    const s = size / 34;
    const cy = size / 2;
    const ink = 0xefe6d0;
    // Box and cone of the speaker.
    g.fillStyle(ink, muted ? 0.55 : 1);
    g.fillRect(8 * s, cy - 4 * s, 5 * s, 8 * s);
    g.fillTriangle(12 * s, cy - 4 * s, 19 * s, cy - 10 * s, 19 * s, cy + 10 * s);
    g.fillTriangle(12 * s, cy - 4 * s, 12 * s, cy + 4 * s, 19 * s, cy + 10 * s);
    if (muted) {
      g.lineStyle(2.5 * s, 0xe0452f, 1);
      g.lineBetween(22 * s, cy - 5 * s, 29 * s, cy + 5 * s);
      g.lineBetween(29 * s, cy - 5 * s, 22 * s, cy + 5 * s);
      return;
    }
    g.lineStyle(2 * s, ink, 1);
    const arcs = soft ? [5] : [5, 10];
    for (const r of arcs) {
      g.beginPath();
      g.arc(19 * s, cy, r * s, -Math.PI / 4, Math.PI / 4);
      g.strokePath();
    }
  }
}


/** Draws a row of small square pips, like lamps in a brass bezel: green for working, dark for unused, red for damaged. */
export function drawPips(g: Phaser.GameObjects.Graphics, x: number, y: number, on: number, max: number, damaged: number, size = 10, gap = 3): number {
  for (let i = 0; i < max; i++) {
    const px = x + i * (size + gap);
    const color = i >= max - damaged ? COLORS.pipDamaged : i < on ? COLORS.pipOn : 0x2a2420;
    g.fillStyle(0x000000, 0.55).fillRoundedRect(px - 1, y - 1, size + 2, size + 2, 2.5);
    g.fillStyle(color, 1).fillRoundedRect(px, y, size, size, 2);
    if (i < on || i >= max - damaged) g.fillStyle(0xffffff, 0.28).fillRoundedRect(px + 1.5, y + 1, size - 3, Math.max(1.5, size * 0.3), 1);
    g.lineStyle(1, i < on ? 0xe8c878 : 0x6a5434, i < on ? 0.55 : 0.5).strokeRoundedRect(px - 0.5, y - 0.5, size + 1, size + 1, 2.5);
  }
  return max * (size + gap);
}

/** Horizontal fill bar: a dark trough in a fine brass rim, filled with a rounded, lit bar. */
export function drawBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, frac: number, color: number, back = 0x15100b): void {
  const fw = Math.max(0, Math.min(1, frac)) * w;
  const r = Math.min(3, h / 2);
  g.fillStyle(0x000000, 0.6).fillRoundedRect(x - 1.5, y - 1.5, w + 3, h + 3, r + 1);
  g.fillStyle(back, 1).fillRoundedRect(x, y, w, h, r);
  if (fw >= 1) {
    g.fillStyle(color, 1).fillRoundedRect(x, y, fw, h, Math.min(r, fw / 2));
    // A sheen along the top and a shade along the bottom give the bar some roundness.
    if (h >= 4) g.fillStyle(0xffffff, 0.24).fillRect(x + 1, y + 1, Math.max(0, fw - 2), Math.ceil(h * 0.3));
    g.fillStyle(0x000000, 0.2).fillRect(x, y + h - Math.max(1, Math.floor(h * 0.25)), fw, Math.max(1, Math.floor(h * 0.25)));
  }
  if (h >= 5) g.lineStyle(1, COLORS.brass, 0.35).strokeRoundedRect(x - 1, y - 1, w + 2, h + 2, r + 0.5);
}

export interface PanelOptions {
  /** A dialog over the rest of the screen: near-opaque, so nothing behind ghosts through. */
  modal?: boolean;
  /**
   * 'wood' (the default): oiled walnut in a brass frame, for light text. 'parchment': a sheet of old paper with a
   * browned, deckled edge, for ink (COLORS.ink, inkStyle).
   */
  skin?: 'wood' | 'parchment';
}

type Part = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Depth & Phaser.GameObjects.Components.Visible & Phaser.GameObjects.Components.AlphaSingle;

/**
 * A framed panel. The rectangle is the fill; the painted parts (the wood or the paper, the frame) follow its depth,
 * visibility, alpha, fill alpha and destruction.
 */
export class Panel extends Phaser.GameObjects.Rectangle {
  readonly keyline: Phaser.GameObjects.Rectangle;
  readonly skin: 'wood' | 'parchment';
  private readonly parts: Part[];
  private readonly shadow: Phaser.GameObjects.Rectangle;
  /** The board or the sheet, whose alpha follows the fill's. */
  private readonly surface: (Part & Phaser.GameObjects.Components.AlphaSingle) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOptions = {}) {
    super(scene, x, y, w, h, COLORS.panel, opts.modal ? 0.97 : 0.92);
    this.setOrigin(0);
    const paper = opts.skin === 'parchment' && painted(scene) && scene.textures.exists('ui:parchment');
    this.skin = paper ? 'parchment' : 'wood';
    // Made before the panel joins the display list, so it lies underneath.
    this.shadow = paper ? scene.add.rectangle(x + 8, y + 10, w - 8, h - 8, 0x000000, 0.4).setOrigin(0) : scene.add.rectangle(x + 4, y + 6, w, h, 0x000000, 0.38).setOrigin(0);
    scene.add.existing(this);
    this.parts = [];
    if (paper) {
      super.setFillStyle(0x000000, 0.001);
      const s = Math.min(PAPER_SLICE, Math.floor(w / 2), Math.floor(h / 2));
      this.surface = scene.add.nineslice(x, y, 'ui:parchment', undefined, w, h, s, s, s, s).setOrigin(0);
      this.parts.push(this.surface);
      this.keyline = scene.add.rectangle(x + 12, y + 12, w - 24, h - 24).setOrigin(0).setStrokeStyle(1, 0x6a4a22, 0.25);
    } else if (painted(scene)) {
      if (scene.textures.exists('ui:wood')) {
        // The grain at a scale that suits a panel, darkened so light text reads on it.
        this.surface = scene.add.tileSprite(x, y, w, h, 'ui:wood').setOrigin(0).setTileScale(0.72).setTint(0x9a8a7c);
        this.surface.setAlpha(opts.modal ? 1 : 0.92);
        this.parts.push(this.surface);
      } else this.parts.push(scene.add.tileSprite(x, y, w, h, 'ui:grain').setOrigin(0).setAlpha(0.5));
      this.parts.push(scene.add.nineslice(x, y, 'ui:frame', undefined, w, h, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE).setOrigin(0));
      this.keyline = scene.add.rectangle(x + 3, y + 3, w - 6, h - 6).setOrigin(0).setVisible(false);
    } else {
      this.setStrokeStyle(1.5, COLORS.panelEdge);
      // Inner keyline, like a framed chart.
      this.keyline = scene.add.rectangle(x + 3, y + 3, w - 6, h - 6).setOrigin(0).setStrokeStyle(1, COLORS.panelInner, 0.9);
    }
    this.parts.push(this.keyline);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.shadow.destroy();
      this.parts.forEach((p) => p.destroy());
    });
  }

  /** A see-through fill lets a painting behind show through the board too. */
  override setFillStyle(color?: number, alpha = 1): this {
    if (this.skin === 'parchment') return this;
    super.setFillStyle(color, alpha);
    this.surface?.setAlpha(Math.min(1, alpha));
    return this;
  }

  // The parts are still unset while the base constructor runs.
  override setDepth(value: number): this {
    super.setDepth(value);
    this.shadow?.setDepth(value - 0.001);
    this.parts?.forEach((p) => p.setDepth(value));
    return this;
  }

  override setVisible(value: boolean): this {
    super.setVisible(value);
    this.shadow?.setVisible(value);
    this.parts?.forEach((p) => p.setVisible(value));
    return this;
  }

  override setAlpha(value: number): this {
    super.setAlpha(value);
    this.shadow?.setAlpha(value);
    this.parts?.forEach((p) => p.setAlpha(value));
    return this;
  }
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: PanelOptions = {}): Panel {
  return new Panel(scene, x, y, w, h, opts);
}

/** A brass frame and a soft shadow for a painting or a card: the panel's rim without its fill. */
export function frame(scene: Phaser.Scene, x: number, y: number, w: number, h: number, depth = 0, shadow = true): Phaser.GameObjects.GameObject[] {
  const parts: Phaser.GameObjects.GameObject[] = [];
  // The shadow goes under whatever is framed, so make the frame after the picture.
  if (shadow) parts.push(scene.add.rectangle(x + 4, y + 6, w, h, 0x000000, 0.4).setOrigin(0).setDepth(depth - 0.01));
  if (!painted(scene)) parts.push(scene.add.rectangle(x, y, w, h).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge).setDepth(depth));
  else parts.push(scene.add.nineslice(x, y, 'ui:frame', undefined, w, h, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE, FRAME_SLICE).setOrigin(0).setDepth(depth));
  return parts;
}

/** An ornamental rule: two tapering brass arms from a diamond. Static: draw it once. */
export function divider(scene: Phaser.Scene, cx: number, y: number, w: number, color: number = COLORS.brass, alpha = 0.85): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  // Once in shadow, a little below, then in brass.
  for (const [fill, a, dy] of [
    [0x000000, alpha * 0.45, 1.5],
    [color, alpha, 0],
  ]) {
    g.fillStyle(fill, a);
    const my = y + dy;
    for (const s of [-1, 1]) {
      g.fillTriangle(cx + s * 14, my - 1.4, cx + s * 14, my + 1.4, cx + (s * w) / 2, my);
      g.fillCircle(cx + s * 9.5, my, 1.8);
    }
    g.fillPoints([new Phaser.Math.Vector2(cx, my - 5.5), new Phaser.Math.Vector2(cx + 5.5, my), new Phaser.Math.Vector2(cx, my + 5.5), new Phaser.Math.Vector2(cx - 5.5, my)], true);
  }
  return g;
}

export interface RibbonOptions {
  /** Width of the ribbon, tails included; by default it fits the text. */
  width?: number;
  size?: number;
  depth?: number;
}

/** A heading on a red silk ribbon with folded, notched tails, centred on its position. */
export class Ribbon extends Phaser.GameObjects.Container {
  readonly label: Phaser.GameObjects.Text;
  private readonly band: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;
  private readonly bandH: number;

  constructor(
    scene: Phaser.Scene,
    cx: number,
    y: number,
    text: string,
    private readonly opts: RibbonOptions = {},
  ) {
    super(scene, cx, y);
    ensureKit(scene);
    const size = opts.size ?? 20;
    this.bandH = Math.max(RIBBON_H, Math.round(size * 2));
    // The band is the upper two-thirds of the texture; the label sits in it.
    this.band =
      scene.sys.renderer?.type === Phaser.CANVAS
        ? scene.add.rectangle(0, 0, 100, this.bandH * 0.62, COLORS.ribbon).setStrokeStyle(1, COLORS.brass, 0.7)
        : scene.add.nineslice(0, this.bandH * 0.06, 'ui:ribbon', undefined, 100, this.bandH, RIBBON_TAIL, RIBBON_TAIL, 0, 0);
    this.label = scene.add.text(0, -1, '', titleStyle(size, '#fff1d0')).setOrigin(0.5).setShadow(0, 1.5, '#2a0604', 2, false, true);
    this.add([this.band, this.label]);
    this.setLabel(text);
    if (opts.depth !== undefined) this.setDepth(opts.depth);
    scene.add.existing(this);
  }

  /** Change the words, widening or narrowing the ribbon to fit unless it was given a width. */
  setLabel(text: string): this {
    if (this.label.text === text && this.band.width > 100) return this;
    this.label.setText(text);
    const w = Math.max(this.opts.width ?? this.label.width + 2 * RIBBON_TAIL + 30, 2 * RIBBON_TAIL + 20);
    if (this.band instanceof Phaser.GameObjects.NineSlice) this.band.setSize(w, this.bandH);
    else this.band.setSize(w - 2 * RIBBON_TAIL + 20, this.bandH * 0.62);
    this.setSize(w, this.bandH);
    return this;
  }
}

export function ribbon(scene: Phaser.Scene, cx: number, y: number, text: string, opts: RibbonOptions = {}): Ribbon {
  return new Ribbon(scene, cx, y, text, opts);
}

export interface SlipOptions {
  size?: number;
  color?: string;
  /** Wrap width of the text. */
  wrap?: number;
  /** A small icon before the text. */
  icon?: IconName;
  italic?: boolean;
}

/**
 * A torn-off slip of parchment with a line of ink on it (and an icon, if given), its top-left at its position: for
 * toasts, notes and pointer labels. Resizes to fit when its text changes.
 */
export class Slip extends Phaser.GameObjects.Container {
  readonly text: Phaser.GameObjects.Text;
  readonly iconImage: Phaser.GameObjects.Image | null = null;
  private readonly paper: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Rectangle;
  private readonly shade: Phaser.GameObjects.Rectangle;
  private readonly padX: number;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, opts: SlipOptions = {}) {
    super(scene, x, y);
    const paper = painted(scene) && scene.textures.exists('ui:parchment');
    const size = opts.size ?? TYPE.body;
    this.padX = 11;
    this.shade = scene.add.rectangle(4, 5, 10, 10, 0x000000, 0.35).setOrigin(0);
    this.paper = paper
      ? scene.add.nineslice(0, 0, 'ui:parchment', undefined, 40, 30, 14, 14, 12, 12).setOrigin(0)
      : scene.add.rectangle(0, 0, 40, 30, COLORS.panel, 0.95).setOrigin(0).setStrokeStyle(1.5, COLORS.panelEdge);
    this.add([this.shade, this.paper]);
    let tx = this.padX;
    if (opts.icon) {
      const { key, frame } = iconFrame(scene, opts.icon);
      const s = Math.round(size * 1.45);
      this.iconImage = scene.add.image(this.padX + s / 2 - 2, 0, key, frame).setDisplaySize(s, s);
      this.add(this.iconImage);
      tx += s + 3;
    }
    this.text = scene.add.text(tx, 6, '', textStyle(size, opts.color ?? (paper ? COLORS.ink : COLORS.text), { wordWrap: opts.wrap ? { width: opts.wrap } : undefined, lineSpacing: 1, fontStyle: opts.italic ? 'italic' : 'normal' }));
    this.add(this.text);
    this.setLabel(text);
    scene.add.existing(this);
  }

  get paperW(): number {
    return this.paper.width;
  }

  get paperH(): number {
    return this.paper.height;
  }

  setLabel(text: string): this {
    if (this.text.text === text && this.paper.width > 40) return this;
    this.text.setText(text);
    const w = Math.ceil(this.text.x + this.text.width + this.padX);
    const h = Math.ceil(this.text.height + 12);
    if (this.paper instanceof Phaser.GameObjects.NineSlice) {
      const s = Math.min(12, Math.floor(h / 2));
      this.paper.setSlices(w, h, 14, 14, s, s);
      this.paper.setSize(w, h);
    } else this.paper.setSize(w, h);
    this.shade.setSize(w - 4, h - 4);
    this.iconImage?.setY(h / 2);
    this.setSize(w, h);
    return this;
  }

  /** Ink colour of the text (on parchment, use the ink colours). */
  setInk(color: string): this {
    if (this.text.style.color !== color) this.text.setColor(color);
    return this;
  }
}

/** A heading in gilt: the Fell face filled with a gold gradient, cut in dark ink, with a soft drop shadow. */
export function goldText(scene: Phaser.Scene, x: number, y: number, text: string, size: number, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, text, titleStyle(size, COLORS.gold, { stroke: '#1a0e05', strokeThickness: Math.max(2, Math.round(size / 10)), ...extra }));
  t.setShadow(0, Math.max(2, Math.round(size / 14)), '#000000', Math.max(3, Math.round(size / 6)), true, true);
  return gild(t);
}

/** Fill a text with the gilt gradient, top to bottom. Call again after changing its text. */
export function gild(t: Phaser.GameObjects.Text, colors: string[] = ['#fff3c4', '#f2c45a', '#d39b34', '#a8701c']): Phaser.GameObjects.Text {
  const grd = t.context.createLinearGradient(0, t.padding.top ?? 0, 0, t.height - (t.padding.bottom ?? 0));
  colors.forEach((c, i) => grd.addColorStop(i / (colors.length - 1), c));
  return t.setFill(grd);
}

/** A gold piece of eight (the painted heap of doubloons where it has loaded), about `size` across. */
export function coin(scene: Phaser.Scene, x: number, y: number, size = 18): Phaser.GameObjects.Image {
  ensureKit(scene);
  const atlas = scene.textures.exists(ICON_ATLAS) && scene.textures.get(ICON_ATLAS).has('gold');
  if (atlas) return scene.add.image(x, y, ICON_ATLAS, 'gold').setDisplaySize(size * 1.3, size * 1.3);
  return scene.add.image(x, y, 'ui:coin').setScale(size / 40);
}

/** A wax seal, about 96px across, pressed with an anchor or a skull. Red wax for a fair end, black for a foul one. */
export function waxSeal(scene: Phaser.Scene, mark: 'anchor' | 'skull'): string {
  const key = `ui:seal-${mark}`;
  if (scene.textures.exists(key)) return key;
  const S = 112;
  const c = S / 2;
  const tex = scene.textures.createCanvas(key, S, S)!;
  const ctx = tex.getContext();
  const rand = seeded(mark === 'anchor' ? 5 : 9);
  const [hi, mid, lo] = mark === 'anchor' ? ['#e0574a', '#a3221a', '#5e0d08'] : ['#5a4a48', '#2a1e1c', '#0d0807'];
  // The blob of wax: an irregular round, with a drip or two.
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 48 + Math.sin(a * 5 + 1) * 2.5 + Math.sin(a * 9) * 1.5 + rand() * 1.5;
    if (i === 0) ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    else ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  const wax = ctx.createRadialGradient(c - 14, c - 16, 4, c, c, 52);
  wax.addColorStop(0, hi);
  wax.addColorStop(0.55, mid);
  wax.addColorStop(1, lo);
  ctx.fillStyle = wax;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // The pressed disc: a sunken ring, then the device.
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(c + 1, c + 1, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,220,200,0.25)';
  ctx.beginPath();
  ctx.arc(c, c, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 29, c + Math.sin(a) * 29, 1.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  // The device, drawn twice: once dark and offset for depth, once lighter on top.
  for (const [style, d] of [
    ['rgba(0,0,0,0.45)', 1.2],
    ['rgba(255,226,208,0.5)', 0],
  ] as const) {
    ctx.save();
    ctx.translate(c + d, c + d);
    ctx.strokeStyle = style;
    ctx.fillStyle = style;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    if (mark === 'anchor') {
      ctx.beginPath();
      ctx.arc(0, -17, 4, 0, Math.PI * 2);
      ctx.moveTo(0, -13);
      ctx.lineTo(0, 18);
      ctx.moveTo(-9, -7);
      ctx.lineTo(9, -7);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 3, 16, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, -4, 13, Math.PI * 0.85, Math.PI * 2.15);
      ctx.lineTo(8, 12);
      ctx.lineTo(-8, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.arc(-5, -3, 3.6, 0, Math.PI * 2);
      ctx.arc(5, -3, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-18, 14);
      ctx.lineTo(18, 24);
      ctx.moveTo(18, 14);
      ctx.lineTo(-18, 24);
      ctx.stroke();
    }
    ctx.restore();
  }
  tex.refresh();
  return key;
}


/** Whether to use the painted kit: NineSlice draws only under WebGL, so the canvas renderer keeps the flat look. */
function painted(scene: Phaser.Scene): boolean {
  if (scene.sys.renderer?.type === Phaser.CANVAS) return false;
  ensureKit(scene);
  return true;
}

const BTN_SLICE = 12;
const FRAME_SLICE = 24;
const PAPER_SLICE = 40;
const RIBBON_H = 48;
const RIBBON_TAIL = 40;

/** Paint the kit's textures, once per game: button plaques, the panel frame, the grain, a coin and the ribbon. */
function ensureKit(scene: Phaser.Scene): void {
  const textures = scene.textures;
  if (textures.exists('ui:btn')) return;
  const wood = textures.exists('ui:wood') ? (textures.get('ui:wood').getSourceImage() as HTMLImageElement) : null;
  paintButtons(textures, wood);
  paintFrame(textures);
  paintGrain(textures);
  paintCoin(textures);
  paintRibbon(textures);
}

interface PlaqueLook {
  /** How much light the walnut face keeps (0 black, 1 as painted). */
  face: number;
  /** A wash over the face: gilt for a button that is on, grey for one that is off. */
  wash?: [string, string];
  /** The brass rim, light edge and dark edge. */
  rim: [string, string];
  /** Inner glow, as the start of an rgba() colour. */
  glow?: string;
  sunk?: boolean;
}

const PLAQUES: Record<string, PlaqueLook> = {
  base: { face: 0.62, rim: ['#e9c97c', '#6e4c1c'] },
  hover: { face: 0.82, rim: ['#fff2c0', '#a8823a'], glow: 'rgba(255,214,120,' },
  press: { face: 0.4, rim: ['#b89048', '#4e3412'], sunk: true },
  on: { face: 0.7, wash: ['rgba(214,160,64,0.62)', 'rgba(120,76,18,0.72)'], rim: ['#fff2c0', '#9c7432'] },
  onHover: { face: 0.82, wash: ['rgba(236,186,84,0.62)', 'rgba(140,92,24,0.7)'], rim: ['#fffbe0', '#b8903e'], glow: 'rgba(255,236,170,' },
  off: { face: 0.34, wash: ['rgba(60,56,52,0.55)', 'rgba(30,28,26,0.6)'], rim: ['#7a6e5c', '#3a3228'] },
};

/** The six plaque states side by side, each a walnut face in a brass rim, for 9-slicing. */
function paintButtons(textures: Phaser.Textures.TextureManager, wood: HTMLImageElement | null): void {
  const W = 72;
  const H = 44;
  const names = Object.keys(PLAQUES);
  const tex = textures.createCanvas('ui:btn', W * names.length, H)!;
  const ctx = tex.getContext();
  const rand = seeded(7);
  names.forEach((name, i) => {
    const look = PLAQUES[name];
    const ox = i * W;
    ctx.save();
    ctx.translate(ox, 0);
    // A dark outer edge, the brass rim, then the face.
    roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 6);
    ctx.fillStyle = 'rgba(8,4,2,0.95)';
    ctx.fill();
    const rim = ctx.createLinearGradient(0, 1, 0, H - 1);
    rim.addColorStop(0, look.rim[0]);
    rim.addColorStop(0.5, look.rim[1]);
    rim.addColorStop(1, look.rim[0]);
    roundRect(ctx, 1.5, 1.5, W - 3, H - 3, 5);
    ctx.fillStyle = rim;
    ctx.fill();
    roundRect(ctx, 4, 4, W - 8, H - 8, 3);
    ctx.fillStyle = '#120a04';
    ctx.fill();
    roundRect(ctx, 4.5, 4.5, W - 9, H - 9, 3);
    ctx.save();
    ctx.clip();
    if (wood) {
      // The same stretch of grain on every state, so a plaque does not shift when it lights.
      ctx.drawImage(wood, 64, 48, 240, 147, 4, 4, W - 8, H - 8);
    } else {
      const g = ctx.createLinearGradient(0, 4, 0, H - 4);
      g.addColorStop(0, '#6a4a2c');
      g.addColorStop(1, '#2e1c0e');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      for (let k = 0; k < 9; k++) {
        ctx.strokeStyle = rand() < 0.5 ? `rgba(0,0,0,${0.08 + rand() * 0.1})` : `rgba(255,220,170,${0.03 + rand() * 0.05})`;
        ctx.lineWidth = 0.6 + rand();
        const y = 5 + rand() * (H - 10);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + rand() * 1.5 - 0.75);
        ctx.stroke();
      }
    }
    ctx.fillStyle = `rgba(10,5,2,${1 - look.face})`;
    ctx.fillRect(0, 0, W, H);
    if (look.wash) {
      const g = ctx.createLinearGradient(0, 4, 0, H - 4);
      g.addColorStop(0, look.wash[0]);
      g.addColorStop(1, look.wash[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (look.glow) {
      for (let k = 0; k < 5; k++) {
        ctx.strokeStyle = `${look.glow}${0.4 - k * 0.08})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(5 + k, 5 + k, W - 10 - 2 * k, H - 10 - 2 * k);
      }
    }
    // A bevel: light along the top, shadow along the bottom; the other way round when sunk.
    ctx.fillStyle = look.sunk ? 'rgba(0,0,0,0.55)' : 'rgba(255,238,200,0.2)';
    ctx.fillRect(5, 5, W - 10, 1.5);
    ctx.fillStyle = look.sunk ? 'rgba(255,238,200,0.12)' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(5, H - 6.5, W - 10, 1.5);
    ctx.restore();
    // Rivets at the corners of the rim.
    for (const [rx, ry] of [
      [5, 5],
      [W - 5, 5],
      [5, H - 5],
      [W - 5, H - 5],
    ]) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(rx + 0.4, ry + 0.6, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.rim[0];
      ctx.beginPath();
      ctx.arc(rx, ry, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    tex.add(name, 0, ox, 0, W, H);
  });
  tex.refresh();
}

/** The panel's rim: shadow falling inward, a bevelled brass moulding, a keyline and fittings at the corners. The middle is clear. */
function paintFrame(textures: Phaser.Textures.TextureManager): void {
  const S = 72;
  const tex = textures.createCanvas('ui:frame', S, S)!;
  const ctx = tex.getContext();
  for (let i = 0; i < 16; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.4 * (1 - i / 16) ** 2})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(i + 0.5, i + 0.5, S - 2 * i - 1, S - 2 * i - 1);
  }
  ctx.strokeStyle = 'rgba(5,3,1,0.95)';
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  // The moulding: a light upper-left edge and a dark lower-right one, like turned brass catching the light.
  const brass = ctx.createLinearGradient(0, 0, S, S);
  brass.addColorStop(0, '#fbe6a6');
  brass.addColorStop(0.45, '#c49a4c');
  brass.addColorStop(1, '#6e4e1e');
  ctx.strokeStyle = brass;
  ctx.lineWidth = 3;
  ctx.strokeRect(2.5, 2.5, S - 5, S - 5);
  ctx.strokeStyle = 'rgba(255,244,210,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1.5, S - 2);
  ctx.lineTo(1.5, 1.5);
  ctx.lineTo(S - 2, 1.5);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(5,3,1,0.75)';
  ctx.strokeRect(4.5, 4.5, S - 9, S - 9);
  ctx.strokeStyle = 'rgba(217,180,103,0.38)';
  ctx.strokeRect(7.5, 7.5, S - 15, S - 15);
  // Corner fittings: a brass bracket with a scroll over the keyline, and a rivet.
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    ctx.save();
    ctx.translate(sx > 0 ? 0 : S, sy > 0 ? 0 : S);
    ctx.scale(sx, sy);
    const plate = ctx.createLinearGradient(3, 3, 20, 20);
    plate.addColorStop(0, '#fbe6a6');
    plate.addColorStop(1, '#9c7432');
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.moveTo(3, 3);
    ctx.lineTo(22, 3);
    ctx.quadraticCurveTo(20, 9, 13, 9);
    ctx.lineTo(9, 9);
    ctx.lineTo(9, 13);
    ctx.quadraticCurveTo(9, 20, 3, 22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(5,3,1,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,24,8,0.8)';
    ctx.beginPath();
    ctx.arc(6.5, 6.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,192,0.95)';
    ctx.beginPath();
    ctx.arc(6, 6, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  tex.refresh();
}

/** A tile of fine fibrous grain, the stand-in for the painted walnut when it has not loaded. */
function paintGrain(textures: Phaser.Textures.TextureManager): void {
  const S = 128;
  const tex = textures.createCanvas('ui:grain', S, S)!;
  const ctx = tex.getContext();
  const rand = seeded(11);
  for (let k = 0; k < 150; k++) {
    const y = rand() * S;
    ctx.strokeStyle = rand() < 0.45 ? `rgba(190,170,130,${0.05 + rand() * 0.06})` : `rgba(0,0,0,${0.1 + rand() * 0.12})`;
    ctx.lineWidth = 0.5 + rand() * 1.2;
    const x = rand() * S;
    const len = 20 + rand() * 90;
    const bend = rand() * 2 - 1;
    // Drawn twice, a tile apart, so the tile wraps without a seam.
    for (const dx of [0, -S]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.quadraticCurveTo(x + dx + len / 2, y + bend, x + dx + len, y);
      ctx.stroke();
    }
  }
  tex.refresh();
}

function paintCoin(textures: Phaser.Textures.TextureManager): void {
  const S = 40;
  const c = S / 2;
  const tex = textures.createCanvas('ui:coin', S, S)!;
  const ctx = tex.getContext();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(c + 1, c + 2, c - 2, 0, Math.PI * 2);
  ctx.fill();
  const face = ctx.createRadialGradient(c - 6, c - 7, 2, c, c, c);
  face.addColorStop(0, '#fff2b8');
  face.addColorStop(0.45, '#f0c24e');
  face.addColorStop(1, '#9a6a14');
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6a440c';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(106,68,12,0.7)';
  ctx.beginPath();
  ctx.arc(c, c, c - 6, 0, Math.PI * 2);
  ctx.stroke();
  // The cross of a piece of eight.
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c, c - 8);
  ctx.lineTo(c, c + 8);
  ctx.moveTo(c - 8, c);
  ctx.lineTo(c + 8, c);
  ctx.stroke();
  tex.refresh();
}

/**
 * A red silk ribbon for headings: a band with stitched edges across the middle, and at each end a tail folded
 * behind it with a swallowtail notch. 9-sliced across, so the tails keep their shape at any width.
 */
function paintRibbon(textures: Phaser.Textures.TextureManager): void {
  const W = 200;
  const H = RIBBON_H;
  const T = RIBBON_TAIL;
  const tex = textures.createCanvas('ui:ribbon', W, H)!;
  const ctx = tex.getContext();
  const bandTop = 6;
  const bandBot = 36;
  const cloth = (y0: number, y1: number, light: string, dark: string) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, light);
    g.addColorStop(0.5, dark);
    g.addColorStop(1, light);
    return g;
  };
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  // The tails, behind the band: a darker underside, notched at the free end.
  for (const s of [1, -1]) {
    ctx.save();
    if (s < 0) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.beginPath();
    ctx.moveTo(T - 2, 14);
    ctx.lineTo(1, 14);
    ctx.lineTo(11, 29);
    ctx.lineTo(1, 44);
    ctx.lineTo(T - 2, 44);
    ctx.closePath();
    ctx.fillStyle = cloth(14, 44, '#8a1e18', '#5a0e0a');
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // The fold where the tail turns under the band.
    ctx.beginPath();
    ctx.moveTo(T - 14, bandBot);
    ctx.lineTo(T - 2, 44);
    ctx.lineTo(T - 2, bandBot);
    ctx.closePath();
    ctx.fillStyle = '#3a0604';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240,200,140,0.35)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(4, 17);
    ctx.lineTo(T - 2, 17);
    ctx.moveTo(4, 41);
    ctx.lineTo(T - 2, 41);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = cloth(bandTop, bandBot, '#c43a2c', '#8e1f1a');
  ctx.fillRect(T - 14, bandTop, W - 2 * (T - 14), bandBot - bandTop);
  ctx.shadowColor = 'transparent';
  // Sheen, stitching and a dark edge top and bottom.
  ctx.fillStyle = 'rgba(255,220,200,0.18)';
  ctx.fillRect(T - 14, bandTop + 2, W - 2 * (T - 14), 4);
  ctx.strokeStyle = 'rgba(40,4,2,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(T - 13.5, bandTop + 0.5, W - 2 * (T - 14) - 1, bandBot - bandTop - 1);
  ctx.strokeStyle = 'rgba(246,214,150,0.6)';
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.moveTo(T - 11, bandTop + 3.5);
  ctx.lineTo(W - T + 11, bandTop + 3.5);
  ctx.moveTo(T - 11, bandBot - 3.5);
  ctx.lineTo(W - T + 11, bandBot - 3.5);
  ctx.stroke();
  ctx.setLineDash([]);
  tex.refresh();
}

/** A small seeded random, so the painted grain comes out the same every time. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Animated sea backdrop. Call `draw(time)` each frame. Made the size of the screen, it reaches the window's edges. */
export class Sea {
  private readonly g: Phaser.GameObjects.Graphics;
  /** The painted sea, when its texture is loaded; otherwise a drawn gradient with wave marks. */
  private readonly img: Phaser.GameObjects.Image | null = null;
  /** The area it covers: the whole window and a margin (the battle camera pulls back and shakes). */
  private area: Phaser.Geom.Rectangle;

  /** `dim` darkens the painting so text on top stays readable (0 for the battle, where the sea is the stage). */
  constructor(scene: Phaser.Scene, w: number, h: number, dim = 0.4) {
    this.area = new Phaser.Geom.Rectangle(0, 0, w, h);
    this.g = scene.add.graphics().setDepth(-10);
    if (scene.textures.exists('art:tex-sea')) {
      this.img = scene.add.image(w / 2, h / 2, 'art:tex-sea').setDepth(-10);
      this.img.setScale(Math.max(w / this.img.width, h / this.img.height) * 1.04);
      if (dim > 0) scene.add.rectangle(0, 0, w, h, 0x061420, dim).setOrigin(0).setDepth(-9.5);
    }
    if (w === SCREEN.w && h === SCREEN.h) {
      bleed(scene, this.g, (r) => {
        const m = Math.max(r.width, r.height) * 0.1;
        this.area = new Phaser.Geom.Rectangle(r.x - m, r.y - m, r.width + m * 2, r.height + m * 2);
        if (this.img) this.img.setScale(Math.max(this.area.width / this.img.width, this.area.height / this.img.height) * 1.04);
      });
    }
  }

  draw(timeMs: number): void {
    const a = this.area;
    if (this.img) {
      // A slow drift, as if the swell were moving under you.
      this.img.setPosition(a.centerX + Math.sin(timeMs / 4000) * 8, a.centerY + Math.cos(timeMs / 5200) * 5);
      return;
    }
    const g = this.g;
    const t = timeMs / 1000;
    g.clear();
    g.fillGradientStyle(COLORS.seaLight, COLORS.seaLight, COLORS.seaDeep, COLORS.seaDeep, 1);
    g.fillRect(a.x, a.y, a.width, a.height);
    g.lineStyle(2, COLORS.wave, 0.35);
    const first = Math.floor((a.y - 30) / 52);
    for (let row = first; row < first + Math.ceil(a.height / 52) + 1; row++) {
      const y = 30 + row * 52;
      const offset = ((t * (12 + (Math.abs(row) % 3) * 6) + row * 47) % 120) - 120;
      for (let x = offset + 120 * Math.floor((a.x - 36 - offset) / 120); x < a.right; x += 120) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 18, y - 5);
        g.lineTo(x + 36, y);
        g.strokePath();
      }
    }
  }
}
