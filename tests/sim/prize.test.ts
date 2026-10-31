import { describe, expect, it } from 'vitest';
import { FITTINGS } from '../../src/data/fittings';
import { highlights } from '../../src/sim/chronicle';
import { applyVoyage, voyageAllowed } from '../../src/sim/commands';
import { EXTRA_CREW, PRIZE_FLOOR, PRIZE_MONEY, PRIZE_RENOWN, Run, type PrizeShip } from '../../src/sim/Run';
import { Ship } from '../../src/sim/Ship';

type Finish = 'surrender' | 'captured' | 'victory' | 'enemySunk' | 'escaped';

/** A voyage that has just fought `enemy` to the given end. */
function fought(kind: Finish, enemy = 'sloop', opts: { ship?: string; seed?: number; sector?: number; boss?: boolean } = {}): Run {
  const run = new Run(opts.ship ?? 'gull', opts.seed ?? 6);
  run.sector = opts.sector ?? 0;
  run.encounter = { kind: 'battle', enemy, name: 'HMS Hazard', boss: opts.boss ?? false, ambush: false, text: '' };
  run.status = 'battle';
  const b = run.startBattle();
  // Knock her about a little first, so her hull and stations come out of the fight hurt.
  b.enemy.hull = Math.round(b.enemy.def.hull * 0.4);
  const guns = b.enemy.system('guns');
  if (guns) guns.damage = 1;
  if (kind === 'captured') {
    for (const c of b.enemy.crew) c.hp = 0;
    b.step(0.05);
  } else (b as unknown as { finish(k: string): void }).finish(kind);
  run.finishBattle(b);
  return run;
}

/** Put the voyage in a port of the given name. */
function inPort(run: Run, name = 'Bridgetown'): Run {
  run.encounter = { kind: 'port', name, rested: false, stock: [] };
  run.status = 'port';
  return run;
}

describe('which beaten ships can be taken', () => {
  it('a ship that strikes, or is carried by boarding, is a prize: her ship, her cargo, and her for a flagship', () => {
    for (const kind of ['surrender', 'captured'] as const) {
      const run = fought(kind);
      expect(run.prize?.ship?.name).toBe('HMS Hazard');
      expect(run.prize?.ship?.power).toBe('crown');
      expect(run.prize?.cargo).toBeGreaterThan(0);
      expect(run.prize?.ship?.cargo).toBe(run.prize?.cargo);
      expect(run.prize?.flagship?.def.className).toBe('Sloop-of-War');
      expect(run.prizeShipBlocker()).toBeNull();
      expect(run.flagshipBlocker()).toBeNull();
    }
  });

  it('a sunk ship is no prize, nor one that got away, nor the blockade frigate', () => {
    for (const kind of ['victory', 'enemySunk'] as const) {
      const run = fought(kind);
      expect(run.prize).toBeNull();
      expect(run.prizeShipBlocker()).not.toBeNull();
      expect(run.flagshipBlocker()).not.toBeNull();
    }
    expect(fought('surrender', 'frigate', { boss: true }).prize).toBeNull();
  });

  it('one pick only: plundering her cargo and cutting her loose rules out the rest', () => {
    const run = fought('surrender');
    const gold = run.gold;
    const cargo = run.prize!.cargo!;
    expect(run.takePrizeCargo()).toMatch(/cut her loose/);
    expect(run.gold).toBe(gold + cargo);
    expect(run.takePrizeCargo()).toBeNull();
    expect(run.takePrizeShip()).toBeNull();
    expect(run.takeFlagship()).toBeNull();
  });
});

