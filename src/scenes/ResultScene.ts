import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { currentRun } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { playSfx } from '../render/sound';
import { weapon } from '../data/weapons';
import { MAX_GUNS } from '../sim/Run';
import type { ResultData } from './BattleScene';
import { saveRun } from './save';

const BOX = { x: 120, y: 64, w: SCREEN.w - 240, h: 600 };
const ART = { w: 460, h: 259 };

/** After a fight: what became of her, a painting, the numbers, the plunder counted out, and the spoils. */
export class ResultScene extends Phaser.Scene {
  private sea!: Sea;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const { battle, report } = data;
    const run = currentRun(this);
    saveRun(run);
    const o = battle.outcome!;
    const cx = SCREEN.w / 2;

    panel(this, BOX.x, BOX.y, BOX.w, BOX.h);
    this.add
      .text(cx, BOX.y + 18, o.title, { fontFamily: TITLE_FONT, fontSize: '44px', color: o.won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5, 0);

    // Left: the painting of her (or of your ruin), and what happened, in a column that flows down.
    const lx = BOX.x + 30;
    const top = BOX.y + 86;
    const art = !o.won && (o.kind === 'defeat' || o.kind === 'sunk' || o.kind === 'crewLost') ? 'defeat' : battle.enemy.def.id === 'frigate' ? 'blockade' : `enemy-${battle.enemy.def.id}`;
    const painted = placeArt(this, art, lx, top, ART.w, ART.h);
    let y = top + (painted ? ART.h + 14 : 0);
    const story = this.add.text(lx, y, o.text, textStyle(16, COLORS.text, { wordWrap: { width: ART.w }, lineSpacing: 3 }));
    y += story.height + 10;
    for (const line of report.lines) {
      const t = this.add.text(lx, y, line, textStyle(15, COLORS.gold, { wordWrap: { width: ART.w } }));
      y += t.height + 4;
    }

    // Right: the plunder counted out, then the tally.
    const rx = lx + ART.w + 40;
    const rw = BOX.x + BOX.w - 30 - rx;
    this.add.text(rx, top, 'PLUNDER', { fontFamily: TITLE_FONT, fontSize: '15px', color: COLORS.gold, fontStyle: 'bold' });
    const purse = this.add.text(rx, top + 20, report.plunder > 0 ? '+0 gold' : '—', { fontFamily: TITLE_FONT, fontSize: '36px', color: COLORS.gold, stroke: '#000000', strokeThickness: 4 });
    if (report.plunder > 0) {
      const count = { n: 0 };
      this.tweens.add({ targets: count, n: report.plunder, duration: 900, delay: 300, ease: 'Cubic.easeOut', onUpdate: () => purse.setText(`+${Math.round(count.n)} gold`) });
      this.time.delayedCall(350, () => playSfx(this, 'coins', 0.55));
    }
    this.add.text(rx, top + 66, `Purse ${run.gold} gold  ·  Provisions ${run.provisions}/${run.maxProvisions}`, textStyle(13, COLORS.textDim));

    const us = battle.stats.player;
    const them = battle.stats.enemy;
    const acc = (s: { shotsFired: number; hits: number }) => (s.shotsFired ? `${Math.round((100 * s.hits) / s.shotsFired)}%` : '—');
    const mins = Math.floor(o.time / 60);
    const secs = Math.floor(o.time % 60)
      .toString()
      .padStart(2, '0');
    const rows: [string, string, string][] = [
      ['', 'You', 'Her'],
      ['Balls fired', `${us.shotsFired}`, `${them.shotsFired}`],
      ['Accuracy', acc(us), acc(them)],
      ['Hull damage dealt', `${us.hullDamage}`, `${them.hullDamage}`],
      ['Hull remaining', `${battle.player.hull}/${battle.player.def.hull}`, `${battle.enemy.hull}/${battle.enemy.def.hull}`],
      ['Crew remaining', `${battle.player.crew.length}/${battle.crewAtStart.player}`, `${battle.enemy.crew.length}/${battle.crewAtStart.enemy}`],
      ['Time', `${mins}:${secs}`, ''],
    ];
    const ty = top + 104;
    this.add.rectangle(rx, ty - 8, rw, 1, COLORS.panelEdge).setOrigin(0);
    rows.forEach(([label, a, b], i) => {
      const ry = ty + i * 28;
      const style = textStyle(15, i === 0 ? COLORS.gold : COLORS.text, { fontStyle: i === 0 ? 'bold' : 'normal' });
      this.add.text(rx, ry, label, textStyle(15, COLORS.textDim));
      this.add.text(rx + rw - 150, ry, a, style).setOrigin(0.5, 0);
      this.add.text(rx + rw - 50, ry, b, style).setOrigin(0.5, 0);
    });
    this.add.text(rx, ty + rows.length * 28 + 6, `${battle.player.def.name} against ${battle.enemy.def.name}`, textStyle(12, COLORS.textDim, { fontStyle: 'italic', wordWrap: { width: rw } }));

    this.spoils(rx, ty + rows.length * 28 + 40, rw);

    const next = run.over
      ? () => this.scene.start('RunEnd')
      : () => {
          this.registry.set('chart-note', [o.text, ...report.lines].join(' '));
          this.scene.start('SeaMap');
        };
    new Button(this, cx - 140, BOX.y + BOX.h - 62, 280, 44, run.over ? 'The voyage ends →' : 'Back to the chart →', next, { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', next);
  }

  /** One pick from a beaten ship: a gun, or a survivor for the crew. */
  private spoils(x: number, y: number, w: number): void {
    const run = currentRun(this);
    const prize = run.prize;
    if (!prize || prize.taken) return;
    const picks: [string, () => string | null][] = [
      ...prize.guns.map((id): [string, () => string | null] => {
        // Will the gun deck have the bars to crew it alongside the guns already aboard?
        const hands = run.fit.guns.reduce((n, g) => n + weapon(g.weapon).hands, 0) + weapon(id).hands;
        const short = run.fit.guns.length < MAX_GUNS && hands > (run.fit.systems.guns ?? 0) ? `  (needs Gun Deck ${hands})` : '';
        return [`Take her ${weapon(id).name}${short}`, () => run.takePrizeGun(id)];
      }),
      ...(prize.recruits
        ? [
            [
              'Press a survivor into service',
              () => {
                const who = run.pressPrizeCrew();
                return who ? `${who} signs the articles.` : null;
              },
            ] as [string, () => string | null],
          ]
        : []),
    ];
    if (!picks.length) return;
    const label = this.add.text(x, y, 'SPOILS: pick one', { fontFamily: TITLE_FONT, fontSize: '15px', color: COLORS.gold, fontStyle: 'bold', wordWrap: { width: w } });
    const buttons: Button[] = [];
    picks.forEach(([text, take], i) => {
      buttons.push(
        new Button(this, x, y + 26 + i * 38, w, 32, text, () => {
          const said = take();
          if (!said) {
            label.setText(i === picks.length - 1 && prize.recruits ? 'No bunk to spare for a prisoner.' : 'No room aboard for her guns.').setColor(COLORS.textWarn);
            return;
          }
          // Destroy after this click has finished dispatching.
          this.time.delayedCall(0, () => buttons.forEach((b) => b.destroy()));
          label.setText(said).setColor(COLORS.textGood);
          saveRun(run);
        }, { size: 14 }),
      );
    });
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
