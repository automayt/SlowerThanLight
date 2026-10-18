import { describe, expect, it } from 'vitest';
import { CoopServer } from '../../server/CoopServer';
import { PROTOCOL_VERSION, type ClientMessage, type CrewState, type ServerMessage } from '../../src/net/protocol';
import { applyVoyage, voyageCheck } from '../../src/sim/commands';
import { Run } from '../../src/sim/Run';

/** A pretend player: a connection that records what the server sends. */
function player(server: CoopServer, name: string) {
  const inbox: ServerMessage[] = [];
  const link = server.connect({ send: (m) => inbox.push(JSON.parse(JSON.stringify(m))) });
  const send = (m: ClientMessage) => link.message(JSON.parse(JSON.stringify(m)));
  send({ t: 'hello', version: PROTOCOL_VERSION, name });
  const last = <T extends ServerMessage['t']>(t: T) => [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  return { inbox, send, last, close: link.close, crew: () => last('crew')?.crew as CrewState };
}

function crewOf(server: CoopServer) {
  const a = player(server, 'Anne');
  a.send({ t: 'create' });
  const b = player(server, 'Mary');
  b.send({ t: 'join', code: a.crew().code });
  return { a, b };
}

describe('co-op server', () => {
  it('gathers a crew: the founder captains, a newcomer takes a job off them', () => {
    const { a, b } = crewOf(new CoopServer());
    const members = b.crew().members;
    expect(members.map((m) => m.name)).toEqual(['Anne', 'Mary']);
    expect(members[0].roles).toEqual(['captain', 'gunner']);
    expect(members[1].roles).toEqual(['bosun']);
    expect(a.crew().code).toBe(b.crew().code);
  });

  it('roles move between players, but a captain aboard keeps the helm', () => {
    const { a, b } = crewOf(new CoopServer());
    b.send({ t: 'roles', roles: ['bosun', 'gunner', 'captain'] });
    expect(b.crew().members[1].roles).toEqual(['gunner', 'bosun']);
    expect(b.crew().members[0].roles).toEqual(['captain']);
    a.send({ t: 'roles', roles: [] });
    // A captain stepping down hands the ship over.
    expect(a.crew().members[1].roles).toContain('captain');
  });

  it('only the captain steers the voyage, and every member gets the command to replay', () => {
    const { a, b } = crewOf(new CoopServer());
    a.send({ t: 'setup', ship: 'wren', difficulty: 'easy' });
    a.send({ t: 'start' });
    const save = b.last('voyageSync')!.save;
    const copy = Run.fromSave(save);
    expect(copy.def.id).toBe('wren');
    const node = copy.reachable()[0].id;
    b.send({ t: 'voyage', cmd: { t: 'jump', node } });
    expect(b.last('error')?.text).toMatch(/captain/);
    a.send({ t: 'voyage', cmd: { t: 'jump', node } });
    const relayed = b.last('voyage')!;
    applyVoyage(copy, relayed.cmd);
    expect(voyageCheck(copy)).toBe(relayed.check);
  });

  it('suggestions reach the whole crew', () => {
    const { a, b } = crewOf(new CoopServer());
    b.send({ t: 'suggest', label: 'Make for Nassau' });
    expect(a.last('suggest')).toEqual({ t: 'suggest', by: 'Mary', label: 'Make for Nassau' });
  });

  it('runs the battle: orders are checked by role, the mate covers empty roles, and the end brings the voyage back', () => {
    const server = new CoopServer();
    const { a, b } = crewOf(server);
    a.send({ t: 'start' });
    // Sail until a ship is sighted, and fight her.
    for (let guard = 0; guard < 60; guard++) {
      const run = Run.fromSave(a.last('battleEnd')?.save ?? a.last('voyageSync')!.save);
      // Replay everything since the last full copy, as a client would.
      const since = a.inbox.lastIndexOf(a.last('battleEnd') ?? a.last('voyageSync')!);
      for (const m of a.inbox.slice(since + 1)) if (m.t === 'voyage') applyVoyage(run, m.cmd);
      if (run.status === 'battle') break;
      const cmd =
        run.status === 'hail'
          ? ({ t: 'hail', id: 'attack' } as const)
          : run.status === 'event'
            ? ({ t: 'choose', index: run.currentEvent().choices.findIndex((_, i) => run.canChoose(i)) } as const)
            : run.status === 'port'
              ? ({ t: 'leavePort' } as const)
              : ({ t: 'jump', node: run.reachable().find((n) => !run.isLateral(n))!.id } as const);
      a.send({ t: 'voyage', cmd });
    }
    expect(b.last('battleStart')).toBeTruthy();
    const snap = b.last('battle')!.snap;
    expect(snap.paused).toBe(true);
    // The bosun's work is Mary's; Anne (captain and gunner) may not order the crew about.
    const crewId = snap.player.crew[0].id;
    a.send({ t: 'battle', cmd: { t: 'crew', ids: [crewId], room: 'pumps', ship: 'player' } });
    expect(a.last('error')?.text).toMatch(/bosun/);
    // Mary goes ashore: the mate takes over her work. Anne lets the mate have the guns too, and engages.
    b.close();
    a.send({ t: 'roles', roles: ['captain'] });
    a.send({ t: 'battle', cmd: { t: 'pause', on: false } });
    for (let i = 0; i < 20 * 900 && !a.last('battleEnd'); i++) server.tick();
    const end = a.last('battleEnd')!;
    expect(end).toBeTruthy();
    expect(['victory', 'surrender', 'enemySunk', 'captured', 'enemyEscaped', 'defeat', 'sunk', 'crewLost', 'escaped']).toContain(end.report.kind);
    expect(Run.fromSave(end.save).status).not.toBe('battle');
  });

  it('a player who comes back with their token rejoins their crew', () => {
    const server = new CoopServer();
    const { a } = crewOf(server);
    const token = a.last('welcome')!.token;
    a.close();
    const again = player(server, 'Anne');
    // A fresh hello without the token is a new sailor...
    expect(again.last('crew')).toBeUndefined();
    const back: ServerMessage[] = [];
    const link = server.connect({ send: (m) => back.push(m) });
    link.message({ t: 'hello', version: PROTOCOL_VERSION, name: 'Anne', token });
    expect(back.some((m) => m.t === 'crew' && m.crew?.members.some((x) => x.name === 'Anne' && x.online))).toBe(true);
  });
});
