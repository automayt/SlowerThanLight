import Phaser from 'phaser';
import type { Battle } from '../sim/Battle';
import { SHOT_EFFECTS } from '../sim/Combat';
import { badges } from '../sim/Skills';
import { SINK_FRACTION } from '../sim/Hazards';
import { UNCREWED_RELOAD } from '../sim/Combat';
import type { Ship } from '../sim/Ship';
import { SHOT_TYPES, SYSTEM_NAMES, type ShotType, type SystemId } from '../sim/types';
import { crewTextures } from './CrewArt';
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

/** Phaser re-draws and re-uploads a Text on every setColor, so only call it on a change. */
function tint(text: Phaser.GameObjects.Text, color: string): Phaser.GameObjects.Text {
  if (text.style.color !== color) text.setColor(color);
  return text;
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
  private readonly escapeBtn: Button;
  private readonly broadsideBtn: Button;
  private readonly handsTitle: Phaser.GameObjects.Text;
  private readonly sysLabels = new Map<SystemId, Phaser.GameObjects.Text>();
  private readonly sysStatus = new Map<SystemId, Phaser.GameObjects.Text>();
  private readonly cards: GunCard[] = [];
  private readonly crewRows: CrewRow[] = [];
  private readonly logText: Phaser.GameObjects.Text;
  private readonly log: { text: string; color: string }[] = [];
  private readonly pauseBanner: Phaser.GameObjects.Text;
  private readonly alert: Phaser.GameObjects.Text;
  /** A short-lived headline (a crew death) that outranks the standing alerts. */
  private flashText = '';
  private flashUntil = 0;
  private readonly hoverText: Phaser.GameObjects.Text;
  private readonly tooltip: Phaser.GameObjects.Text;
  private readonly pointer: Phaser.Input.Pointer;

  constructor(
    scene: Phaser.Scene,
    private readonly battle: Battle,
    cb: HudCallbacks,
  ) {
    const player = battle.player;

    // --- Top: player status ---
    panel(scene, 8, 8, 470, 66);
    heading(scene, 18, 14, 'HULL', 15);
    this.playerStats = scene.add.text(18, 50, '', textStyle(13));
    this.escapeBtn = new Button(scene, 360, 42, 108, 26, 'Escape', () => battle.escape(), { size: 13 });

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
      this.sysLabels.set(id, scene.add.text(42, y, SYSTEM_NAMES[id], textStyle(13)));
      this.sysStatus.set(id, scene.add.text(264, y + 1, '', textStyle(11, COLORS.textDim)));
      if (id === 'bulwarks' || id === 'sails' || id === 'pumps' || id === 'surgeon') {
        new Button(scene, 112, y - 2, 22, 22, '−', () => battle.addHands(id, -1), { size: 15 });
        new Button(scene, 236, y - 2, 22, 22, '+', () => battle.addHands(id, 1), { size: 15 });
      }
    });

    this.broadsideBtn = new Button(scene, 222, BOTTOM_Y + 6, 108, 22, '', () => battle.setBroadside(!battle.player.broadside), { size: 12 });
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
      const power = new Button(scene, x + 8, BOTTOM_Y + 50, 64, 22, '', () => battle.toggleGun(i), { size: 11 });
      scene.add.text(x + 76, BOTTOM_Y + 55, `${gun.def.hands} hand${gun.def.hands > 1 ? 's' : ''} · ${gun.def.shots}×${gun.def.damage} dmg`, textStyle(10, COLORS.textDim));
      const status = scene.add.text(x + 8, BOTTOM_Y + 98, '', textStyle(11, COLORS.textDim));
      const target = scene.add.text(x + 8, BOTTOM_Y + 114, '', textStyle(11));
      const shots = SHOT_TYPES.map((s, j) => {
        const b = new Button(scene, x + 8 + j * 36, BOTTOM_Y + 140, 33, 24, '', () => battle.setShot(i, s), { size: 13 });
        b.add(scene.add.image(16.5, 12, shotIcon(scene, s)).setScale(0.5));
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
    heading(scene, logX + 10, BOTTOM_Y + 7, "Captain's Log", 15);
    this.logText = scene.add.text(logX + 10, BOTTOM_Y + 30, '', textStyle(12, COLORS.text, { wordWrap: { width: SCREEN.w - logX - 28 }, lineSpacing: 3 }));

    this.g = scene.add.graphics();

    this.alert = scene.add
      .text(SCREEN.w / 2, 486, '', { fontFamily: TITLE_FONT, fontSize: '18px', color: '#ffd8cc', backgroundColor: '#5a1410e6', padding: { x: 14, y: 5 }, stroke: '#000000', strokeThickness: 2 })
      .setOrigin(0.5)
      .setDepth(20)
      .setVisible(false);
    this.pauseBanner = scene.add
      .text(SCREEN.w / 2, 98, 'PAUSED  ·  Space to resume', { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, backgroundColor: '#0b1622dd', padding: { x: 18, y: 7 }, stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(20);
    this.hoverText = scene.add
      .text(0, 0, '', textStyle(13, COLORS.text, { backgroundColor: '#0b1622e8', padding: { x: 10, y: 5 }, wordWrap: { width: 340 } }))
      .setOrigin(0, 1)
      .setDepth(30);
    this.pointer = scene.input.activePointer;
    this.tooltip = scene.add
      .text(0, 0, '', textStyle(12, COLORS.text, { backgroundColor: '#000000dd', padding: { x: 8, y: 5 }, wordWrap: { width: 300 } }))
      .setOrigin(0, 1)
      .setDepth(30)
      .setVisible(false);
  }

  /** Headline something for a few seconds, above the standing alerts. */
  flash(text: string, ms = 3500): void {
    this.flashText = text;
    this.flashUntil = performance.now() + ms;
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
    this.drawLayers(player, 64, 36);
    this.playerStats.setText(`Evasion ${Math.round(player.evasion())}%  ·  Flood ${floodPct(player)}  ·  Board ${battle.canBoard() ? '✓' : '✗'}`);
    tint(this.playerStats, battle.grappled ? COLORS.gold : COLORS.text);
    drawBar(g, 250, 48, 100, 16, player.escape / 100, battle.canEscape() ? 0x7fdc6a : 0x6a9ac0);
    const rate = player.escapeRate();
    const eta = rate > 0 ? Math.ceil((100 - player.escape) / rate) : 0;
    const escapeLabel = !battle.allowEscape ? 'No escape' : battle.grappled ? 'Grappled!' : battle.canEscape() ? 'Escape!' : rate > 0 ? `Make Sail ${eta}s` : 'No way on';
    this.escapeBtn.setEnabled(battle.canEscape()).setText(escapeLabel);

    this.drawHull(enemy, SCREEN.w - 414, 14);
    this.drawLayers(enemy, SCREEN.w - 414, 36);
    this.enemyTitle.setText('HULL');
    const fleeing = battle.enemyFleeing ? '   FLEEING!' : '';
    this.enemyStats.setText(`${enemy.def.className}  ·  Evasion ${Math.round(enemy.evasion())}%  ·  Flood ${floodPct(enemy)}${fleeing}`);
    if (battle.enemyFleeing) drawBar(g, SCREEN.w - 110, 48, 90, 16, enemy.escape / 100, 0xd06a4a);

    this.broadsideBtn.setText(player.broadside ? 'Broadside: ON' : 'Broadside: off').setOn(player.broadside);

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
              ? gun.target
                ? 'Loaded — firing'
                : 'Loaded — pick a target!'
              : crewless
                ? `Slow: no gun crew  ${((gun.def.loadTime - gun.charge) / UNCREWED_RELOAD).toFixed(0)}s`
                : `Loading… ${(gun.def.loadTime - gun.charge).toFixed(1)}s`,
      );
      card.target.setText(gun.target ? `→ ${enemy.room(gun.target).def.name}` : aiming ? '→ click an enemy room' : '→ no target');
      tint(card.target, gun.target ? COLORS.textWarn : COLORS.textDim);
      const warn = card.status.text.startsWith('!') || card.status.text.startsWith('Slow');
      tint(card.status, loadedIdle ? COLORS.gold : warn ? COLORS.textWarn : COLORS.textDim);
      SHOT_TYPES.forEach((s: ShotType, j) => card.shots[j].setOn(gun.shot === s));
    });

    this.logText.setText(this.log.map((l) => l.text).join('\n'));
    while (this.logText.height > 172 && this.log.length > 1) {
      this.log.shift();
      this.logText.setText(this.log.map((l) => l.text).join('\n'));
    }
    this.pauseBanner.setVisible(battle.paused && !battle.outcome);
    this.pauseBanner.setText(battle.time === 0 ? 'Aim your guns and set your crew  ·  Space to engage' : 'PAUSED  ·  Space to resume');

    // The single most urgent problem aboard, and what to do about it.
    const now = performance.now();
    const alert = now < this.flashUntil ? this.flashText : battle.outcome ? '' : urgentAlert(battle);
    this.alert.setVisible(!!alert);
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
    const w = Math.min(12, Math.floor(400 / n) - 2);
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
  const fire = [...ship.rooms.values()].filter((r) => r.fire > 0).sort((a, b) => b.fire - a.fire)[0];
  if (fire && fire.fire > 30) return `FIRE in the ${roomName(fire.def.id)}: send crew to put it out`;
  const helm = ship.system('helm');
  if (helm && ship.capacity('helm') > 0 && !ship.isManned('helm')) return `HELM UNMANNED: evasion 0%. Send someone to the ${roomName(helm.room)}`;
  const guns = ship.system('guns');
  if (guns && ship.capacity('guns') === 0) return `GUN DECK WRECKED: send crew to repair the ${roomName(guns.room)}`;
  if (guns && ship.guns.some((g) => g.powered) && ship.gunCrew().length === 0) return `NO GUN CREW: guns load slowly. Send someone to the ${roomName(guns.room)}`;
  return '';
}
