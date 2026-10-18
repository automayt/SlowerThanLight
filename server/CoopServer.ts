import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAYER_SHIPS } from '../src/data/ships';
import { PROTOCOL_VERSION, type ClientMessage, type CrewState, type CrewSummary, type Member, type ServerMessage } from '../src/net/protocol';
import { Battle } from '../src/sim/Battle';
import { applyBattle, applyVoyage, battleRole, mateDuties, ROLE_NAMES, ROLES, voyageAllowed, voyageCheck, type Role } from '../src/sim/commands';
import { Run, type BattleSetup, type Difficulty, type RunSave } from '../src/sim/Run';
import { battleSnapshot } from '../src/sim/snapshot';

/** One end of a connection: the socket in production, a stub in tests. */
export interface Conn {
  send(msg: ServerMessage): void;
}

interface Player {
  id: string;
  token: string;
  name: string;
  conn: Conn | null;
  crew: string | null;
}

interface Crew {
  code: string;
  /** Members by player id, with the roles each holds. */
  members: Map<string, Set<Role>>;
  ship: string;
  difficulty: Difficulty;
  phase: CrewState['phase'];
  run: Run | null;
  battle: Battle | null;
  setup: BattleSetup | null;
  /** Ticks since the last snapshot went out, and whether an order changed the battle since. */
  quiet: number;
  dirty: boolean;
}

/** What a crew's file on disk holds. */
interface CrewFile {
  code: string;
  ship: string;
  difficulty: Difficulty;
  phase: CrewState['phase'];
  members: { id: string; token: string; name: string; roles: Role[] }[];
  save: RunSave | null;
}

/** Simulation step the server ticks battles by, and how often a paused battle still sends a snapshot (in ticks). */
export const TICK = 0.05;
const PAUSED_SNAPSHOT_EVERY = 5;

/**
 * The co-op game server: players gather into crews that share one ship. The captain decides the voyage, which every
 * member's game replays command by command; battles run here and go out as snapshots. Roles nobody holds fall to an
 * AI first mate. Crews are saved to disk, so a voyage survives a restart.
 */
export class CoopServer {
  private readonly players = new Map<string, Player>();
  private readonly crews = new Map<string, Crew>();

  constructor(private readonly saveDir: string | null = null) {
    if (saveDir) this.load();
  }

  // --- Connections ------------------------------------------------------------

  /** A new connection: returns what to call with its messages and when it closes. */
  connect(conn: Conn): { message: (msg: ClientMessage) => void; close: () => void } {
    let player: Player | null = null;
    return {
      message: (msg) => {
        if (msg.t === 'hello') {
          player = this.hello(conn, msg);
          return;
        }
        if (!player) return conn.send({ t: 'error', text: 'Say hello first.' });
        this.handle(player, msg);
      },
      close: () => {
        if (!player || player.conn !== conn) return;
        player.conn = null;
        const crew = player.crew ? this.crews.get(player.crew) : null;
        if (crew) this.membersChanged(crew, `${player.name} has gone ashore.`);
      },
    };
  }

  private hello(conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): Player | null {
    if (msg.version !== PROTOCOL_VERSION) {
      conn.send({ t: 'error', text: 'This game is a different version from the server. Reload the page.' });
      return null;
    }
    const known = msg.token ? [...this.players.values()].find((p) => p.token === msg.token) : undefined;
    const player = known ?? { id: randomUUID(), token: randomBytes(16).toString('hex'), name: '', conn: null, crew: null };
    // A second tab with the same token takes over the player.
    player.conn?.send({ t: 'notice', text: 'You have joined from another window.' });
    player.conn = conn;
    player.name = cleanName(msg.name) || player.name || 'Sailor';
    this.players.set(player.id, player);
    conn.send({ t: 'welcome', id: player.id, token: player.token, name: player.name });
    const crew = player.crew ? this.crews.get(player.crew) : null;
    if (crew) {
      this.membersChanged(crew, `${player.name} is back aboard.`);
      this.catchUp(crew, player);
    } else conn.send({ t: 'crews', crews: this.summaries() });
    return player;
  }

