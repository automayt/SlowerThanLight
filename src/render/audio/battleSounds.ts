import type Phaser from 'phaser';
import type { Battle } from '../../sim/Battle';
import type { BattleEvent } from '../../sim/events';
import { SWAMP_LEVEL, type Ship } from '../../sim/Ship';
import type { Side } from '../../sim/types';
import type { ShipView } from '../ShipView';
import { playSfx } from '../sound';

type Views = (side: Side) => ShipView;

/** Seconds between the cutlass clashes of a melee, the pumps' strokes, the surgeon's and the carpenter's work. */
const SWORDS_EVERY = [0.8, 1.6];
const PUMP_EVERY = 3.6;
const HEAL_EVERY = 4.5;
const HAMMER_EVERY = 1.6;

/**
 * The sound of a battle: what each event sounds like and where it sits in stereo (our ship on the left, hers on the
 * right), and the sounds of things the events don't announce, watched for each frame: fires put out, rooms swamped,
 * stations wrecked or mended, cutlasses in a melee, the pumps, the surgeon.
 */
export class BattleSounds {
  private readonly burning = new Map<string, boolean>();
  private readonly swamped = new Map<string, boolean>();
  private readonly damage = new Map<string, number>();
  private readonly hp = new Map<number, number>();
  private next = { swords: 0, pump: 0, heal: 0, hammer: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly battle: Battle,
    private readonly view: Views,
  ) {
    this.watch(0, true);
  }

  private x(side: Side, room: string): number {
    const v = this.view(side);
    return v.ship.rooms.has(room) ? v.roomCenter(room).x : side === 'player' ? 320 : 960;
  }

  private play(name: string | string[], volume: number, x?: number, delay = 0): void {
    if (delay > 0) this.scene.time.delayedCall(delay, () => playSfx(this.scene, name, { volume, x }));
    else playSfx(this.scene, name, { volume, x });
  }

  /** A battle event's sound. */
  event(ev: BattleEvent): void {
    const ours = ev.side === 'player';
    switch (ev.t) {
      case 'shot': {
        const view = this.view(ev.side);
        const def = view.ship.guns[ev.gun]?.def;
        const x = view.muzzle(ev.gun).x;
        const v = ours ? 0.55 : 0.4;
        if (def?.id === 'swivel') this.play('musket', v * 0.8, x);
        else this.play(def && def.damage >= 3 ? ['cannon-heavy', 'cannon'] : 'cannon', v, x);
        // Chain whirs and hot shot hisses on its way; grape rattles when it lands.
        if (ev.shot === 'chain') this.play('chain', v * 0.7, x + (ours ? 160 : -160), 90);
        else if (ev.shot === 'hot') this.play('hotshot', v * 0.7, x, 60);
        break;
      }
      case 'hit': {
        const x = this.x(ev.side, ev.room);
        if (ev.deflected) this.play('hit-wood', 0.25, x);
        else {
          this.play('hit-wood', ours ? 0.6 : 0.4, x);
          if (ev.shot === 'grape') this.play('grape', ours ? 0.5 : 0.35, x);
        }
        break;
      }
      case 'block':
        this.play('hit-wood', 0.2, this.x(ev.side, ev.room));
        break;
      case 'miss':
        this.play('splash', 0.35, this.x(ev.side, ev.room));
        break;
      case 'fire':
        this.play('fire', 0.9, this.x(ev.side, ev.room));
        break;
      case 'breach': {
        const x = this.x(ev.side, ev.room);
        this.play('breach', ours ? 0.55 : 0.35, x);
        if (ours) this.play('flood', 0.35, x, 450);
        break;
      }
      case 'board': {
        // Hooks bite, a roar, muskets, then steel.
        this.play('grapple', 0.5, 640);
        this.play('boarders', 0.5, ours ? 900 : 380, 200);
        this.play('musket', 0.4, 640, 450);
        this.play('swords', 0.45, ours ? 900 : 380, 1000);
        break;
      }
      case 'order':
        if (ours) {
          this.play(ev.order === 'sail' ? 'sail' : ev.order === 'steel' ? 'musket' : 'bell', 0.45, 320);
          if (ev.order === 'steel') this.play('swords', 0.4, 640, 250);
        } else this.play(ev.order === 'sail' ? 'sail' : 'bell', 0.3, 960);
        break;
      case 'crit': {
        const x = this.x(ev.side, ev.room);
        if (ev.kind === 'magazine' || ev.kind === 'powder') this.play('explosion', ev.kind === 'magazine' ? 0.7 : 0.45, x);
        else this.play(ev.kind === 'waterline' ? 'breach' : 'hit-wood', 0.6, x);
        this.play('crit', ours ? 0.6 : 0.45, x);
        if (ev.kind === 'mast') this.play('mast', 0.6, x, 180);
        if (ev.kind === 'waterline') this.play('flood', 0.5, x, 300);
        break;
      }
      case 'consort':
        // Our consort fires from beyond her far side.
        this.play('cannon', 0.35, 1280);
        break;
      case 'consortHit':
        this.play('hit-wood', 0.3, 1280);
        break;
      case 'consortSunk':
        this.play('sink', 0.5, 1280);
        break;
      case 'rally':
        this.play('bell', 0.6, 960);
        break;
    }
  }

