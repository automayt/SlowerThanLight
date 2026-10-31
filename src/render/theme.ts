import type Phaser from 'phaser';

export const COLORS = {
  seaDeep: 0x0b1f33,
  seaLight: 0x14405e,
  wave: 0x2a6a8f,
  hull: 0x5a3b22,
  hullEdge: 0x2b1a0d,
  deck: 0xc8a26a,
  deckSystem: 0xd8b77e,
  deckEnemy: 0xb9ab8a,
  roomEdge: 0x3a2614,
  door: 0xf0deb0,
  water: 0x2f7fd6,
  fire: 0xff5a1f,
  fireCore: 0xffc23a,
  breach: 0x10161c,
  pipOn: 0x7fdc6a,
  pipOff: 0x3a3a3a,
  pipDamaged: 0xd23c3c,
  playerCrew: 0xf3e3b5,
  enemyCrew: 0x2f5ea8,
  select: 0xffe34d,
  aim: 0xff4040,
  /** Under an oiled-walnut panel: the darkest of the wood, so the grain laid over it reads as a board. */
  panel: 0x1c120a,
  panelEdge: 0x8a6a36,
  panelInner: 0x3a2a18,
  button: 0x2a1a0e,
  buttonHover: 0x3d2814,
  buttonActive: 0x8a6a2a,
  buttonDisabled: 0x221c17,
  /** Polished brass, for frames and ornaments. */
  brass: 0xd9b467,
  /** Ribbon cloth for headings. */
  ribbon: 0x8e1f1a,
  text: '#efe6d0',
  textDim: '#b3a58a',
  textWarn: '#ff7b5c',
  textGood: '#9be37f',
  gold: '#f2c45a',
  /** Ink on parchment, and its red for warnings and the Navy. */
  ink: '#2a170a',
  inkDim: '#6a5236',
  inkRed: '#8a1c1c',
  inkGood: '#2f5a1c',
  inkGold: '#7a4e0c',
} as const;

/** Body text: a book face with lining figures, legible at 12px. Bundled from @fontsource (OFL). */
export const FONT = '"Lora", "Trebuchet MS", Georgia, serif';
/** Headings: IM Fell English, from types cut in the 1680s (OFL), with Lora's lining figures (see main.ts). */
export const TITLE_FONT = '"STL Fell", Georgia, "Times New Roman", serif';
/** Small capitals of the same Fell face, for labels and section heads. */
export const CAPS_FONT = '"STL Fell SC", "STL Fell", Georgia, serif';

/** Every face the screens draw with, for document.fonts.load before the first scene. */
export const FONT_FACES = ['16px "Lora"', 'italic 16px "Lora"', 'bold 16px "Lora"', 'bold italic 16px "Lora"', '32px "STL Fell"', 'italic 32px "STL Fell"', '32px "STL Fell SC"'];

/**
 * The type scale. Body text in Lora: `small` for captions and keycaps, `body` for most lines, `lead` for an
 * opening line. Headings in Fell: `label` for a section head in small capitals, `head` for a panel title,
 * `title` for a dialog, `banner` for a screen.
 */
export const TYPE = { small: 11, body: 13, lead: 15, label: 15, head: 18, title: 26, banner: 34 } as const;

export const SCREEN = { w: 1280, h: 720 } as const;

export function textStyle(size: number, color: string = COLORS.text, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return { fontFamily: FONT, fontSize: `${size}px`, color, ...extra };
}

/** A heading in the Fell face. */
export function titleStyle(size: number, color: string = COLORS.gold, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return { fontFamily: TITLE_FONT, fontSize: `${size}px`, color, ...extra };
}

/** A section label in Fell small capitals. */
export function capsStyle(size: number = TYPE.label, color: string = COLORS.gold, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return { fontFamily: CAPS_FONT, fontSize: `${size}px`, color, ...extra };
}

/** Body text in ink, for parchment. */
export function inkStyle(size: number = TYPE.body, color: string = COLORS.ink, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return textStyle(size, color, extra);
}

/**
 * The same hue as a colour meant for dark wood, deepened to read as ink on parchment (a power's colour, say).
 * `k` is how much of the original lightness is kept.
 */
export function inkOf(color: string, k = 0.5): string {
  const n = parseInt(color.replace('#', ''), 16);
  const ch = (s: number) => Math.round(((n >> s) & 0xff) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