  private handle(player: Player, msg: ClientMessage): void {
    const crew = player.crew ? this.crews.get(player.crew) ?? null : null;
    const roles = crew?.members.get(player.id) ?? new Set<Role>();
    const fail = (text: string) => player.conn?.send({ t: 'error', text });
    switch (msg.t) {
      case 'create': {
        this.leave(player);
        const created = this.newCrew();
        created.members.set(player.id, new Set(ROLES));
        player.crew = created.code;
        this.membersChanged(created);
        this.broadcastCrews();
        return;
      }
      case 'join': {
        const target = this.crews.get(msg.code.toUpperCase());
        if (!target || target.phase === 'over') return fail('No crew sails under that name.');
        if (crew === target) return;
        this.leave(player);
        player.crew = target.code;
        target.members.set(player.id, new Set());
        this.giveRole(target, player.id);
        this.membersChanged(target, `${player.name} signs the articles.`);
        this.catchUp(target, player);
        this.broadcastCrews();
        return;
      }
      case 'leave':
        this.leave(player);
        player.conn?.send({ t: 'crew', crew: null });
        player.conn?.send({ t: 'crews', crews: this.summaries() });
        return;
      case 'roles':
        if (!crew) return;
        this.setRoles(crew, player, msg.roles);
        return;
      case 'setup':
        if (!crew || crew.phase !== 'lobby') return;
        if (!roles.has('captain')) return fail('Only the captain chooses the ship.');
        if (!PLAYER_SHIPS.some((s) => s.id === msg.ship)) return fail('No such ship.');
        crew.ship = msg.ship;
        crew.difficulty = msg.difficulty;
        this.membersChanged(crew);
        this.broadcastCrews();
        return;
      case 'start':
        if (!crew || crew.phase !== 'lobby') return;
        if (!roles.has('captain')) return fail('Only the captain can weigh anchor.');
        crew.run = new Run(crew.ship, undefined, crew.difficulty);
        crew.phase = 'voyage';
        this.persist(crew);
        this.membersChanged(crew);
        this.toCrew(crew, { t: 'voyageSync', save: crew.run.toSave() });
        this.broadcastCrews();
        return;
      case 'voyage': {
        const run = crew?.run;
        if (!crew || !run || crew.phase !== 'voyage') return;
        if (!roles.has('captain')) return fail('The captain decides that.');
        if (crew.battle || !voyageAllowed(run, msg.cmd)) return fail('That cannot be done now.');
        applyVoyage(run, msg.cmd);
        this.toCrew(crew, { t: 'voyage', cmd: msg.cmd, by: player.name, check: voyageCheck(run) });
        if (run.over) crew.phase = 'over';
        this.persist(crew);
        if (run.over) this.membersChanged(crew);
        else if (run.status === 'battle') this.beginBattle(crew);
        return;
      }
      case 'suggest':
        if (crew) this.toCrew(crew, { t: 'suggest', by: player.name, label: String(msg.label).slice(0, 120) });
        return;
      case 'battle': {
        const battle = crew?.battle;
        if (!crew || !battle || battle.outcome) return;
        const need = battleRole(msg.cmd);
        if (need && !roles.has(need)) return fail(`That is the ${ROLE_NAMES[need].toLowerCase()}'s order to give.`);
        applyBattle(battle, msg.cmd);
        crew.dirty = true;
        return;
      }
      case 'sync':
        if (crew) this.catchUp(crew, player);
        return;
    }
  }

  // --- Crews and roles ----------------------------------------------------------

  private newCrew(): Crew {
    let code = '';
    do code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
    while (this.crews.has(code));
    const crew: Crew = { code, members: new Map(), ship: 'gull', difficulty: 'normal', phase: 'lobby', run: null, battle: null, setup: null, quiet: 0, dirty: false };
    this.crews.set(code, crew);
    return crew;
  }

  private leave(player: Player): void {
    const crew = player.crew ? this.crews.get(player.crew) : null;
    player.crew = null;
    if (!crew) return;
    const roles = crew.members.get(player.id) ?? new Set<Role>();
    crew.members.delete(player.id);
    // Their roles go to whoever is still aboard (the captain's first), or the mate.
    const heir = this.online(crew)[0];
    if (heir && roles.has('captain')) crew.members.get(heir)!.add('captain');
    if (!crew.members.size && crew.phase !== 'voyage') {
      this.crews.delete(crew.code);
      this.unpersist(crew);
    } else this.membersChanged(crew, `${player.name} has left the crew.`);
    this.broadcastCrews();
  }

