import Phaser from 'phaser';
import { gunLoadRate, type Battle } from '../sim/Battle';
import { SHOT_EFFECTS } from '../sim/Combat';
import { badges } from '../sim/Skills';
import { SINK_FRACTION } from '../sim/Hazards';
import { ORDER_IDS, ORDERS, type OrderId } from '../sim/Orders';
import { TEMPERS } from '../sim/Temper';
import type { Crew, GunState, Ship } from '../sim/Ship';
import { SHOT_TYPES, SYSTEM_NAMES, type ShotType, type SystemId } from '../sim/types';
import { crewTextures } from './CrewArt';
import { icon, setIcon, type IconName } from './icons';
import { COLORS, SCREEN, TYPE, capsStyle, textStyle, titleStyle } from './theme';
import { LogBook, Toasts, type LogEntry } from './Toasts';
import { addTip, Button, drawBar, drawPips, keycap, panel, Ribbon, Slip, tipZone } from './ui';
import type { BattleCommand } from '../sim/commands';
import { toDesign } from './screen';

export interface HudCallbacks {
  selectCrew(id: number, additive: boolean): void;
  selectGun(index: number): void;
  /** Pick a gun for aiming (no toggle): any click on its card, buttons included, readies it. */
  aimWith(index: number): void;
  clearGunTarget(index: number): void;
  toggleSpeed(): void;
  /** Give a battle order (in co-op it goes to the server, if it is this player's to give). */
  order(cmd: BattleCommand): boolean;
}

export interface HudState {
  selectedCrew: Set<number>;
  aimingGun: number | null;
  hoverText: string;
  /** Game speed multiplier (1 or 2). */
  speed: number;
}

/** Keys that select crew, in muster-roll order. */
export const CREW_KEYS = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O'] as const;

/** One-line explanations of each station, for the deckhand rows. */
const SYSTEM_TIPS: Record<SystemId, string> = {
  helm: 'Helm: someone must stand at the wheel, or evasion and making sail drop to nothing.',
  bulwarks: 'Bulwarks: each hand raises a layer that stops one ball (chain shot flies over). Layers rebuild after a hit.',
  sails: 'Sails: hands here add evasion and speed for making sail. A crew member at the mast adds more.',
  pumps: 'Pumps: hands bail out flood water. Send crew to patch holes, or she fills and sinks.',
  surgeon: "Surgeon: hands here heal crew resting in the surgeon's cabin.",
  guns: 'Gun Deck: manned guns draw their hands from here. Crew standing in the room load them faster.',
};

/** First-battle hints, each shown once and remembered. */
export type HintId = 'aim' | 'crew' | 'pause' | 'hands' | 'shot';
const HINT_TEXT: Record<HintId, string> = {
  aim: 'Click a gun card (or press its number), then a room on her ship to aim it.',
  crew: 'Click a crew member (or their key), then a room to send them. Shift picks several.',
  pause: 'Space pauses the fight. You can give every order while paused.',
  hands: 'Deckhands work your stations with the + and − buttons. On Bulwarks, each raises a layer that stops a ball.',
  shot: 'Try other shot: chain tears her sails, grape cuts down crew, hot shot starts fires. Shift+number cycles a gun’s shot.',
};
/** How long an informational hint stays up, in ms (aiming waits until it is done). */
const HINT_MS: Partial<Record<HintId, number>> = { crew: 14000, pause: 9000, hands: 16000, shot: 16000 };
const HINTS_KEY = 'slower-than-light.hints';
let hintsSeen: Set<string> | null = null;

function seenHints(): Set<string> {
  if (!hintsSeen) {
    try {
      hintsSeen = new Set(JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]') as string[]);
    } catch {
      hintsSeen = new Set();
    }
  }
  return hintsSeen;
}

function markHintSeen(id: HintId): void {
  const seen = seenHints();
  if (seen.has(id)) return;
  seen.add(id);
  try {
    localStorage.setItem(HINTS_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage may be blocked; the hint just comes back next time.
  }
}

const BOTTOM_Y = 512;

/**
 * Draw order of the HUD: above the ships (1-6), drag band (25), ambient gulls and cloud shadows, and hit effects,
 * so nothing drifts over a panel; the scene's banners and outcome overlay sit above all of it (60+).
 */
export const HUD_DEPTH = { panels: 50, toasts: 51, alert: 52, banner: 53, hint: 54, hover: 55, log: 90 } as const;
/** Hull bars start this far right of the panel's edge, after the hull icon. */
const HULL_BAR_DX = 40;
/** Widest a hull bar may grow. */
const HULL_BAR_W = 400;

/** Phaser re-draws and re-uploads a Text on every setColor, so only call it on a change. */
function tint(text: Phaser.GameObjects.Text, color: string): Phaser.GameObjects.Text {
  if (text.style.color !== color) text.setColor(color);
  return text;
}

/** Set a Text's words only when they change (each change re-draws its texture). */
function say(text: Phaser.GameObjects.Text, words: string): Phaser.GameObjects.Text {
  if (text.text !== words) text.setText(words);
  return text;
}

/** Section heading in the Fell small capitals. */
function heading(scene: Phaser.Scene, x: number, y: number, text: string, size: number = TYPE.label): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, capsStyle(size, COLORS.gold)).setShadow(0, 1, '#000000', 2, false, true);
}

const CARD_W = 200;
const CARD_GAP = 6;
const CARDS_X = 346;
/** The captain's orders row, between the two top panels under the clock. */
const ORDER_W = 104;
const ORDER_Y = 42;
const ORDER_LABEL: Record<OrderId, string> = { rake: 'Rake her!', sail: 'Crowd sail', steel: 'Cold steel' };
const ENEMY_ORDER_LABEL: Record<OrderId, string> = { rake: 'RAKING', sail: 'CROWDING SAIL', steel: 'COLD STEEL' };
/** The log button, bottom right. */
const LOG_KEY = 'L';

interface GunCard {
  bg: Phaser.GameObjects.Rectangle;
  status: Phaser.GameObjects.Text;
  target: Phaser.GameObjects.Text;
  targetIcon: Phaser.GameObjects.Image;
  secs: Phaser.GameObjects.Text;
  foot: Phaser.GameObjects.Text;
  power: Button;
  shots: Button[];
  x: number;
}

