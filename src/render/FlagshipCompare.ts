import Phaser from 'phaser';
import { weapon } from '../data/weapons';
import { EXTRA_CREW, type Run } from '../sim/Run';
import { Ship } from '../sim/Ship';
import type { PowerId, ShipDef, SystemId } from '../sim/types';
import { SYSTEM_NAMES } from '../sim/types';
import { icon } from './icons';
import { shipGeometry, type Ensign } from './ShipArt';
import { ShipView } from './ShipView';
import { capsStyle, COLORS, inkStyle, SCREEN, titleStyle } from './theme';
import { Button, divider, drawPips, panel, ribbon } from './ui';

/** The ensign a ship of each power flies. */
const COLOURS: Record<PowerId, Ensign> = { crown: 'navy', spain: 'spanish', france: 'trade', trade: 'trade', brethren: 'pirate' };
const STATIONS: SystemId[] = ['helm', 'sails', 'guns', 'pumps', 'surgeon', 'bulwarks'];

/** One side of the comparison: a ship as she stands, and who she is. */
interface Side {
  title: string;
  def: ShipDef;
  hull: number;
  damage: Partial<Record<SystemId, number>>;
  berths: number;
  flag: Ensign;
}

/**
 * Before shifting your flag to a beaten ship: the two ships side by side on a sheet of parchment (their draughts,
 * hull, speed, berths, stations and guns), what comes across with you and what stays with your old ship. Laid over
 * the result screen; Take command / Keep my ship close it. The overlay sits just above the screen's own objects
 * (depth 0) so the ships' draughts (ShipView, depths 1 to 6) can be drawn on it. The screen routes Enter and Esc to
 * `take` and `close`.
 */
export class FlagshipCompare {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly views: ShipView[] = [];
  closed = false;
  readonly take: Button;

