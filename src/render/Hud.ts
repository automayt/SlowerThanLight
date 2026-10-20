import Phaser from 'phaser';
import { gunLoadRate, type Battle } from '../sim/Battle';
import { SHOT_EFFECTS } from '../sim/Combat';
import { badges } from '../sim/Skills';
import { SINK_FRACTION } from '../sim/Hazards';
import type { GunState, Ship } from '../sim/Ship';
import { SHOT_TYPES, SYSTEM_NAMES, type ShotType, type SystemId } from '../sim/types';
import { crewTextures } from './CrewArt';
import { COLORS, SCREEN, textStyle, TITLE_FONT } from './theme';
import { Button, drawBar, drawPips, panel } from './ui';
import type { BattleCommand } from '../sim/commands';

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
export const HUD_DEPTH = { panels: 50, alert: 52, banner: 53, hint: 54, hover: 55 } as const;
/** Hull bars start this far right of their HULL heading. */
const HULL_BAR_DX = 58;
/** Widest a hull bar may grow. */
const HULL_BAR_W = 390;

/** Phaser re-draws and re-uploads a Text on every setColor, so only call it on a change. */
function tint(text: Phaser.GameObjects.Text, color: string): Phaser.GameObjects.Text {
  if (text.style.color !== color) text.setColor(color);
  return text;
}

/** A small boxed key label, like a keycap, showing the hotkey for a control. */
function keycap(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Text {
  return scene.add.text(x, y, key, textStyle(10, COLORS.textDim, { backgroundColor: '#05101acc', padding: { x: 3, y: 1 } }));
}

/** Small-caps section heading in the serif face. */
function heading(scene: Phaser.Scene, x: number, y: number, text: string, size = 14): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, { fontFamily: TITLE_FONT, fontSize: `${size}px`, color: COLORS.gold, fontStyle: 'bold' });
}
const CARD_W = 158;

interface GunCard {
  bg: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  target: Phaser.GameObjects.Text;
  power: Button;
  shots: Button[];
  x: number;
}

interface CrewRow {
  bg: Phaser.GameObjects.Rectangle;
  name: Phaser.GameObjects.Text;
  task: Phaser.GameObjects.Text;
}

