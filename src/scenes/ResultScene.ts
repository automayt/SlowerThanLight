import Phaser from 'phaser';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, Sea } from '../render/ui';
import type { ResultData } from './BattleScene';

export class ResultScene extends Phaser.Scene {
  private sea!: Sea;

  constructor() {
    super('Result');
  }

  create(data: ResultData): void {
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    const { battle, shipId } = data;
    const o = battle.outcome!;
    const cx = SCREEN.w / 2;

    this.add.rectangle(cx - 330, 110, 660, 470, COLORS.panel, 0.93).setOrigin(0).setStrokeStyle(2, COLORS.panelEdge);
    this.add
      .text(cx, 170, o.title, { fontFamily: TITLE_FONT, fontSize: '48px', color: o.won ? COLORS.gold : COLORS.textWarn, stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5);
    this.add.text(cx, 230, o.text, textStyle(17, COLORS.text, { align: 'center', wordWrap: { width: 580 } })).setOrigin(0.5, 0);

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
      ['Crew remaining', `${battle.player.crew.length}/${battle.player.def.crew.length}`, `${battle.enemy.crew.length}/${battle.enemy.def.crew.length}`],
    ];
    rows.forEach(([label, a, b], i) => {
      const y = 300 + i * 30;
      const style = textStyle(16, i === 0 ? COLORS.gold : COLORS.text);
      this.add.text(cx - 280, y, label, textStyle(16, COLORS.textDim));
      this.add.text(cx + 40, y, a, style).setOrigin(0.5, 0);
      this.add.text(cx + 210, y, b, style).setOrigin(0.5, 0);
    });
    this.add.text(cx, 488, `Battle lasted ${mins}:${secs}`, textStyle(14, COLORS.textDim)).setOrigin(0.5, 0);

    new Button(this, cx - 250, 520, 230, 44, 'Fight Again', () => this.scene.start('Battle', { shipId }), { size: 18 });
    new Button(this, cx + 20, 520, 230, 44, 'Choose Another Ship', () => this.scene.start('ShipSelect', { shipId }), { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', () => this.scene.start('Battle', { shipId }));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
