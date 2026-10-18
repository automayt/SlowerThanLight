import Phaser from 'phaser';
import { placeBackdrop } from '../render/art';
import { ledgerOpen } from '../render/Ledger';
import { harbourTerms, PortEnvoy } from '../render/PortEnvoy';
import { currentRun, freshHunger, RunBar } from '../render/RunBar';
import { CAPS_FONT, COLORS, SCREEN, textStyle } from '../render/theme';
import { Button, divider, goldText, panel, Sea } from '../render/ui';
import { playLoop, playSfx } from '../render/sound';
import { weapon } from '../data/weapons';
import { FITTINGS } from '../data/fittings';
import { HULL_PRICE, MAX_GUNS, type Run } from '../sim/Run';
import { PORT_TAGLINES, SPECIALITY_TEXT } from '../data/voyage';
import { badges } from '../sim/Skills';
import type { WeaponDef } from '../sim/types';
import { saveRun } from './save';
import { onVoyage, voyage } from '../net/voyage';
import { applyVoyage, type VoyageCommand } from '../sim/commands';

const TOP = 84;
const COL_Y = TOP + 104;
const COLS = [
  { x: 40, w: 370, title: 'Harbour' },
  { x: 430, w: 400, title: 'Shipwright' },
  { x: 850, w: 390, title: 'Armoury' },
];
const ROW = 50;

function fittingName(id: string): string {
  return FITTINGS[id]?.name ?? id;
}

function gunStats(w: WeaponDef): string {
  return `${w.shots}×${w.damage} dmg · ${w.loadTime}s · ${w.hands} hand${w.hands > 1 ? 's' : ''}`;
}

interface BuyOptions {
  enabled: boolean;
  /** The voyage command the button gives, and what to do (and say) when it is carried out. */
  cmd: VoyageCommand;
  fn: () => void;
  /** Beside the button: what it does, or what you have now. */
  detail?: string;
  detailColor?: string;
  /** Its price, so a disabled button can say how much you are short. */
  price?: number;
  /** Hover text when it can be bought. */
  tip?: string;
  /** Hover text when it cannot, unless the purse is the reason. */
  why?: string;
}

