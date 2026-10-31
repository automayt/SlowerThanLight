import Phaser from 'phaser';
import { TAVERNS } from '../data/nemesis';
import { voyage } from '../net/voyage';
import { DICE_HANDS, DICE_STAKES, DICE_TARGET, diceTotal, type Run } from '../sim/Run';
import { portraitFor } from '../data/portraits';
import { Dialogue } from './Dialogue';
import { escHandled } from './escape';
import { COLORS, SCREEN, TYPE, inkStyle, titleStyle } from './theme';
import { Button, panel, ribbon } from './ui';

/** Draw one die: a bone-white square with its pips. */
function drawDie(g: Phaser.GameObjects.Graphics, x: number, y: number, s: number, value: number, dim = false): void {
  g.fillStyle(0x000000, 0.35).fillRoundedRect(x + 2, y + 3, s, s, s * 0.18);
  g.fillStyle(dim ? 0xb9ab8a : 0xf1e6c8, 1).fillRoundedRect(x, y, s, s, s * 0.18);
  g.lineStyle(1.5, 0x3a2614, 0.9).strokeRoundedRect(x, y, s, s, s * 0.18);
  const c = s / 2;
  const o = s * 0.27;
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-o, -o], [o, o]],
    3: [[-o, -o], [0, 0], [o, o]],
    4: [[-o, -o], [o, -o], [-o, o], [o, o]],
    5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
    6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
  };
  g.fillStyle(value === 1 ? 0x8a1c1c : 0x1a0e05, 1);
  for (const [dx, dy] of pips[value] ?? []) g.fillCircle(x + c + dx, y + c + dy, s * 0.085);
}

/**
 * The port's tavern, over the port screen: stand a round to hear what lies ahead, or play Bones against a local
 * captain. Both are voyage commands (the captain's, in co-op); `say` and `refresh` run when one is carried out.
 */
