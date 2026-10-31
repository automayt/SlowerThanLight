import Phaser from 'phaser';
import type { Run } from '../sim/Run';
import { SYSTEM_NAMES, type SystemId } from '../sim/types';
import { icon } from './icons';
import { openLedger } from './Ledger';
import { COLORS, SCREEN, TYPE, textStyle, titleStyle } from './theme';
import { OptionsButton } from './options';
import { Button, drawBar, panel, SoundButton, tipZone } from './ui';

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

const D = 6;

/**
 * Top-of-screen status strip for chart, event and port scenes: the ship, her hull and crew, gold and provisions,
 * damage as station icons, and the fleet astern. Figures stand by their icons; the words are in the tips.
 */
export class RunBar {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly hull: Phaser.GameObjects.Text;
  private readonly crew: Phaser.GameObjects.Text;
  private readonly gold: Phaser.GameObjects.Text;
  private readonly fleet: Phaser.GameObjects.Text;
  private readonly food: Phaser.GameObjects.Text;
  private readonly sector: Phaser.GameObjects.Text;
  /** Icons for damaged stations and wounded crew, remade when they change. */
  private marks: Phaser.GameObjects.GameObject[] = [];
  /** What the strip last showed, so a refresh every frame only redraws when something changed. */
  private shown = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly run: Run,
  ) {
    panel(scene, 8, 8, SCREEN.w - 16, 62).setDepth(5);
    // Brass rules between the groups.
    const rules = scene.add.graphics().setDepth(D).lineStyle(1, COLORS.brass, 0.3);
    for (const x of [218, 440, 1012]) rules.lineBetween(x, 18, x, 60);
    const name = scene.add.text(20, 13, run.def.name, titleStyle(23, COLORS.gold)).setDepth(D).setShadow(0, 1, '#000000', 3, false, true);
    for (let size = 22; name.width > 192 && size >= 16; size--) name.setFontSize(size);
    scene.add.text(20, 44, run.def.className, textStyle(TYPE.body, COLORS.textDim, { fontStyle: 'italic' })).setDepth(D);
    this.g = scene.add.graphics().setDepth(D);

    // Hull and crew.
    icon(scene, 242, 26, 'hull', 30).setDepth(D);
    this.hull = scene.add.text(424, 25, '', textStyle(TYPE.body, '#fff6e0', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 })).setOrigin(1, 0.5).setDepth(D + 0.5);
    tipZone(scene, 226, 12, 204, 28, () => `Hull ${run.condition.hull} of ${run.fit.hull}. Shipwrights in port mend her; a fight at none sinks her.`).setDepth(D);
    icon(scene, 242, 53, 'crew', 22).setDepth(D);
    this.crew = scene.add.text(258, 45, '', textStyle(TYPE.body)).setDepth(D);
    tipZone(scene, 226, 42, 110, 24, () => this.crewTip()).setDepth(D);

    // Gold and provisions.
    icon(scene, 466, 27, 'gold', 32).setDepth(D);
    this.gold = scene.add.text(486, 12, '', titleStyle(24, COLORS.gold)).setDepth(D).setShadow(0, 1, '#000000', 2, false, true);
    tipZone(scene, 448, 12, 110, 30, () => `${run.gold} gold: for repairs, stores, guns and hands in port.`).setDepth(D);
    icon(scene, 600, 27, 'provisions', 32).setDepth(D);
    this.food = scene.add.text(620, 16, '', textStyle(17, COLORS.text, { fontStyle: 'bold' })).setDepth(D);
    tipZone(scene, 582, 12, 110, 30, () =>
      `Provisions: ${run.provisions} of ${run.maxProvisions}. Each jump eats one; with none, the crew go hungry and weaken. Buy more in port.`,
    ).setDepth(D);

    this.fleet = scene.add.text(SCREEN.w - 22, 14, '', textStyle(16, COLORS.textWarn, { fontStyle: 'bold' })).setOrigin(1, 0).setDepth(D);
    this.sector = scene.add.text(SCREEN.w - 22, 44, '', textStyle(12, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(1, 0).setDepth(D);
    tipZone(scene, 1020, 12, SCREEN.w - 1040, 50, () => `${fleetDistance(run)}. The Navy follows your wake: keep ahead of it, and leave the sector by its far side.`).setDepth(D);
    new OptionsButton(scene, 972, 23, 30).setDepth(D);
    new SoundButton(scene, 884, 23, 30).setDepth(D);
    // How the powers regard you, a click or the L key away on every screen that shows this strip.
    new Button(scene, 922, 21, 34, 34, '', () => openLedger(scene, run), { icon: 'flag', tip: 'Standing at sea (L)' }).setDepth(D);
    scene.input.keyboard?.on('keydown-L', () => openLedger(scene, run));
    this.refresh();
  }

  private crewTip(): string {
    const c = this.run.condition;
    const hurt = c.crew.filter((m) => m.hp < 70);
    const consort = this.run.consort;
    return [
      `Crew ${c.crew.length} of ${this.run.maxCrew} berths.`,
      hurt.length ? `Wounded: ${hurt.map((m) => `${m.name} (${Math.round(m.hp)})`).join(', ')}.` : 'None wounded.',
      consort ? `In company: ${consort.name}, hull ${consort.hull} of ${consort.maxHull}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  refresh(): void {
    const { run, scene } = this;
    const c = run.condition;
    const state = `${c.hull}/${run.fit.hull} ${c.crew.map((m) => m.hp).join()}/${run.maxCrew} ${run.gold} ${JSON.stringify(c.damage)} ${run.navy}@${run.nodeId} ${run.sector} ${run.provisions}/${run.maxProvisions} ${run.consort?.hull ?? '-'}`;
    if (state === this.shown) return;
    this.shown = state;
    const g = this.g;
    g.clear();
    this.hull.setText(`${c.hull}/${run.fit.hull}`);
    const frac = c.hull / run.fit.hull;
    drawBar(g, 262, 18, 166, 15, frac, frac > 0.5 ? 0x7fdc6a : frac > 0.25 ? 0xe5c23a : 0xe0452f);
    const hurt = c.crew.filter((m) => m.hp < 70).length;
    this.crew.setText(`${c.crew.length}/${run.maxCrew}`);
    this.gold.setText(`${run.gold}`);
    // The fleet's line warms from parchment to red as it closes.
    const gap = run.node.col - run.navy;
    this.fleet.setText(fleetDistance(run)).setColor(gap > 2 ? COLORS.text : gap > 1 ? COLORS.gold : COLORS.textWarn);
    this.sector.setText(`Sector ${run.sector + 1}: ${run.sectorDef.name}`);
    this.food.setText(`${run.provisions}/${run.maxProvisions}`);
    this.food.setColor(run.provisions === 0 ? COLORS.textWarn : run.provisions <= 3 ? COLORS.gold : COLORS.text);
    drawBar(g, 621, 42, 64, 5, run.provisions / Math.max(1, run.maxProvisions), run.provisions <= 3 ? 0xe5c23a : 0x9ac07a);

    // Marks: a heart for the wounded, a prize in company, and each damaged station by its icon.
    for (const o of this.marks) o.destroy();
    this.marks = [];
    let x = this.crew.x + this.crew.width + 12;
    const mark = (name: Parameters<typeof icon>[3], text: string, color: string, tip: string, at = x, y = 54) => {
      const img = icon(scene, at + 8, y, name, 17).setDepth(D);
      const t = scene.add.text(at + 18, y - 8, text, textStyle(12, color, { fontStyle: 'bold' })).setDepth(D);
      const zone = tipZone(scene, at, y - 11, 20 + t.width, 22, tip).setDepth(D);
      this.marks.push(img, t, zone);
      return at + 22 + t.width + 8;
    };
    if (hurt) x = mark('heart', `${hurt}`, COLORS.textWarn, `${hurt} wounded: rest them in port, or a surgeon heals them at sea.`);
    if (run.consort) x = mark('flag', `${run.consort.hull}/${run.consort.maxHull}`, COLORS.textGood, `In company: ${run.consort.name}, hull ${run.consort.hull} of ${run.consort.maxHull}.`, Math.min(x, 380));
    let dx = 700;
    for (const [id, n] of Object.entries(c.damage) as [SystemId, number][]) {
      if (!n) continue;
      dx = mark(id, `−${n}`, COLORS.textWarn, `${SYSTEM_NAMES[id]} damaged (−${n}): a shipwright in port puts it right.`, dx, 40);
    }
  }
}
