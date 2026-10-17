import Phaser from 'phaser';
import { crewFrame, crewTextures, CREW_ORIGIN, setEnemyStyle } from '../render/CrewArt';
import { CREW_KEYS, Hud } from '../render/Hud';
import { playLoop, playSfx, stopLoop, toggleMute } from '../render/sound';
import { currentRun } from '../render/RunBar';
import { ShipView, type AimMark } from '../render/ShipView';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Sea } from '../render/ui';
import type { Battle } from '../sim/Battle';
import type { BattleReport, Run } from '../sim/Run';
import { BOARD_TIME, grappleSpeed, partyStrength } from '../sim/Boarding';
import { SHOT_EFFECTS, TRAVEL_TIME } from '../sim/Combat';
import type { BattleEvent } from '../sim/events';
import { SHOT_TYPES, SYSTEM_NAMES, type Side } from '../sim/types';
import { bumpProfile, saveRun } from './save';

const TILE = 42;
const SHIP_CENTER_Y = 292;
/** Banners and the outcome overlay sit above the HUD (see HUD_DEPTH). */
const OVERLAY_DEPTH = 60;
/** Ships that fly the Spanish ensign rather than a plain trade flag. */
const SPANISH_SHIPS = new Set(['guarda', 'galleon']);

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
  private readonly swingers = new Map<number, Phaser.GameObjects.Image>();
  private ambient!: Phaser.GameObjects.Graphics;
  private clouds: { x: number; y: number; s: number; v: number }[] = [];
  private gulls: { x: number; y: number; v: number; phase: number; drift: number }[] = [];
  private hud!: Hud;
  private selected = new Set<number>();
  private aimingGun: number | null = null;
  private ending = false;
  private drag: { x: number; y: number; active: boolean } | null = null;
  private band!: Phaser.GameObjects.Graphics;
  /** Scene time at which the fight actually starts, after the ships have sailed in. */
  private startAt = 0;
  /** Whether the opening pause (orders before the first shot) has been applied. */
  private armed = false;
  /** Game speed: the battle is ticked this many times faster than real time. */
  private speed = 1;
  /** Crew in muster-roll order, for the crew hotkeys. */
  private crewIds: number[] = [];
  /** Moments that unlock first-battle hints. */
  private wasHit = false;
  private volleyLanded = false;

  constructor() {
    super('Battle');
  }

  init(): void {
    this.selected = new Set();
    this.aimingGun = null;
    this.ending = false;
    this.startAt = 0;
    this.armed = false;
    this.drag = null;
    this.swingers.clear();
    this.speed = (this.registry.get('battle-speed') as number | undefined) ?? 1;
    this.wasHit = false;
    this.volleyLanded = false;
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    const battle = (this.battle = run.startBattle());
    this.sea = new Sea(this, SCREEN.w, SCREEN.h, 0);

    const foe = run.encounter.kind === 'battle' ? run.currentEnemy() : null;
    const faction = foe?.faction ?? 'navy';
    setEnemyStyle(faction === 'navy' ? 'navy' : faction === 'merchant' ? 'merchant' : 'pirate');
    const p = battle.player;
    const e = battle.enemy;
    const spanish = SPANISH_SHIPS.has(e.def.id) || (!!foe && SPANISH_SHIPS.has(foe.id));
    this.playerView = new ShipView(this, p, 250, SHIP_CENTER_Y - (p.height * TILE) / 2, TILE, false, { flag: 'pirate' });
    this.enemyView = new ShipView(this, e, SCREEN.w - 12 - (e.width + 1.7) * TILE, SHIP_CENTER_Y - (e.height * TILE) / 2, TILE, true, {
      flag: faction === 'navy' ? 'navy' : faction === 'pirate' ? 'pirate' : spanish ? 'spanish' : 'trade',
    });
    this.fx = this.add.graphics().setDepth(10);
    this.events.once('shutdown', () => {
      this.playerView.destroy();
      this.enemyView.destroy();
      for (const img of this.swingers.values()) img.destroy();
      this.swingers.clear();
    });
    this.ambient = this.add.graphics().setDepth(8);
    this.clouds = Array.from({ length: 4 }, (_, i) => ({ x: i * 380 + Math.random() * 200, y: 60 + Math.random() * 420, s: 0.8 + Math.random() * 0.8, v: 6 + Math.random() * 6 }));
    this.gulls = Array.from({ length: 3 }, () => ({ x: Math.random() * SCREEN.w, y: 90 + Math.random() * 380, v: 22 + Math.random() * 18, phase: Math.random() * 6, drift: Math.random() * 6 }));

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
      toggleSpeed: () => this.toggleSpeed(),
    });
    this.crewIds = p.crew.map((c) => c.id);
    if (run.encounter.kind === 'battle') this.hud.addLog(run.encounter.text, COLORS.gold);
    this.hud.addLog(`${e.def.name} bears down on you. Run out the guns!`, COLORS.gold);
    this.hud.addLog('Click a gun card, then an enemy room to aim. Space pauses.');
    if (battle.enemyRuns) {
      this.hud.addLog('She means to run: cripple her Sails or Helm before she escapes.', COLORS.textWarn);
      this.hud.flash('SHE MEANS TO RUN: CRIPPLE HER SAILS OR HELM', 7000);
    }

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onPointerDown(ptr, over));
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => this.onPointerMove(ptr));
    this.input.on('pointerup', (ptr: Phaser.Input.Pointer) => this.onPointerUp(ptr));
    this.band = this.add.graphics().setDepth(25);
    this.introduce();

    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', () => {
      battle.togglePause();
      this.hud.hintDone('pause');
    });
    kb.on('keydown-B', () => battle.setBroadside(!battle.player.broadside));
    kb.on('keydown-F', () => this.toggleSpeed());
    kb.on('keydown-M', () => toggleMute(this.game));
    playLoop(this, 'waves', 0.25);
    stopLoop(this, 'creak');
    kb.on('keydown-ESC', () => {
      this.aimingGun = null;
      this.selected.clear();
    });
    // 1-4 picks a gun to aim; Shift+1-4 cycles its shot.
    ['ONE', 'TWO', 'THREE', 'FOUR'].forEach((k, i) =>
      kb.on(`keydown-${k}`, (e: KeyboardEvent) => {
        const gun = battle.player.guns[i];
        if (!gun || battle.outcome) return;
        if (e.shiftKey) {
          battle.setShot(i, SHOT_TYPES[(SHOT_TYPES.indexOf(gun.shot) + 1) % SHOT_TYPES.length]);
          this.hud.hintDone('shot');
        } else this.aimingGun = this.aimingGun === i ? null : i;
      }),
    );
    // Crew by the key shown on their row; Shift adds to the selection.
    CREW_KEYS.forEach((k, i) =>
      kb.on(`keydown-${k}`, (e: KeyboardEvent) => {
        const id = this.crewIds[i];
        if (id === undefined || battle.outcome || !battle.crewOf('player').some((c) => c.id === id)) return;
        if (!e.shiftKey) this.selected.clear();
        this.selected.add(id);
      }),
    );
  }

  private toggleSpeed(): void {
    this.speed = this.speed > 1 ? 1 : 2;
    this.registry.set('battle-speed', this.speed);
  }

  /** First-battle hints, offered in order as the moment for each comes; the HUD shows one at a time, once ever. */
  private offerHints(): void {
    const b = this.battle;
    const hud = this.hud;
    if (b.outcome || this.time.now < this.startAt) return;
    if (b.player.guns.some((g) => g.target)) hud.hintDone('aim');
    else hud.hint('aim');
    hud.hint('crew');
    if (!b.paused) hud.hint('pause');
    if (this.wasHit) hud.hint('hands');
    if (this.volleyLanded) hud.hint('shot');
  }

  private onPointerUp(ptr: Phaser.Input.Pointer): void {
    const drag = this.drag;
    this.drag = null;
    this.band.clear();
    if (!drag || !drag.active) return;
    const x0 = Math.min(drag.x, ptr.x);
    const x1 = Math.max(drag.x, ptr.x);
    const y0 = Math.min(drag.y, ptr.y);
    const y1 = Math.max(drag.y, ptr.y);
    if (!ptr.event.shiftKey) this.selected.clear();
    for (const view of [this.playerView, this.enemyView]) {
      for (const c of view.ship.crew) {
        if (c.side !== 'player') continue;
        const p = view.toScreen(c.pos);
        if (p.x >= x0 && p.x <= x1 && p.y >= y0 - 12 && p.y <= y1 + 12) this.selected.add(c.id);
      }
    }
  }

  private onPointerMove(ptr: Phaser.Input.Pointer): void {
    const drag = this.drag;
    if (!drag || !ptr.isDown) return;
    if (!drag.active && Math.hypot(ptr.x - drag.x, ptr.y - drag.y) > 8) drag.active = true;
    if (!drag.active) return;
    const g = this.band;
    g.clear();
    g.fillStyle(COLORS.select, 0.08).fillRect(Math.min(drag.x, ptr.x), Math.min(drag.y, ptr.y), Math.abs(ptr.x - drag.x), Math.abs(ptr.y - drag.y));
    g.lineStyle(1.5, COLORS.select, 0.8).strokeRect(Math.min(drag.x, ptr.x), Math.min(drag.y, ptr.y), Math.abs(ptr.x - drag.x), Math.abs(ptr.y - drag.y));
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

    // An order is given once: the selection is spent, so a later click on her deck (to aim) can't send a boarding party.
    const room = this.playerView.roomAt(ptr.x, ptr.y);
    if (room && this.selected.size) {
      if (b.orderCrew(this.selected, room, 'player')) this.hud.hintDone('crew');
      for (const c of b.player.crew) if (this.selected.has(c.id) && c.waypoints.length) this.playerView.markMove(c.slot);
      this.selected.clear();
      return;
    }
    if (enemyRoom && this.selected.size) {
      const sent = b.orderCrew(this.selected, enemyRoom, 'enemy');
      if (sent) {
        this.selected.clear();
        this.hud.hintDone('crew');
      }
      else if (!b.canBoard()) this.hud.addLog('She is too fast to grapple. Cripple her sails or helm first.', COLORS.textWarn);
      return;
    }

    // Empty water or deck: the start of a drag-select, or a click that clears the selection.
    this.drag = { x: ptr.x, y: ptr.y, active: false };
    if (!ptr.event.shiftKey) this.selected.clear();
    this.aimingGun = null;
  }

  update(time: number, delta: number): void {
    const b = this.battle;
    // Orders can be given while the ships close, but the clock only starts once they are alongside.
    if (time >= this.startAt) {
      // Once alongside, hold fire until the captain has given orders.
      if (!this.armed) {
        this.armed = true;
        b.paused = true;
      }
      b.update((delta / 1000) * this.speed);
    }
    for (const ev of b.drainEvents()) this.onEvent(ev);
    this.offerHints();

    // Drop selections of crew who died.
    const alive = new Set<number>();
    for (const c of b.crewOf('player')) alive.add(c.id);
    for (const id of this.selected) if (!alive.has(id)) this.selected.delete(id);
    for (const c of b.crewOf('enemy')) alive.add(c.id);

    const ptr = this.input.activePointer;
    const hoverEnemy = this.enemyView.roomAt(ptr.x, ptr.y);
    const hoverPlayer = this.playerView.roomAt(ptr.x, ptr.y);

    const targets: AimMark[] = [];
    b.player.guns.forEach((g, i) => {
      if (g.target) targets.push({ room: g.target, gun: i + 1, charge: g.powered ? g.charge / g.def.loadTime : 0, hostile: false });
    });
    // What the enemy has her guns laid on, so you can clear a room before the broadside lands.
    const threats: AimMark[] = [];
    b.enemy.guns.forEach((g, i) => {
      if (g.target && g.powered) threats.push({ room: g.target, gun: i + 1, charge: g.charge / g.def.loadTime, hostile: true });
    });

    this.sea.draw(time);
    this.playerView.draw(time, { selected: this.selected, hoverRoom: hoverPlayer, alive, targets: threats });
    this.enemyView.draw(time, { selected: this.selected, hoverRoom: hoverEnemy, targets, aiming: this.aimingGun !== null, alive });
    this.drawAmbient(time, delta / 1000);
    this.drawProjectiles();

    this.hud.refresh({
      selectedCrew: this.selected,
      aimingGun: this.aimingGun,
      hoverText: this.hoverText(hoverPlayer, hoverEnemy),
      speed: this.speed,
    });

    if (b.outcome && !this.ending) this.endBattle();
  }

  /** Both ships sail into range under a banner before the shooting starts. */
  private introduce(): void {
    const now = this.time.now;
    this.startAt = now + 2300;
    this.playerView.arrive(now);
    this.enemyView.arrive(now);
    const banner = this.add
      .text(SCREEN.w / 2, 200, this.run.encounter.kind === 'battle' && this.run.encounter.boss ? 'The Blockade!' : 'Beat to Quarters!', {
        fontFamily: TITLE_FONT,
        fontSize: '50px',
        color: COLORS.gold,
        stroke: '#000000',
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_DEPTH + 1)
      .setAlpha(0)
      .setScale(0.8);
    const sub = this.add
      .text(SCREEN.w / 2, 246, `${this.battle.enemy.def.name}, ${this.battle.enemy.def.className}`, { fontFamily: TITLE_FONT, fontSize: '20px', color: COLORS.text, stroke: '#000000', strokeThickness: 4, fontStyle: 'italic' })
      .setOrigin(0.5)
      .setDepth(OVERLAY_DEPTH + 1)
      .setAlpha(0);
    this.tweens.add({ targets: banner, alpha: 1, scale: 1, duration: 450, ease: 'Back.easeOut' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 450, delay: 200 });
    this.tweens.add({ targets: [banner, sub], alpha: 0, delay: 1900, duration: 450, onComplete: () => (banner.destroy(), sub.destroy()) });
  }

  /** Cloud shadows sliding over the water and ships, and a few gulls wheeling overhead. */
  private drawAmbient(time: number, dt: number): void {
    const g = this.ambient;
    const t = time / 1000;
    g.clear();
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x - 260 * c.s > SCREEN.w) {
        c.x = -260 * c.s;
        c.y = 60 + Math.random() * 420;
      }
      for (let i = 0; i < 5; i++) {
        g.fillStyle(0x061420, 0.045).fillEllipse(c.x + Math.sin(i * 2.1) * 90 * c.s, c.y + Math.cos(i * 1.7) * 30 * c.s, 220 * c.s, 90 * c.s);
      }
    }
    for (const gull of this.gulls) {
      gull.x += gull.v * dt;
      gull.y += Math.sin(t * 0.7 + gull.drift) * 8 * dt;
      if (gull.x > SCREEN.w + 30) {
        gull.x = -30;
        gull.y = 90 + Math.random() * 380;
      }
      const flap = Math.sin(t * 9 + gull.phase);
      const wing = 7;
      // Shadow on the sea, then the bird.
      g.lineStyle(2, 0x061420, 0.18);
      g.beginPath();
      g.moveTo(gull.x - wing + 12, gull.y + 40 + flap * 2);
      g.lineTo(gull.x + 12, gull.y + 42);
      g.lineTo(gull.x + wing + 12, gull.y + 40 + flap * 2);
      g.strokePath();
      g.lineStyle(2.2, 0xf4f1ea, 0.95);
      g.beginPath();
      g.moveTo(gull.x - wing, gull.y - 3 + flap * 3);
      g.lineTo(gull.x - 2, gull.y);
      g.lineTo(gull.x, gull.y + 1);
      g.lineTo(gull.x + 2, gull.y);
      g.lineTo(gull.x + wing, gull.y - 3 + flap * 3);
      g.strokePath();
    }
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
    if (sys) {
      const level = `${side.level(sys)}/${side.system(sys)!.max}`;
      if (SYSTEM_NAMES[sys] === room.def.name) parts[0] = `${room.def.name} ${level}`;
      else parts.push(`${SYSTEM_NAMES[sys]} ${level}`);
    }
    if (room.fire > 0) parts.push('ON FIRE');
    if (room.breach) parts.push('HOLED');
    if (room.water > 5) parts.push(`water ${Math.round(room.water)}%`);
    const boarding = !!enemyRoom && this.selected.size > 0 && this.aimingGun === null;
    // What a ball would find in there (the boarding odds below say it for a party).
    if (enemyRoom && !boarding) {
      const hers = side.own().filter((c) => c.room === id).length;
      parts.push(hers ? `${hers} of her crew` : 'no crew');
    }
    if (enemyRoom && this.aimingGun !== null) parts.push('click to aim');
    if (playerRoom && this.selected.size) parts.push('click to send crew');
    if (boarding) {
      parts.push(b.canBoard() ? 'click to BOARD' : `too fast to grapple (her speed ${grappleSpeed(b.enemy).toFixed(0)}, yours ${grappleSpeed(b.player).toFixed(0)})`);
    }
    const fighting = side.crew.filter((c) => c.room === id && c.side !== side.side).length;
    if (fighting) parts.push(`${fighting} BOARDER${fighting > 1 ? 'S' : ''}`);
    return boarding ? `${parts.join(' · ')}\n${this.boardingOdds(id)}` : parts.join(' · ');
  }

  /** The odds of sending the selected crew into one of her rooms: who is waiting there, and how many she has in all. */
  private boardingOdds(roomId: string): string {
    const b = this.battle;
    const party = b.crewOf('player').filter((c) => this.selected.has(c.id));
    const here = b.enemy.own().filter((c) => c.room === roomId);
    const aboard = b.enemy.own();
    const ours = partyStrength(party);
    const theirs = partyStrength(here, true);
    const odds = `Your ${party.length} (strength ${ours.toFixed(1)}) vs her ${here.length} here (strength ${theirs.toFixed(1)}) · she has ${aboard.length} aboard`;
    if (theirs > ours) return `${odds}\n⚠ OUTMATCHED in this room: send more, or pick an emptier one`;
    if (partyStrength(aboard, true) > ours) return `${odds}\n⚠ OUTNUMBERED aboard: her crew will rally against you`;
    return odds;
  }

  private viewFor(side: Side): ShipView {
    return side === 'player' ? this.playerView : this.enemyView;
  }

  private drawProjectiles(): void {
    const g = this.fx;
    g.clear();
    if (this.battle.outcome) {
      for (const img of this.swingers.values()) img.destroy();
      this.swingers.clear();
      return;
    }
    // Boarders swinging across on lines between the ships.
    const swinging = new Set<number>();
    for (const tr of this.battle.transit) {
      const fromView = this.viewFor(tr.to === 'player' ? 'enemy' : 'player');
      const toView = this.viewFor(tr.to);
      const fromRoom = tr.to === 'player' ? fromView.ship.system('guns')?.room ?? tr.room : tr.crew.home;
      const a = fromView.roomCenter(fromView.ship.rooms.has(fromRoom) ? fromRoom : [...fromView.ship.rooms.keys()][0]);
      const b = toView.roomCenter(tr.room);
      const k = 1 - Math.max(0, tr.t) / BOARD_TIME;
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k - Math.sin(k * Math.PI) * 50;
      g.lineStyle(1.5, 0xd8c8a0, 0.7).lineBetween((a.x + b.x) / 2, Math.min(a.y, b.y) - 120, x, y - 30);
      swinging.add(tr.crew.id);
      const prefix = crewTextures(this, tr.crew);
      let img = this.swingers.get(tr.crew.id);
      if (!img) {
        img = this.add.image(x, y, `${prefix}:walk1`).setOrigin(CREW_ORIGIN.x, CREW_ORIGIN.y).setScale(0.5).setDepth(9);
        this.swingers.set(tr.crew.id, img);
      }
      img.setTexture(`${prefix}:${crewFrame(tr.crew, this.time.now / 1000)}`).setPosition(x, y).setFlipX(b.x < a.x);
    }
    for (const [id, img] of this.swingers) {
      if (swinging.has(id)) continue;
      img.destroy();
      this.swingers.delete(id);
    }
    for (const p of this.battle.projectiles) {
      if (p.t < p.delay) continue;
      const k = Math.min(1, (p.t - p.delay) / TRAVEL_TIME);
      const shooter = this.viewFor(p.from);
      const target = this.viewFor(p.from === 'player' ? 'enemy' : 'player');
      const a = shooter.muzzle(p.gun);
      const b = target.roomCenter(p.room);
      const at = (kk: number) => ({ x: a.x + (b.x - a.x) * kk, y: a.y + (b.y - a.y) * kk - Math.sin(kk * Math.PI) * 70 });
      const { x, y } = at(k);
      // Shadow on the water below, so the arc reads.
      g.fillStyle(0x061420, 0.28).fillEllipse(a.x + (b.x - a.x) * k + 6, a.y + (b.y - a.y) * k + 10, 10, 4);
      for (let i = 1; i <= 4; i++) {
        const tp = at(Math.max(0, k - i * 0.035));
        if (p.shot === 'hot') g.fillStyle(i < 2 ? 0xffc040 : 0xff5a1f, 0.55 - i * 0.12).fillCircle(tp.x, tp.y, 5 - i * 0.8);
        else g.fillStyle(0xd8d4cc, 0.28 - i * 0.06).fillCircle(tp.x, tp.y, 3 + i * 0.8);
      }
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
    if (ev.t === 'hit' || ev.t === 'block' || ev.t === 'miss') {
      if (ours) this.wasHit = true;
      else this.volleyLanded = true;
    }
    switch (ev.t) {
      case 'shot': {
        playSfx(this, 'cannon', ours ? 0.55 : 0.4);
        const m = view.muzzle(ev.gun);
        this.burst(m.x, m.y, 0xfff0a0, 9, 180);
        this.smoke(m.x, m.y, m.dx, m.dy);
        break;
      }
      case 'hit': {
        if (ev.deflected) {
          playSfx(this, 'hit-wood', 0.25);
          const g = view.roomCenter(ev.room);
          this.burst(g.x, g.y, 0xd8d4cc, 10, 260);
          this.floatText(g.x, g.y - 6, 'GLANCED OFF', '#d8d4cc');
          if (!ours) this.hud.addLog(`A ball glances off her stout sides. Try heavier guns, chain or grape.`);
          break;
        }
        playSfx(this, 'hit-wood', ours ? 0.6 : 0.4);
        const c = view.roomCenter(ev.room);
        const jx = (Math.random() - 0.5) * TILE * 0.6;
        const jy = (Math.random() - 0.5) * TILE * 0.6;
        this.burst(c.x + jx, c.y + jy, ev.shot === 'hot' ? COLORS.fire : 0xffb050, 22, 380);
        this.splinters(c.x + jx, c.y + jy);
        if (ev.hull > 0 || ev.shot === 'hot') view.addScorch(ev.room);
        if (ev.hull > 0) view.addHullScar(ev.room);
        // What the ball struck, so a hit on a station reads even when it does no hull damage.
        const sys = view.ship.room(ev.room).def.system;
        const struck = `${ev.hull > 0 ? `-${ev.hull}` : 'HIT'}${sys ? ` ${SYSTEM_NAMES[sys].toUpperCase()}` : ''}`;
        this.floatText(c.x + jx, c.y - 22, struck, ours ? '#ff6a5a' : '#ffd27a');
        if (ours) this.cameras.main.shake(140, 0.004);
        const name = view.ship.room(ev.room).def.name;
        const kind = ev.shot === 'round' ? '' : ` (${SHOT_EFFECTS[ev.shot].label.toLowerCase()} shot)`;
        if (ours) this.hud.addLog(`We're hit in the ${name}${kind}${ev.hull ? `, ${ev.hull} hull` : ''}!`);
        else this.hud.addLog(`Hit their ${name}${kind}${ev.hull ? `, ${ev.hull} hull` : ''}.`);
        break;
      }
      case 'block': {
        playSfx(this, 'hit-wood', 0.2);
        view.flashBlock();
        const c = view.roomCenter(ev.room);
        this.burst(c.x, c.y, 0xf0dca0, 12, 260);
        this.floatText(c.x, c.y - 6, 'BLOCKED', '#f0dca0');
        break;
      }
      case 'miss': {
        playSfx(this, 'splash', 0.35);
        const c = view.roomCenter(ev.room);
        this.splash(c.x + (Math.random() - 0.5) * TILE * 2, c.y + (Math.random() < 0.5 ? -1 : 1) * TILE * (2.4 + Math.random()));
        this.floatText(c.x, c.y, 'MISS', '#cfe8ff');
        break;
      }
      case 'fire': {
        playSfx(this, 'fire', 0.9);
        const c = view.roomCenter(ev.room);
        this.floatText(c.x, c.y + 2, 'FIRE!', '#ffb050');
        if (ours) this.hud.addLog(`Fire in the ${view.ship.room(ev.room).def.name}!`);
        break;
      }
      case 'breach': {
        playSfx(this, 'breach', ours ? 0.55 : 0.35);
        const c = view.roomCenter(ev.room);
        this.floatText(c.x, c.y + 20, 'HOLED!', '#7fc4ff');
        if (ours) this.hud.addLog(`We're holed in the ${view.ship.room(ev.room).def.name}, she's taking water!`);
        break;
      }
      case 'board': {
        playSfx(this, 'boarders', 0.5);
        const target = this.viewFor(ev.side === 'player' ? 'enemy' : 'player').ship.room(ev.room).def.name;
        if (ev.side === 'player') this.hud.addLog(`${ev.count > 1 ? `${ev.count} of your crew swing` : 'Your boarder swings'} across for her ${target}!`, COLORS.gold);
        else this.hud.addLog(`BOARDERS! ${ev.count} of them coming over the side for our ${target}!`, COLORS.textWarn);
        break;
      }
      case 'death':
        this.hud.addLog(ours ? `${ev.name} has fallen.` : `Enemy ${ev.name} is down.`);
        if (ours) this.hud.flash(`${ev.name.toUpperCase()} HAS FALLEN`);
        break;
      case 'log':
        this.hud.addLog(ev.text);
        break;
      case 'rally':
        playSfx(this, 'bell', 0.6);
        this.cameras.main.shake(400, 0.005);
        this.hud.flash('THE COMMODORE RALLIES HIS CREW', 4500);
        this.hud.addLog(ev.text, COLORS.textWarn);
        break;
    }
  }

  private burst(x: number, y: number, color: number, radius: number, duration: number): void {
    const c = this.add.circle(x, y, radius, color, 0.85).setDepth(11);
    this.tweens.add({ targets: c, scale: 1.8, alpha: 0, duration, onComplete: () => c.destroy() });
  }

  private smoke(x: number, y: number, dx: number, dy: number): void {
    for (let i = 0; i < 4; i++) {
      const c = this.add.circle(x, y, 6 + i * 2, 0xd8d4cc, 0.55).setDepth(11);
      this.tweens.add({
        targets: c,
        x: x + dx * (14 + i * 10) + (Math.random() - 0.5) * 10,
        y: y + dy * (14 + i * 10) - 6,
        scale: 2.4,
        alpha: 0,
        duration: 900 + i * 200,
        ease: 'Cubic.easeOut',
        onComplete: () => c.destroy(),
      });
    }
  }

  private splinters(x: number, y: number): void {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 14 + Math.random() * 22;
      const r = this.add.rectangle(x, y, 6, 2, 0xc9a36a).setDepth(11).setRotation(a);
      this.tweens.add({ targets: r, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, angle: r.angle + 180, alpha: 0, duration: 500, onComplete: () => r.destroy() });
    }
    const puff = this.add.circle(x, y, 10, 0x3a3530, 0.5).setDepth(11);
    this.tweens.add({ targets: puff, y: y - 18, scale: 2.6, alpha: 0, duration: 1100, onComplete: () => puff.destroy() });
  }

  private splash(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      const ring = this.add.ellipse(x, y, 10, 5).setStrokeStyle(2, 0xe8f4f8, 0.8).setDepth(1.5);
      this.tweens.add({ targets: ring, scaleX: 4 + i, scaleY: 4 + i, alpha: 0, delay: i * 120, duration: 800, onComplete: () => ring.destroy() });
    }
    for (let i = 0; i < 6; i++) {
      const drop = this.add.circle(x, y, 2.5, 0xe8f4f8, 0.9).setDepth(11);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      this.tweens.add({ targets: drop, x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 22, alpha: 0, duration: 500, ease: 'Quad.easeOut', onComplete: () => drop.destroy() });
    }
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add.text(x, y, text, textStyle(15, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 1100, onComplete: () => t.destroy() });
  }

  private endBattle(): void {
    this.ending = true;
    const o = this.battle.outcome!;
    if (o.won) playSfx(this, 'bell', 0.6);
    if (o.kind === 'victory' || o.kind === 'defeat') playSfx(this, 'explosion', 0.7);
    if (o.kind === 'captured') bumpProfile('captures');
    const report = this.run.finishBattle(this.battle);
    // When she gets away, say what it costs (the alarm brings the fleet on) while the log is still up.
    if (o.kind === 'enemyEscaped') {
      this.hud.addLog(`${this.battle.enemy.def.name} gets clean away.`, COLORS.textWarn);
      for (const line of report.lines) this.hud.addLog(line, COLORS.textWarn);
    }
    const now = this.time.now;
    switch (o.kind) {
      case 'victory':
        this.enemyView.startFinale('explode', now);
        break;
      case 'enemySunk':
        this.enemyView.startFinale('sink', now);
        break;
      case 'enemyEscaped':
        this.enemyView.startFinale('sail', now);
        break;
      case 'escaped':
        this.playerView.startFinale('sail', now);
        break;
      case 'defeat':
      case 'sunk':
        this.playerView.startFinale('sink', now);
        break;
    }
    if (o.kind === 'victory' || o.kind === 'defeat') this.cameras.main.shake(500, 0.006);
    // Let the finale play, then dim the scene and name the outcome.
    this.time.delayedCall(1400, () => {
      const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0).setOrigin(0).setDepth(OVERLAY_DEPTH);
      this.tweens.add({ targets: shade, fillAlpha: 0.45, duration: 600 });
      const title = this.add
        .text(SCREEN.w / 2, SCREEN.h / 2 - 60, o.title, { fontFamily: TITLE_FONT, fontSize: '56px', color: o.won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 6 })
        .setOrigin(0.5)
        .setDepth(OVERLAY_DEPTH + 1)
        .setAlpha(0)
        .setScale(0.85);
      this.tweens.add({ targets: title, alpha: 1, scale: 1, duration: 500, ease: 'Back.easeOut' });
    });
    this.time.delayedCall(3800, () => this.scene.start('Result', { battle: this.battle, report } satisfies ResultData));
  }
}
