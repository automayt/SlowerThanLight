import Phaser from 'phaser';
import { currentRun } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, Sea } from '../render/ui';
import type { ResultData } from './BattleScene';
import { saveRun } from './save';

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

    this.add.rectangle(cx - 330, 86, 660, 520, COLORS.panel, 0.93).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
    this.add
      .text(cx, 136, o.title, { fontFamily: TITLE_FONT, fontSize: '48px', color: o.won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5);
    this.add.text(cx, 180, o.text, textStyle(17, COLORS.text, { align: 'center', wordWrap: { width: 580 } })).setOrigin(0.5, 0);

    const us = battle.stats.player;
    const them = battle.stats.enemy;
    const acc = (s: { shotsFired: number; hits: number }) => (s.shotsFired ? `${Math.round((100 * s.hits) / s.shotsFired)}%` : '—');
    const mins = Math.floor(o.time / 60);
    const secs = Math.floor(o.time % 60)
      .toString()
      .padStart(2, '0');
    const rows: [string, string, string][] = [
      ['', battle.player.def.name, battle.enemy.def.name],
      ['Balls fired', `${us.shotsFired}`, `${them.shotsFired}`],
      ['Accuracy', acc(us), acc(them)],
      ['Hull damage dealt', `${us.hullDamage}`, `${them.hullDamage}`],
      ['Hull remaining', `${battle.player.hull}/${battle.player.def.hull}`, `${battle.enemy.hull}/${battle.enemy.def.hull}`],
      ['Crew remaining', `${battle.player.crew.length}/${battle.crewAtStart.player}`, `${battle.enemy.crew.length}/${battle.crewAtStart.enemy}`],
    ];
    rows.forEach(([label, a, b], i) => {
      const y = 290 + i * 30;
      const style = textStyle(16, i === 0 ? COLORS.gold : COLORS.text);
      this.add.text(cx - 280, y, label, textStyle(16, COLORS.textDim));
      this.add.text(cx + 40, y, a, style).setOrigin(0.5, 0);
      this.add.text(cx + 210, y, b, style).setOrigin(0.5, 0);
    });
    this.add.text(cx, 478, `Battle lasted ${mins}:${secs}`, textStyle(14, COLORS.textDim)).setOrigin(0.5, 0);
    if (report.lines.length) this.add.text(cx, 232, report.lines.join('  '), textStyle(16, COLORS.gold, { align: 'center', wordWrap: { width: 600 } })).setOrigin(0.5, 0);

    const next = run.over
      ? () => this.scene.start('RunEnd')
      : () => {
          this.registry.set('chart-note', [o.text, ...report.lines].join(' '));
          this.scene.start('SeaMap');
        };
    new Button(this, cx - 140, 540, 280, 44, run.over ? 'The voyage ends →' : 'Back to the chart →', next, { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', next);
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
