import Phaser from 'phaser';
import type { Run } from '../sim/Run';
import { SYSTEM_NAMES, type SystemId } from '../sim/types';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from './theme';
import { coin, drawBar, panel, SoundButton } from './ui';

/** The scene that holds the current voyage. Scenes share it through the game registry. */
export function currentRun(scene: Phaser.Scene): Run {
  const run = scene.registry.get('run') as Run | undefined;
  if (!run) throw new Error('No voyage under way');
  return run;
}

export function setRun(scene: Phaser.Scene, run: Run): void {
  scene.registry.set('run', run);
}

/** The crew's hunger on the jump just made, if it has not yet been shown in an event or port. */
export function freshHunger(scene: Phaser.Scene, run: Run): string {
  const jump = `${run.sector}:${run.jumps}`;
  if (!run.hungerNote || scene.registry.get('hunger-shown') === jump) return '';
  scene.registry.set('hunger-shown', jump);
  return run.hungerNote;
}

/** How far astern the fleet is, in plain words. */
export function fleetDistance(run: Run): string {
  const gap = run.node.col - run.navy;
  if (gap <= 0) return 'The Navy fleet is upon you!';
  const halves = Math.round(gap * 2) / 2;
  const n = `${Math.floor(halves) || ''}${halves % 1 ? '½' : ''}`;
  return `Navy fleet ${n} jump${halves > 1 ? 's' : ''} astern`;
}

/** Top-of-screen status strip for chart, event and port scenes: hull, crew, gold, damage and the fleet. */
export class RunBar {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly hull: Phaser.GameObjects.Text;
  private readonly crew: Phaser.GameObjects.Text;
  private readonly gold: Phaser.GameObjects.Text;
  private readonly damage: Phaser.GameObjects.Text;
  private readonly fleet: Phaser.GameObjects.Text;
  private readonly food: Phaser.GameObjects.Text;
  private readonly sector: Phaser.GameObjects.Text;
  /** What the strip last showed, so a refresh every frame only redraws when something changed. */
  private shown = '';

  constructor(scene: Phaser.Scene, private readonly run: Run) {
    panel(scene, 8, 8, SCREEN.w - 16, 62).setDepth(5);
    // Brass rules between the groups.
    const rules = scene.add.graphics().setDepth(6).lineStyle(1, COLORS.brass, 0.3);
    for (const x of [218, 548, 1012]) rules.lineBetween(x, 18, x, 60);
    scene.add.text(20, 14, run.def.name, { fontFamily: TITLE_FONT, fontSize: '23px', color: COLORS.gold }).setDepth(6).setShadow(0, 1, '#000000', 3, false, true);
    scene.add.text(20, 44, run.def.className, textStyle(13, COLORS.textDim, { fontStyle: 'italic' })).setDepth(6);
    this.g = scene.add.graphics().setDepth(6);
    this.hull = scene.add.text(230, 14, '', textStyle(14)).setDepth(6);
    this.crew = scene.add.text(230, 44, '', textStyle(13)).setDepth(6);
    coin(scene, 572, 25, 20).setDepth(6);
    this.gold = scene.add.text(588, 14, '', textStyle(18, COLORS.gold, { fontStyle: 'bold' })).setDepth(6);
    this.damage = scene.add.text(560, 44, '', textStyle(12, COLORS.textWarn)).setDepth(6);
    this.fleet = scene.add.text(SCREEN.w - 22, 14, '', textStyle(16, COLORS.textWarn, { fontStyle: 'bold' })).setOrigin(1, 0).setDepth(6);
    this.sector = scene.add.text(SCREEN.w - 22, 44, '', textStyle(12, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(1, 0).setDepth(6);
    this.food = scene.add.text(760, 14, '', textStyle(16, COLORS.text, { fontStyle: 'bold' })).setDepth(6);
    new SoundButton(scene, 972, 23, 30).setDepth(6);
    this.refresh();
  }

  refresh(): void {
    const { run } = this;
    const c = run.condition;
    const state = `${c.hull}/${run.fit.hull} ${c.crew.map((m) => m.hp).join()}/${run.maxCrew} ${run.gold} ${JSON.stringify(c.damage)} ${run.navy}@${run.nodeId} ${run.sector} ${run.provisions}/${run.maxProvisions}`;
    if (state === this.shown) return;
    this.shown = state;
    const g = this.g;
    g.clear();
    this.hull.setText(`Hull ${c.hull}/${run.fit.hull}`);
    const frac = c.hull / run.fit.hull;
    drawBar(g, 330, 17, 200, 14, frac, frac > 0.5 ? 0x7fdc6a : frac > 0.25 ? 0xe5c23a : 0xe0452f);
    const hurt = c.crew.filter((m) => m.hp < 70).length;
    this.crew.setText(`Crew ${c.crew.length}/${run.maxCrew}${hurt ? `  (${hurt} wounded)` : ''}`);
    this.gold.setText(`${run.gold} gold`);
    const dmg = (Object.entries(c.damage) as [SystemId, number][]).map(([id, n]) => `${SYSTEM_NAMES[id]} −${n}`);
    this.damage.setText(dmg.length ? `Damaged: ${dmg.join(', ')}` : '');
    // The fleet's line warms from parchment to red as it closes.
    const gap = run.node.col - run.navy;
    this.fleet.setText(fleetDistance(run)).setColor(gap > 2 ? COLORS.text : gap > 1 ? COLORS.gold : COLORS.textWarn);
    this.sector.setText(`Sector ${run.sector + 1}: ${run.sectorDef.name}`);
    this.food.setText(`Provisions ${run.provisions}/${run.maxProvisions}`);
    this.food.setColor(run.provisions === 0 ? COLORS.textWarn : run.provisions <= 3 ? COLORS.gold : COLORS.text);
  }
}