/** A friendly port: repairs and crew, shipwright upgrades, and an armoury, or rest while the fleet closes in. */
export class PortScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private note!: Phaser.GameObjects.Text;
  /** What each of this screen's commands does here, by the command (rebuilt with the buttons). */
  private readonly fns = new Map<string, () => void>();
  private envoy: PortEnvoy | null = null;

  constructor() {
    super('Port');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    this.envoy = null;
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    playLoop(this, 'waves', 0.22);
    playLoop(this, 'creak', 0.2);
    this.bar = new RunBar(this, run);
    this.dyn = [];
    const name = run.encounter.kind === 'port' ? run.encounter.name : 'Port';

    const painted = placeBackdrop(this, 'port', SCREEN.w, SCREEN.h, 0);
    // The harbour shows faintly through the panel.
    panel(this, 24, TOP, SCREEN.w - 48, SCREEN.h - TOP - 12).setFillStyle(COLORS.panel, painted ? 0.84 : 0.92);
    const title = goldText(this, SCREEN.w / 2, TOP + 6, name, 38).setOrigin(0.5, 0);
    for (const s of [-1, 1]) divider(this, SCREEN.w / 2 + s * (title.width / 2 + 80), title.y + title.height / 2 + 2, 100);
    this.add
      .text(SCREEN.w / 2, TOP + 54, PORT_TAGLINES[name] ?? 'A free port where no one asks where your cargo came from.', textStyle(14, COLORS.textDim, { fontStyle: 'italic' }))
      .setOrigin(0.5, 0);
    // What the port is known for, in the corner opposite the harbour masters (hunger news goes beneath it).
    const special = run.speciality;
    const known = special ? this.add.text(COLS[0].x, TOP + 8, SPECIALITY_TEXT[special], textStyle(13, COLORS.gold, { fontStyle: 'italic', wordWrap: { width: 330 }, lineSpacing: 2 })) : null;
    // Hunger on the way in, tucked in the corner beside the port's name.
    const hunger = freshHunger(this, run);
    if (hunger) this.add.text(COLS[0].x, known ? known.y + known.height + 4 : TOP + 10, `⚠ ${hunger}`, textStyle(13, COLORS.textWarn, { fontStyle: 'italic', wordWrap: { width: 330 }, lineSpacing: 2 }));
    for (const c of COLS) {
      this.add.text(c.x, COL_Y - 31, c.title, { fontFamily: CAPS_FONT, fontSize: '20px', color: COLORS.gold }).setShadow(0, 1, '#000000', 3, false, true);
      this.add.rectangle(c.x, COL_Y - 6, c.w, 1, COLORS.brass, 0.45).setOrigin(0);
    }

    this.note = this.add.text(SCREEN.w / 2, SCREEN.h - 92, '', textStyle(15, COLORS.textGood, { fontStyle: 'italic' })).setOrigin(0.5, 0);

    // The harbour's masters, in the corner opposite: who holds the port, their terms, and a door to their office.
    const terms = this.add.text(SCREEN.w - 44, TOP + 8, harbourTerms(run), textStyle(13, run.portFeud ? COLORS.textWarn : COLORS.text, { fontStyle: 'italic' })).setOrigin(1, 0);
    const offered = run.encounter.kind === 'port' && !!run.encounter.commission;
    const masters = new Button(this, SCREEN.w - 44 - 210, terms.y + terms.height + 6, 210, 32, offered ? 'Harbour masters ✦' : 'Harbour masters', () => this.openEnvoy(), {
      size: 14,
      hint: 'H',
      tip: offered ? 'Gifts, your standing here, and work on offer.' : 'Gifts and your standing here.',
    });
    this.input.keyboard!.on('keydown-H', () => masters.press());
    const welcome = run.encounter.kind === 'port' ? (run.encounter.welcome ?? []) : [];
    if (welcome.length) this.say(welcome.join('  '));
    const leave = () => {
      playSfx(this, 'sail', 0.45);
      run.leavePort();
      this.registry.set('chart-note', `You weigh anchor and stand out of ${name}.`);
      this.scene.start('SeaMap');
    };
    // Every purchase is a voyage command: in co-op the captain's go through the server, and play out here when they return.
    const perform = (cmd: VoyageCommand) => {
      const fn = this.fns.get(JSON.stringify(cmd));
      if (fn) return fn();
      if (cmd.t === 'gift' && this.envoy) return this.envoy.gift();
      if (cmd.t === 'commission' && this.envoy) return this.envoy.take();
      applyVoyage(this.run, cmd);
      this.later();
    };
    onVoyage(this, {
      rest: perform,
      repairHull: perform,
      hire: perform,
      provisions: perform,
      fitting: perform,
      upgrade: perform,
      buyGun: perform,
      sellGun: perform,
      gift: perform,
      commission: perform,
      leavePort: leave,
    });
    const weigh = new Button(this, SCREEN.w / 2 - 130, SCREEN.h - 64, 260, 44, 'Weigh anchor →', () => voyage(this, { t: 'leavePort' }, `Weigh anchor and leave ${name}`), { size: 18, hint: 'Enter' });
    this.input.keyboard!.on('keydown-ENTER', () => !this.envoy && !ledgerOpen(this) && weigh.press());
    this.rebuild();
  }

  private openEnvoy(): void {
    if (this.envoy) return;
    this.envoy = new PortEnvoy(this, this.run, () => this.later(), () => (this.envoy = null));
  }

  private say(text: string): void {
    this.note.setText(text);
  }

  /** Redraw every button: prices, stock and gun list change after each purchase. */
  private rebuild(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
    this.fns.clear();
    this.harbour();
    this.shipwright();
    this.armoury();
    this.bar.refresh();
    saveRun(this.run);
  }

  /** Rebuild after the current click has finished dispatching (the clicked button is about to be destroyed). */
  private later(): void {
    this.time.delayedCall(0, () => this.rebuild());
  }

  private button(x: number, y: number, w: number, label: string, o: BuyOptions): void {
    const short = o.price !== undefined && this.run.gold < o.price ? `You need ${o.price - this.run.gold} more gold.` : '';
    const tip = o.enabled ? o.tip : short || o.why;
    this.fns.set(JSON.stringify(o.cmd), () => {
      const gold = this.run.gold;
      o.fn();
      if (this.run.gold !== gold) playSfx(this, 'coins', 0.5);
      this.later();
    });
    const b = new Button(this, x, y, w, 40, label, () => voyage(this, o.cmd, label), { size: 14, tip }).setEnabled(o.enabled);
    b.label.setOrigin(0, 0.5).setX(12);
    this.dyn.push(b);
    if (o.detail) {
      // Beside the button, centred on it and wrapped to what is left of its column.
      const col = COLS.find((c) => c.x === x) ?? COLS[0];
      this.dyn.push(this.add.text(x + w + 10, y + 20, o.detail, textStyle(12, o.detailColor ?? COLORS.textDim, { wordWrap: { width: col.x + col.w - (x + w + 10) } })).setOrigin(0, 0.5));
    }
  }

  private harbour(): void {
    const run = this.run;
    const { x } = COLS[0];
    const w = 210;
    let y = COL_Y;
    this.button(x, y, w, run.canRest() ? 'Rest & refit' : 'Rested and refitted', {
      enabled: run.canRest(),
      cmd: { t: 'rest' },
      fn: () => run.rest() && this.say('The crew sleep ashore while the shipwrights mend every system.'),
      detail: 'Heal crew, mend systems.\nFleet gains ½ jump.',
      why: 'You have rested here already.',
    });
    y += ROW + 6;
    const missing = run.hullMissing();
    const n = Math.min(missing, Math.floor(run.gold / HULL_PRICE));
    const sound = 'The hull is sound.';
    this.button(x, y, w, missing ? `Patch 1 hull (${HULL_PRICE}g)` : 'Hull is sound', {
      enabled: run.canRepairHull(1),
      cmd: { t: 'repairHull', points: 1 },
      fn: () => run.repairHull(1) && this.say('Carpenters plank over the worst of it.'),
      detail: `Hull ${run.condition.hull}/${run.fit.hull} · ${HULL_PRICE}g a point`,
      price: missing ? HULL_PRICE : undefined,
      why: sound,
    });
    y += ROW;
    this.button(x, y, w, n > 1 ? `Patch ${n} hull (${n * HULL_PRICE}g)` : 'Patch all you can', {
      enabled: n > 1,
      cmd: { t: 'repairHull', points: n },
      fn: () => run.repairHull(n) && this.say('The hull is made good.'),
      price: missing && !n ? HULL_PRICE : undefined,
      why: missing ? 'Only one point to patch: use the button above.' : sound,
    });
    y += ROW + 6;
    const full = run.condition.crew.length >= run.maxCrew;
    this.button(x, y, w, full ? 'No bunks to spare' : `Hire crew member (${run.crewPrice}g)`, {
      enabled: run.canHire(),
      cmd: { t: 'hire' },
      fn: () => {
        const who = run.hireCrew();
        if (who) this.say(`${who} signs the articles.`);
      },
      detail: `Crew ${run.condition.crew.length}/${run.maxCrew}`,
      price: full ? undefined : run.crewPrice,
      why: 'Every bunk aboard is taken.',
    });
    y += ROW + 10;

    // Chandler: victuals and fittings.
    this.dyn.push(this.add.text(x, y - 10, 'Chandler', { fontFamily: CAPS_FONT, fontSize: '17px', color: COLORS.gold }));
    y += 12;
    const room = run.maxProvisions - run.provisions;
    const lot = Math.min(5, room);
    this.button(x, y, w, room <= 0 ? 'Hold is full' : `Buy ${lot} provisions (${lot * run.provisionPrice}g)`, {
      enabled: lot > 0 && run.canBuyProvisions(lot),
      cmd: { t: 'provisions', n: lot },
      fn: () => run.buyProvisions(lot) && this.say('Salt pork, biscuit and fresh water are swayed aboard.'),
      detail: `${run.provisions}/${run.maxProvisions} aboard`,
      price: lot > 0 ? lot * run.provisionPrice : undefined,
      tip: 'A day’s provisions go with every jump. Without them the crew go hungry and lose health.',
      why: 'The hold can take no more.',
    });
    y += ROW;
    const offers = run.fittingOffers();
    if (!offers.length) {
      this.dyn.push(this.add.text(x, y + 10, 'No fittings for sale.', textStyle(12, COLORS.textDim, { fontStyle: 'italic' })));
      y += ROW;
    }
    for (const o of offers) {
      this.button(x, y, w, `${o.fitting.name} (${o.price}g)`, {
        enabled: o.available,
        cmd: { t: 'fitting', id: o.fitting.id },
        fn: () => run.buyFitting(o.fitting.id) && this.say(`${o.fitting.name} fitted. ${o.fitting.blurb}`),
        detail: o.fitting.short,
        price: o.price,
        tip: o.fitting.blurb,
      });
      y += ROW;
    }
    if (run.fittings.length) {
      const aboard = this.add.text(x, y + 2, `Aboard: ${run.fittings.map((id) => fittingName(id)).join(', ')}`, textStyle(12, COLORS.textDim, { wordWrap: { width: COLS[0].w } }));
      this.dyn.push(aboard);
      y += aboard.height + 8;
    }
    y += 6;
    // Crew, compactly: the chandler's goods push the roster down the column.
    const roster = run.condition.crew.map((c) => `${c.name} ${c.hp}%${badges(c) ? ` ${badges(c)}` : ''}`).join('  ·  ');
    this.dyn.push(this.add.text(x, y, roster, textStyle(12, COLORS.text, { lineSpacing: 2, wordWrap: { width: COLS[0].w } })));
  }

  private shipwright(): void {
    const run = this.run;
    const { x } = COLS[1];
    run.upgradeOffers().forEach((o, i) => {
      this.button(x, COL_Y + i * ROW, 230, o.maxed ? o.label : `${o.label} (${o.price}g)`, {
        enabled: o.available,
        cmd: { t: 'upgrade', id: o.id },
        fn: () => run.buyUpgrade(o.id) && this.say(`${o.label}: done.`),
        detail: o.detail,
        price: o.maxed ? undefined : o.price,
        why: 'Already as good as she can be made.',
      });
    });
  }

  private armoury(): void {
    const run = this.run;
    const { x, w } = COLS[2];
    let y = COL_Y;
    const offers = run.gunOffers();
    const portsFree = run.fit.guns.length < MAX_GUNS;
    this.dyn.push(this.add.text(x, y, 'For sale', textStyle(13, COLORS.textDim, { fontStyle: 'bold' })));
    y += 22;
    if (!offers.length) {
      this.dyn.push(this.add.text(x, y, 'Sold out.', textStyle(13, COLORS.textDim, { fontStyle: 'italic' })));
      y += ROW;
    }
    // Hands the guns aboard need, to warn when a new one would leave the gun deck short.
    const hands = run.fit.guns.reduce((n, g) => n + weapon(g.weapon).hands, 0);
    const deck = run.fit.systems.guns ?? 0;
    for (const o of offers) {
      const need = hands + o.weapon.hands;
      const shortHanded = need > deck;
      this.button(x, y, 230, `${o.weapon.name} (${o.price}g)`, {
        enabled: o.available,
        cmd: { t: 'buyGun', weapon: o.weapon.id },
        fn: () => run.buyGun(o.weapon.id) && this.say(`A ${o.weapon.name} is hoisted aboard.`),
        detail: `${gunStats(o.weapon)}${shortHanded ? `\nneeds Gun Deck ${need}` : ''}`,
        detailColor: shortHanded ? COLORS.gold : undefined,
        price: portsFree ? o.price : undefined,
        tip: shortHanded ? `With this aboard your guns need ${need} hands, but Gun Deck ${deck} lets only ${deck} work at once.` : undefined,
        why: 'Every gun port is filled: sell a gun first.',
      });
      y += ROW;
    }
    y += 8;
    this.dyn.push(this.add.text(x, y, `Your guns (${run.fit.guns.length}/${MAX_GUNS} gun ports)`, textStyle(13, COLORS.textDim, { fontStyle: 'bold' })));
    y += 22;
    run.fit.guns.forEach((g, i) => {
      const wdef = weapon(g.weapon);
      this.dyn.push(this.add.text(x, y + 4, wdef.name, textStyle(13)));
      this.dyn.push(this.add.text(x, y + 22, gunStats(wdef), textStyle(12, COLORS.textDim)));
      this.fns.set(JSON.stringify({ t: 'sellGun', index: i }), () => {
        if (run.sellGun(i)) {
          playSfx(this, 'coins', 0.5);
          this.say(`The ${wdef.name} is sold.`);
        }
        this.later();
      });
      const b = new Button(this, x + w - 110, y + 2, 110, 34, `Sell ${run.sellPrice(i)}g`, () => voyage(this, { t: 'sellGun', index: i }, `Sell the ${wdef.name}`), { size: 14, tip: run.canSellGun(i) ? undefined : 'Your last gun: she will not put to sea unarmed.' }).setEnabled(run.canSellGun(i));
      this.dyn.push(b);
      y += 44;
    });
    this.dyn.push(this.add.text(x, y + 4, `Gun Deck ${deck}: that many hands can work guns at once (your guns need ${hands}).`, textStyle(12, hands > deck ? COLORS.gold : COLORS.textDim, { wordWrap: { width: w } })));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