  /** Watch for what the events don't announce. `now` in seconds. */
  update(now: number): void {
    if (this.battle.outcome) return;
    this.watch(now, false);
  }

  private watch(now: number, quiet: boolean): void {
    for (const side of ['player', 'enemy'] as const) {
      const ship = this.battle.ships[side];
      const ours = side === 'player';
      for (const room of ship.rooms.values()) {
        const key = `${side}:${room.def.id}`;
        const fire = room.fire > 0;
        // Put out (not burnt out with the room swamped: that is the flood's sound).
        if (!quiet && this.burning.get(key) && !fire) this.play('hiss', ours ? 0.45 : 0.25, this.x(side, room.def.id));
        this.burning.set(key, fire);
        const wet = room.water >= SWAMP_LEVEL;
        if (!quiet && wet && !this.swamped.get(key)) this.play('flood', ours ? 0.45 : 0.3, this.x(side, room.def.id));
        this.swamped.set(key, wet);
      }
      for (const sys of ship.systems.values()) {
        const key = `${side}:${sys.id}`;
        const was = this.damage.get(key) ?? sys.damage;
        // A station wrecked outright; ours mended a point.
        if (!quiet && sys.max > 0 && sys.damage >= sys.max && was < sys.max) this.play('mast', ours ? 0.55 : 0.4, this.x(side, sys.room), 120);
        if (!quiet && ours && sys.damage < was && now >= this.next.hammer) {
          this.next.hammer = now + HAMMER_EVERY;
          this.play('hammer', 0.35, this.x(side, sys.room));
        }
        this.damage.set(key, sys.damage);
      }
    }
    if (quiet) {
      for (const c of this.battle.player.own()) this.hp.set(c.id, c.hp);
      return;
    }
    this.melee(now);
    this.pumps(now);
    this.surgeon(now);
  }

  /** Cutlasses clash wherever crews are fighting hand to hand. */
  private melee(now: number): void {
    if (now < this.next.swords) return;
    for (const side of ['player', 'enemy'] as const) {
      const fighter = this.battle.ships[side].crew.find((c) => c.task === 'fight' && c.hp > 0);
      if (!fighter) continue;
      const [lo, hi] = SWORDS_EVERY;
      this.next.swords = now + lo + Math.random() * (hi - lo);
      this.play('swords', side === 'player' ? 0.4 : 0.3, this.view(side).toScreen(fighter.pos).x);
      return;
    }
  }

  /** The pumps at work while our ship has water in her and hands on them. */
  private pumps(now: number): void {
    const ship: Ship = this.battle.player;
    const pumps = ship.system('pumps');
    if (!pumps || now < this.next.pump || ship.level('pumps') <= 0) return;
    if (![...ship.rooms.values()].some((r) => r.water > 5)) return;
    this.next.pump = now + PUMP_EVERY;
    this.play('pump', 0.22, this.x('player', pumps.room));
  }

  /** The surgeon mending one of ours. */
  private surgeon(now: number): void {
    const ship = this.battle.player;
    const room = ship.system('surgeon')?.room;
    let mended = false;
    for (const c of ship.own()) {
      const was = this.hp.get(c.id) ?? c.hp;
      if (room && c.room === room && c.hp > was + 0.01) mended = true;
      this.hp.set(c.id, c.hp);
    }
    if (mended && now >= this.next.heal) {
      this.next.heal = now + HEAL_EVERY;
      this.play('heal', 0.3, this.x('player', room!));
    }
  }
}