interface CrewRow {
  bg: Phaser.GameObjects.Rectangle;
  skin: Phaser.GameObjects.NineSlice | null;
  name: Phaser.GameObjects.Text;
  task: Phaser.GameObjects.Text;
  taskIcon: Phaser.GameObjects.Image;
  /** The full line for the tooltip. */
  tip: string;
}

interface StatSlot {
  icon: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
}

/** All on-screen panels around the two ships. Built once, refreshed every frame. */
export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly playerStats: { evasion: StatSlot; flood: StatSlot; board: StatSlot };
  private readonly enemyStats: { evasion: StatSlot; flood: StatSlot; crew: StatSlot };
  private readonly fleeLabel: Phaser.GameObjects.Text;
  private readonly escapeBtn: Button;
  private readonly broadsideBtn: Button;
  private readonly handsCount: Phaser.GameObjects.Text;
  private readonly sysRows = new Map<SystemId, { y: number; status: StatSlot }>();
  private readonly cards: GunCard[] = [];
  private readonly crewRows: CrewRow[] = [];
  /** Every line of the fight; a line repeated back to back is counted rather than written again. */
  private readonly log: LogEntry[] = [];
  private readonly toasts: Toasts;
  private logBook: LogBook | null = null;
  private readonly logBtn: Button;
  private unread = 0;
  private readonly pauseBtn: Button;
  private readonly speedBtn: Button;
  private readonly orderBtns = new Map<OrderId, Button>();
  /** Her captain's temper, and any order of hers in force. */
  private readonly temperText: Phaser.GameObjects.Text;
  private readonly enemyOrdersText: Phaser.GameObjects.Text;
  private readonly hintBox: Phaser.GameObjects.Container;
  private readonly hintG: Phaser.GameObjects.Graphics;
  private readonly hintPaper: Phaser.GameObjects.NineSlice | null;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly hintAnchors: Record<HintId, { x: number; y: number; dir: 'up' | 'down' | 'left' }>;
  private readonly hintClose: Phaser.GameObjects.Text;
  private hintId: HintId | null = null;
  private hintUntil = 0;
  private readonly pauseBanner: Phaser.GameObjects.Text;
  private readonly alert: Ribbon;
  /** A short-lived headline (a crew death) that outranks the standing alerts. */
  private flashText = '';
  private flashUntil = 0;
  private readonly hoverSlip: Slip;
  private readonly companyText: Phaser.GameObjects.Text;
  private readonly pointer: Phaser.Input.Pointer;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly battle: Battle,
    cb: HudCallbacks,
  ) {
    const player = battle.player;
    const enemy = battle.enemy;
    const before = new Set(scene.children.list);

    // --- Top: player status ---
    panel(scene, 8, 8, 470, 66);
    icon(scene, 26, 23, 'hull', 28);
    tipZone(scene, 12, 10, 440, 26, () => `Hull ${player.hull} of ${player.def.hull}. At none she goes down.\nThe shields below: bulwark layers, each stops one ball.`);
    this.playerStats = {
      evasion: this.stat(scene, 22, 'evasion', () => `Evasion: ${Math.round(player.evasion())}% of her shots miss. Helm and Sails raise it.`),
      flood: this.stat(scene, 92, 'flood', () => `Flooding: ${floodPct(player)} of the way to sinking. Pumps bail; crew patch holes.`),
      board: this.stat(scene, 162, 'board', () => (battle.canBoard() ? 'You can board her: select crew, then click a room on her ship.' : 'Too far to board: she must be slowed (her Sails or Helm) first.')),
    };
    this.companyText = scene.add.text(14, 78, '', textStyle(12, COLORS.textGood, { fontStyle: 'italic', backgroundColor: '#1c120acc', padding: { x: 6, y: 2 } })).setDepth(HUD_DEPTH.panels);
    this.escapeBtn = new Button(scene, 360, 42, 108, 26, 'Escape', () => cb.order({ t: 'escape' }), {
      size: 13,
      tip: 'Make sail and escape the fight. The bar fills while hands work the Sails and someone stands at the Helm.',
    });

    // --- Top centre: the clock ---
    this.pauseBtn = new Button(scene, SCREEN.w / 2 - 122, 10, 118, 26, '', () => {
      cb.order({ t: 'pause', on: !battle.paused });
      this.hintDone('pause');
    }, { size: 13, hint: 'Space' });
    this.speedBtn = new Button(scene, SCREEN.w / 2 + 4, 10, 118, 26, '2× speed', () => cb.toggleSpeed(), { size: 13, hint: 'F' });

    // --- Top centre, under the clock: the captain's orders ---
    ORDER_IDS.forEach((id, i) => {
      const def = ORDERS[id];
      const b = new Button(scene, SCREEN.w / 2 - (ORDER_IDS.length * (ORDER_W + 4) - 4) / 2 + i * (ORDER_W + 4), ORDER_Y, ORDER_W, 24, ORDER_LABEL[id], () => cb.order({ t: 'order', order: id }), {
        size: 12,
        hint: def.key,
        tip: `${def.name} (${def.key})
${def.blurb}
Lasts ${def.duration}s, then ${def.cooldown - def.duration}s more to make ready.`,
      });
      this.orderBtns.set(id, b);
    });

    // --- Top: enemy status ---
    const ex = SCREEN.w - 478;
    panel(scene, ex, 8, 470, 66);
    icon(scene, ex + 18, 23, 'hull', 28);
    tipZone(scene, ex + 4, 10, 440, 26, () => `Her hull: ${enemy.hull} of ${enemy.def.hull}. Bring it to nothing and she strikes.`);
    const cls = scene.add.text(ex + 12, 49, enemy.def.className, textStyle(TYPE.body, COLORS.textDim, { fontStyle: 'italic' }));
    const sx = Math.min(ex + 12 + cls.width + 14, ex + 230);
    this.enemyStats = {
      evasion: this.stat(scene, sx, 'evasion', () => `Her evasion: ${Math.round(enemy.evasion())}% of your shots miss. Chain on her Sails, or hit her Helm.`),
      flood: this.stat(scene, sx + 70, 'flood', () => `Her flooding: ${floodPct(enemy)} of the way to sinking.`),
      crew: this.stat(scene, sx + 140, 'crew', () => `Her people still standing, of those she began with: ${battle.crewOf('enemy').length} of ${battle.crewAtStart.enemy}. The odds for a boarding party.`),
    };
    const temper = TEMPERS[battle.temper];
    this.temperText = scene.add
      .text(SCREEN.w - 14, 78, `Her captain: ${temper.name}`, textStyle(12, COLORS.gold, { fontStyle: 'italic', backgroundColor: '#1c120acc', padding: { x: 6, y: 2 } }))
      .setOrigin(1, 0)
      .setDepth(HUD_DEPTH.panels)
      .setInteractive();
    addTip(this.temperText, `Her captain: ${temper.name}. ${temper.short}.`);
    this.enemyOrdersText = scene.add
      .text(SCREEN.w - 14, 100, '', textStyle(12, COLORS.textWarn, { fontStyle: 'bold', backgroundColor: '#1c120acc', padding: { x: 6, y: 2 } }))
      .setOrigin(1, 0)
      .setDepth(HUD_DEPTH.panels);

    // --- Left: crew list ---
    heading(scene, 12, 86, 'Crew');
    player.crew.forEach((c, i) => {
      const y = 110 + i * 40;
      const skin = scene.textures.exists('ui:btn') ? scene.add.nineslice(8, y, 'ui:btn', 'base', 168, 36, 10, 10, 10, 10).setOrigin(0) : null;
      const bg = scene.add.rectangle(8, y, 168, 36, COLORS.panel, skin ? 0.001 : 0.88).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge, skin ? 0 : 1);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => cb.selectCrew(c.id, p.event.shiftKey));
      // Head-and-shoulders portrait cut from their sprite.
      scene.add.rectangle(13, y + 4, 28, 28, 0x120a04).setOrigin(0).setStrokeStyle(1, COLORS.brass, 0.5);
      scene.add.image(27, y + 5, `${crewTextures(scene, c)}:idle0`).setOrigin(0.5, 0).setCrop(10, 2, 36, 34).setScale(0.78).setDisplayOrigin(28, 3);
      const name = scene.add.text(46, y + 4, c.name, textStyle(12, COLORS.text, { fontStyle: 'bold' }));
      const taskIcon = icon(scene, 52, y + 24, 'anchor', 14);
      const task = scene.add.text(61, y + 17, '', textStyle(TYPE.small - 1, COLORS.textDim));
      if (i < CREW_KEYS.length) keycap(scene, 10, y + 22, CREW_KEYS[i], 9);
      bg.setData('crewId', c.id);
      const row: CrewRow = { bg, skin, name, task, taskIcon, tip: '' };
      addTip(bg, () => row.tip);
      this.crewRows.push(row);
    });

    // --- Bottom-left: hands ---
    panel(scene, 8, BOTTOM_Y, 330, 200);
    icon(scene, 28, BOTTOM_Y + 18, 'hands', 22);
    const handsTitle = heading(scene, 44, BOTTOM_Y + 8, 'Deckhands').setInteractive();
    addTip(
      handsTitle,
      'Deckhands are your ship’s working hands: put them on stations like power. Your named crew (left) are separate: officers who walk the decks, man stations, repair and fight.',
    );
    this.handsCount = scene.add.text(handsTitle.x + handsTitle.width + 8, BOTTOM_Y + 10, '', textStyle(TYPE.body, COLORS.textDim));
    const systems: SystemId[] = ['helm', 'bulwarks', 'sails', 'pumps', 'surgeon', 'guns'];
    systems.filter((id) => player.system(id)).forEach((id, i) => {
      const y = BOTTOM_Y + 42 + i * 26;
      icon(scene, 27, y + 8, id, 22);
      scene.add.text(42, y, SYSTEM_NAMES[id], textStyle(TYPE.body));
      tipZone(scene, 14, y - 3, 96, 24, () => `${SYSTEM_TIPS[id]}\n${systemStatus(player, id).long}`);
      tipZone(scene, 262, y - 3, 72, 24, () => systemStatus(player, id).long);
      const status = { icon: icon(scene, 274, y + 8, 'check', 16), text: scene.add.text(284, y + 1, '', textStyle(TYPE.small, COLORS.textDim)) };
      this.sysRows.set(id, { y, status });
      if (id === 'bulwarks' || id === 'sails' || id === 'pumps' || id === 'surgeon') {
        const hands = (d: number) => {
          cb.order({ t: 'hands', system: id, delta: d });
          this.hintDone('hands');
        };
        new Button(scene, 112, y - 2, 22, 22, '−', () => hands(-1), { size: 15, tip: `Take a hand off the ${SYSTEM_NAMES[id]}` });
        new Button(scene, 236, y - 2, 22, 22, '+', () => hands(1), { size: 15, tip: `Put a hand on the ${SYSTEM_NAMES[id]}` });
      }
    });

    this.broadsideBtn = new Button(scene, 214, BOTTOM_Y + 8, 116, 24, '', () => cb.order({ t: 'broadside', on: !battle.player.broadside }), {
      size: 12,
      hint: 'B',
      tip: 'Broadside (B): hold every aimed gun until all are loaded, then fire together. Swamps bulwarks, which stop one ball per layer.',
    });

    // --- Bottom-centre: gun cards ---
    player.guns.forEach((gun, i) => {
      const x = CARDS_X + i * (CARD_W + CARD_GAP);
      const def = gun.def;
      const bg = panel(scene, x, BOTTOM_Y, CARD_W, 200);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => (p.rightButtonDown() ? cb.clearGunTarget(i) : cb.selectGun(i)));
      const loadSecs = (def.loadTime / Math.max(0.01, gunLoadRate(player))).toFixed(0);
      addTip(
        bg,
        () =>
          `${def.name}: ${def.hands ? `${def.hands} hand${def.hands > 1 ? 's' : ''} to man` : 'needs no hands'}, fires ${def.shots} ball${def.shots > 1 ? 's' : ''} of ${def.damage} damage, loads in about ${loadSecs}s.${def.note ? `\n${def.note}.` : ''}\nClick the card (or press ${i + 1}), then a room on her ship. Right-click clears its target.`,
      );
      keycap(scene, x + 10, BOTTOM_Y + 11, `${i + 1}`, 12);
      const name = scene.add.text(x + 30, BOTTOM_Y + 9, def.name, titleStyle(17, COLORS.gold)).setShadow(0, 1, '#000000', 2, false, true);
      for (let size = 16; name.width > CARD_W - 40 && size >= 12; size--) name.setFontSize(size);
      // Made with its longer word, so the icon takes its place beside it.
      const power = new Button(scene, x + 8, BOTTOM_Y + 36, 92, 28, 'Manned', () => {
        cb.order({ t: 'gunPower', gun: i });
        cb.aimWith(i);
      }, { size: 12, icon: 'crew', tip: `Man this gun with ${def.hands || 'no'} hand${def.hands === 1 ? '' : 's'} from the gun deck, or stand them down.` });
      // What she needs and what she throws: a hat per hand, a ball per shot.
      const hx = x + 110;
      if (def.hands) for (let h = 0; h < def.hands; h++) icon(scene, hx + 7 + h * 15, BOTTOM_Y + 43, 'crew', 16);
      else scene.add.text(hx, BOTTOM_Y + 36, 'no hands', textStyle(TYPE.small, COLORS.textDim, { fontStyle: 'italic' }));
      icon(scene, hx + 7, BOTTOM_Y + 59, 'round', 15);
      scene.add.text(hx + 17, BOTTOM_Y + 51, `${def.shots} × ${def.damage}`, textStyle(TYPE.body, COLORS.text, { fontStyle: 'bold' }));
      scene.add.text(hx + 17 + 34, BOTTOM_Y + 53, 'dmg', textStyle(TYPE.small - 1, COLORS.textDim));
      // The load meter, with seconds to go written on its end.
      icon(scene, x + 16, BOTTOM_Y + 80, 'clock', 16);
      const secs = scene.add.text(x + CARD_W - 12, BOTTOM_Y + 80, '', textStyle(TYPE.small, '#fff6e0', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(1, 0.5);
      const status = scene.add.text(x + 10, BOTTOM_Y + 93, '', textStyle(12, COLORS.textDim, { wordWrap: { width: CARD_W - 20 }, lineSpacing: -2 }));
      const targetIcon = icon(scene, x + 17, BOTTOM_Y + 121, 'target', 16);
      const target = scene.add.text(x + 28, BOTTOM_Y + 113, '', textStyle(12));
      const shotW = (CARD_W - 16 - 3 * 4) / 4;
      const shots = SHOT_TYPES.map((s, j) => {
        const b = new Button(scene, x + 8 + j * (shotW + 4), BOTTOM_Y + 138, shotW, 34, '', () => {
          cb.order({ t: 'shot', gun: i, shot: s });
          // Choosing the shot readies the gun too: pick chain, then click where it goes.
          cb.aimWith(i);
          this.hintDone('shot');
        }, { size: 13, icon: s, tip: `${SHOT_EFFECTS[s].label} shot: ${SHOT_EFFECTS[s].blurb}\nShift+${i + 1} cycles this gun's shot.` });
        // A gun that fires only one kind of shot offers only that one.
        if (def.fixedShot && def.fixedShot !== s) b.setEnabled(false).setAlpha(0.35);
        return b;
      });
      // The shot in the gun, or what sets a special gun apart.
      if (def.note) icon(scene, x + 16, BOTTOM_Y + 186, 'star', 14);
      const foot = scene.add.text(x + (def.note ? 26 : 10), BOTTOM_Y + 186, def.note ?? '', textStyle(TYPE.small, def.note ? COLORS.gold : COLORS.textDim, { fontStyle: 'italic' })).setOrigin(0, 0.5);
      this.cards.push({ bg, status, target, targetIcon, secs, foot, power, shots, x });
    });

    // --- Bottom-right: the log, kept in a book; its lines pop up as toasts near the action ---
    this.logBtn = new Button(scene, SCREEN.w - 8 - 108, BOTTOM_Y + 200 - 38, 108, 38, 'Log', () => this.toggleLog(), { size: 14, icon: 'log', hint: LOG_KEY, tip: "The Captain's Log: every report of the fight (L)." });
    scene.input.keyboard?.on(`keydown-${LOG_KEY}`, () => this.toggleLog());

    this.g = scene.add.graphics();
    this.fleeLabel = scene.add
      .text(SCREEN.w - 65, 56, 'FLEEING', textStyle(12, COLORS.text, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }))
      .setOrigin(0.5)
      .setVisible(false);
    // Everything built so far is panel furniture: lift it above the ships, the gulls and the gun smoke.
    for (const obj of scene.children.list) if (!before.has(obj)) (obj as unknown as Phaser.GameObjects.Components.Depth).setDepth(HUD_DEPTH.panels);
    // The seconds to go are written on the load meters, which are drawn after them.
    for (const card of this.cards) card.secs.setDepth(HUD_DEPTH.panels + 0.5);

    this.toasts = new Toasts(scene, HUD_DEPTH.toasts);
    this.alert = new Ribbon(scene, SCREEN.w / 2, 486, '', { size: 17, depth: HUD_DEPTH.alert }).setVisible(false);
    this.pauseBanner = scene.add
      .text(SCREEN.w / 2, 98, 'PAUSED  ·  Space to resume', titleStyle(24, COLORS.gold, { backgroundColor: '#1c120ae0', padding: { x: 18, y: 7 }, stroke: '#000000', strokeThickness: 3 }))
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH.banner);
    this.hoverSlip = new Slip(scene, 0, 0, '', { size: TYPE.body, wrap: 440 }).setDepth(HUD_DEPTH.hover).setVisible(false);
    this.pointer = scene.input.activePointer;

    // A hint on a slip of parchment with a brass pointer, beside (never over) the control it explains.
    this.hintG = scene.add.graphics();
    this.hintPaper = scene.textures.exists('ui:parchment') && scene.sys.renderer?.type !== Phaser.CANVAS ? scene.add.nineslice(0, 0, 'ui:parchment', undefined, 64, 40, 18, 18, 14, 14).setOrigin(0) : null;
    this.hintText = scene.add.text(14, 10, '', textStyle(TYPE.body, this.hintPaper ? COLORS.ink : COLORS.text, { wordWrap: { width: 270 }, lineSpacing: 1 }));
    this.hintClose = scene.add.text(0, 4, '×', textStyle(17, this.hintPaper ? COLORS.inkDim : COLORS.textDim)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.hintClose.on('pointerdown', () => this.hintId && this.hintDone(this.hintId));
    this.hintBox = scene.add.container(0, 0, [this.hintG, ...(this.hintPaper ? [this.hintPaper] : []), this.hintText, this.hintClose]).setDepth(HUD_DEPTH.hint).setVisible(false);
    const card0 = this.cards[0]?.x ?? CARDS_X;
    this.hintAnchors = {
      aim: { x: card0 + CARD_W / 2, y: BOTTOM_Y - 3, dir: 'down' },
      shot: { x: card0 + CARD_W / 2, y: BOTTOM_Y - 3, dir: 'down' },
      // Low enough on the first crew row to clear the opening banner.
      crew: { x: 180, y: 134, dir: 'left' },
      // Below the orders row, pointing up toward the clock.
      pause: { x: SCREEN.w / 2 - 63, y: ORDER_Y + 30, dir: 'up' },
      hands: { x: 140, y: BOTTOM_Y - 3, dir: 'down' },
    };
  }

  /** An icon and a figure, with a tip on hover, on a panel's lower row. */
  private stat(scene: Phaser.Scene, x: number, name: IconName, tip: () => string): StatSlot {
    tipZone(scene, x, 46, 64, 22, tip);
    return { icon: icon(scene, x + 9, 57, name, 18), text: scene.add.text(x + 20, 49, '', textStyle(TYPE.body, COLORS.text)) };
  }

  /** Offer a first-battle hint, unless it has been seen or another is up. */
  hint(id: HintId): void {
    if (this.hintId || seenHints().has(id)) return;
    this.hintId = id;
    const ms = HINT_MS[id];
    this.hintUntil = ms ? performance.now() + ms : Infinity;
    // The pause hint sits in the narrow gap between the two top panels.
    this.hintText.setWordWrapWidth(id === 'pause' ? 220 : 270).setText(HINT_TEXT[id]);
    const w = this.hintText.width + 40;
    const h = this.hintText.height + 20;
    const a = this.hintAnchors[id];
    const x = a.dir === 'left' ? a.x + 12 : a.dir === 'up' ? SCREEN.w / 2 - w / 2 : Phaser.Math.Clamp(a.x - 40, 8, SCREEN.w - w - 8);
    const y = a.dir === 'down' ? a.y - 10 - h : a.dir === 'up' ? a.y + 10 : a.y - 12;
    const g = this.hintG.clear();
    if (this.hintPaper) {
      this.hintPaper.setSize(w, h);
      g.fillStyle(0x000000, 0.35).fillRect(4, 5, w - 2, h - 2);
    } else {
      g.fillStyle(0x1c120a, 0.96).fillRoundedRect(0, 0, w, h, 6);
      g.lineStyle(2, 0xf2c45a, 0.95).strokeRoundedRect(0, 0, w, h, 6);
    }
    // The brass pointer, in box coordinates.
    const tx = a.x - x;
    const ty = a.y - y;
    g.fillStyle(0x2a170a, 1);
    if (a.dir === 'down') g.fillTriangle(tx - 10, h - 3, tx + 10, h - 3, tx, ty + 1);
    else if (a.dir === 'up') g.fillTriangle(tx - 10, 3, tx + 10, 3, tx, ty - 1);
    else g.fillTriangle(3, ty - 10, 3, ty + 10, tx - 1, ty);
    g.fillStyle(0xe2b866, 1);
    if (a.dir === 'down') g.fillTriangle(tx - 8, h - 3, tx + 8, h - 3, tx, ty - 1);
    else if (a.dir === 'up') g.fillTriangle(tx - 8, 3, tx + 8, 3, tx, ty + 1);
    else g.fillTriangle(3, ty - 8, 3, ty + 8, tx + 1, ty);
    this.hintClose.setX(w - 8);
    this.hintBox.setPosition(x, y).setVisible(true);
  }

  /** The player has done what a hint describes (or closed it): never show it again. */
  hintDone(id: HintId): void {
    markHintSeen(id);
    if (this.hintId !== id) return;
    this.hintId = null;
    this.hintBox.setVisible(false);
  }

  /** Give an order from its hotkey, as a click on its button would (false if it cannot be given now). */
  pressOrder(id: OrderId): boolean {
    return this.orderBtns.get(id)?.press() ?? false;
  }

  /** Headline something for a few seconds, above the standing alerts. */
  flash(text: string, ms = 3500): void {
    this.flashText = text;
    this.flashUntil = performance.now() + ms;
  }

  /** Write a line in the Captain's Log: it pops up as a toast near the action and stays in the book (L). */
  addLog(text: string, color: string = COLORS.text): void {
    const last = this.log[this.log.length - 1];
    if (last && last.text === text) last.count++;
    else this.log.push({ text, color, count: 1, time: this.battle.time });
    while (this.log.length > 400) this.log.shift();
    if (this.logBook) return;
    this.toasts.push(text, color);
    this.unread++;
  }

  /** Open the Captain's Log, or close it. */
  toggleLog(): void {
    if (this.logBook && !this.logBook.closed) {
      this.logBook.close();
      return;
    }
    this.unread = 0;
    this.logBook = new LogBook(this.scene, this.log, HUD_DEPTH.log, () => (this.logBook = null));
  }

  refresh(state: HudState): void {
    const { battle } = this;
    const player = battle.player;
    const enemy = battle.enemy;
    const g = this.g;
    g.clear();
    this.toasts.update();
    this.logBtn.setText(this.unread > 0 && !this.logBook ? `Log ·${Math.min(this.unread, 99)}` : 'Log');

    // Top bars.
    this.drawHull(player, 8 + HULL_BAR_DX, 14);
    this.drawLayers(player, 8 + HULL_BAR_DX, 36);
    const ps = this.playerStats;
    // Grappled, the figures go gold: the ships are locked together.
    const plain = battle.grappled ? COLORS.gold : COLORS.text;
    tint(say(ps.evasion.text, `${Math.round(player.evasion())}%`), plain);
    const pflood = Math.round((player.floodFraction() / SINK_FRACTION) * 100);
    tint(say(ps.flood.text, `${pflood}%`), pflood >= 25 ? COLORS.textWarn : plain);
    tint(say(ps.board.text, battle.canBoard() ? '✓' : '✗'), battle.canBoard() ? COLORS.textGood : COLORS.textDim);
    const company = battle.consorts.filter((c) => c.hull === undefined || c.hull > 0).map((c) => (c.hull !== undefined ? `${c.name} ${c.hull}/${c.maxHull}` : c.name));
    say(this.companyText, company.length ? `In company: ${company.join(', ')}` : '');
    drawBar(g, 250, 48, 100, 16, player.escape / 100, battle.canEscape() ? 0x7fdc6a : 0x6a9ac0);
    const rate = player.escapeRate();
    const eta = rate > 0 ? Math.ceil((100 - player.escape) / rate) : 0;
    const escapeLabel = !battle.allowEscape ? 'No escape' : battle.grappled ? 'Grappled!' : battle.canEscape() ? 'Escape!' : rate > 0 ? `Make Sail ${eta}s` : 'No way on';
    this.escapeBtn.setEnabled(battle.canEscape()).setText(escapeLabel);

    const ex = SCREEN.w - 478;
    this.drawHull(enemy, ex + HULL_BAR_DX, 14);
    this.drawLayers(enemy, ex + HULL_BAR_DX, 36);
    const es = this.enemyStats;
    say(es.evasion.text, `${Math.round(enemy.evasion())}%`);
    say(es.flood.text, floodPct(enemy));
    // Her people still standing, out of those she began with: the odds for a boarding party.
    say(es.crew.text, `${battle.crewOf('enemy').length}/${battle.crewAtStart.enemy}`);
    this.fleeLabel.setVisible(battle.enemyFleeing);
    if (battle.enemyFleeing) drawBar(g, SCREEN.w - 110, 48, 90, 16, enemy.escape / 100, 0xd06a4a);

    this.broadsideBtn.setText(player.broadside ? 'Broadside ON' : 'Broadside').setOn(player.broadside);

    // The captain's orders: in force (lit, counting down), making ready (dim, with a bar filling), or ready.
    for (const [id, btn] of this.orderBtns) {
      const o = player.orders[id];
      const def = ORDERS[id];
      btn.setOn(o.active > 0).setEnabled(battle.canOrder('player', id));
      btn.setText(o.active > 0 ? `${ORDER_LABEL[id]} ${Math.ceil(o.active)}s` : o.cooldown > 0 ? `${ORDER_LABEL[id]} ${Math.ceil(o.cooldown)}s` : ORDER_LABEL[id]);
      const ready = 1 - o.cooldown / def.cooldown;
      drawBar(g, btn.x + 4, ORDER_Y + 26, ORDER_W - 8, 3, ready, o.cooldown > 0 ? 0x6a9ac0 : 0x7fdc6a);
    }
    const hers = ORDER_IDS.filter((id) => enemy.orders[id].active > 0).map((id) => `${ENEMY_ORDER_LABEL[id]} ${Math.ceil(enemy.orders[id].active)}s`);
    say(this.enemyOrdersText, hers.length ? `⚑ Her orders: ${hers.join(' · ')}` : '').setVisible(hers.length > 0 && !battle.outcome);
    this.temperText.setVisible(!battle.outcome);

    // Crew list: your people wherever they are, aboard, crossing, or on her deck.
    const mine = battle.crewOf('player');
    this.crewRows.forEach((row) => {
      const id = row.bg.getData('crewId') as number;
      const c = mine.find((x) => x.id === id);
      if (!c) {
        if (row.bg.input?.enabled) {
          row.bg.setAlpha(0.35).disableInteractive();
          row.skin?.setFrame('off');
          row.name.setAlpha(0.45);
          say(row.task, 'fallen');
          setIcon(row.taskIcon, 'skull');
        }
        // Struck through in red, like a name crossed off the muster roll.
        g.lineStyle(1.5, 0xc0201a, 0.9).lineBetween(row.name.x - 2, row.name.y + 8, row.name.x + row.name.width + 2, row.name.y + 8);
        return;
      }
      const picked = state.selectedCrew.has(id);
      if (row.skin) {
        const frame = picked ? 'onHover' : 'base';
        if (row.skin.frame.name !== frame) row.skin.setFrame(frame);
      } else row.bg.setStrokeStyle(picked ? 2 : 1, picked ? COLORS.select : COLORS.panelEdge);
      if (picked) g.lineStyle(2, COLORS.select, 0.9).strokeRoundedRect(row.bg.x - 1, row.bg.y - 1, row.bg.width + 2, row.bg.height + 2, 5);
      const marks = badges(c);
      say(row.name, marks ? `${c.name} ${marks.replace(/ /g, '')}` : c.name);
      const aboard = battle.shipOf(c);
      const room = aboard ? aboard.room(c.room).def : null;
      say(row.task, !aboard ? 'Crossing over…' : aboard === player ? room!.name : `HER ${room!.name}`);
      setIcon(row.taskIcon, !aboard ? 'board' : taskIcon(c, room?.system));
      tint(row.task, aboard && aboard !== player ? COLORS.gold : COLORS.textDim);
      const frac = c.hp / c.maxHp;
      drawBar(g, row.bg.x + 40, row.bg.y + 31, 124, 3, frac, frac > 0.6 ? 0x6fd35a : frac > 0.3 ? 0xe5c23a : 0xe0452f);
      row.tip = `${c.name}${marks ? `  ${marks}` : ''}\n${!aboard ? 'Crossing over to her deck' : `${taskLabel(c.task)} · ${aboard === player ? '' : 'her '}${room!.name}`}\nHealth ${Math.ceil(c.hp)} of ${c.maxHp}`;
    });

    // Hands.
    const free = player.freeHands();
    say(this.handsCount, `${free} free of ${player.def.hands}`);
    tint(this.handsCount, free > 0 ? COLORS.text : COLORS.textDim);
    drawPips(g, 18, BOTTOM_Y + 30, free, player.def.hands, 0, 7, 2);
    for (const [id, row] of this.sysRows) {
      const sys = player.system(id)!;
      const on = id === 'helm' ? player.level('helm') : player.allocated(id);
      drawPips(g, 140, row.y + 3, on, sys.max, sys.damage, 12, 3);
      const st = systemStatus(player, id);
      if (st.icon) setIcon(row.status.icon, st.icon);
      row.status.icon.setVisible(!!st.icon);
      tint(say(row.status.text, st.short), st.warn ? COLORS.textWarn : COLORS.textDim);
    }

    // Guns.
    const loadRate = gunLoadRate(player);
    const secsLeft = (gun: GunState) => (gun.def.loadTime - gun.charge) / loadRate;
    // The gun a broadside is still waiting on: aimed and crewed but not yet loaded (as Combat holds it).
    let lagging = -1;
    if (player.broadside) {
      player.guns.forEach((g, j) => {
        if (g.powered && g.target && enemy.rooms.has(g.target) && g.charge < g.def.loadTime && (lagging < 0 || secsLeft(g) > secsLeft(player.guns[lagging]))) lagging = j;
      });
    }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    player.guns.forEach((gun, i) => {
      const card = this.cards[i];
      const aiming = state.aimingGun === i;
      const loadedIdle = gun.powered && gun.charge >= gun.def.loadTime && !gun.target;
      if (aiming || loadedIdle) {
        g.lineStyle(aiming ? 3 : 2 + pulse * 1.5, aiming ? COLORS.select : Phaser.Display.Color.GetColor(242, 160 + Math.round(pulse * 36), 60), 1);
        g.strokeRoundedRect(card.x - 1, BOTTOM_Y - 1, CARD_W + 2, 202, 4);
      }
      card.power.setText(gun.powered ? 'Manned' : 'Idle').setOn(gun.powered);
      const loaded = gun.charge / gun.def.loadTime;
      drawBar(g, card.x + 28, BOTTOM_Y + 73, CARD_W - 36, 14, loaded, loaded >= 1 ? 0x7fdc6a : gun.powered ? 0xd0a040 : 0x6a5a40);
      say(card.secs, loaded >= 1 ? 'READY' : gun.powered ? `${secsLeft(gun).toFixed(1)}s` : '');
      const working = player.level('guns') > 0 || !gun.powered;
      const deckFull = player.allocated('guns') + gun.def.hands > player.capacity('guns');
      const crewless = player.gunCrew().length === 0;
      say(
        card.status,
        !gun.powered
          ? player.capacity('guns') < gun.def.hands || (deckFull && player.system('guns')!.damage > 0)
            ? '! Gun deck damaged: repair it'
            : deckFull
              ? 'No room on the gun deck'
              : player.freeHands() < gun.def.hands
                ? 'Needs free hands to man'
                : 'Idle: man her to load'
          : !working
            ? '! Gun deck out of action'
            : loaded >= 1
              ? !gun.target
                ? 'Loaded: pick a target!'
                : battle.holdingFire
                  ? 'Holding fire: boarders aboard'
                  : lagging >= 0
                    ? `Broadside: waiting on gun ${lagging + 1}`
                    : 'Loaded: firing'
              : crewless
                ? 'Slow: no gun crew'
                : 'Loading…',
      );
      say(card.target, gun.target ? enemy.room(gun.target).def.name : aiming ? 'Click a room on her ship' : 'No target');
      card.targetIcon.setAlpha(gun.target ? 1 : 0.4);
      tint(card.target, gun.target ? COLORS.textWarn : aiming ? '#ffe34d' : COLORS.textDim);
      const warn = card.status.text.startsWith('!') || card.status.text.startsWith('Slow');
      const holding = card.status.text.startsWith('Holding') || card.status.text.startsWith('Broadside');
      tint(card.status, loadedIdle || holding ? COLORS.gold : warn ? COLORS.textWarn : COLORS.textDim);
      SHOT_TYPES.forEach((s: ShotType, j) => card.shots[j].setOn(gun.shot === s));
      if (!gun.def.note) say(card.foot, `${SHOT_EFFECTS[gun.shot].label} shot`);
    });

    this.pauseBanner.setVisible(battle.paused && !battle.outcome);
    say(this.pauseBanner, battle.time === 0 ? 'Aim your guns and set your crew  ·  Space to engage' : 'PAUSED  ·  Space to resume');
    this.pauseBtn.setText(!battle.paused ? 'Pause' : battle.time === 0 ? 'Engage' : 'Resume').setOn(battle.paused).setEnabled(!battle.outcome);
    this.speedBtn.setOn(state.speed > 1).setEnabled(!battle.outcome);

    // The single most urgent problem aboard, and what to do about it.
    const now = performance.now();
    const alert = now < this.flashUntil ? this.flashText : battle.outcome ? '' : urgentAlert(battle);
    this.alert.setVisible(!!alert);
    // An alert outranks a hint; informational hints also lapse on their own.
    if (this.hintId && now > this.hintUntil) this.hintDone(this.hintId);
    this.hintBox.setVisible(!!this.hintId && !alert && !battle.outcome);
    // Toasts rise clear of a hint above the bottom panels.
    const hintUp = this.hintBox.visible && this.hintId !== null && this.hintAnchors[this.hintId].dir === 'down';
    this.toasts.setFloor(hintUp ? this.hintBox.y - 6 : null);
    if (alert) {
      this.alert.setLabel(alert);
      this.alert.setAlpha(0.85 + 0.15 * Math.sin(now / 160));
    }
    this.toasts.setVisible(!battle.outcome);
    // Room info follows the pointer, kept on screen.
    this.hoverSlip.setVisible(!!state.hoverText);
    if (state.hoverText) {
      this.hoverSlip.setLabel(state.hoverText);
      const at = toDesign(this.pointer.x, this.pointer.y);
      const x = Math.min(at.x + 16, SCREEN.w - this.hoverSlip.paperW - 6);
      const y = Math.max(at.y - 12 - this.hoverSlip.paperH, 6);
      this.hoverSlip.setPosition(Math.round(x), Math.round(y));
    }
  }

  /** Bulwark layers under the hull bar: solid when ready, filling while they recharge. */
  private drawLayers(ship: Ship, x: number, y: number): void {
    const g = this.g;
    const max = ship.level('bulwarks');
    const cap = ship.system('bulwarks')?.max ?? 0;
    for (let i = 0; i < cap; i++) {
      const sx = x + i * 16;
      const shield = (fill: number, alpha: number) => {
        g.fillStyle(fill, alpha);
        g.beginPath();
        g.moveTo(sx, y);
        g.lineTo(sx + 12, y);
        g.lineTo(sx + 12, y + 5);
        g.lineTo(sx + 6, y + 10);
        g.lineTo(sx, y + 5);
        g.closePath();
        g.fillPath();
      };
      shield(0x000000, 0.6);
      if (i < ship.layers) shield(0xf0dca0, 1);
      else if (i === ship.layers && i < max) shield(0xf0dca0, 0.15 + 0.5 * ship.layerCharge);
      else if (i >= max) shield(0x6a2020, 0.6);
    }
  }

  /** The hull as a row of planks, green to red as she is hurt. */
  private drawHull(ship: Ship, x: number, y: number): void {
    const g = this.g;
    const n = ship.def.hull;
    const w = Math.min(12, Math.floor(HULL_BAR_W / n) - 2);
    const frac = ship.hull / n;
    const color = frac > 0.5 ? 0x7fdc6a : frac > 0.25 ? 0xe5c23a : 0xe0452f;
    g.fillStyle(0x000000, 0.6).fillRoundedRect(x - 2, y - 2, n * (w + 2) + 2, 22, 3);
    for (let i = 0; i < n; i++) {
      const on = i < ship.hull;
      const sx = x + i * (w + 2);
      g.fillStyle(on ? color : 0x2a221c, 1).fillRect(sx, y, w, 18);
      if (on) {
        g.fillStyle(0xffffff, 0.25).fillRect(sx, y, w, 6);
        g.fillStyle(0x000000, 0.2).fillRect(sx, y + 14, w, 4);
      }
    }
    g.lineStyle(1, COLORS.brass, 0.35).strokeRoundedRect(x - 2.5, y - 2.5, n * (w + 2) + 3, 23, 3);
  }
}

