import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { currentRun } from '../render/RunBar';
import { CAPS_FONT, COLORS, SCREEN, textStyle } from '../render/theme';
import { Button, coin, divider, frame, gild, goldText, panel, Sea } from '../render/ui';
import { FlagshipCompare } from '../render/FlagshipCompare';
import type { IconName } from '../render/icons';
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
  /** The two ships side by side, while you weigh taking command of her. */
  private compare: FlagshipCompare | null = null;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const { battle, report } = data;
    const run = currentRun(this);
    saveRun(run);
    this.compare = null;
    // With her fate to decide on the right, the tally packs closer to leave it room.
    const spoilsShown = !!run.prize && !run.prize.taken;
    const rowH = spoilsShown ? 22 : 28;
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
      const ry = ty + i * rowH;
      // Every other row lightly banded, like a ruled ledger.
      if (i % 2 === 0 && i > 0) this.add.rectangle(rx - 6, ry - (rowH - 18) / 2 - 1, rw + 12, rowH, 0xffffff, 0.04).setOrigin(0);
      const size = spoilsShown ? 14 : 15;
      const style = textStyle(size, i === 0 ? COLORS.gold : COLORS.text, { fontStyle: i === 0 ? 'bold' : 'normal' });
      this.add.text(rx, ry, label, textStyle(size, COLORS.textDim));
      this.add.text(rx + rw - 150, ry, a, style).setOrigin(0.5, 0);
      this.add.text(rx + rw - 50, ry, b, style).setOrigin(0.5, 0);
    });
    this.add.text(rx, ty + rows.length * rowH + 4, `${battle.player.def.name} against ${battle.enemy.def.name}`, textStyle(12, COLORS.textDim, { fontStyle: 'italic', wordWrap: { width: rw } }));

    this.spoils(rx, ty + rows.length * rowH + (spoilsShown ? 30 : 40), rw);

    const next = run.over
      ? () => this.scene.start('RunEnd')
      : () => {
          this.registry.set('chart-note', [o.text, ...report.lines].join(' '));
          this.scene.start('SeaMap');
        };
    // With spoils to pick on the right, the way on sits under the left column, clear of them.
    const go = new Button(this, spoilsShown ? lx : cx - 150, BOX.y + BOX.h - 62, 300, 44, run.over ? 'Voyage’s end →' : 'Back to the chart →', next, { size: 18, hint: 'Enter' });
    // Enter and Esc answer the comparison while it is open; otherwise Enter sails on.
    this.input.keyboard!.on('keydown-ENTER', () => (this.compare ? this.compare.take.press() : go.press()));
    this.input.keyboard!.on('keydown-ESC', () => this.compare?.close());
  }

  /**
   * What becomes of a beaten ship that struck or was carried: take her as a prize (a hand sails her in company to
   * a port's prize court), take command of her (after a side-by-side look), or plunder her (a gun, a survivor or
   * her cargo) and cut her loose. One pick; in co-op it is the captain's call and plays out on every screen.
   */
  private spoils(x: number, y: number, w: number): void {
    const run = currentRun(this);
    const prize = run.prize;
    if (!prize || prize.taken) return;
    const ship = prize.ship;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const heading = this.add.text(x, y - 4, ship ? 'Her fate' : 'Spoils', { fontFamily: CAPS_FONT, fontSize: '19px', color: COLORS.gold });
    const hint = this.add.text(x + w, y, 'pick one, or press its number', textStyle(12, COLORS.textDim, { fontStyle: 'italic', align: 'right', wordWrap: { width: w - 120 } })).setOrigin(1, 0);
    parts.push(hint);
    const note = this.add.text(x, y + 24, '', textStyle(14, COLORS.textGood, { wordWrap: { width: w }, lineSpacing: 2 }));

    interface Pick {
      label: string;
      cmd: VoyageCommand;
      take: () => string | null;
      fail: string;
      icon?: IconName;
      tip?: string;
      enabled?: boolean;
      sfx: string;
    }
    const picks: Pick[] = [];
    const big: Pick[] = [];
    if (ship) {
      const quote = run.prizeQuote({ ...ship, crew: undefined }, null)!;
      const blocked = run.prizeShipBlocker();
      big.push({
        label: 'Take her as a prize',
        cmd: { t: 'prizeShip' },
        take: () => run.takePrizeShip(),
        fail: `No hands to spare for a prize crew (${blocked ?? ''}).`,
        icon: 'flag',
        enabled: !blocked,
        tip: blocked
          ? `You cannot: ${blocked}.`
          : `One of your hands sails her in company as prize master. She fires a light broadside in your fights and draws some of the enemy's fire; she can be sunk, and if you run from a fight she is retaken. A port's prize court buys her${run.consort ? `. ${run.consort.name}, already in company, is sold now to make room` : ''}.`,
        sfx: 'prize',
      });
      if (run.flagshipOffered) {
        big.push({
          label: 'Take command of her…',
          cmd: { t: 'flagship' },
          take: () => run.takeFlagship(),
          fail: 'You cannot take command of her.',
          icon: 'anchor',
          tip: 'Compare the two ships, then decide.',
          sfx: 'prize',
        });
      }
      const details = [
        `${blocked ? 'Needs a hand to spare.' : 'A hand sails her in.'} About ${quote.price} gold at a prize court; more in her enemies' ports.`,
        `Shift your flag to this ${prize.flagship!.def.className.toLowerCase()}, hull ${prize.flagship!.hull} of ${prize.flagship!.def.hull}.`,
      ];
      big.forEach((_, i) => parts.push(this.add.text(x + 250, y + 26 + i * 46, details[i], textStyle(12, COLORS.textDim, { wordWrap: { width: w - 250 }, lineSpacing: 1 }))));
    }
    picks.push(...big);
    // Plunder: her two heaviest guns, a survivor, or her cargo.
    const plunder: Pick[] = [
      ...[...prize.guns].sort((a, b) => weapon(b).price - weapon(a).price).slice(0, 2).map((id): Pick => {
        // Will the gun deck have the bars to crew it alongside the guns already aboard?
        const hands = run.fit.guns.reduce((n, g) => n + weapon(g.weapon).hands, 0) + weapon(id).hands;
        const full = run.fit.guns.length >= MAX_GUNS;
        const tip = full
          ? `No free gun port: she fetches ${Math.floor(weapon(id).price / 2)} gold for scrap.`
          : `Mounted in a free gun port.${hands > (run.fit.systems.guns ?? 0) ? ` Your Gun Deck needs ${hands} bars to crew it with the rest.` : ''}`;
        return { label: weapon(id).name.replace(' Long Gun', ''), cmd: { t: 'prizeGun', weapon: id }, take: () => run.takePrizeGun(id), fail: 'No room aboard for her guns.', tip, sfx: 'coins' };
      }),
      ...(prize.recruits
        ? [
            {
              label: 'A survivor',
              cmd: { t: 'pressCrew' },
              take: () => {
                const who = run.pressPrizeCrew();
                return who ? `${who} signs the articles.` : null;
              },
              fail: 'No bunk to spare for a prisoner.',
              tip: 'One of her crew signs on with you, if you have a bunk.',
              sfx: 'cheer',
            } as Pick,
          ]
        : []),
      ...(prize.cargo ? [{ label: `Her cargo +${prize.cargo}g`, cmd: { t: 'prizeCargo' }, take: () => run.takePrizeCargo(), fail: 'Her hold is empty.', tip: 'Break open her hold and take what is worth taking.', sfx: 'coins' } as Pick] : []),
    ];
    picks.push(...plunder);
    if (!picks.length) {
      heading.destroy();
      return;
    }

    const buttons: Button[] = [];
    const takes = new Map<string, () => void>();
    // The pick plays out here when it is made: on every player's screen at once in co-op.
    const done = (said: string, sfx: string) => {
      // Destroy after this click has finished dispatching.
      this.time.delayedCall(0, () => [...buttons, ...parts].forEach((b) => b.destroy()));
      this.compare?.close();
      note.setText(said);
      playSfx(this, sfx, 0.6);
      saveRun(run);
    };
    for (const p of picks) {
      takes.set(JSON.stringify(p.cmd), () => {
        const said = p.take();
        if (said) done(said, p.sfx);
        else hint.setText(p.fail).setColor(COLORS.textWarn);
      });
    }
    const run_ = (cmd: VoyageCommand) => takes.get(JSON.stringify(cmd))?.();
    onVoyage(this, { prizeGun: run_, pressCrew: run_, prizeShip: run_, prizeCargo: run_, flagship: run_ });

    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    const go = (p: Pick) => (p.cmd.t === 'flagship' ? this.openCompare(p.label) : voyage(this, p.cmd, p.label));
    big.forEach((p, i) => {
      buttons.push(new Button(this, x, y + 24 + i * 46, 238, 38, `${i + 1}. ${p.label}`, () => go(p), { size: 15, icon: p.icon, tip: p.tip }).setEnabled(p.enabled ?? true));
    });
    let py = y + 24 + big.length * 46;
    if (plunder.length) {
      parts.push(this.add.text(x, py + 2, ship ? 'Or plunder her and cut her loose:' : 'Take one:', textStyle(13, COLORS.textDim, { fontStyle: 'italic' })));
      py += 24;
      const gap = 8;
      const bw = (w - gap * (plunder.length - 1)) / plunder.length;
      plunder.forEach((p, i) => {
        buttons.push(new Button(this, x + i * (bw + gap), py, bw, 34, `${big.length + i + 1}. ${p.label}`, () => go(p), { size: 13, tip: p.tip }));
      });
    }
    picks.forEach((_, i) => {
      if (keys[i]) this.input.keyboard!.on(`keydown-${keys[i]}`, () => !this.compare && buttons[i]?.active && buttons[i].press());
    });
  }

  /** Lay the two ships side by side before shifting your flag. */
  private openCompare(label: string): void {
    const run = currentRun(this);
    if (this.compare || !run.prize?.flagship || run.prize.taken) return;
    this.compare = new FlagshipCompare(
      this,
      run,
      () => voyage(this, { t: 'flagship' }, label),
      () => (this.compare = null),
    );
  }

  update(time: number): void {
    this.sea.draw(time);
    this.compare?.update(time);
  }
}