  /** A newcomer takes a job off whoever holds more than one, the bosun's first, never the captain's. */
  private giveRole(crew: Crew, id: string): void {
    for (const role of ['bosun', 'gunner'] as Role[]) {
      const holder = [...crew.members].find(([other, r]) => other !== id && r.has(role) && r.size > 1);
      const free = ![...crew.members.values()].some((r) => r.has(role));
      if (free || holder) {
        holder?.[1].delete(role);
        crew.members.get(id)!.add(role);
        return;
      }
    }
  }

  /** Take up exactly these roles. Another's role moves to you, except a captaincy whose captain is aboard. */
  private setRoles(crew: Crew, player: Player, wanted: Role[]): void {
    const mine = crew.members.get(player.id)!;
    const want = new Set(wanted.filter((r) => ROLES.includes(r)));
    if (mine.has('captain') && !want.has('captain') && !this.online(crew).some((id) => id !== player.id)) want.add('captain');
    for (const role of want) {
      const holder = [...crew.members].find(([id, r]) => id !== player.id && r.has(role));
      if (role === 'captain' && holder && this.players.get(holder[0])?.conn) continue;
      holder?.[1].delete(role);
      mine.add(role);
    }
    for (const role of [...mine]) {
      if (want.has(role)) continue;
      mine.delete(role);
      // A captain stepping down hands the ship to someone aboard.
      if (role === 'captain') {
        const heir = this.online(crew).find((id) => id !== player.id);
        if (heir) crew.members.get(heir)!.add('captain');
        else mine.add('captain');
      }
    }
    this.membersChanged(crew);
  }

  private online(crew: Crew): string[] {
    return [...crew.members.keys()].filter((id) => this.players.get(id)?.conn);
  }

  /** After anyone joins, leaves, drops or changes jobs: keep a captain aboard, re-crew the mate, tell everyone. */
  private membersChanged(crew: Crew, notice?: string): void {
    const aboard = this.online(crew);
    const captain = [...crew.members].find(([, r]) => r.has('captain'))?.[0];
    if (aboard.length && (!captain || !aboard.includes(captain))) {
      if (captain) crew.members.get(captain)!.delete('captain');
      crew.members.get(aboard[0])!.add('captain');
    }
    if (crew.battle) {
      const held = aboard.flatMap((id) => [...crew.members.get(id)!]);
      crew.battle.setMate(mateDuties(held));
      // With nobody aboard, the battle waits for them.
      if (!aboard.length) crew.battle.paused = true;
      crew.dirty = true;
    }
    if (crew.run?.status === 'battle' && !crew.battle && aboard.length) this.beginBattle(crew);
    const state = this.crewState(crew);
    this.toCrew(crew, { t: 'crew', crew: state });
    if (notice) this.toCrew(crew, { t: 'notice', text: notice });
    this.persist(crew);
  }

  private crewState(crew: Crew): CrewState {
    const members: Member[] = [...crew.members].map(([id, roles]) => {
      const p = this.players.get(id);
      return { id, name: p?.name ?? 'Sailor', roles: ROLES.filter((r) => roles.has(r)), online: !!p?.conn };
    });
    return { code: crew.code, members, ship: crew.ship, difficulty: crew.difficulty, phase: crew.phase };
  }

  /** Bring one player's game up to date: the crew, the voyage, and any battle in progress. */
  private catchUp(crew: Crew, player: Player): void {
    const send = (m: ServerMessage) => player.conn?.send(m);
    send({ t: 'crew', crew: this.crewState(crew) });
    if (!crew.run) return;
    send({ t: 'voyageSync', save: crew.run.toSave() });
    if (crew.battle && crew.setup) {
      send({ t: 'battleStart', setup: crew.setup });
      send({ t: 'battle', snap: battleSnapshot(crew.battle), events: [] });
    }
  }

  summaries(): CrewSummary[] {
    return [...this.crews.values()]
      .filter((c) => c.phase !== 'over')
      .map((c) => {
        const captain = [...c.members].find(([, r]) => r.has('captain'))?.[0];
        return {
          code: c.code,
          captain: (captain && this.players.get(captain)?.name) || '—',
          ship: PLAYER_SHIPS.find((s) => s.id === c.ship)?.name ?? c.ship,
          players: c.members.size,
          online: this.online(c).length,
          sailing: c.phase === 'voyage',
        };
      });
  }

