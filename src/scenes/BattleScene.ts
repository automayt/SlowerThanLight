import Phaser from 'phaser';
import { Hud } from '../render/Hud';
import { playLoop, playSfx, toggleMute } from '../render/sound';
import { currentRun } from '../render/RunBar';
import { ShipView } from '../render/ShipView';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Sea } from '../render/ui';
import type { Battle } from '../sim/Battle';
import type { BattleReport, Run } from '../sim/Run';
import { BOARD_TIME, grappleSpeed } from '../sim/Boarding';
import { SHOT_EFFECTS, TRAVEL_TIME } from '../sim/Combat';
import type { BattleEvent } from '../sim/events';
import { SYSTEM_NAMES, type Side } from '../sim/types';
import { bumpProfile, saveRun } from './save';

const TILE = 42;
const SHIP_CENTER_Y = 292;

export interface ResultData {
  battle: Battle;
  report: BattleReport;
}

export class BattleScene extends Phaser.Scene {
  private run!: Run;
  private battle!: Battle;
  private sea!: Sea;
  private playerView!: ShipView;
  private enemyView!: ShipView;
  private fx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private selected = new Set<number>();
  private aimingGun: number | null = null;
  private ending = false;

  constructor() {
    super('Battle');
  }

  init(): void {
    this.selected = new Set();
    this.aimingGun = null;
    this.ending = false;
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    const battle = (this.battle = run.startBattle());
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);

    const p = battle.player;
    const e = battle.enemy;
    this.playerView = new ShipView(this, p, 200, SHIP_CENTER_Y - (p.height * TILE) / 2, TILE, false);
    this.enemyView = new ShipView(this, e, SCREEN.w - 40 - (e.width + 0.6) * TILE, SHIP_CENTER_Y - (e.height * TILE) / 2, TILE, true);
    this.fx = this.add.graphics().setDepth(10);

