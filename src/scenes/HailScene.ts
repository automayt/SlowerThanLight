import Phaser from 'phaser';
import { enemy } from '../data/enemies';
import { power } from '../data/powers';
import { NEMESIS } from '../data/nemesis';
import { placeArt } from '../render/art';
import { ledgerOpen, openLedger, standingBar } from '../render/Ledger';
import { currentRun, freshHunger, RunBar } from '../render/RunBar';
import { playLoop, playSfx } from '../render/sound';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { tierName } from '../sim/Diplomacy';
import type { HailOption, Run } from '../sim/Run';
import { loadArtOnDemand } from './PreloadScene';
import { saveRun } from './save';
import { onVoyage, voyage } from '../net/voyage';

const X = 40;
const Y = 88;
const W = SCREEN.w - 80;
const H = SCREEN.h - Y - 16;
const ART = { x: X + 28, y: Y + 70, w: 520, h: 293 };

/** Odds and price of an answer, in a few words. */
function terms(o: HailOption): string {
  return [o.cost ? `${o.cost} gold` : '', o.chance !== undefined ? `${Math.round(o.chance * 100)}% chance` : '', o.fight === 'maybe' ? 'may mean a fight' : '']
    .filter(Boolean)
    .join(' · ');
}

/** A sail in sight: read her colours, then talk, pay, trick, threaten, or fight. */
export class HailScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private buttons: Button[] = [];
  private tx = 0;
  private tw = 0;
  private choicesY = 0;

  constructor() {
    super('Hail');
  }

  preload(): void {
    const run = currentRun(this);
    if (run.encounter.kind === 'battle') loadArtOnDemand(this, this.artKey(run));
  }

  private artKey(run: Run): string {
    const id = run.encounter.kind === 'battle' ? run.encounter.enemy : '';
    return id === 'frigate' ? 'blockade' : `enemy-${id}`;
  }

  create(): void {
    const run = (this.run = currentRun(this));
    if (run.encounter.kind !== 'battle') return void this.scene.start('SeaMap');
    saveRun(run);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    playLoop(this, 'waves', 0.22);
    this.bar = new RunBar(this, run);
    this.buttons = [];
    const enc = run.encounter;
    const foe = enemy(enc.enemy);
    const flag = power(foe.power);

    panel(this, X, Y, W, H);
    this.add.text(SCREEN.w / 2, Y + 14, `Sail ho: ${enc.name}`, { fontFamily: TITLE_FONT, fontSize: '32px', color: COLORS.gold }).setOrigin(0.5, 0);
    const art = placeArt(this, this.artKey(run), ART.x, ART.y, ART.w, ART.h);

    // Under the painting: whose flag she flies and how that flag regards you.
    const fy = ART.y + (art ? ART.h + 16 : 0);
    const fx = ART.x;
    if (enc.nemesis) {
      // Crane flies no flag but his own: his quarrel is with you, and nobody else takes sides.
      this.add.text(fx, fy, `${foe.ship.className} · Captain ${NEMESIS.captain}`, { fontFamily: TITLE_FONT, fontSize: '20px', color: COLORS.textWarn });
      const { met, grudge } = run.nemesis;
      const story = met <= 1 ? 'The first time you have met since you marooned him.' : `Your ${['second', 'third', 'fourth'][met - 2] ?? 'next'} meeting. He has got away from you ${grudge === 1 ? 'once' : `${grudge} times`}.`;
      this.add.text(fx, fy + 34, `${story} No flag will take sides in this.`, textStyle(13, COLORS.text, { wordWrap: { width: ART.w } }));
    } else {
      this.add.text(fx, fy, `${foe.ship.className} · ${flag.name}`, { fontFamily: TITLE_FONT, fontSize: '20px', color: flag.color });
      standingBar(this, fx, fy + 38, ART.w, 12, run.standing[foe.power]);
      this.add.text(fx, fy + 56, `${flag.name} regard${foe.power === 'brethren' || foe.power === 'trade' ? '' : 's'} you as ${tierName(run.tier(foe.power)).toLowerCase()} (${run.standing[foe.power]})`, textStyle(13, COLORS.text));
    }
    new Button(this, fx, fy + 82, 200, 34, 'Standing at sea', () => openLedger(this, run), { size: 14, hint: 'L' });

    this.tx = art ? ART.x + ART.w + 32 : X + 120;
    this.tw = X + W - this.tx - 28;
    // Hunger on the way here comes first.
    let top = ART.y;
    const hunger = freshHunger(this, run);
    if (hunger) top += this.add.text(this.tx, top, `⚠ ${hunger}`, textStyle(15, COLORS.textWarn, { fontStyle: 'italic', wordWrap: { width: this.tw }, lineSpacing: 3 })).height + 12;
    const sighting = this.add.text(this.tx, top, enc.text, textStyle(16, COLORS.text, { wordWrap: { width: this.tw }, lineSpacing: 4 }));
    const answer = this.add.text(this.tx, sighting.y + sighting.height + 12, run.hailText(), textStyle(16, flag.color, { wordWrap: { width: this.tw }, lineSpacing: 4, fontStyle: 'italic' }));
    this.choicesY = answer.y + answer.height + 20;

    // Each answer as a button: what you say, what it means, and its odds or price.
    let cy = this.choicesY;
    const options = run.hailOptions();
    options.forEach((o, i) => {
      const head = this.add.text(16, 8, `${i + 1}. ${o.label}${o.blocker ? `  (${o.blocker})` : ''}`, textStyle(16, COLORS.text, { wordWrap: { width: this.tw - 32 } }));
      const sub = this.add.text(16, 10 + head.height, [o.detail, terms(o)].filter(Boolean).join('  ·  '), textStyle(13, COLORS.gold, { fontStyle: 'italic', wordWrap: { width: this.tw - 32 } }));
      const h = 8 + head.height + 2 + sub.height + 8;
      const b = new Button(this, this.tx, cy, this.tw, h, '', () => voyage(this, { t: 'hail', id: o.id }, o.label), { tip: o.blocker ?? undefined });
      b.label.setVisible(false);
      b.add([head, sub]);
      b.setEnabled(o.available);
      if (!o.available) [head, sub].forEach((t) => t.setAlpha(0.4));
      this.buttons.push(b);
      cy += h + 8;
    });
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
    options.forEach((_, i) => this.input.keyboard!.on(`keydown-${keys[i]}`, () => !ledgerOpen(this) && this.buttons[i]?.press()));
    onVoyage(this, { hail: (cmd) => this.choose(options.find((o) => o.id === cmd.id)!) });
  }

  private choose(o: HailOption): void {
    const run = this.run;
    if (!this.buttons.length || !o.available) return;
    const result = run.hail(o.id);
    saveRun(run);
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    if (result.fight) playSfx(this, 'boarders', 0.4);
    else if (result.changes.some((c) => c.includes('gold'))) playSfx(this, 'coins', 0.5);

    const said = this.add.text(this.tx, this.choicesY, result.text, textStyle(17, COLORS.gold, { wordWrap: { width: this.tw }, lineSpacing: 5, fontStyle: 'italic' }));
    if (result.changes.length) this.add.text(this.tx, said.y + said.height + 16, result.changes.join('\n'), textStyle(15, COLORS.text, { wordWrap: { width: this.tw }, lineSpacing: 4 }));

    const target = run.over ? 'RunEnd' : result.fight ? 'Battle' : 'SeaMap';
    const next = () => {
      if (!result.fight) this.registry.set('chart-note', result.text);
      this.scene.start(target);
    };
    const label = { RunEnd: 'Voyage’s end →', Battle: 'Beat to quarters!', SeaMap: 'Back to the chart →' }[target];
    const go = new Button(this, this.tx + this.tw / 2 - 130, Y + H - 62, 260, 46, label, next, { size: 18, hint: 'Enter' });
    this.input.keyboard!.once('keydown-ENTER', () => go.press());
  }

  update(time: number): void {
    this.sea.draw(time);
    this.bar.refresh();
  }
}
