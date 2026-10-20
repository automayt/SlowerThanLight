import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { currentRun } from '../render/RunBar';
import { CAPS_FONT, COLORS, SCREEN, textStyle } from '../render/theme';
import { Button, coin, divider, frame, gild, goldText, panel, Sea } from '../render/ui';
import { playSfx } from '../render/sound';
import { weapon } from '../data/weapons';
import { MAX_GUNS } from '../sim/Run';
import type { ResultData } from './BattleScene';
import { saveRun } from './save';
import { onVoyage, voyage } from '../net/voyage';
import type { VoyageCommand } from '../sim/commands';

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
    const title = goldText(this, cx, BOX.y + 12, o.title, 46).setOrigin(0.5, 0);
    if (!o.won) gild(title, ['#ffc2a8', '#ef6a4c', '#b8321e', '#7a1408']);
    divider(this, cx, title.y + title.height + 4, Math.max(280, title.width + 140));

    // Left: the painting of her (or of your ruin), and what happened, in a column that flows down.
    const lx = BOX.x + 30;
    const top = BOX.y + 86;
    const art = !o.won && (o.kind === 'defeat' || o.kind === 'sunk' || o.kind === 'crewLost') ? 'defeat' : battle.enemy.def.id === 'frigate' ? 'blockade' : `enemy-${battle.enemy.def.id}`;
    const painted = placeArt(this, art, lx, top, ART.w, ART.h, false);
    if (painted) frame(this, lx - 4, top - 4, ART.w + 8, ART.h + 8);
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
    this.add.text(rx, top - 4, 'Plunder', { fontFamily: CAPS_FONT, fontSize: '20px', color: COLORS.gold });
    const chest = coin(this, rx + 18, top + 41, 34);
    const purse = this.add.text(rx + 44, top + 20, report.plunder > 0 ? '+0 gold' : '—', textStyle(32, COLORS.gold, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }));
    if (report.plunder > 0) {
      const count = { n: 0 };
      this.tweens.add({ targets: count, n: report.plunder, duration: 900, delay: 300, ease: 'Cubic.easeOut', onUpdate: () => purse.setText(`+${Math.round(count.n)} gold`) });
      this.time.delayedCall(350, () => playSfx(this, 'coins', 0.55));
      // A shower of coins tumbling into the purse as it is counted.
      for (let i = 0; i < Math.min(14, 4 + Math.round(report.plunder / 10)); i++) {
        const c = coin(this, chest.x + Phaser.Math.Between(-30, 160), chest.y - Phaser.Math.Between(60, 110), 18).setAlpha(0).setAngle(Phaser.Math.Between(0, 360));
        this.tweens.add({
          targets: c,
          x: chest.x + Phaser.Math.Between(-6, 6),
          y: chest.y,
          alpha: { from: 1, to: 0.2 },
          angle: c.angle + Phaser.Math.Between(180, 540),
          delay: 300 + i * 55,
          duration: 520,
          ease: 'Quad.easeIn',
          onComplete: () => c.destroy(),
        });
      }
      this.tweens.add({ targets: chest, scale: chest.scale * 1.18, yoyo: true, duration: 120, delay: 820, repeat: 2 });
    }
    this.add.text(rx, top + 70, `Purse ${run.gold} gold  ·  Provisions ${run.provisions}/${run.maxProvisions}`, textStyle(13, COLORS.textDim));

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
    this.add.rectangle(rx, ty - 8, rw, 1, COLORS.brass, 0.5).setOrigin(0);
    rows.forEach(([label, a, b], i) => {
      const ry = ty + i * 28;
      // Every other row lightly banded, like a ruled ledger.
      if (i % 2 === 0 && i > 0) this.add.rectangle(rx - 6, ry - 4, rw + 12, 28, 0xffffff, 0.04).setOrigin(0);
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
    // With spoils to pick on the right, the way on sits under the left column, clear of them.
    const spoilsShown = !!run.prize && !run.prize.taken;
    const go = new Button(this, spoilsShown ? lx : cx - 150, BOX.y + BOX.h - 62, 300, 44, run.over ? 'Voyage’s end →' : 'Back to the chart →', next, { size: 18, hint: 'Enter' });
    this.input.keyboard!.once('keydown-ENTER', () => go.press());
  }

  /** One pick from a beaten ship: a gun, or a survivor for the crew. */
  private spoils(x: number, y: number, w: number): void {
    const run = currentRun(this);
    const prize = run.prize;
    if (!prize || prize.taken) return;
    type Pick = [string, () => string | null, VoyageCommand, string];
    const ship = prize.ship;
    const picks: Pick[] = [
      // The ship herself, sailed in company by a prize crew (selling any prize already with you).
      ...(ship
        ? [
            [
              `Sail ${ship.name} in company${run.consort ? ` (sell ${run.consort.name})` : ''}`,
              () => run.takePrizeShip(),
              { t: 'prizeShip' },
              `No hands to spare for a prize crew (${run.prizeShipBlocker() ?? ''}).`,
            ] as Pick,
          ]
        : []),
      // Her two heaviest guns, so the picks fit.
      ...[...prize.guns].sort((a, b) => weapon(b).price - weapon(a).price).slice(0, 2).map((id): Pick => {
        // Will the gun deck have the bars to crew it alongside the guns already aboard?
        const hands = run.fit.guns.reduce((n, g) => n + weapon(g.weapon).hands, 0) + weapon(id).hands;
        const short = run.fit.guns.length < MAX_GUNS && hands > (run.fit.systems.guns ?? 0) ? `  (needs Gun Deck ${hands})` : '';
        return [`Take her ${weapon(id).name}${short}`, () => run.takePrizeGun(id), { t: 'prizeGun', weapon: id }, 'No room aboard for her guns.'];
      }),
      ...(prize.recruits
        ? [
            [
              'Press a survivor into service',
              () => {
                const who = run.pressPrizeCrew();
                return who ? `${who} signs the articles.` : null;
              },
              { t: 'pressCrew' },
              'No bunk to spare for a prisoner.',
            ] as Pick,
          ]
        : []),
    ];
    if (!picks.length) return;
    const label = this.add.text(x, y - 4, 'Spoils: pick one (or press its number)', { fontFamily: CAPS_FONT, fontSize: '18px', color: COLORS.gold, wordWrap: { width: w } });
    const buttons: Button[] = [];
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    // Taking spoils is the captain's call: the pick plays out here when it is made.
    const takes = new Map<string, () => void>();
    const run_ = (cmd: VoyageCommand) => takes.get(JSON.stringify(cmd))?.();
    onVoyage(this, { prizeGun: run_, pressCrew: run_, prizeShip: run_ });
    // Picks pack closer when there are many, so they stay clear of the button below.
    const step = picks.length > 3 ? 34 : 38;
    picks.forEach(([text, take, cmd, fail], i) => {
      if (keys[i]) this.input.keyboard!.on(`keydown-${keys[i]}`, () => buttons[i]?.active && buttons[i].press());
      takes.set(JSON.stringify(cmd), () => {
          const said = take();
          if (!said) {
            label.setText(fail).setColor(COLORS.textWarn);
            return;
          }
          // Destroy after this click has finished dispatching.
          this.time.delayedCall(0, () => buttons.forEach((b) => b.destroy()));
          label.setText(said).setColor(COLORS.textGood);
          saveRun(run);
      });
      buttons.push(new Button(this, x, y + 26 + i * step, w, step - 6, `${i + 1}. ${text}`, () => voyage(this, cmd, text), { size: 14 }));
    });
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
