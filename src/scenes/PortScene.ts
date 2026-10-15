import Phaser from 'phaser';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { CREW_PRICE, HULL_PRICE, type Run } from '../sim/Run';

const W = 760;
const H = 500;
const X = (SCREEN.w - W) / 2;
const Y = 100;

/** A friendly port: buy hull repairs and crew, or rest and refit while the fleet closes in. */
export class PortScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private rest!: Button;
  private patch!: Button;
  private patchAll!: Button;
  private hire!: Button;
  private note!: Phaser.GameObjects.Text;
  private roster!: Phaser.GameObjects.Text;

  constructor() {
    super('Port');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    this.bar = new RunBar(this, run);
    const name = run.encounter.kind === 'port' ? run.encounter.name : 'Port';

    panel(this, X, Y, W, H);
    this.add.text(SCREEN.w / 2, Y + 18, name, { fontFamily: TITLE_FONT, fontSize: '36px', color: COLORS.gold }).setOrigin(0.5, 0);
    this.add
      .text(SCREEN.w / 2, Y + 66, 'A free port where no one asks where your cargo came from. Shipwrights, taverns full of idle sailors, and a harbourmaster who can be paid to forget.', textStyle(15, COLORS.textDim, { wordWrap: { width: W - 80 }, align: 'center' }))
      .setOrigin(0.5, 0);

    const bx = X + 40;
    const bw = 330;
    this.rest = new Button(this, bx, Y + 140, bw, 44, 'Rest & refit', () => this.act(run.rest(), 'The crew sleep ashore while the shipwrights mend every system.'), { size: 16 });
    this.add.text(bx + bw + 16, Y + 146, 'Heal all crew and repair every system.\nThe Navy fleet gains half a jump.', textStyle(13, COLORS.textDim));
    this.patch = new Button(this, bx, Y + 196, bw, 44, '', () => this.act(run.repairHull(1), 'Carpenters plank over the worst of the damage.'), { size: 16 });
    this.patchAll = new Button(this, bx, Y + 252, bw, 44, '', () => this.act(run.repairHull(this.affordableHull()), 'The hull is made good.'), { size: 16 });
    this.add.text(bx + bw + 16, Y + 210, `${HULL_PRICE} gold per point of hull.`, textStyle(13, COLORS.textDim));
    this.hire = new Button(this, bx, Y + 308, bw, 44, '', () => this.hireOne(), { size: 16 });
    this.add.text(bx + bw + 16, Y + 314, `Sign on a sailor from the taverns.\nYou have bunks for ${run.maxCrew}.`, textStyle(13, COLORS.textDim));

    this.roster = this.add.text(bx, Y + 370, '', textStyle(13, COLORS.text, { wordWrap: { width: W - 80 }, lineSpacing: 3 }));
    this.note = this.add.text(SCREEN.w / 2, Y + H - 90, '', textStyle(15, COLORS.textGood, { fontStyle: 'italic' })).setOrigin(0.5, 0);

    const leave = () => {
      run.leavePort();
      this.registry.set('chart-note', `You weigh anchor and stand out of ${name}.`);
      this.scene.start('SeaMap');
    };
    new Button(this, SCREEN.w / 2 - 120, Y + H - 56, 240, 44, 'Weigh anchor →', leave, { size: 18 });
    this.input.keyboard!.once('keydown-ENTER', leave);
  }

  private affordableHull(): number {
    return Math.min(this.run.hullMissing(), Math.floor(this.run.gold / HULL_PRICE));
  }

  private hireOne(): void {
    const name = this.run.hireCrew();
    if (name) this.note.setText(`${name} signs the articles.`).setColor(COLORS.textGood);
  }

  private act(ok: boolean, text: string): void {
    if (ok) this.note.setText(text).setColor(COLORS.textGood);
  }

  update(time: number): void {
    const run = this.run;
    this.sea.draw(time);
    this.bar.refresh();
    const missing = run.hullMissing();
    const n = this.affordableHull();
    this.rest.setEnabled(run.canRest()).setText(run.canRest() ? 'Rest & refit' : 'Rested and refitted');
    this.patch.setEnabled(run.canRepairHull(1)).setText(missing ? `Patch 1 hull (${HULL_PRICE} gold)` : 'Hull is sound');
    this.patchAll.setEnabled(n > 1).setText(n > 1 ? `Patch ${n} hull (${n * HULL_PRICE} gold)` : 'Patch all you can afford');
    const full = run.condition.crew.length >= run.maxCrew;
    this.hire.setEnabled(run.canHire()).setText(full ? 'No bunks to spare' : `Hire a sailor (${CREW_PRICE} gold)`);
    this.roster.setText('Crew:  ' + run.condition.crew.map((c) => `${c.name} ${c.hp}%`).join(',  '));
  }
}
