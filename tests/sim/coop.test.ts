import { describe, expect, it } from 'vitest';
import { Battle } from '../../src/sim/Battle';
import { applyBattle, applyVoyage, battleRole, mateDuties, voyageAllowed, voyageCheck, type VoyageCommand } from '../../src/sim/commands';
import { Run } from '../../src/sim/Run';
import { applySnapshot, battleSnapshot } from '../../src/sim/snapshot';

/** A battle as a server would run it, and a client's copy built from the same setup. */
function pair(seed = 5) {
  const run = new Run('gull', seed);
  run.encounter = { kind: 'battle', enemy: 'privateer', name: 'The Test', boss: false, ambush: false, text: '' };
  run.status = 'battle';
  const setup = JSON.parse(JSON.stringify(run.battleSetup()));
  const server = new Battle(setup.player, setup.enemy, setup.options);
  const client = new Battle(setup.player, setup.enemy, setup.options);
  client.remote = true;
  return { server, client };
}

describe('co-op battle snapshots', () => {
  it('a copy brought up to a snapshot matches the battle it came from', () => {
    const { server, client } = pair();
    server.setMate({ guns: true, hands: true, crew: true });
    for (let i = 0; i < 400; i++) {
      server.step(0.05);
      if (i % 37 === 0) applySnapshot(client, JSON.parse(JSON.stringify(battleSnapshot(server))));
    }
    applySnapshot(client, JSON.parse(JSON.stringify(battleSnapshot(server))));
    expect(battleSnapshot(client)).toEqual(battleSnapshot(server));
  });

  it('keeps crew objects by id, so views that hold them stay valid', () => {
    const { server, client } = pair();
    applySnapshot(client, battleSnapshot(server));
    const held = client.player.crew[0];
    server.step(0.05);
    server.player.crew[0].hp = 42;
    applySnapshot(client, battleSnapshot(server));
    expect(client.player.crew[0]).toBe(held);
    expect(held.hp).toBe(42);
  });

  it('a copy never steps itself, and the events sent with a snapshot come out of it', () => {
    const { client } = pair();
    const t = client.time;
    client.update(1);
    expect(client.time).toBe(t);
    applySnapshot(client, battleSnapshot(client), [{ t: 'log', side: 'player', text: 'hello' }]);
    expect(client.drainEvents()).toEqual([{ t: 'log', side: 'player', text: 'hello' }]);
  });
});

describe('roles and the AI mate', () => {
  it('each order belongs to one role, and anyone may pause', () => {
    expect(battleRole({ t: 'aim', gun: 0, room: null })).toBe('gunner');
    expect(battleRole({ t: 'crew', ids: [], room: 'helm', ship: 'player' })).toBe('bosun');
    expect(battleRole({ t: 'escape' })).toBe('captain');
    expect(battleRole({ t: 'pause', on: true })).toBeNull();
  });

  it('the mate takes the work of every role nobody holds, never the captain’s', () => {
    expect(mateDuties(['captain'])).toEqual({ guns: true, hands: true, crew: true });
    expect(mateDuties(['captain', 'gunner'])).toEqual({ hands: true, crew: true });
    expect(mateDuties(['captain', 'gunner', 'bosun'])).toEqual({});
  });

  it('a mate on the guns aims them and leaves the crew where the bosun put them', () => {
    const { server: b } = pair(9);
    b.setMate({ guns: true });
    const where = b.player.crew.map((c) => c.room);
    const helm = b.player.crew.find((c) => c.room === 'helm')!;
    applyBattle(b, { t: 'crew', ids: [helm.id], room: 'pumps', ship: 'player' });
    for (let i = 0; i < 40; i++) b.step(0.05);
    expect(b.player.guns.some((g) => g.target)).toBe(true);
    expect(b.player.crew.filter((c) => c !== helm).map((c) => c.room)).toEqual(where.filter((_, i) => b.player.crew[i] !== helm));
  });

  it('applies battle orders like the controls do', () => {
    const { server: b } = pair();
    applyBattle(b, { t: 'aim', gun: 0, room: 'helm' });
    expect(b.player.guns[0].target).toBe('helm');
    applyBattle(b, { t: 'shot', gun: 0, shot: 'chain' });
    expect(b.player.guns[0].shot).toBe('chain');
    applyBattle(b, { t: 'speed', speed: 2 });
    expect(b.speed).toBe(2);
    applyBattle(b, { t: 'pause', on: true });
    expect(b.paused).toBe(true);
  });
});

describe('co-op voyages', () => {
  it('every copy of a voyage given the same commands stays in step with the server’s', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const server = new Run('gull', seed);
      let client = Run.fromSave(JSON.parse(JSON.stringify(server.toSave())));
      for (let guard = 0; guard < 80 && !server.over; guard++) {
        if (server.status === 'battle') {
          const b = server.startBattle({ autoPlayer: true });
          b.runToEnd(900);
          if (!b.outcome) break;
          server.finishBattle(b);
          // The battle is the server's: afterwards every client takes its voyage whole.
          client = Run.fromSave(JSON.parse(JSON.stringify(server.toSave())));
          continue;
        }
        const cmd = pick(server);
        expect(voyageAllowed(server, cmd)).toBe(true);
        const wire = JSON.parse(JSON.stringify(cmd)) as VoyageCommand;
        applyVoyage(server, cmd);
        applyVoyage(client, wire);
        expect(voyageCheck(client), `seed ${seed} step ${guard}`).toBe(voyageCheck(server));
      }
    }
  });

  it('refuses commands that do not fit the moment', () => {
    const run = new Run('gull', 1);
    expect(voyageAllowed(run, { t: 'jump', node: 999 })).toBe(false);
    expect(voyageAllowed(run, { t: 'rest' })).toBe(false);
    expect(voyageAllowed(run, { t: 'choose', index: 0 })).toBe(false);
  });
});

/** A plain captain's next command. */
function pick(run: Run): VoyageCommand {
  switch (run.status) {
    case 'chart':
      return { t: 'jump', node: run.reachable().find((n) => !run.isLateral(n))?.id ?? run.reachable()[0].id };
    case 'hail':
      return { t: 'hail', id: run.hailOptions().find((o) => o.id === 'attack')!.id };
    case 'event':
      return { t: 'choose', index: run.currentEvent().choices.findIndex((_, i) => run.canChoose(i)) };
    default:
      return run.canBuyProvisions(1) ? { t: 'provisions', n: 1 } : { t: 'leavePort' };
  }
}