function floodPct(ship: Ship): string {
  return `${Math.round((ship.floodFraction() / SINK_FRACTION) * 100)}%`;
}

function taskLabel(task: string): string {
  return { moving: 'Moving', fire: 'Firefighting', breach: 'Patching leak', repair: 'Repairing', man: 'Manning', fight: 'Fighting!', sabotage: 'Sabotaging', idle: 'Standing by' }[task] ?? task;
}

/** A crew member's task as an icon: the station's own when manning it. */
function taskIcon(c: Crew, system: SystemId | undefined): IconName {
  switch (c.task) {
    case 'moving':
      return 'moving';
    case 'fire':
      return 'fire';
    case 'breach':
      return 'flood';
    case 'repair':
      return 'repair';
    case 'man':
      return system ?? 'anchor';
    case 'fight':
      return 'fight';
    case 'sabotage':
      return 'sabotage';
    default:
      return 'anchor';
  }
}

/** A station's state: an icon and a word or two for the row, and a sentence for its tip. */
function systemStatus(ship: Ship, id: SystemId): { icon: IconName | null; short: string; long: string; warn: boolean } {
  if (ship.isSwamped(id) && id !== 'pumps') return { icon: 'flood', short: 'Swamped', long: 'Swamped: water in the room stops the station. Bail her out.', warn: true };
  if (id === 'helm') return ship.isManned('helm') ? { icon: 'check', short: '', long: 'Someone is at the wheel.', warn: false } : { icon: 'cross', short: 'Empty', long: 'Nobody at the wheel: evasion is nothing. Send someone to the helm.', warn: true };
  if (id === 'guns') return { icon: 'crew', short: `${ship.allocated('guns')}/${ship.capacity('guns')}`, long: `${ship.allocated('guns')} of ${ship.capacity('guns')} hands on the guns.`, warn: false };
  if (id === 'sails' && ship.isManned('sails')) return { icon: 'check', short: '', long: 'A crew member is aloft at the mast.', warn: false };
  if (id === 'surgeon' && ship.level('surgeon') > 0) return { icon: 'heart', short: '', long: 'Treating the wounded in the cabin.', warn: false };
  if (id === 'bulwarks' && ship.level('bulwarks') > 0) return { icon: 'bulwarks', short: `${ship.layers}/${ship.level('bulwarks')}`, long: `${ship.layers} of ${ship.level('bulwarks')} layers ready.`, warn: false };
  if (id === 'pumps' && ship.level('pumps') > 0) return ship.isSwamped('pumps') ? { icon: 'flood', short: '½', long: 'The pump room is swamped: bailing at half rate.', warn: true } : { icon: 'flood', short: '', long: 'Bailing.', warn: false };
  return { icon: null, short: '', long: 'No hands on it.', warn: false };
}