describe('a prize at the prize court', () => {
  const prize = (over: Partial<PrizeShip> = {}): PrizeShip => ({ enemy: 'sloop', name: 'HMS Hazard', hull: 30, maxHull: 30, power: 'crown', tier: 0, cargo: 10, ...over });

  it('is worth her class, as much as her hull has left, plus her cargo', () => {
    const run = new Run('gull', 1);
    const sound = run.prizeQuote(prize(), 'trade')!;
    expect(sound.price).toBe(sound.worth + 10);
    const half = run.prizeQuote(prize({ hull: 15 }), 'trade')!;
    expect(half.condition).toBe(0.5);
    expect(half.price).toBe(Math.round(sound.worth * 0.5 + 10));
    // A wreck still fetches something for her timbers.
    expect(run.prizeQuote(prize({ hull: 1 }), 'trade')!.condition).toBe(PRIZE_FLOOR);
    // A galleon is worth more than a cutter; a ship taken deeper in is better found and worth more.
    const galleon = run.prizeQuote(prize({ enemy: 'galleon', power: 'spain' }), 'trade')!.worth;
    const cutter = run.prizeQuote(prize({ enemy: 'cutter' }), 'trade')!.worth;
    expect(galleon).toBeGreaterThan(cutter);
    run.sector = 2;
    expect(run.prizeQuote(prize({ tier: 2 }), 'trade')!.worth).toBeGreaterThan(sound.worth);
  });

  it('pays prize money on a ship of its enemies, and only a ransom for one of its own', () => {
    const run = new Run('gull', 1);
    const at = (port: 'trade' | 'spain' | 'brethren' | 'crown') => run.prizeQuote(prize(), port)!;
    // Spain is the Crown's sworn enemy, the Brethren too; the merchants are its friends; the Crown buys back its own.
    expect(at('spain').money).toBe(PRIZE_MONEY.sworn);
    expect(at('spain').why).toMatch(/sworn enemy/);
    expect(at('trade').money).toBe(1);
    expect(at('crown').money).toBe(PRIZE_MONEY.own);
    expect(at('crown').why).toMatch(/ransom/);
    expect(at('spain').price).toBeGreaterThan(at('trade').price);
    expect(at('trade').price).toBeGreaterThan(at('crown').price);
    // Cargo sells at its worth whoever buys it.
    expect(at('crown').price).toBe(Math.round(at('crown').worth * PRIZE_MONEY.own + 10));
    // A rival (Spain and France) pays a little prize money.
    expect(run.prizeQuote(prize({ enemy: 'corsair', power: 'france' }), 'spain')!.money).toBe(PRIZE_MONEY.rival);
  });

  it('a prize crew sails her in, she sells only in port, and her prize master comes home', () => {
    const run = fought('surrender');
    const crew = run.condition.crew.length;
    expect(run.takePrizeShip()).toMatch(/prize master/);
    expect(run.condition.crew.length).toBe(crew - 1);
    expect(run.canSellConsort()).toBe(false);
    expect(voyageAllowed(run, { t: 'sellConsort' })).toBe(false);
    inPort(run, 'Havana');
    const quote = run.prizeQuote()!;
    expect(quote.money).toBe(PRIZE_MONEY.sworn);
    const gold = run.gold;
    expect(applyVoyage(run, { t: 'sellConsort' })).toEqual({ t: 'text', text: `HMS Hazard fetches ${quote.price} gold at the prize court.` });
    expect(run.gold).toBe(gold + quote.price);
    expect(run.condition.crew.length).toBe(crew);
    expect(run.consort).toBeNull();
  });
});