export class Tavern {
  private frame: Phaser.GameObjects.GameObject[] = [];
  private objects: Phaser.GameObjects.GameObject[] = [];
  closed = false;
  private last = '';
  /** What the keeper and the rival last said: words already heard are not typed out again on a redraw. */
  private spoken: Record<string, string> = {};
  private readonly w = 980;
  private readonly h = 540;
  private static readonly DEPTH = 50;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly run: Run,
    private readonly onClose: () => void = () => {},
  ) {
    const x = (SCREEN.w - this.w) / 2;
    const y = (SCREEN.h - this.h) / 2;
    const d = Tavern.DEPTH;
    const shade = scene.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.55).setOrigin(0).setDepth(d).setInteractive();
    shade.on('pointerdown', () => this.close());
    const close = new Button(scene, SCREEN.w / 2 - 70, y + this.h - 50, 140, 36, 'Close', () => this.close(), { size: 15, hint: 'Esc' }).setDepth(d + 1);
    const name = run.encounter.kind === 'port' ? run.encounter.name : '';
    const sheet = panel(scene, x, y, this.w, this.h, { modal: true, skin: 'parchment' }).setDepth(d);
    // The sheet swallows clicks: only the shade around it closes the tavern.
    sheet.setInteractive();
    this.frame = [shade, sheet, close, ribbon(scene, SCREEN.w / 2, y + 2, TAVERNS[name] ?? 'The Tavern', { size: 22, depth: d + 2 })];
    this.frame.push(scene.add.rectangle(SCREEN.w / 2, y + 60, 1, this.h - 130, 0x6a4a22, 0.4).setOrigin(0.5, 0).setDepth(d + 1));
    scene.input.keyboard?.once('keydown-ESC', () => this.close());
    this.refresh();
  }

  /** Show what the last move did (the result of a rumour or a throw). */
  say(text: string | null): void {
    if (text) this.last = text;
    this.refresh();
  }

  /** Lay out both halves from the run (again after each move). */
  refresh(): void {
    if (this.closed) return;
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(Tavern.DEPTH + 1);
      this.objects.push(o);
      return o;
    };
    this.rumours(add);
    this.bones(add);
  }

  /** Someone at the tavern speaking, typed out only the first time those words are said. */
  private speaker(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, key: string, x: number, y: number, w: number, portrait: string, name: string, role: string, text: string): number {
    const d = add(new Dialogue(this.scene, { x, y, w, portrait, name, role, text, portraitH: 112, size: 14, cps: 90 }));
    if (this.spoken[key] === text) d.skip();
    this.spoken[key] = text;
    return d.fullHeight;
  }

  private rumours(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const { scene, run } = this;
    const x = (SCREEN.w - this.w) / 2 + 28;
    let y = (SCREEN.h - this.h) / 2 + 66;
    const w = this.w / 2 - 56;
    const port = run.encounter.kind === 'port' ? run.encounter.name : '';
    const heard = run.encounter.kind === 'port' ? run.encounter.rumours : undefined;
    // The keeper tells the rumours herself, once a round is bought.
    const words = heard
      ? heard.join('\n\n')
      : run.portFeud
        ? 'We don’t serve your sort here. Drink up whatever you brought and go.'
        : 'Stand the house a round, Captain, and the talk turns to the waters ahead: what the sails out there are, what tales wait in the unknown waters, and now and then a wreck worth diving on.';
    y += this.speaker(add, 'keeper', x, y, w, portraitFor('tavern'), 'The keeper', `${TAVERNS[port] ?? 'The Tavern'}, ${port || 'ashore'}`, words) + 16;
    if (heard) return;
    const price = run.rumourPrice();
    const why = run.portFeud ? 'Nobody here will talk to you.' : run.gold < price ? `You are ${price - run.gold} gold short.` : undefined;
    add(new Button(scene, x, y, 240, 40, `Stand a round · ${price}`, () => voyage(scene, { t: 'rumour' }, 'Stand a round in the tavern'), { size: 15, icon: 'gold', tip: why ?? `Stand the house a round for ${price} gold.` })).setEnabled(run.canBuyRumour());
  }

  private bones(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T): void {
    const { scene, run } = this;
    const table = run.diceTable;
    if (!table) return;
    const x = SCREEN.w / 2 + 28;
    let y = (SCREEN.h - this.h) / 2 + 66;
    const w = this.w / 2 - 56;
    const left = DICE_HANDS - table.played;
    const greeting = left <= 0 ? 'Enough. You’ve had the best of me tonight, or I of you. Come back when the tide turns.' : 'Sit down, Captain. Bones is a simple game: two dice, a little nerve, and knowing when to stop.';
    y += this.speaker(add, 'rival', x, y, w, portraitFor('dice'), table.rival, 'Plays Bones for coin', greeting) + 12;
    const rules = add(
      scene.add.text(x, y, `Roll two dice, then roll again or stand. Over ${DICE_TARGET} and you bust. He rolls until he beats you or busts; a tie is a push. Exactly ${DICE_TARGET} pays double.`, inkStyle(TYPE.body, COLORS.inkDim, { wordWrap: { width: w }, lineSpacing: 2 })),
    );
    y += rules.height + 12;
    const hand = table.hand;
    const g = add(scene.add.graphics());
    const row = (label: string, dice: number[], dim: boolean) => {
      add(scene.add.text(x, y + 12, label, inkStyle(14, COLORS.ink, { fontStyle: 'bold' })));
      dice.forEach((v, i) => drawDie(g, x + 92 + i * 40, y, 32, v, dim));
      if (dice.length) add(scene.add.text(x + 92 + dice.length * 40 + 6, y + 8, `${diceTotal(dice)}`, titleStyle(23, diceTotal(dice) > DICE_TARGET ? COLORS.inkRed : COLORS.inkGold)));
      y += 44;
    };
    if (hand) {
      row('You', hand.you, false);
      row('Rival', hand.rival, true);
    }
    if (this.last) {
      const said = add(scene.add.text(x, y, this.last, inkStyle(14, COLORS.inkGold, { fontStyle: 'italic', wordWrap: { width: w } })));
      y += said.height + 10;
    }
    const live = !!hand && !hand.result;
    if (live) {
      add(new Button(scene, x, y, 150, 40, 'Roll again', () => voyage(scene, { t: 'dice', act: 'roll' }, 'Roll again at Bones'), { size: 15 })).setEnabled(run.canDice('roll'));
      add(new Button(scene, x + 162, y, 150, 40, `Stand on ${diceTotal(hand.you)}`, () => voyage(scene, { t: 'dice', act: 'stand' }, 'Stand at Bones'), { size: 15 })).setEnabled(run.canDice('stand'));
      return;
    }
    add(scene.add.text(x, y, left > 0 ? `${left} hand${left > 1 ? 's' : ''} left before your rival calls it a night.` : `${table.rival} has had enough of you for one night.`, inkStyle(TYPE.body, COLORS.inkDim, { fontStyle: 'italic' })));
    y += 26;
    DICE_STAKES.forEach((stake, i) => {
      const why = left <= 0 ? 'The table is closed to you tonight.' : run.gold < stake ? `You are ${stake - run.gold} gold short.` : undefined;
      add(new Button(scene, x + i * 104, y, 96, 40, `${stake}`, () => voyage(scene, { t: 'dice', act: 'stake', stake }, `Stake ${stake} gold at Bones`), { size: 15, icon: 'gold', tip: why ?? `Stake ${stake} gold on a hand of Bones.` })).setEnabled(run.canDice('stake', stake));
    });
  }

  close(): void {
    if (this.closed) return;
    escHandled();
    this.closed = true;
    const items = [...this.frame, ...this.objects];
    // After this click finishes dispatching.
    this.scene.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
    this.onClose();
  }
}