/** The most urgent trouble aboard the player's ship, phrased as an order. Empty when all is well. */
function urgentAlert(battle: Battle): string {
  const ship = battle.player;
  const roomName = (id: string) => ship.room(id).def.name;
  const flood = ship.floodFraction() / SINK_FRACTION;
  if (flood >= 0.25) {
    const leak = [...ship.rooms.values()].find((r) => r.breach);
    const pumps = ship.system('pumps');
    const pumpHelp = pumps && ship.capacity('pumps') === 0 ? 'repair the Pumps' : 'hands to the Pumps';
    return `TAKING WATER (${Math.round(flood * 100)}%): ${pumpHelp}${leak ? `, patch the leak in the ${roomName(leak.def.id)}` : ''}`;
  }
  const boarders = ship.crew.find((c) => c.side !== ship.side && !c.waypoints.length);
  if (boarders) return `BOARDERS in the ${roomName(boarders.room)}: send crew to repel them`;
  // The fiercest blaze, by its hottest tile: a fire is worth shouting about before it fills the room.
  const hottest = (r: { flames: number[] }) => Math.max(...r.flames);
  const fire = [...ship.rooms.values()].filter((r) => r.fire > 0).sort((a, b) => hottest(b) - hottest(a))[0];
  if (fire && hottest(fire) > 30) return `FIRE in the ${roomName(fire.def.id)}: send crew to put it out`;
  const helm = ship.system('helm');
  if (helm && ship.capacity('helm') > 0 && !ship.isManned('helm')) return `HELM UNMANNED: evasion 0%. Send someone to the ${roomName(helm.room)}`;
  const guns = ship.system('guns');
  if (guns && ship.capacity('guns') === 0) return `GUN DECK WRECKED: send crew to repair the ${roomName(guns.room)}`;
  if (guns && ship.guns.some((g) => g.powered) && ship.gunCrew().length === 0) return `NO GUN CREW: guns load slowly. Send someone to the ${roomName(guns.room)}`;
  const foe = battle.enemy;
  const foeRate = foe.escapeRate();
  if (battle.enemyFleeing && !battle.grappled && foe.escape >= 50 && foeRate > 0) {
    return `SHE'S GETTING AWAY (${Math.ceil((100 - foe.escape) / foeRate)}s): chain shot her Sails, or hit her Helm`;
  }
  return '';
}