  constructor(
    scene: Phaser.Scene,
    run: Run,
    onTake: () => void,
    private readonly onClose: () => void = () => {},
  ) {
    const f = run.prize!.flagship!;
    const hers = run.flagshipShip!;
    const foePower = run.prize!.ship?.power ?? 'crown';
    const mine: Side = { title: 'Your ship', def: run.ship, hull: run.condition.hull, damage: run.condition.damage, berths: run.maxCrew, flag: 'pirate' };
    const her: Side = { title: 'Her', def: hers, hull: f.hull, damage: f.damage, berths: f.def.crew.length + EXTRA_CREW, flag: COLOURS[foePower] };
    const W = 1000;
    const H = 632;
    const x0 = (SCREEN.w - W) / 2;
    const y0 = (SCREEN.h - H) / 2 + 8;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.objects.push(o), o);
    const shade = add(scene.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.6).setOrigin(0).setDepth(0.8).setInteractive());
    void shade;
    const sheet = add(panel(scene, x0, y0, W, H, { modal: true, skin: 'parchment' }).setDepth(0.85));
    sheet.setInteractive();
    add(ribbon(scene, SCREEN.w / 2, y0 - 2, `Take command of ${f.def.name}?`, { size: 22, depth: 9 }));

    const colW = (W - 100) / 2;
    const cols = [x0 + 36, x0 + W / 2 + 14];
    const t = (x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle) => add(scene.add.text(x, y, s, style).setDepth(9));
    // A ruled line down the middle of the sheet.
    const rule = add(scene.add.graphics().setDepth(0.9));
    rule.lineStyle(1, 0x6a5236, 0.45).lineBetween(x0 + W / 2, y0 + 40, x0 + W / 2, y0 + 446);

    [mine, her].forEach((side, i) => {
      const x = cols[i];
      const other = i === 0 ? her : mine;
      let y = y0 + 34;
      t(x, y, side.title, capsStyle(14, COLORS.inkDim));
      t(x + colW, y, side.def.className, inkStyle(13, COLORS.inkDim, { fontStyle: 'italic' })).setOrigin(1, 0);
      y += 18;
      t(x, y, side.def.name, titleStyle(24, COLORS.ink));
      y += 34;

      // Her draught on a strip of chart paper, as the shipwright would show her.
      const strip = { x, y, w: colW, h: 104 };
      add(scene.textures.exists('art:chart-paper') ? scene.add.image(strip.x, strip.y, 'art:chart-paper').setOrigin(0).setDisplaySize(strip.w, strip.h) : scene.add.rectangle(strip.x, strip.y, strip.w, strip.h, 0xd9c49a).setOrigin(0)).setDepth(0.9);
      const edge = add(scene.add.graphics().setDepth(0.95));
      edge.lineStyle(1, 0x6a5236, 0.6).strokeRect(strip.x, strip.y, strip.w, strip.h);
      const ship = new Ship(side.def, 'player', { hull: Math.max(1, side.hull), crew: [], damage: side.damage });
      const geo = shipGeometry(ship);
      const spanW = geo.padL - 0.25 + geo.tip + 1.2;
      const spanH = geo.beam * 2 + 0.2;
      const tile = Math.min(13, (strip.w - 30) / spanW, (strip.h - 6) / spanH);
      const left = strip.x + (strip.w - spanW * tile) / 2 + (geo.padL - 0.25) * tile;
      this.views.push(new ShipView(scene, ship, left, strip.y + (strip.h - ship.height * tile) / 2, tile, false, { showLabels: false, flag: side.flag }));
      y += strip.h + 12;

      // The particulars, her column inked green where she is better and red where she is worse.
      const better = (a: number, b: number) => (i === 0 || a === b ? COLORS.ink : a > b ? COLORS.inkGood : COLORS.inkRed);
      const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
      const rows: [string, string, string][] = [
        ['Hull', `${Math.max(0, side.hull)} of ${side.def.hull}`, better(side.hull, other.hull)],
        ['Speed (evasion)', pct(side.def.speedBonus), better(side.def.speedBonus, other.def.speedBonus)],
        ['Berths for crew', `${side.berths}`, better(side.berths, other.berths)],
        ['Deckhands', `${side.def.hands}`, better(side.def.hands, other.def.hands)],
        ['Hand to hand', `×${(side.def.melee ?? 1).toFixed(2).replace(/0$/, '')}`, better(side.def.melee ?? 1, other.def.melee ?? 1)],
      ];
      if (side.def.armour || other.def.armour) rows.push(['Stout sides', side.def.armour ? 'light balls glance off' : '—', better(side.def.armour ?? 0, other.def.armour ?? 0)]);
      for (const [label, value, ink] of rows) {
        t(x, y, label, inkStyle(13, COLORS.inkDim));
        t(x + colW, y, value, inkStyle(13, ink, { fontStyle: 'bold' })).setOrigin(1, 0);
        y += 19;
      }
      y += 6;
      // Stations as lamps, two to a row: lit for working, red for damaged.
      const pips = add(scene.add.graphics().setDepth(9));
      STATIONS.forEach((id, k) => {
        const bars = side.def.systems[id] ?? 0;
        const sx = x + (k % 2) * (colW / 2);
        const sy = y + Math.floor(k / 2) * 21;
        add(icon(scene, sx + 8, sy + 8, id, 16).setDepth(9));
        t(sx + 20, sy, SYSTEM_NAMES[id], inkStyle(12, bars ? COLORS.ink : COLORS.inkDim));
        if (!bars) t(sx + 112, sy, 'none', inkStyle(12, COLORS.inkDim, { fontStyle: 'italic' }));
        const dmg = Math.min(bars, side.damage[id] ?? 0);
        drawPips(pips, sx + 112, sy + 3, bars - dmg, bars, dmg, 9, 3);
        const ob = other.def.systems[id] ?? 0;
        if (i === 1 && bars !== ob) t(sx + 112 + bars * 12 + 4, sy, `${bars > ob ? '+' : '−'}${Math.abs(bars - ob)}`, inkStyle(11, bars > ob ? COLORS.inkGood : COLORS.inkRed, { fontStyle: 'bold' }));
      });
      y += 3 * 21 + 6;
      const guns = side.def.guns.map((g) => weapon(g.weapon).name);
      const counted = [...new Set(guns)].map((n) => `${guns.filter((g) => g === n).length > 1 ? `${guns.filter((g) => g === n).length}× ` : ''}${n}`);
      t(x, y, `Guns: ${counted.join(', ') || 'none'}`, inkStyle(12, COLORS.ink, { wordWrap: { width: colW } }));
    });

    // What comes across and what stays.
    const terms = run.flagshipTerms();
    let y = y0 + 452;
    add(divider(scene, SCREEN.w / 2, y, W - 120, 0x6a5236, 0.6).setDepth(9));
    y += 10;
    t(cols[0], y, 'Comes across with you', capsStyle(15, COLORS.inkGood));
    t(cols[1], y, `Stays with ${run.def.name}`, capsStyle(15, COLORS.inkRed));
    y += 22;
    t(cols[0], y, terms.comes.join(' · '), inkStyle(12, COLORS.ink, { wordWrap: { width: colW }, lineSpacing: 2 }));
    t(cols[1], y, terms.stays.length ? terms.stays.join(' · ') : 'Nothing: she is as she was built.', inkStyle(12, COLORS.ink, { wordWrap: { width: colW }, lineSpacing: 2 }));
    t(SCREEN.w / 2, y0 + H - 96, `Her people are put aboard ${run.def.name} and sent on their way. You sail ${f.def.name} as the fight left her.`, inkStyle(12, COLORS.inkDim, { fontStyle: 'italic', align: 'center', wordWrap: { width: W - 140 } })).setOrigin(0.5, 0);

    const blocker = run.flagshipBlocker();
    this.take = add(new Button(scene, SCREEN.w / 2 - 250, y0 + H - 58, 240, 42, 'Take command', () => onTake(), { size: 17, hint: 'Enter', icon: 'anchor', tip: blocker ? `You cannot: ${blocker}.` : undefined }).setDepth(9));
    this.take.setEnabled(!blocker);
    add(new Button(scene, SCREEN.w / 2 + 10, y0 + H - 58, 240, 42, 'Keep my ship', () => this.close(), { size: 17, hint: 'Esc' }).setDepth(9));
  }

  /** Keep the draughts riding the swell. */
  update(time: number): void {
    for (const v of this.views) v.draw(time);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const v of this.views) v.destroy();
    for (const o of this.objects) o.destroy();
    this.onClose();
  }
}