    this.hud = new Hud(this, battle, {
      selectCrew: (id, additive) => {
        if (!additive) this.selected.clear();
        this.selected.add(id);
      },
      selectGun: (i) => (this.aimingGun = this.aimingGun === i ? null : i),
      clearGunTarget: (i) => {
        battle.aimGun(i, null);
        if (this.aimingGun === i) this.aimingGun = null;
      },
    });
    if (run.encounter.kind === 'battle') this.hud.addLog(run.encounter.text, COLORS.gold);
    this.hud.addLog(`${e.def.name} bears down on you. Run out the guns!`, COLORS.gold);
    this.hud.addLog('Click a gun card, then an enemy room to aim. Space pauses.');

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onPointerDown(ptr, over));

    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', () => battle.togglePause());
    kb.on('keydown-M', () => toggleMute(this.game));
    playLoop(this, 'waves', 0.25);
    kb.on('keydown-ESC', () => {
      this.aimingGun = null;
      this.selected.clear();
    });
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((k, i) =>
      kb.on(`keydown-${k}`, () => {
        if (i < battle.player.guns.length) this.aimingGun = this.aimingGun === i ? null : i;
      }),
    );
  }

  private onPointerDown(ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (over.length || this.battle.outcome) return;
    const b = this.battle;

    if (ptr.rightButtonDown()) {
      this.aimingGun = null;
      this.selected.clear();
      return;
    }

    const enemyRoom = this.enemyView.roomAt(ptr.x, ptr.y);
    if (this.aimingGun !== null && enemyRoom) {
      b.aimGun(this.aimingGun, enemyRoom);
      this.aimingGun = null;
      return;
    }

    // Your crew can be picked out on either ship (boarders stand on the enemy's deck).
    const crew = [this.playerView.crewAt(ptr.x, ptr.y), this.enemyView.crewAt(ptr.x, ptr.y)].find((c) => c?.side === 'player');
    if (crew) {
      if (!ptr.event.shiftKey) this.selected.clear();
      this.selected.add(crew.id);
      return;
    }

    const room = this.playerView.roomAt(ptr.x, ptr.y);
    if (room && this.selected.size) {
      b.orderCrew(this.selected, room, 'player');
      return;
    }
    if (enemyRoom && this.selected.size) {
      const sent = b.orderCrew(this.selected, enemyRoom, 'enemy');
      if (!sent && !b.canBoard()) this.hud.addLog('She is too fast to grapple. Cripple her sails or helm first.', COLORS.textWarn);
      return;
    }

    this.selected.clear();
    this.aimingGun = null;
  }

  update(time: number, delta: number): void {
    const b = this.battle;
    b.update(delta / 1000);
    for (const ev of b.drainEvents()) this.onEvent(ev);

    // Drop selections of crew who died.
    const alive = new Set(b.crewOf('player').map((c) => c.id));
    for (const id of this.selected) if (!alive.has(id)) this.selected.delete(id);

    const ptr = this.input.activePointer;
    const hoverEnemy = this.enemyView.roomAt(ptr.x, ptr.y);
    const hoverPlayer = this.playerView.roomAt(ptr.x, ptr.y);

    const targets = new Map<string, number[]>();
    b.player.guns.forEach((g, i) => {
      if (!g.target) return;
      targets.set(g.target, [...(targets.get(g.target) ?? []), i + 1]);
    });

    this.sea.draw(time);
    this.playerView.draw(time, { selected: this.selected, hoverRoom: hoverPlayer });
    this.enemyView.draw(time, { selected: this.selected, hoverRoom: hoverEnemy, targets, aiming: this.aimingGun !== null });
    this.drawProjectiles();

    this.hud.refresh({
      selectedCrew: this.selected,
      aimingGun: this.aimingGun,
      hoverText: this.hoverText(hoverPlayer, hoverEnemy),
    });

    if (b.outcome && !this.ending) this.endBattle();
  }

  private hoverText(playerRoom: string | null, enemyRoom: string | null): string {
    const b = this.battle;
    const side = enemyRoom ? b.enemy : playerRoom ? b.player : null;
    const id = enemyRoom ?? playerRoom;
    if (!side || !id) {
      if (this.aimingGun !== null) return `Aiming gun ${this.aimingGun + 1}: click an enemy room (right-click to cancel)`;
      if (this.selected.size) return b.canBoard() ? 'Click a room on either ship: yours to move, hers to board' : 'Click one of your rooms to send the selected crew there';
      return '';
    }
    const room = side.room(id);
    const sys = room.def.system;
    const parts = [room.def.name];
    if (sys) parts.push(`${SYSTEM_NAMES[sys]} ${side.level(sys)}/${side.system(sys)!.max}`);
    if (room.fire > 0) parts.push('ON FIRE');
    if (room.breach) parts.push('HOLED');
    if (room.water > 5) parts.push(`water ${Math.round(room.water)}%`);
    if (enemyRoom && this.aimingGun !== null) parts.push('click to aim');
    if (playerRoom && this.selected.size) parts.push('click to send crew');
    if (enemyRoom && this.selected.size && this.aimingGun === null) {
      parts.push(b.canBoard() ? 'click to BOARD' : `too fast to grapple (her speed ${grappleSpeed(b.enemy).toFixed(0)}, yours ${grappleSpeed(b.player).toFixed(0)})`);
    }
    const fighting = side.crew.filter((c) => c.room === id && c.side !== side.side).length;
    if (fighting) parts.push(`${fighting} BOARDER${fighting > 1 ? 'S' : ''}`);
    return parts.join(' · ');
  }

  private viewFor(side: Side): ShipView {
    return side === 'player' ? this.playerView : this.enemyView;
  }

  private drawProjectiles(): void {
    const g = this.fx;
    g.clear();
    if (this.battle.outcome) return;
    // Boarders swinging across on lines between the ships.
    for (const tr of this.battle.transit) {
      const fromView = this.viewFor(tr.to === 'player' ? 'enemy' : 'player');
      const toView = this.viewFor(tr.to);
      const fromRoom = tr.to === 'player' ? fromView.ship.system('guns')?.room ?? tr.room : tr.crew.home;
      const a = fromView.roomCenter(fromView.ship.rooms.has(fromRoom) ? fromRoom : [...fromView.ship.rooms.keys()][0]);
      const b = toView.roomCenter(tr.room);
      const k = 1 - Math.max(0, tr.t) / BOARD_TIME;
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 50;
      g.lineStyle(1, 0xd8c8a0, 0.5).lineBetween(a.x, a.y - 60, x, y);
      g.fillStyle(tr.crew.side === 'player' ? COLORS.playerCrew : COLORS.enemyCrew, 1).fillCircle(x, y, 7);
      g.lineStyle(2, 0x1a1208, 1).strokeCircle(x, y, 7);
    }
    for (const p of this.battle.projectiles) {
      if (p.t < p.delay) continue;
      const k = Math.min(1, (p.t - p.delay) / TRAVEL_TIME);
      const shooter = this.viewFor(p.from);
      const target = this.viewFor(p.from === 'player' ? 'enemy' : 'player');
      const gunRoom = shooter.ship.system('guns')?.room;
      if (!gunRoom) continue;
      const a = shooter.roomCenter(gunRoom);
      const b = target.roomCenter(p.room);
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 70;
      switch (p.shot) {
        case 'chain':
          g.fillStyle(0x111111, 1).fillCircle(x - 5, y, 4).fillCircle(x + 5, y, 4);
          g.lineStyle(2, 0x555555, 1).lineBetween(x - 5, y, x + 5, y);
          break;
        case 'grape':
          for (let i = 0; i < 5; i++) g.fillStyle(0x222222, 1).fillCircle(x + Math.cos(i * 1.3) * 5, y + Math.sin(i * 1.3) * 5, 2.5);
          break;
        case 'hot':
          g.fillStyle(COLORS.fire, 0.5).fillCircle(x, y, 9);
          g.fillStyle(COLORS.fireCore, 1).fillCircle(x, y, 5);
          break;
        default:
          g.fillStyle(0x111111, 1).fillCircle(x, y, 5.5);
      }
    }
  }

  private onEvent(ev: BattleEvent): void {
    const view = this.viewFor(ev.side);
    const ours = ev.side === 'player';
    switch (ev.t) {
      case 'shot': {
        playSfx(this, 'cannon', ours ? 0.55 : 0.4);
        const gunRoom = view.ship.system('guns')?.room;
        if (gunRoom) this.burst(view.roomCenter(gunRoom).x, view.roomCenter(gunRoom).y, 0xfff0a0, 14, 250);
        break;
      }
      case 'hit': {
        playSfx(this, 'hit-wood', ours ? 0.6 : 0.4);
        const c = view.roomCenter(ev.room);
        const jx = (Math.random() - 0.5) * TILE * 0.6;
        const jy = (Math.random() - 0.5) * TILE * 0.6;
        this.burst(c.x + jx, c.y + jy, ev.shot === 'hot' ? COLORS.fire : 0xffb050, 26, 420);
        if (ours) this.cameras.main.shake(140, 0.004);
        const name = view.ship.room(ev.room).def.name;
        const kind = ev.shot === 'round' ? '' : ` (${SHOT_EFFECTS[ev.shot].label.toLowerCase()} shot)`;
        if (ours) this.hud.addLog(`We're hit in the ${name}${kind}${ev.hull ? `, ${ev.hull} hull` : ''}!`);
        else this.hud.addLog(`Hit their ${name}${kind}${ev.hull ? `, ${ev.hull} hull` : ''}.`);
        break;
      }
      case 'miss': {
        playSfx(this, 'splash', 0.35);
        const c = view.roomCenter(ev.room);
        this.floatText(c.x, c.y, 'MISS', '#cfe8ff');
        break;
      }
      case 'fire': {
        playSfx(this, 'fire', 0.3);
        const c = view.roomCenter(ev.room);
        this.floatText(c.x, c.y - 10, 'FIRE!', '#ffb050');
        if (ours) this.hud.addLog(`Fire in the ${view.ship.room(ev.room).def.name}!`);
        break;
      }
      case 'breach': {
        const c = view.roomCenter(ev.room);
        this.floatText(c.x, c.y + 10, 'HOLED!', '#7fc4ff');
        if (ours) this.hud.addLog(`We're holed in the ${view.ship.room(ev.room).def.name}, she's taking water!`);
        break;
      }
      case 'board': {
        const target = this.viewFor(ev.side === 'player' ? 'enemy' : 'player').ship.room(ev.room).def.name;
        if (ev.side === 'player') this.hud.addLog(`${ev.count > 1 ? `${ev.count} of your crew swing` : 'Your boarder swings'} across for her ${target}!`, COLORS.gold);
        else this.hud.addLog(`BOARDERS! ${ev.count} of them coming over the side for our ${target}!`, COLORS.textWarn);
        break;
      }
      case 'death':
        this.hud.addLog(ours ? `${ev.name} has fallen.` : `Enemy ${ev.name} is down.`);
        break;
      case 'log':
        this.hud.addLog(ev.text);
        break;
    }
  }

  private burst(x: number, y: number, color: number, radius: number, duration: number): void {
    const c = this.add.circle(x, y, radius, color, 0.85).setDepth(11);
    this.tweens.add({ targets: c, scale: 1.8, alpha: 0, duration, onComplete: () => c.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, textStyle(15, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
  }

  private endBattle(): void {
    this.ending = true;
    const o = this.battle.outcome!;
    if (o.won) playSfx(this, 'bell', 0.6);
    if (o.kind === 'captured') bumpProfile('captures');
    const report = this.run.finishBattle(this.battle);
    this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.45).setOrigin(0).setDepth(40);
    this.add
      .text(SCREEN.w / 2, SCREEN.h / 2 - 60, o.title, { fontFamily: TITLE_FONT, fontSize: '56px', color: o.won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 6 })
      .setOrigin(0.5)
      .setDepth(41);
    this.time.delayedCall(2200, () => this.scene.start('Result', { battle: this.battle, report } satisfies ResultData));
  }
}
