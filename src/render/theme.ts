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
  panel: 0x0f1b26,
  panelEdge: 0x8a6a36,
  panelInner: 0x24384a,
  button: 0x1d3041,
  buttonHover: 0x2b4760,
  buttonActive: 0x8a6a2a,
  buttonDisabled: 0x1c2630,
  /** Polished brass, for frames and ornaments. */
  brass: 0xd9b467,
  text: '#efe6d0',
  textDim: '#9fb1bf',
  textWarn: '#ff7b5c',
  textGood: '#9be37f',
  gold: '#f2c45a',
  /** Ink on parchment, and its red for warnings and the Navy. */
  ink: '#2a170a',
  inkRed: '#8a1c1c',
} as const;

/** Body text: a book face with lining figures, legible at 12px. Bundled from @fontsource (OFL). */
export const FONT = '"Lora", "Trebuchet MS", Georgia, serif';
/** Headings: IM Fell English, from types cut in the 1680s (OFL), with Lora's lining figures (see main.ts). */
export const TITLE_FONT = '"STL Fell", Georgia, "Times New Roman", serif';
/** Small capitals of the same Fell face, for labels and section heads. */
export const CAPS_FONT = '"STL Fell SC", "STL Fell", Georgia, serif';

/** Every face the screens draw with, for document.fonts.load before the first scene. */
export const FONT_FACES = ['16px "Lora"', 'italic 16px "Lora"', 'bold 16px "Lora"', 'bold italic 16px "Lora"', '32px "STL Fell"', 'italic 32px "STL Fell"', '32px "STL Fell SC"'];

export const SCREEN = { w: 1280, h: 720 } as const;

export function textStyle(size: number, color: string = COLORS.text, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return { fontFamily: FONT, fontSize: `${size}px`, color, ...extra };
}

/** A heading in the Fell face. */
export function titleStyle(size: number, color: string = COLORS.gold, extra: Phaser.Types.GameObjects.Text.TextStyle = {}) {
  return { fontFamily: TITLE_FONT, fontSize: `${size}px`, color, ...extra };
}
