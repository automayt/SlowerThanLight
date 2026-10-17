import Phaser from 'phaser';
import { placeBackdrop } from '../render/art';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { playLoop, playSfx } from '../render/sound';
import { weapon } from '../data/weapons';
import { FITTINGS } from '../data/fittings';
import { CREW_PRICE, HULL_PRICE, MAX_GUNS, PROVISION_PRICE, type Run } from '../sim/Run';
import { PORT_TAGLINES } from '../data/voyage';
import { badges } from '../sim/Skills';
import type { WeaponDef } from '../sim/types';
import { saveRun } from './save';

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

/** A friendly port: repairs and crew, shipwright upgrades, and an armoury, or rest while the fleet closes in. */
export class PortScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private note!: Phaser.GameObjects.Text;

  constructor() {
    super('Port');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    playLoop(this, 'waves', 0.22);
    playLoop(this, 'creak', 0.2);
    this.bar = new RunBar(this, run);
    this.dyn = [];
    const name = run.encounter.kind === 'port' ? run.encounter.name : 'Port';

    const painted = placeBackdrop(this, 'port', SCREEN.w, SCREEN.h, 0);
    panel(this, 24, TOP, SCREEN.w - 48, SCREEN.h - TOP - 12).setFillStyle(COLORS.panel, painted ? 0.9 : 0.92);
    this.add.text(SCREEN.w / 2, TOP + 8, name, { fontFamily: TITLE_FONT, fontSize: '34px', color: COLORS.gold }).setOrigin(0.5, 0);
    this.add
      .text(SCREEN.w / 2, TOP + 52, PORT_TAGLINES[name] ?? 'A free port where no one asks where your cargo came from.', textStyle(14, COLORS.textDim, { fontStyle: 'italic' }))
      .setOrigin(0.5, 0);
    for (const c of COLS) {
      this.add.text(c.x, COL_Y - 30, c.title.toUpperCase(), textStyle(14, COLORS.gold, { fontStyle: 'bold' }));
      this.add.rectangle(c.x, COL_Y - 8, c.w, 1, COLORS.panelEdge).setOrigin(0);
    }

    this.note = this.add.text(SCREEN.w / 2, SCREEN.h - 92, '', textStyle(15, COLORS.textGood, { fontStyle: 'italic' })).setOrigin(0.5, 0);
    const leave = () => {
      run.leavePort();
      this.registry.set('chart-note', `You weigh anchor and stand out of ${name}.`);
      this.scene.start('SeaMap');
    };
    new Button(this, SCREEN.w / 2 - 120, SCREEN.h - 64, 240, 44, 'Weigh anchor →', leave, { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', leave);
    this.rebuild();
  }

  private say(text: string): void {
    this.note.setText(text);
  }

  /** Redraw every button: prices, stock and gun list change after each purchase. */
  private rebuild(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
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

  private button(x: number, y: number, w: number, label: string, enabled: boolean, fn: () => void, detail?: string, tip?: string): void {
    const b = new Button(this, x, y, w, 40, label, () => {
      const gold = this.run.gold;
      fn();
      if (this.run.gold !== gold) playSfx(this, 'coins', 0.5);
      this.later();
    }, { size: 14 }).setEnabled(enabled);
    b.label.setOrigin(0, 0.5).setX(12);
    this.dyn.push(b);
    if (tip) {
      b.bg.on('pointerover', () => this.say(tip));
    }
    if (detail) this.dyn.push(this.add.text(x + w + 10, y + 12, detail, textStyle(12, COLORS.textDim)));
  }

  private harbour(): void {
    const run = this.run;
    const { x } = COLS[0];
    const w = 210;
    let y = COL_Y;
    this.button(x, y, w, run.canRest() ? 'Rest & refit' : 'Rested and refitted', run.canRest(), () => run.rest() && this.say('The crew sleep ashore while the shipwrights mend every system.'), 'Heal crew, mend systems.\nFleet gains ½ jump.');
    y += ROW + 6;
    const missing = run.hullMissing();
    const n = Math.min(missing, Math.floor(run.gold / HULL_PRICE));
    this.button(x, y, w, missing ? `Patch 1 hull (${HULL_PRICE}g)` : 'Hull is sound', run.canRepairHull(1), () => run.repairHull(1) && this.say('Carpenters plank over the worst of it.'), `${HULL_PRICE} gold a point`);
    y += ROW;
    this.button(x, y, w, n > 1 ? `Patch ${n} hull (${n * HULL_PRICE}g)` : 'Patch all you can', n > 1, () => run.repairHull(n) && this.say('The hull is made good.'));
    y += ROW + 6;
    const full = run.condition.crew.length >= run.maxCrew;
    this.button(x, y, w, full ? 'No bunks to spare' : `Hire a sailor (${CREW_PRICE}g)`, run.canHire(), () => {
      const who = run.hireCrew();
      if (who) this.say(`${who} signs the articles.`);
    }, `Bunks for ${run.maxCrew}`);
    y += ROW + 10;

    // Chandler: victuals and fittings.
    this.dyn.push(this.add.text(x, y - 6, 'CHANDLER', textStyle(12, COLORS.gold, { fontStyle: 'bold' })));
    y += 12;
    const room = run.maxProvisions - run.provisions;
    const lot = Math.min(5, room);
    this.button(
      x,
      y,
      w,
      room <= 0 ? 'Hold is full' : `Buy ${lot} provisions (${lot * PROVISION_PRICE}g)`,
      lot > 0 && run.canBuyProvisions(lot),
      () => run.buyProvisions(lot) && this.say('Salt pork, biscuit and fresh water are swayed aboard.'),
      `${run.provisions}/${run.maxProvisions} aboard`,
    );
    y += ROW;
    const offers = run.fittingOffers();
    if (!offers.length) {
      this.dyn.push(this.add.text(x, y + 10, 'No fittings for sale.', textStyle(12, COLORS.textDim, { fontStyle: 'italic' })));
      y += ROW;
    }
    for (const o of offers) {
      this.button(x, y, w, `${o.fitting.name} (${o.price}g)`, o.available, () => run.buyFitting(o.fitting.id) && this.say(`${o.fitting.name} fitted. ${o.fitting.blurb}`), o.fitting.short, o.fitting.blurb);
      y += ROW;
    }
    if (run.fittings.length) {
      this.dyn.push(this.add.text(x, y + 2, `Aboard: ${run.fittings.map((id) => fittingName(id)).join(', ')}`, textStyle(11, COLORS.textDim, { wordWrap: { width: COLS[0].w } })));
      y += 22;
    }
    y += 6;
    // Crew, compactly: the chandler's goods push the roster down the column.
    const roster = run.condition.crew.map((c) => `${c.name} ${c.hp}%${badges(c) ? ` ${badges(c)}` : ''}`).join('  ·  ');
    this.dyn.push(this.add.text(x, y, roster, textStyle(11, COLORS.text, { lineSpacing: 2, wordWrap: { width: COLS[0].w } })));
  }

  private shipwright(): void {
    const run = this.run;
    const { x } = COLS[1];
    run.upgradeOffers().forEach((o, i) => {
      this.button(x, COL_Y + i * ROW, 230, o.maxed ? o.label : `${o.label} (${o.price}g)`, o.available, () => run.buyUpgrade(o.id) && this.say(`${o.label}: done.`), o.detail);
    });
  }

  private armoury(): void {
    const run = this.run;
    const { x, w } = COLS[2];
    let y = COL_Y;
    const offers = run.gunOffers();
    this.dyn.push(this.add.text(x, y, 'For sale', textStyle(13, COLORS.textDim, { fontStyle: 'bold' })));
    y += 22;
    if (!offers.length) {
      this.dyn.push(this.add.text(x, y, 'Sold out.', textStyle(13, COLORS.textDim, { fontStyle: 'italic' })));
      y += ROW;
    }
    for (const o of offers) {
      this.button(x, y, 230, `${o.weapon.name} (${o.price}g)`, o.available, () => run.buyGun(o.weapon.id) && this.say(`A ${o.weapon.name} is hoisted aboard.`), gunStats(o.weapon));
      y += ROW;
    }
    y += 8;
    this.dyn.push(this.add.text(x, y, `Your guns (${run.fit.guns.length}/${MAX_GUNS} gun ports)`, textStyle(13, COLORS.textDim, { fontStyle: 'bold' })));
    y += 22;
    run.fit.guns.forEach((g, i) => {
      const wdef = weapon(g.weapon);
      this.dyn.push(this.add.text(x, y + 4, wdef.name, textStyle(13)));
      this.dyn.push(this.add.text(x, y + 22, gunStats(wdef), textStyle(11, COLORS.textDim)));
      const b = new Button(this, x + w - 110, y + 2, 110, 34, `Sell ${run.sellPrice(i)}g`, () => {
        if (run.sellGun(i)) this.say(`The ${wdef.name} is sold.`);
        this.later();
      }, { size: 13 }).setEnabled(run.canSellGun(i));
      this.dyn.push(b);
      y += 44;
    });
    this.dyn.push(this.add.text(x, y + 4, `Gun Deck ${run.fit.systems.guns ?? 0}: that many hands can work guns at once.`, textStyle(11, COLORS.textDim, { wordWrap: { width: w } })));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
