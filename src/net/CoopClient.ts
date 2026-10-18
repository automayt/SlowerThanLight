import { Battle } from '../sim/Battle';
import type { Role } from '../sim/commands';
import { Run, type BattleReport } from '../sim/Run';
import { applySnapshot } from '../sim/snapshot';
import { PROTOCOL_VERSION, type ClientMessage, type CrewState, type CrewSummary, type ServerMessage } from './protocol';

const TOKEN_KEY = 'slower-than-light.coop.token';
const NAME_KEY = 'slower-than-light.coop.name';

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the player rejoins as a new sailor after a reload.
  }
}

export type CoopStatus = 'connecting' | 'open' | 'closed';

/**
 * This browser's side of a co-op crew: the connection to the server, the crew and its roles, and live copies of the
 * shared voyage and battle that the server's messages keep in step. Scenes read from it; the co-op director (see
 * CoopDirector) turns its messages into scene changes.
 */
export class CoopClient {
  status: CoopStatus = 'connecting';
  id = '';
  name = stored(NAME_KEY) || 'Sailor';
  crews: CrewSummary[] = [];
  crew: CrewState | null = null;
  run: Run | null = null;
  battle: Battle | null = null;
  /** How the last battle ended, until the battle screen takes it. */
  report: BattleReport | null = null;
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<(m: ServerMessage) => void>();
  private retry = 0;
  private closedByUs = false;

  constructor() {
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.status = 'connecting';
    ws.onopen = () => {
      this.retry = 0;
      this.status = 'open';
      this.send({ t: 'hello', version: PROTOCOL_VERSION, name: this.name, token: stored(TOKEN_KEY) || undefined });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      this.status = 'closed';
      this.emit({ t: 'notice', text: 'Lost touch with the server…' });
      // Reconnect, backing off; the server keeps our place in the crew.
      if (!this.closedByUs) setTimeout(() => this.open(), Math.min(5000, 500 * 2 ** this.retry++));
    };
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(fn: (m: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(m: ServerMessage): void {
    for (const fn of [...this.listeners]) fn(m);
  }

  setName(name: string): void {
    this.name = name.trim().slice(0, 20) || 'Sailor';
    store(NAME_KEY, this.name);
    this.send({ t: 'hello', version: PROTOCOL_VERSION, name: this.name, token: stored(TOKEN_KEY) || undefined });
  }

  /** Roles this player holds in their crew. */
  get roles(): Role[] {
    return this.crew?.members.find((m) => m.id === this.id)?.roles ?? [];
  }

  has(role: Role): boolean {
    return this.roles.includes(role);
  }

  /** Who holds a role (a player's name), or null when the AI mate has it. */
  holder(role: Role): string | null {
    return this.crew?.members.find((m) => m.online && m.roles.includes(role))?.name ?? null;
  }

  private receive(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.name = m.name;
        store(TOKEN_KEY, m.token);
        break;
      case 'crews':
        this.crews = m.crews;
        break;
      case 'crew':
        this.crew = m.crew;
        if (!m.crew) {
          this.run = null;
          this.battle = null;
        }
        break;
      case 'voyageSync':
        this.run = Run.fromSave(m.save);
        break;
      case 'battleStart': {
        const b = new Battle(m.setup.player, m.setup.enemy, m.setup.options);
        b.remote = true;
        this.battle = b;
        this.report = null;
        break;
      }
      case 'battle':
        if (this.battle) applySnapshot(this.battle, m.snap, m.events);
        break;
      case 'battleEnd':
        this.report = m.report;
        this.run = Run.fromSave(m.save);
        break;
    }
    this.emit(m);
  }
}

let client: CoopClient | null = null;

/** The co-op link, or null when playing alone. */
export function coop(): CoopClient | null {
  return client;
}

export function startCoop(): CoopClient {
  client ??= new CoopClient();
  return client;
}

export function endCoop(): void {
  client?.send({ t: 'leave' });
  client?.close();
  client = null;
}