  private broadcastCrews(): void {
    const crews = this.summaries();
    for (const p of this.players.values()) if (!p.crew) p.conn?.send({ t: 'crews', crews });
  }

  private toCrew(crew: Crew, msg: ServerMessage): void {
    for (const id of crew.members.keys()) this.players.get(id)?.conn?.send(msg);
  }

  // --- Battles ------------------------------------------------------------------

  private beginBattle(crew: Crew): void {
    const run = crew.run!;
    crew.setup = run.battleSetup();
    const battle = new Battle(crew.setup.player, crew.setup.enemy, crew.setup.options);
    // Every battle opens paused, so the crew can look her over and give orders first.
    battle.paused = true;
    crew.battle = battle;
    const held = this.online(crew).flatMap((id) => [...crew.members.get(id)!]);
    battle.setMate(mateDuties(held));
    this.toCrew(crew, { t: 'battleStart', setup: crew.setup });
    this.toCrew(crew, { t: 'battle', snap: battleSnapshot(battle), events: battle.drainEvents() });
  }

  /** Advance every battle one tick and send what changed. */
  tick(): void {
    for (const crew of this.crews.values()) {
      const battle = crew.battle;
      if (!battle) continue;
      if (!battle.paused) battle.update(TICK * battle.speed);
      const events = battle.drainEvents();
      crew.quiet++;
      if (!battle.paused || events.length || crew.dirty || crew.quiet >= PAUSED_SNAPSHOT_EVERY || battle.outcome) {
        this.toCrew(crew, { t: 'battle', snap: battleSnapshot(battle), events });
        crew.quiet = 0;
        crew.dirty = false;
      }
      if (battle.outcome) this.endBattle(crew);
    }
  }

  private endBattle(crew: Crew): void {
    const run = crew.run!;
    const report = run.finishBattle(crew.battle!);
    crew.battle = null;
    crew.setup = null;
    if (run.over) crew.phase = 'over';
    this.toCrew(crew, { t: 'battleEnd', report, save: run.toSave() });
    this.persist(crew);
    if (run.over) this.membersChanged(crew);
  }

  // --- Saving -----------------------------------------------------------------------

  private file(crew: Crew): string | null {
    return this.saveDir && join(this.saveDir, `${crew.code}.json`);
  }

  private persist(crew: Crew): void {
    const file = this.file(crew);
    if (!file) return;
    const data: CrewFile = {
      code: crew.code,
      ship: crew.ship,
      difficulty: crew.difficulty,
      phase: crew.phase,
      members: [...crew.members].map(([id, roles]) => ({ id, token: this.players.get(id)?.token ?? '', name: this.players.get(id)?.name ?? 'Sailor', roles: [...roles] })),
      save: crew.run?.toSave() ?? null,
    };
    try {
      mkdirSync(this.saveDir!, { recursive: true });
      writeFileSync(file, JSON.stringify(data));
    } catch (e) {
      console.error(`Could not save crew ${crew.code}:`, e);
    }
  }

  private unpersist(crew: Crew): void {
    const file = this.file(crew);
    if (file && existsSync(file)) rmSync(file);
  }

  /** Crews saved by an earlier run of the server, with their members as players waiting to reconnect. */
  private load(): void {
    if (!this.saveDir || !existsSync(this.saveDir)) return;
    for (const name of readdirSync(this.saveDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const data = JSON.parse(readFileSync(join(this.saveDir, name), 'utf8')) as CrewFile;
        if (data.phase === 'over') continue;
        const crew: Crew = {
          code: data.code,
          members: new Map(),
          ship: data.ship,
          difficulty: data.difficulty,
          phase: data.phase,
          run: data.save ? Run.fromSave(data.save) : null,
          battle: null,
          setup: null,
          quiet: 0,
          dirty: false,
        };
        for (const m of data.members) {
          crew.members.set(m.id, new Set(m.roles));
          if (!this.players.has(m.id)) this.players.set(m.id, { id: m.id, token: m.token, name: m.name, conn: null, crew: crew.code });
        }
        this.crews.set(crew.code, crew);
      } catch (e) {
        console.error(`Skipping unreadable crew save ${name}:`, e);
      }
    }
  }
}

function cleanName(name: unknown): string {
  return String(name ?? '')
    .replace(/[^\p{L}\p{N} '\-]/gu, '')
    .trim()
    .slice(0, 20);
}
