import Phaser from 'phaser';
import type { Battle } from '../sim/Battle';
import { SHOT_EFFECTS } from '../sim/Combat';
import { badges } from '../sim/Skills';
import { SINK_FRACTION } from '../sim/Hazards';
import type { Ship } from '../sim/Ship';
import { SHOT_TYPES, SYSTEM_NAMES, type ShotType, type SystemId } from '../sim/types';
import { COLORS, SCREEN, textStyle, TITLE_FONT } from './theme';
import { Button, drawBar, drawPips, panel } from './ui';

export interface HudCallbacks {
  selectCrew(id: number, additive: boolean): void;
  selectGun(index: number): void;
  clearGunTarget(index: number): void;
}

export interface HudState {
  selectedCrew: Set<number>;
  aimingGun: number | null;
  hoverText: string;
}

const BOTTOM_Y = 512;
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
  private readonly escapeBtn: Button;
  private readonly handsTitle: Phaser.GameObjects.Text;
  private readonly sysLabels = new Map<SystemId, Phaser.GameObjects.Text>();
  private readonly sysStatus = new Map<SystemId, Phaser.GameObjects.Text>();
  private readonly cards: GunCard[] = [];
  private readonly crewRows: CrewRow[] = [];
  private readonly logText: Phaser.GameObjects.Text;
  private readonly log: { text: string; color: string }[] = [];
  private readonly pauseBanner: Phaser.GameObjects.Text;
  private readonly hoverText: Phaser.GameObjects.Text;
  private readonly tooltip: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    private readonly battle: Battle,
    cb: HudCallbacks,
  ) {
    const player = battle.player;

    // --- Top: player status ---
    panel(scene, 8, 8, 470, 66);
    scene.add.text(18, 14, 'HULL', textStyle(13, COLORS.textDim, { fontStyle: 'bold' }));
    this.playerStats = scene.add.text(18, 50, '', textStyle(13));
    this.escapeBtn = new Button(scene, 360, 42, 108, 26, 'Escape', () => battle.escape(), { size: 13 });

    // --- Top: enemy status ---
    panel(scene, SCREEN.w - 478, 8, 470, 66);
    this.enemyTitle = scene.add.text(SCREEN.w - 468, 14, 'HULL', textStyle(13, COLORS.textDim, { fontStyle: 'bold' }));
    this.enemyStats = scene.add.text(SCREEN.w - 468, 50, '', textStyle(13));

    // --- Left: crew list ---
    scene.add.text(14, 92, 'CREW', textStyle(13, COLORS.textDim, { fontStyle: 'bold' }));
    player.crew.forEach((c, i) => {
      const y = 112 + i * 40;
      const bg = scene.add.rectangle(8, y, 150, 36, COLORS.panel, 0.9).setOrigin(0).setStrokeStyle(1, COLORS.panelEdge);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => cb.selectCrew(c.id, p.event.shiftKey));
      const name = scene.add.text(14, y + 3, c.name, textStyle(12));
      const task = scene.add.text(14, y + 18, '', textStyle(10, COLORS.textDim));
      bg.setData('crewId', c.id);
      this.crewRows.push({ bg, name, task });
    });

    // --- Bottom-left: hands ---
    panel(scene, 8, BOTTOM_Y, 330, 200);
    this.handsTitle = scene.add.text(18, BOTTOM_Y + 8, '', textStyle(14, COLORS.gold, { fontStyle: 'bold' }));
    const systems: SystemId[] = ['helm', 'sails', 'pumps', 'surgeon', 'guns'];
    systems.forEach((id, i) => {
      if (!player.system(id)) return;
      const y = BOTTOM_Y + 40 + i * 31;
      this.sysLabels.set(id, scene.add.text(18, y, SYSTEM_NAMES[id], textStyle(13)));
      this.sysStatus.set(id, scene.add.text(232, y + 1, '', textStyle(11, COLORS.textDim)));
      if (id === 'sails' || id === 'pumps' || id === 'surgeon') {
        new Button(scene, 92, y - 2, 22, 22, '−', () => battle.addHands(id, -1), { size: 15 });
        new Button(scene, 204, y - 2, 22, 22, '+', () => battle.addHands(id, 1), { size: 15 });
      }
    });

    // --- Bottom-centre: gun cards ---
    player.guns.forEach((gun, i) => {
      const x = 346 + i * (CARD_W + 6);
      const bg = scene.add.rectangle(x, BOTTOM_Y, CARD_W, 200, COLORS.panel, 0.92).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', (p: Phaser.Input.Pointer) => (p.rightButtonDown() ? cb.clearGunTarget(i) : cb.selectGun(i)));
      const name = scene.add.text(x + 8, BOTTOM_Y + 8, `${i + 1}. ${gun.def.name}`, textStyle(13, COLORS.text, { fontStyle: 'bold', wordWrap: { width: CARD_W - 16 } }));
      const power = new Button(scene, x + 8, BOTTOM_Y + 50, 72, 22, '', () => battle.toggleGun(i), { size: 12 });
      scene.add.text(x + 88, BOTTOM_Y + 54, `${gun.def.hands} hand${gun.def.hands > 1 ? 's' : ''} · ${gun.def.shots}×${gun.def.damage}`, textStyle(11, COLORS.textDim));
      const status = scene.add.text(x + 8, BOTTOM_Y + 98, '', textStyle(11, COLORS.textDim));
      const target = scene.add.text(x + 8, BOTTOM_Y + 114, '', textStyle(11));
      const shots = SHOT_TYPES.map((s, j) => {
        const b = new Button(scene, x + 8 + j * 36, BOTTOM_Y + 140, 33, 24, SHOT_EFFECTS[s].label[0], () => battle.setShot(i, s), { size: 13 });
        b.bg.on('pointerover', () => this.showTooltip(`${SHOT_EFFECTS[s].label} shot: ${SHOT_EFFECTS[s].blurb}`, x, BOTTOM_Y - 8));
        b.bg.on('pointerout', () => this.tooltip.setVisible(false));
        return b;
      });
      scene.add.text(x + 8, BOTTOM_Y + 172, 'Click card, then enemy room', textStyle(10, COLORS.textDim));
      this.cards.push({ bg, name, status, target, power, shots, x });
    });

    // --- Bottom-right: log ---
    const logX = 346 + 4 * (CARD_W + 6);
    panel(scene, logX, BOTTOM_Y, SCREEN.w - logX - 8, 200);
    scene.add.text(logX + 10, BOTTOM_Y + 8, "CAPTAIN'S LOG", textStyle(13, COLORS.textDim, { fontStyle: 'bold' }));
    this.logText = scene.add.text(logX + 10, BOTTOM_Y + 30, '', textStyle(12, COLORS.text, { wordWrap: { width: SCREEN.w - logX - 28 }, lineSpacing: 3 }));

    this.g = scene.add.graphics();

    this.pauseBanner = scene.add
      .text(SCREEN.w / 2, 98, 'PAUSED — press Space to resume', { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, backgroundColor: '#000000aa', padding: { x: 14, y: 6 } })
      .setOrigin(0.5)
      .setDepth(20);
    this.hoverText = scene.add.text(SCREEN.w / 2, BOTTOM_Y - 14, '', textStyle(13, COLORS.text, { backgroundColor: '#00000088', padding: { x: 8, y: 3 } })).setOrigin(0.5, 1);
    this.tooltip = scene.add
      .text(0, 0, '', textStyle(12, COLORS.text, { backgroundColor: '#000000dd', padding: { x: 8, y: 5 }, wordWrap: { width: 300 } }))
      .setOrigin(0, 1)
      .setDepth(30)
      .setVisible(false);
  }

  addLog(text: string, color: string = COLORS.text): void {
    this.log.push({ text, color });
    while (this.log.length > 9) this.log.shift();
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
    this.drawHull(player, 64, 14);
    this.playerStats.setText(`Evasion ${Math.round(player.evasion())}%   Flooding ${floodPct(player)}   ${battle.canBoard() ? 'Can board' : 'Too slow to board'}`);
    this.playerStats.setColor(battle.grappled ? COLORS.gold : COLORS.text);
    drawBar(g, 250, 48, 100, 16, player.escape / 100, battle.canEscape() ? 0x7fdc6a : 0x6a9ac0);
    const escapeLabel = !battle.allowEscape ? 'No escape' : battle.grappled ? 'Grappled!' : battle.canEscape() ? 'Escape!' : 'Make Sail…';
    this.escapeBtn.setEnabled(battle.canEscape()).setText(escapeLabel);

    this.drawHull(enemy, SCREEN.w - 414, 14);
    this.enemyTitle.setText('HULL');
    const fleeing = battle.enemyFleeing ? '   FLEEING!' : '';
    this.enemyStats.setText(`${enemy.def.className}   Evasion ${Math.round(enemy.evasion())}%   Flooding ${floodPct(enemy)}${fleeing}`);
    if (battle.enemyFleeing) drawBar(g, SCREEN.w - 110, 48, 90, 16, enemy.escape / 100, 0xd06a4a);

    // Crew list: your people wherever they are, aboard, crossing, or on her deck.
    const mine = battle.crewOf('player');
    this.crewRows.forEach((row) => {
      const id = row.bg.getData('crewId') as number;
      const c = mine.find((x) => x.id === id);
      if (!c) {
        row.bg.setAlpha(0.35).disableInteractive();
        row.name.setAlpha(0.4);
        row.task.setText('lost');
        return;
      }
      row.bg.setStrokeStyle(state.selectedCrew.has(id) ? 2 : 1, state.selectedCrew.has(id) ? COLORS.select : COLORS.panelEdge);
      row.name.setText(`${c.name}  ${badges(c)}`);
      const aboard = battle.shipOf(c);
      row.task.setText(!aboard ? 'Crossing over…' : aboard === player ? `${taskLabel(c.task)} · ${player.room(c.room).def.name}` : `${taskLabel(c.task)} · HER ${aboard.room(c.room).def.name}`);
      row.task.setColor(aboard && aboard !== player ? COLORS.gold : COLORS.textDim);
      const frac = c.hp / c.maxHp;
      drawBar(g, row.bg.x + 5, row.bg.y + 31, 140, 3, frac, frac > 0.6 ? 0x6fd35a : frac > 0.3 ? 0xe5c23a : 0xe0452f);
    });

    // Hands.
    const free = player.freeHands();
    this.handsTitle.setText(`HANDS  ${free} free of ${player.def.hands}`);
    drawPips(g, 18, BOTTOM_Y + 26, free, player.def.hands, 0, 8, 2);
    for (const [id, label] of this.sysLabels) {
      const sys = player.system(id)!;
      const y = label.y + 3;
      const on = id === 'helm' ? player.level('helm') : player.allocated(id);
      drawPips(g, 120, y, on, sys.max, sys.damage, 12, 3);
      this.sysStatus.get(id)!.setText(systemStatus(player, id)).setColor(systemStatus(player, id).startsWith('!') ? COLORS.textWarn : COLORS.textDim);
    }

    // Guns.
    player.guns.forEach((gun, i) => {
      const card = this.cards[i];
      const aiming = state.aimingGun === i;
      card.bg.setStrokeStyle(aiming ? 3 : 2, aiming ? COLORS.select : gun.powered ? 0x5c7f99 : COLORS.panelEdge);
      card.power.setText(gun.powered ? '⏻ Manned' : '⏻ Idle').setOn(gun.powered);
      const loaded = gun.charge / gun.def.loadTime;
      drawBar(g, card.x + 8, BOTTOM_Y + 80, CARD_W - 16, 12, loaded, loaded >= 1 ? 0x7fdc6a : 0xd0a040);
      const working = player.level('guns') > 0 || !gun.powered;
      card.status.setText(
        !gun.powered
          ? 'Needs hands to load'
          : !working
            ? '! Gun deck out of action'
            : loaded >= 1
              ? 'Loaded — pick a target'
              : `Loading… ${(gun.def.loadTime - gun.charge).toFixed(1)}s`,
      );
      card.target.setText(gun.target ? `→ ${enemy.room(gun.target).def.name}` : aiming ? '→ click an enemy room' : '→ no target');
      card.target.setColor(gun.target ? COLORS.textWarn : COLORS.textDim);
      SHOT_TYPES.forEach((s: ShotType, j) => card.shots[j].setOn(gun.shot === s));
    });

    this.logText.setText(this.log.map((l) => l.text).join('\n'));
    while (this.logText.height > 172 && this.log.length > 1) {
      this.log.shift();
      this.logText.setText(this.log.map((l) => l.text).join('\n'));
    }
    this.pauseBanner.setVisible(battle.paused && !battle.outcome);
    this.hoverText.setText(state.hoverText).setVisible(!!state.hoverText);
  }

  private drawHull(ship: Ship, x: number, y: number): void {
    const g = this.g;
    const n = ship.def.hull;
    const w = Math.min(12, Math.floor(400 / n) - 2);
    for (let i = 0; i < n; i++) {
      const frac = ship.hull / n;
      const color = i < ship.hull ? (frac > 0.5 ? 0x7fdc6a : frac > 0.25 ? 0xe5c23a : 0xe0452f) : 0x2a2f33;
      g.fillStyle(color, 1).fillRect(x + i * (w + 2), y, w, 18);
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
  if (id === 'pumps' && ship.level('pumps') > 0) return ship.isSwamped('pumps') ? '! Half rate' : 'Bailing';
  return '';
}