describe('losing a prize', () => {
  const withPrize = () => {
    const run = fought('surrender');
    run.takePrizeShip();
    return run;
  };

  it('is retaken when you run from a fight, prize crew and all', () => {
    const run = withPrize();
    const crew = run.condition.crew.length;
    const report = (() => {
      run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS Swift', boss: false, ambush: false, text: '' };
      run.status = 'battle';
      const b = run.startBattle();
      (b as unknown as { finish(k: string): void }).finish('escaped');
      return run.finishBattle(b);
    })();
    expect(run.consort).toBeNull();
    expect(run.condition.crew.length).toBe(crew);
    expect(report.lines.join(' ')).toMatch(/HMS Swift retakes her/);
    expect(run.log.at(-2)).toMatchObject({ kind: 'prize', name: 'HMS Hazard', outcome: 'retaken' });
  });

  it('stays with you through a fight you win', () => {
    const run = withPrize();
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS Swift', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const b = run.startBattle();
    (b as unknown as { finish(k: string): void }).finish('enemySunk');
    run.finishBattle(b);
    expect(run.consort?.name).toBe('HMS Hazard');
  });

  it('storms batter her, and one too many sends her to the bottom, her prize crew rowing back', () => {
    const run = withPrize();
    const p = run.consort!;
    p.hull = 5;
    expect(run.batterConsort(2).join(' ')).toMatch(/−2 hull, 3\//);
    expect(p.hull).toBe(3);
    const crew = run.condition.crew.length;
    expect(run.batterConsort(4).join(' ')).toMatch(/founders.*pulls across/);
    expect(run.consort).toBeNull();
    expect(run.condition.crew.length).toBe(crew + 1);
  });

  it('an event that damages your hull damages hers too', () => {
    const run = withPrize();
    const before = run.consort!.hull;
    const out = (run as unknown as { applyEffect(e: { text: string; hull: number }): string[] }).applyEffect({ text: 'A squall.', hull: -2 });
    expect(run.consort!.hull).toBe(before - 2);
    expect(out.join(' ')).toMatch(/HMS Hazard takes a beating/);
  });
});

describe('shifting your flag to a prize', () => {
  it('her hull, damage, stations and guns become yours; your crew, purse and stores come across', () => {
    const run = fought('surrender', 'sloop');
    run.gold = 77;
    run.provisions = 9;
    const names = run.condition.crew.map((c) => c.name);
    const her = run.prize!.flagship!;
    expect(her.hull).toBe(Math.round(her.def.hull * 0.4));
    expect(her.damage.guns).toBe(1);
    expect(applyVoyage(run, { t: 'flagship' }).t).toBe('text');
    expect(run.def.name).toBe('HMS Hazard');
    expect(run.def.className).toBe('Sloop-of-War');
    expect(run.shipId).toBe('gull');
    expect(run.fit.hull).toBe(her.def.hull);
    expect(run.fit.systems).toEqual(her.def.systems);
    expect(run.fit.guns.map((g) => g.weapon)).toEqual(her.def.guns.map((g) => g.weapon));
    expect(run.condition.hull).toBe(her.hull);
    expect(run.condition.damage).toEqual({ guns: 1 });
    expect(run.condition.crew.map((c) => c.name)).toEqual(names);
    expect(run.gold).toBe(77);
    expect(run.provisions).toBe(9);
    expect(run.maxCrew).toBe(her.def.crew.length + EXTRA_CREW);
    // Each hand keeps their station: whoever stood at the helm stands at hers.
    const rooms = new Map(run.def.rooms.map((r) => [r.id, r]));
    for (const c of run.condition.crew) expect(rooms.has(c.home)).toBe(true);
    expect(run.condition.crew.filter((c) => rooms.get(c.home)?.system === 'helm').length).toBeGreaterThan(0);
    // She sails into the next fight as your ship.
    new Ship(run.ship, 'player', run.condition);
    run.encounter = { kind: 'battle', enemy: 'cutter', name: 'HMS Swift', boss: false, ambush: false, text: '' };
    run.status = 'battle';
    const b = run.startBattle({ autoPlayer: true });
    expect(b.player.def.name).toBe('HMS Hazard');
    expect(b.player.hull).toBe(her.hull);
    b.runToEnd(300);
    expect(b.outcome).not.toBeNull();
  });

  it('refits and fittings built into your old ship stay with her; what the crew carry comes along', () => {
    const run = fought('surrender', 'sloop');
    run.fit.hull += 3;
    run.fit.systems.sails = (run.fit.systems.sails ?? 0) + 1;
    run.fittings = ['copper', 'chest', 'figurehead', 'marines'];
    const terms = run.flagshipTerms();
    expect(terms.stays).toContain('Oak planking (+3 hull)');
    expect(terms.stays).toContain('Sails refit (+1)');
    expect(terms.stays.some((s) => s.startsWith('Your guns:'))).toBe(true);
    expect(terms.stays).toEqual(expect.arrayContaining([FITTINGS.copper.name, FITTINGS.figurehead.name]));
    expect(terms.comes).toEqual(expect.arrayContaining([FITTINGS.chest.name, FITTINGS.marines.name]));
    expect(run.takeFlagship()).toMatch(/Copper Sheathing, Fearsome Figurehead with her/);
    expect(run.fittings).toEqual(['chest', 'marines']);
  });

  it('a prize already in company sails on with you', () => {
    const run = fought('surrender', 'merchant');
    run.takePrizeShip();
    run.status = 'battle';
    run.encounter = { kind: 'battle', enemy: 'sloop', name: 'HMS Kingfisher', boss: false, ambush: false, text: '' };
    const b = run.startBattle();
    (b as unknown as { finish(k: string): void }).finish('surrender');
    run.finishBattle(b);
    expect(run.flagshipTerms().comes).toContain(`${run.consort!.name}, in company`);
    run.takeFlagship();
    expect(run.def.name).toBe('HMS Kingfisher');
    expect(run.consort).not.toBeNull();
  });

  it('is only offered for a ship big enough, with berths for your crew', () => {
    const small = fought('surrender', 'smuggler');
    expect(small.flagshipOffered).toBe(false);
    expect(small.flagshipBlocker()).toMatch(/too small/);
    expect(voyageAllowed(small, { t: 'flagship' })).toBe(false);
    const crowded = fought('surrender', 'sloop');
    const berths = crowded.prize!.flagship!.def.crew.length + EXTRA_CREW;
    while (crowded.condition.crew.length <= berths) crowded.condition.crew.push({ ...crowded.condition.crew[1], name: `Hand ${crowded.condition.crew.length}` });
    expect(crowded.flagshipOffered).toBe(true);
    expect(crowded.flagshipBlocker()).toMatch(/berths/);
    expect(crowded.takeFlagship()).toBeNull();
  });
});

describe('prizes in the log and in renown', () => {
  it('each ship taken adds a little renown', () => {
    const plain = fought('surrender');
    const base = plain.renown;
    plain.takePrizeShip();
    expect(plain.renown).toBe(base + PRIZE_RENOWN);
    const flag = fought('surrender');
    flag.takeFlagship();
    expect(flag.prizes).toBe(1);
  });

  it('the chronicle tells what became of each prize, and of a change of flag', () => {
    const run = fought('surrender');
    run.takePrizeShip();
    inPort(run, 'Havana');
    const price = run.sellConsort();
    run.status = 'battle';
    run.encounter = { kind: 'battle', enemy: 'galleon', name: 'San José', boss: false, ambush: false, text: '' };
    const b = run.startBattle();
    (b as unknown as { finish(k: string): void }).finish('surrender');
    run.finishBattle(b);
    run.takeFlagship();
    const lines = Object.fromEntries(highlights(run.log, 12).map((h) => [h.label, h.text]));
    expect(lines['Prize taken']).toBe(`HMS Hazard (sold, ${price} gold)`);
    expect(lines['Change of flag']).toBe('From The Black Gull to San José.');
  });
});