/** All on-screen panels around the two ships. Built once, refreshed every frame. */
export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly playerStats: Phaser.GameObjects.Text;
  private readonly enemyStats: Phaser.GameObjects.Text;
  private readonly enemyTitle: Phaser.GameObjects.Text;
  private readonly fleeLabel: Phaser.GameObjects.Text;
  private readonly escapeBtn: Button;
  private readonly broadsideBtn: Button;
  private readonly handsTitle: Phaser.GameObjects.Text;
  private readonly sysLabels = new Map<SystemId, Phaser.GameObjects.Text>();
  private readonly sysStatus = new Map<SystemId, Phaser.GameObjects.Text>();
  private readonly cards: GunCard[] = [];
  private readonly crewRows: CrewRow[] = [];
  private readonly logText: Phaser.GameObjects.Text;
  /** Recent log lines; a line repeated back to back is counted rather than written again. */
  private readonly log: { text: string; color: string; count: number }[] = [];
  private logDirty = true;
  private readonly pauseBtn: Button;
  private readonly speedBtn: Button;
  private readonly hintBox: Phaser.GameObjects.Container;
  private readonly hintG: Phaser.GameObjects.Graphics;
  private readonly hintText: Phaser.GameObjects.Text;
  private readonly hintAnchors: Record<HintId, { x: number; y: number; dir: 'up' | 'down' | 'left' }>;
  private readonly hintClose: Phaser.GameObjects.Text;
  private hintId: HintId | null = null;
  private hintUntil = 0;
  private readonly pauseBanner: Phaser.GameObjects.Text;
  private readonly alert: Phaser.GameObjects.Text;
  /** A short-lived headline (a crew death) that outranks the standing alerts. */
  private flashText = '';
  private flashUntil = 0;
  private readonly hoverText: Phaser.GameObjects.Text;
  private readonly companyText: Phaser.GameObjects.Text;
  private readonly tooltip: Phaser.GameObjects.Text;
  private readonly pointer: Phaser.Input.Pointer;

  constructor(
    scene: Phaser.Scene,
    private readonly battle: Battle,
    cb: HudCallbacks,
  ) {
    const player = battle.player;
    const before = new Set(scene.children.list);

    // --- Top: player status ---
    panel(scene, 8, 8, 470, 66);
    heading(scene, 18, 14, 'HULL', 15);
    this.playerStats = scene.add.text(18, 50, '', textStyle(13));
    this.companyText = scene.add.text(14, 78, '', textStyle(12, COLORS.textGood, { fontStyle: 'italic', backgroundColor: '#0b1622cc', padding: { x: 6, y: 2 } })).setDepth(HUD_DEPTH.panels);
    this.escapeBtn = new Button(scene, 360, 42, 108, 26, 'Escape', () => cb.order({ t: 'escape' }), { size: 13 });

    // --- Top centre: the clock ---
    this.pauseBtn = new Button(scene, SCREEN.w / 2 - 122, 10, 118, 26, '', () => {
      cb.order({ t: 'pause', on: !battle.paused });
      this.hintDone('pause');
    }, { size: 13 });
    this.pauseBtn.add(keycap(scene, 116, 13, 'Space').setOrigin(1, 0.5));
    this.speedBtn = new Button(scene, SCREEN.w / 2 + 4, 10, 118, 26, '2× speed', () => cb.toggleSpeed(), { size: 13 });
    this.speedBtn.add(keycap(scene, 116, 13, 'F').setOrigin(1, 0.5));
    this.pauseBtn.label.setX(46);
    this.speedBtn.label.setX(50);

    // --- Top: enemy status ---
    panel(scene, SCREEN.w - 478, 8, 470, 66);
    this.enemyTitle = heading(scene, SCREEN.w - 468, 14, 'HULL', 15);
    this.enemyStats = scene.add.text(SCREEN.w - 468, 50, '', textStyle(13));

    // --- Left: crew list ---
    heading(scene, 12, 88, 'CREW');
    player.crew.forEach((c, i) => {
      const y = 110 + i * 40;
      const bg = scene.add.rectangle(8, y, 168, 36, COLORS.panel, 0.88).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => cb.selectCrew(c.id, p.event.shiftKey));
      // Head-and-shoulders portrait cut from their sprite.
      scene.add.rectangle(12, y + 3, 28, 30, 0x1b2a38).setOrigin(0).setStrokeStyle(1, COLORS.panelInner);
      scene.add.image(26, y + 4, `${crewTextures(scene, c)}:idle0`).setOrigin(0.5, 0).setCrop(10, 2, 36, 34).setScale(0.82).setDisplayOrigin(28, 3);
      const name = scene.add.text(44, y + 3, c.name, textStyle(12, COLORS.text, { fontStyle: 'bold' }));
      const task = scene.add.text(44, y + 18, '', textStyle(10, COLORS.textDim));
      if (i < CREW_KEYS.length) keycap(scene, 10, y + 21, CREW_KEYS[i]);
      bg.setData('crewId', c.id);
      this.crewRows.push({ bg, name, task });
    });

    // --- Bottom-left: hands ---
    panel(scene, 8, BOTTOM_Y, 330, 200);
    this.handsTitle = heading(scene, 18, BOTTOM_Y + 7, '', 15);
    this.handsTitle.setInteractive({ useHandCursor: false });
    this.handsTitle.on('pointerover', () =>
      this.showTooltip('Deckhands are your ship’s working hands: put them on stations like power. Your named crew (left) are separate: officers who walk the decks, man stations, repair and fight.', 18, BOTTOM_Y - 8),
    );
    this.handsTitle.on('pointerout', () => this.tooltip.setVisible(false));
    const systems: SystemId[] = ['helm', 'bulwarks', 'sails', 'pumps', 'surgeon', 'guns'];
    systems.filter((id) => player.system(id)).forEach((id, i) => {
      const y = BOTTOM_Y + 38 + i * 26;
      if (scene.textures.exists(`sysicon:${id}`)) scene.add.image(27, y + 8, `sysicon:${id}`).setScale(0.48);
      const label = scene.add.text(42, y, SYSTEM_NAMES[id], textStyle(13)).setInteractive();
      label.on('pointerover', () => this.showTooltip(SYSTEM_TIPS[id], 18, BOTTOM_Y - 8));
      label.on('pointerout', () => this.tooltip.setVisible(false));
      this.sysLabels.set(id, label);
      this.sysStatus.set(id, scene.add.text(264, y, '', textStyle(12, COLORS.textDim)));
      if (id === 'bulwarks' || id === 'sails' || id === 'pumps' || id === 'surgeon') {
        const hands = (d: number) => {
          cb.order({ t: 'hands', system: id, delta: d });
          this.hintDone('hands');
        };
        new Button(scene, 112, y - 2, 22, 22, '−', () => hands(-1), { size: 15 });
        new Button(scene, 236, y - 2, 22, 22, '+', () => hands(1), { size: 15 });
      }
    });

    this.broadsideBtn = new Button(scene, 222, BOTTOM_Y + 6, 108, 22, '', () => cb.order({ t: 'broadside', on: !battle.player.broadside }), { size: 12 });
    this.broadsideBtn.add(keycap(scene, 104, 11, 'B').setOrigin(1, 0.5));
    this.broadsideBtn.label.setX(48);
    this.broadsideBtn.bg.on('pointerover', () =>
      this.showTooltip('Broadside (B): hold every aimed gun until all are loaded, then fire together. Swamps bulwarks, which stop one ball per layer.', 222, BOTTOM_Y - 8),
    );
    this.broadsideBtn.bg.on('pointerout', () => this.tooltip.setVisible(false));

    // --- Bottom-centre: gun cards ---
    player.guns.forEach((gun, i) => {
      const x = 346 + i * (CARD_W + 6);
      const bg = scene.add.rectangle(x, BOTTOM_Y, CARD_W, 200, COLORS.panel, 0.9).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
      scene.add.rectangle(x + 3, BOTTOM_Y + 3, CARD_W - 6, 194).setOrigin(0).setStrokeStyle(1, COLORS.panelInner, 0.9);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => (p.rightButtonDown() ? cb.clearGunTarget(i) : cb.selectGun(i)));
      if (scene.textures.exists('sysicon:guns')) scene.add.image(x + 18, BOTTOM_Y + 19, 'sysicon:guns').setScale(0.55);
      const name = scene.add.text(x + 34, BOTTOM_Y + 8, `${i + 1}. ${gun.def.name}`, { fontFamily: TITLE_FONT, fontSize: '14px', color: COLORS.gold, fontStyle: 'bold', wordWrap: { width: CARD_W - 42 } });
      const power = new Button(scene, x + 8, BOTTOM_Y + 50, 72, 24, '', () => {
        cb.order({ t: 'gunPower', gun: i });
        cb.aimWith(i);
      }, { size: 12 });
      scene.add.text(x + 88, BOTTOM_Y + 47, `${gun.def.hands ? `${gun.def.hands} hand${gun.def.hands > 1 ? 's' : ''}` : 'no hands'}\n${gun.def.shots}×${gun.def.damage} dmg`, textStyle(12, COLORS.textDim, { lineSpacing: -1 }));
      const status = scene.add.text(x + 8, BOTTOM_Y + 97, '', textStyle(12, COLORS.textDim, { wordWrap: { width: CARD_W - 16 }, lineSpacing: -2 }));
      const target = scene.add.text(x + 8, BOTTOM_Y + 113, '', textStyle(12));
      const shots = SHOT_TYPES.map((s, j) => {
        const b = new Button(scene, x + 9 + j * 35.5, BOTTOM_Y + 143, 33, 24, '', () => {
          cb.order({ t: 'shot', gun: i, shot: s });
          // Choosing the shot readies the gun too: pick chain, then click where it goes.
          cb.aimWith(i);
          this.hintDone('shot');
        }, { size: 13 });
        b.add(scene.add.image(16.5, 12, shotIcon(scene, s)).setScale(0.5));
        // A gun that fires only one kind of shot offers only that one.
        if (gun.def.fixedShot && gun.def.fixedShot !== s) b.setEnabled(false).setAlpha(0.35);
        b.bg.on('pointerover', () => this.showTooltip(`${SHOT_EFFECTS[s].label} shot: ${SHOT_EFFECTS[s].blurb}
Shift+${i + 1} cycles this gun's shot.`, x, BOTTOM_Y - 8));
        b.bg.on('pointerout', () => this.tooltip.setVisible(false));
        return b;
      });
      // A special gun says what sets it apart in place of the usual reminder.
      scene.add
        .text(x + CARD_W / 2, BOTTOM_Y + 174, gun.def.note ?? 'Click, then her room', textStyle(gun.def.note ? 11 : 12, gun.def.note ? COLORS.gold : COLORS.textDim, { fontStyle: gun.def.note ? 'italic' : 'normal', align: 'center', wordWrap: { width: CARD_W - 12 } }))
        .setOrigin(0.5, 0);
      this.cards.push({ bg, name, status, target, power, shots, x });
    });

    // --- Bottom-right: log, taking whatever room the gun cards leave ---
    const logX = 346 + player.guns.length * (CARD_W + 6);
    panel(scene, logX, BOTTOM_Y, SCREEN.w - logX - 8, 200);
    heading(scene, logX + 10, BOTTOM_Y + 7, "Captain's Log", 15);
    this.logText = scene.add.text(logX + 10, BOTTOM_Y + 30, '', textStyle(12, COLORS.text, { wordWrap: { width: SCREEN.w - logX - 28 }, lineSpacing: 3 }));

    this.g = scene.add.graphics();
    this.fleeLabel = scene.add
      .text(SCREEN.w - 65, 56, 'FLEEING', textStyle(12, COLORS.text, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }))
      .setOrigin(0.5)
      .setVisible(false);
    // Everything built so far is panel furniture: lift it above the ships, the gulls and the gun smoke.
    for (const obj of scene.children.list) if (!before.has(obj)) (obj as unknown as Phaser.GameObjects.Components.Depth).setDepth(HUD_DEPTH.panels);

    this.alert = scene.add
      .text(SCREEN.w / 2, 486, '', { fontFamily: TITLE_FONT, fontSize: '18px', color: '#ffd8cc', backgroundColor: '#5a1410e6', padding: { x: 14, y: 5 }, stroke: '#000000', strokeThickness: 2 })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH.alert)
      .setVisible(false);
    this.pauseBanner = scene.add
      .text(SCREEN.w / 2, 98, 'PAUSED  ·  Space to resume', { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, backgroundColor: '#0b1622dd', padding: { x: 18, y: 7 }, stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH.banner);
    this.hoverText = scene.add
      .text(0, 0, '', textStyle(13, COLORS.text, { backgroundColor: '#0b1622e8', padding: { x: 10, y: 5 }, wordWrap: { width: 460 } }))
      .setOrigin(0, 1)
      .setDepth(HUD_DEPTH.hover);
    this.pointer = scene.input.activePointer;
    this.tooltip = scene.add
      .text(0, 0, '', textStyle(12, COLORS.text, { backgroundColor: '#000000dd', padding: { x: 8, y: 5 }, wordWrap: { width: 300 } }))
      .setOrigin(0, 1)
      .setDepth(HUD_DEPTH.hover)
      .setVisible(false);

    // A hint box with a pointer, beside (never over) the control it explains.
    this.hintG = scene.add.graphics();
    this.hintText = scene.add.text(12, 9, '', textStyle(13, COLORS.text, { wordWrap: { width: 270 }, lineSpacing: 1 }));
    this.hintClose = scene.add.text(0, 4, '×', textStyle(16, COLORS.textDim)).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.hintClose.on('pointerdown', () => this.hintId && this.hintDone(this.hintId));
    this.hintBox = scene.add.container(0, 0, [this.hintG, this.hintText, this.hintClose]).setDepth(HUD_DEPTH.hint).setVisible(false);
    const card0 = this.cards[0]?.x ?? 346;
    this.hintAnchors = {
      aim: { x: card0 + CARD_W / 2, y: BOTTOM_Y - 3, dir: 'down' },
      shot: { x: card0 + CARD_W / 2, y: BOTTOM_Y - 3, dir: 'down' },
      // Low enough on the first crew row to clear the opening banner.
      crew: { x: 180, y: 134, dir: 'left' },
      pause: { x: SCREEN.w / 2 - 63, y: 39, dir: 'up' },
      hands: { x: 140, y: BOTTOM_Y - 3, dir: 'down' },
    };
  }

  /** Offer a first-battle hint, unless it has been seen or another is up. */
  hint(id: HintId): void {
    if (this.hintId || seenHints().has(id)) return;
    this.hintId = id;
    const ms = HINT_MS[id];
    this.hintUntil = ms ? performance.now() + ms : Infinity;
    // The pause hint sits in the narrow gap between the two top panels.
    this.hintText.setWordWrapWidth(id === 'pause' ? 220 : 270).setText(HINT_TEXT[id]);
    const w = this.hintText.width + 36;
    const h = this.hintText.height + 18;
    const a = this.hintAnchors[id];
    const x = a.dir === 'left' ? a.x + 12 : a.dir === 'up' ? SCREEN.w / 2 - w / 2 : Phaser.Math.Clamp(a.x - 40, 8, SCREEN.w - w - 8);
    const y = a.dir === 'down' ? a.y - 10 - h : a.dir === 'up' ? a.y + 10 : a.y - 12;
    const g = this.hintG.clear();
    g.fillStyle(0x0b1622, 0.96).fillRoundedRect(0, 0, w, h, 6);
    g.lineStyle(2, 0xf2c45a, 0.95).strokeRoundedRect(0, 0, w, h, 6);
    // The pointer, in box coordinates.
    const tx = a.x - x;
    const ty = a.y - y;
    g.fillStyle(0xf2c45a, 1);
    if (a.dir === 'down') g.fillTriangle(tx - 8, h, tx + 8, h, tx, ty);
    else if (a.dir === 'up') g.fillTriangle(tx - 8, 0, tx + 8, 0, tx, ty);
    else g.fillTriangle(0, ty - 8, 0, ty + 8, tx, ty);
    this.hintClose.setX(w - 6);
    this.hintBox.setPosition(x, y).setVisible(true);
  }

  /** The player has done what a hint describes (or closed it): never show it again. */
  hintDone(id: HintId): void {
    markHintSeen(id);
    if (this.hintId !== id) return;
    this.hintId = null;
    this.hintBox.setVisible(false);
  }

  /** Headline something for a few seconds, above the standing alerts. */
  flash(text: string, ms = 3500): void {
    this.flashText = text;
    this.flashUntil = performance.now() + ms;
  }

  addLog(text: string, color: string = COLORS.text): void {
    const last = this.log[this.log.length - 1];
    if (last && last.text === text) last.count++;
    else this.log.push({ text, color, count: 1 });
    while (this.log.length > 9) this.log.shift();
    this.logDirty = true;
  }

  private showTooltip(text: string, x: number, y: number): void {
    this.tooltip.setText(text).setPosition(x, y).setVisible(true);
  }

  refresh(state: HudState): void {
    const { battle } = this;
    const player = battle.player;
    const enemy = battle.enemy;
    const g = this.g;
    g.clear();

    // Top bars.
    this.drawHull(player, 18 + HULL_BAR_DX, 14);
    this.drawLayers(player, 18 + HULL_BAR_DX, 36);
    this.playerStats.setText(`Evasion ${Math.round(player.evasion())}%  ·  Flood ${floodPct(player)}  ·  Board ${battle.canBoard() ? '✓' : '✗'}`);
    const company = battle.consorts.filter((c) => c.hull === undefined || c.hull > 0).map((c) => (c.hull !== undefined ? `${c.name} ${c.hull}/${c.maxHull}` : c.name));
    this.companyText.setText(company.length ? `In company: ${company.join(', ')}` : '');
    tint(this.playerStats, battle.grappled ? COLORS.gold : COLORS.text);
    drawBar(g, 250, 48, 100, 16, player.escape / 100, battle.canEscape() ? 0x7fdc6a : 0x6a9ac0);
    const rate = player.escapeRate();
    const eta = rate > 0 ? Math.ceil((100 - player.escape) / rate) : 0;
    const escapeLabel = !battle.allowEscape ? 'No escape' : battle.grappled ? 'Grappled!' : battle.canEscape() ? 'Escape!' : rate > 0 ? `Make Sail ${eta}s` : 'No way on';
    this.escapeBtn.setEnabled(battle.canEscape()).setText(escapeLabel);

    this.drawHull(enemy, SCREEN.w - 468 + HULL_BAR_DX, 14);
    this.drawLayers(enemy, SCREEN.w - 468 + HULL_BAR_DX, 36);
    this.enemyTitle.setText('HULL');
    // Her people still standing, out of those she began with: the odds for a boarding party.
    const crewLeft = battle.crewOf('enemy').length;
    // While she runs, her class gives way to the flight bar at the panel's end.
    const herClass = battle.enemyFleeing ? '' : `${enemy.def.className} · `;
    this.enemyStats.setText(`${herClass}Evasion ${Math.round(enemy.evasion())}% · Flood ${floodPct(enemy)} · Crew ${crewLeft}/${battle.crewAtStart.enemy}`);
    this.fleeLabel.setVisible(battle.enemyFleeing);
    if (battle.enemyFleeing) drawBar(g, SCREEN.w - 110, 48, 90, 16, enemy.escape / 100, 0xd06a4a);

    this.broadsideBtn.setText(player.broadside ? 'Broadside: ON' : 'Broadside: off').setOn(player.broadside);

    // Crew list: your people wherever they are, aboard, crossing, or on her deck.
    const mine = battle.crewOf('player');
    this.crewRows.forEach((row) => {
      const id = row.bg.getData('crewId') as number;
      const c = mine.find((x) => x.id === id);
      if (!c) {
        row.bg.setAlpha(0.35).disableInteractive();
        row.name.setAlpha(0.45);
        row.task.setText('fallen');
        // Struck through in red, like a name crossed off the muster roll.
        g.lineStyle(1.5, 0xc0201a, 0.9).lineBetween(row.name.x - 2, row.name.y + 8, row.name.x + row.name.width + 2, row.name.y + 8);
        return;
      }
      row.bg.setStrokeStyle(state.selectedCrew.has(id) ? 2 : 1, state.selectedCrew.has(id) ? COLORS.select : COLORS.panelEdge);
      row.name.setText(`${c.name}  ${badges(c)}`);
      const aboard = battle.shipOf(c);
      row.task.setText(!aboard ? 'Crossing over…' : aboard === player ? `${taskLabel(c.task)} · ${player.room(c.room).def.name}` : `${taskLabel(c.task)} · HER ${aboard.room(c.room).def.name}`);
      tint(row.task, aboard && aboard !== player ? COLORS.gold : COLORS.textDim);
      const frac = c.hp / c.maxHp;
      drawBar(g, row.bg.x + 36, row.bg.y + 31, 126, 3, frac, frac > 0.6 ? 0x6fd35a : frac > 0.3 ? 0xe5c23a : 0xe0452f);
    });

    // Hands.
    const free = player.freeHands();
    this.handsTitle.setText(`DECKHANDS  ${free} free of ${player.def.hands}`);
    drawPips(g, 18, BOTTOM_Y + 26, free, player.def.hands, 0, 8, 2);
    for (const [id, label] of this.sysLabels) {
      const sys = player.system(id)!;
      const y = label.y + 3;
      const on = id === 'helm' ? player.level('helm') : player.allocated(id);
      drawPips(g, 140, y, on, sys.max, sys.damage, 12, 3);
      const status = systemStatus(player, id);
      tint(this.sysStatus.get(id)!.setText(status), status.startsWith('!') ? COLORS.textWarn : COLORS.textDim);
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
    player.guns.forEach((gun, i) => {
      const card = this.cards[i];
      const aiming = state.aimingGun === i;
      const loadedIdle = gun.powered && gun.charge >= gun.def.loadTime && !gun.target;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      card.bg.setStrokeStyle(
        aiming ? 3 : loadedIdle ? 2 + pulse * 1.5 : 2,
        aiming ? COLORS.select : loadedIdle ? Phaser.Display.Color.GetColor(242, 160 + Math.round(pulse * 36), 60) : gun.powered ? 0x5c7f99 : COLORS.panelEdge,
      );
      card.power.setText(gun.powered ? '⏻ Manned' : '⏻ Idle').setOn(gun.powered);
      const loaded = gun.charge / gun.def.loadTime;
      drawBar(g, card.x + 8, BOTTOM_Y + 80, CARD_W - 16, 12, loaded, loaded >= 1 ? 0x7fdc6a : 0xd0a040);
      const working = player.level('guns') > 0 || !gun.powered;
      const deckFull = player.allocated('guns') + gun.def.hands > player.capacity('guns');
      const crewless = player.gunCrew().length === 0;
      card.status.setText(
        !gun.powered
          ? player.capacity('guns') < gun.def.hands || (deckFull && player.system('guns')!.damage > 0)
            ? '! Gun deck damaged — repair it'
            : deckFull
              ? 'No room on the gun deck'
              : player.freeHands() < gun.def.hands
                ? 'Needs free hands to man'
                : 'Idle — click ⏻ to man'
          : !working
            ? '! Gun deck out of action'
            : loaded >= 1
              ? !gun.target
                ? 'Loaded — pick a target!'
                : battle.holdingFire
                  ? 'Holding fire: boarders aboard'
                  : lagging >= 0
                    ? `Holding for broadside (gun ${lagging + 1}: ${secsLeft(player.guns[lagging]).toFixed(1)}s)`
                    : 'Loaded — firing'
              : crewless
                ? `Slow: no gun crew  ${secsLeft(gun).toFixed(0)}s`
                : `Loading… ${secsLeft(gun).toFixed(1)}s`,
      );
      card.target.setText(gun.target ? `→ ${enemy.room(gun.target).def.name}` : aiming ? '→ click an enemy room' : '→ no target');
      card.target.setY(card.status.y + Math.max(16, card.status.height));
      tint(card.target, gun.target ? COLORS.textWarn : COLORS.textDim);
      const warn = card.status.text.startsWith('!') || card.status.text.startsWith('Slow');
      const holding = card.status.text.startsWith('Holding');
      tint(card.status, loadedIdle || holding ? COLORS.gold : warn ? COLORS.textWarn : COLORS.textDim);
      SHOT_TYPES.forEach((s: ShotType, j) => card.shots[j].setOn(gun.shot === s));
    });

    if (this.logDirty) {
      this.logDirty = false;
      const lines = () => this.log.map((l) => (l.count > 1 ? `${l.text}  ×${l.count}` : l.text)).join('\n');
      this.logText.setText(lines());
      while (this.logText.height > 172 && this.log.length > 1) {
        this.log.shift();
        this.logText.setText(lines());
      }
    }
    this.pauseBanner.setVisible(battle.paused && !battle.outcome);
    this.pauseBanner.setText(battle.time === 0 ? 'Aim your guns and set your crew  ·  Space to engage' : 'PAUSED  ·  Space to resume');
    this.pauseBtn.setText(!battle.paused ? 'Pause' : battle.time === 0 ? 'Engage' : 'Resume').setOn(battle.paused).setEnabled(!battle.outcome);
    this.speedBtn.setOn(state.speed > 1).setEnabled(!battle.outcome);

    // The single most urgent problem aboard, and what to do about it.
    const now = performance.now();
    const alert = now < this.flashUntil ? this.flashText : battle.outcome ? '' : urgentAlert(battle);
    this.alert.setVisible(!!alert);
    // An alert outranks a hint; informational hints also lapse on their own.
    if (this.hintId && now > this.hintUntil) this.hintDone(this.hintId);
    this.hintBox.setVisible(!!this.hintId && !alert && !battle.outcome);
    if (alert) {
      if (this.alert.text !== alert) this.alert.setText(alert);
      this.alert.setAlpha(0.8 + 0.2 * Math.sin(now / 160));
    }
    // Room info follows the pointer, kept on screen.
    this.hoverText.setText(state.hoverText).setVisible(!!state.hoverText);
    if (state.hoverText) {
      const x = Math.min(this.pointer.x + 16, SCREEN.w - this.hoverText.width - 6);
      const y = Math.max(this.pointer.y - 12, this.hoverText.height + 6);
      this.hoverText.setPosition(x, y);
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

  private drawHull(ship: Ship, x: number, y: number): void {
    const g = this.g;
    const n = ship.def.hull;
    const w = Math.min(12, Math.floor(HULL_BAR_W / n) - 2);
    const frac = ship.hull / n;
    const color = frac > 0.5 ? 0x7fdc6a : frac > 0.25 ? 0xe5c23a : 0xe0452f;
    g.fillStyle(0x000000, 0.6).fillRect(x - 2, y - 2, n * (w + 2) + 2, 22);
    for (let i = 0; i < n; i++) {
      const on = i < ship.hull;
      const sx = x + i * (w + 2);
      g.fillStyle(on ? color : 0x252b30, 1).fillRect(sx, y, w, 18);
      if (on) {
        g.fillStyle(0xffffff, 0.25).fillRect(sx, y, w, 6);
        g.fillStyle(0x000000, 0.2).fillRect(sx, y + 14, w, 4);
      }
    }
  }
}

function floodPct(ship: Ship): string {
  return `${Math.round((ship.floodFraction() / SINK_FRACTION) * 100)}%`;
}

function taskLabel(task: string): string {
  return { moving: 'Moving', fire: 'Firefighting', breach: 'Patching leak', repair: 'Repairing', man: 'Manning', fight: 'Fighting!', sabotage: 'Sabotaging', idle: 'Standing by' }[task] ?? task;
}

function systemStatus(ship: Ship, id: SystemId): string {
  if (ship.isSwamped(id) && id !== 'pumps') return '! Swamped';
  if (id === 'helm') return ship.isManned('helm') ? 'Manned' : '! Unmanned';
  if (id === 'guns') return `${ship.allocated('guns')}/${ship.capacity('guns')} on guns`;
  if (id === 'sails' && ship.isManned('sails')) return 'Manned';
  if (id === 'surgeon' && ship.level('surgeon') > 0) return 'Treating';
  if (id === 'bulwarks') return ship.level('bulwarks') > 0 ? `${ship.layers}/${ship.level('bulwarks')} ready` : '';
  if (id === 'pumps' && ship.level('pumps') > 0) return ship.isSwamped('pumps') ? '! Half rate' : 'Bailing';
  return '';
}

/** A small painted icon for each kind of shot, made once. */
function shotIcon(scene: Phaser.Scene, shot: ShotType): string {
  const key = `shoticon:${shot}`;
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 40, 40)!;
  const ctx = tex.getContext();
  const ball = (x: number, y: number, r: number, base = '#2a2a2a') => {
    const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    grad.addColorStop(0, '#8a8a88');
    grad.addColorStop(1, base);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  switch (shot) {
    case 'round':
      ball(20, 20, 11);
      break;
    case 'chain':
      ctx.strokeStyle = '#9a9a96';
      ctx.lineWidth = 3;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(11, 26);
      ctx.quadraticCurveTo(20, 34, 29, 14);
      ctx.stroke();
      ctx.setLineDash([]);
      ball(10, 27, 7);
      ball(30, 13, 7);
      break;
    case 'grape':
      for (const [x, y] of [
        [14, 14],
        [26, 13],
        [20, 21],
        [12, 26],
        [27, 26],
        [20, 31],
        [20, 9],
      ])
        ball(x, y, 5);
      break;
    case 'hot': {
      const glow = ctx.createRadialGradient(20, 22, 2, 20, 22, 18);
      glow.addColorStop(0, 'rgba(255,200,80,0.9)');
      glow.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(20, 22, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7a22';
      ctx.beginPath();
      ctx.moveTo(10, 24);
      ctx.quadraticCurveTo(12, 8, 20, 3);
      ctx.quadraticCurveTo(26, 12, 30, 24);
      ctx.closePath();
      ctx.fill();
      ball(20, 25, 9, '#7a2a10');
      break;
    }
  }
  tex.refresh();
  return key;
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
