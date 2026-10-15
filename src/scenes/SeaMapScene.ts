import Phaser from 'phaser';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { NAVY_SPEED, type Run } from '../sim/Run';
import type { NodeKind, SeaNode } from '../sim/SeaChart';

const LEFT = 90;
const RIGHT = SCREEN.w - 90;
const TOP = 130;
const BOTTOM = 560;
const NODE_R = 20;

const KIND_STYLE: Record<NodeKind, { color: number; label: string; glyph: string }> = {
  start: { color: 0x9fb1bf, label: 'Tortuga', glyph: '⚓' },
  battle: { color: 0xd2553a, label: 'Sail sighted', glyph: '⚔' },
  event: { color: 0x5a9bd4, label: 'Unknown', glyph: '?' },
  port: { color: 0x7fdc6a, label: 'Port', glyph: '⚓' },
  empty: { color: 0x6b7f8f, label: 'Open sea', glyph: '~' },
  boss: { color: 0x8a1c1c, label: 'The Blockade', glyph: '☠' },
};

/** The voyage chart: pick the next node to sail to while the Navy fleet closes from the west. */
export class SeaMapScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private g!: Phaser.GameObjects.Graphics;
  private hover: SeaNode | null = null;
  private tip!: Phaser.GameObjects.Text;
  private dialog: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('SeaMap');
  }

  init(): void {
    this.hover = null;
    this.dialog = [];
  }

  create(): void {
    const run = (this.run = currentRun(this));
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    this.g = this.add.graphics();
    this.bar = new RunBar(this, run);

    this.add.text(SCREEN.w / 2, 86, 'Choose your heading', { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5, 0);

    for (const node of run.chart.nodes) {
      const { x, y } = this.pos(node);
      const style = KIND_STYLE[node.kind];
      this.add.text(x, y, style.glyph, textStyle(node.kind === 'boss' ? 22 : 18, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5).setDepth(2);
      const label = node.kind === 'port' || node.kind === 'start' ? (node.name ?? style.label) : style.label;
      this.add.text(x, y + NODE_R + 4, label, textStyle(12, COLORS.textDim)).setOrigin(0.5, 0).setDepth(2);
      const hit = this.add.circle(x, y, NODE_R + 6, 0x000000, 0.001).setDepth(3);
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => (this.hover = node));
      hit.on('pointerout', () => this.hover === node && (this.hover = null));
      hit.on('pointerdown', () => this.sailTo(node));
    }

    panel(this, 8, SCREEN.h - 74, SCREEN.w - 16, 66);
    this.add.text(20, SCREEN.h - 66, this.lastWords(), textStyle(14, COLORS.text, { wordWrap: { width: SCREEN.w - 60 } }));
    this.add.text(20, SCREEN.h - 32, 'Click a highlighted node to sail there. The red tide is the Royal Navy: nodes it overruns become Navy ambushes.', textStyle(12, COLORS.textDim));

    this.tip = this.add
      .text(0, 0, '', textStyle(13, COLORS.text, { backgroundColor: '#000000dd', padding: { x: 8, y: 5 }, wordWrap: { width: 280 } }))
      .setDepth(20)
      .setVisible(false);

    if (run.encounter.kind === 'empty' && run.status === 'chart' && this.registry.get('fresh-jump')) {
      this.showDialog('Open Water', run.encounter.text, [['Continue', () => this.closeDialog()]]);
    }
    this.registry.set('fresh-jump', false);
  }

  /** The most recent thing that happened, for the footer. */
  private lastWords(): string {
    const note = this.registry.get('chart-note') as string | undefined;
    if (note) return note;
    return this.run.jumps === 0 ? 'You slip out of Tortuga at dawn. Somewhere astern, a Royal Navy squadron has your scent.' : 'The chart is spread on the captain’s table.';
  }

  private pos(node: SeaNode): { x: number; y: number } {
    const cols = this.run.chart.columns - 1;
    return { x: LEFT + ((RIGHT - LEFT) * node.col) / cols, y: TOP + (BOTTOM - TOP) * node.y };
  }

  private colX(col: number): number {
    return LEFT + ((RIGHT - LEFT) * col) / (this.run.chart.columns - 1);
  }

  private sailTo(node: SeaNode): void {
    if (this.dialog.length) return;
    const run = this.run;
    if (!run.reachable().some((n) => n.id === node.id)) return;
    const enc = run.jump(node.id);
    this.registry.set('chart-note', '');
    switch (enc.kind) {
      case 'battle': {
        const foe = run.currentEnemy();
        const title = enc.boss ? 'The Blockade' : enc.ambush ? 'Overrun!' : 'Sail Ho!';
        this.showDialog(title, `${enc.text}\n\n${foe.ship.name}, ${foe.ship.className}.`, [['Beat to quarters!', () => this.scene.start('Battle')]]);
        break;
      }
      case 'event':
        this.scene.start('Event');
        break;
      case 'port':
        this.scene.start('Port');
        break;
      default:
        this.registry.set('fresh-jump', true);
        this.registry.set('chart-note', enc.kind === 'empty' ? enc.text : '');
        this.scene.restart();
    }
  }

  private showDialog(title: string, text: string, buttons: [string, () => void][]): void {
    const w = 520;
    const h = 250;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2;
    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.45).setOrigin(0).setDepth(30).setInteractive();
    const box = panel(this, x, y, w, h).setDepth(31);
    const t = this.add.text(SCREEN.w / 2, y + 18, title, { fontFamily: TITLE_FONT, fontSize: '30px', color: COLORS.gold }).setOrigin(0.5, 0).setDepth(32);
    const body = this.add.text(x + 26, y + 66, text, textStyle(15, COLORS.text, { wordWrap: { width: w - 52 }, lineSpacing: 4 })).setDepth(32);
    this.dialog = [shade, box, t, body];
    buttons.forEach(([label, fn], i) => {
      const bw = 220;
      const bx = SCREEN.w / 2 - (buttons.length * (bw + 12) - 12) / 2 + i * (bw + 12);
      const b = new Button(this, bx, y + h - 60, bw, 42, label, fn, { size: 17 }).setDepth(32);
      this.dialog.push(b);
    });
    this.input.keyboard!.once('keydown-ENTER', () => this.dialog.length && buttons[0][1]());
  }

  private closeDialog(): void {
    for (const o of this.dialog) o.destroy();
    this.dialog = [];
  }

  update(time: number): void {
    const run = this.run;
    const g = this.g;
    this.sea.draw(time);
    g.clear();

    // The fleet: a red tide from the west edge up to its front.
    const front = Math.max(0, this.colX(run.navy));
    if (front > 0) {
      g.fillStyle(0x8a1c1c, 0.28).fillRect(0, 78, front, SCREEN.h - 74 - 78);
      g.lineStyle(3, 0xd23c3c, 0.8);
      g.beginPath();
      for (let y = 78; y <= SCREEN.h - 74; y += 6) {
        const x = front + Math.sin(y / 18 + time / 400) * 5;
        if (y === 78) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    // Where the fleet will be after your next jump.
    const next = this.colX(run.navy + NAVY_SPEED);
    if (next > 0 && run.status === 'chart') {
      g.lineStyle(1, 0xd23c3c, 0.45);
      for (let y = 82; y < SCREEN.h - 80; y += 16) g.lineBetween(next, y, next, y + 8);
    }

    const reach = new Set(run.reachable().map((n) => n.id));
    const visited = new Set(run.visited);

    // Routes.
    for (const n of run.chart.nodes) {
      const a = this.pos(n);
      for (const id of n.next) {
        const m = run.chart.nodes[id];
        const b = this.pos(m);
        const sailed = visited.has(n.id) && visited.has(m.id) && run.visited.indexOf(m.id) === run.visited.indexOf(n.id) + 1;
        const open = n.id === run.nodeId && reach.has(m.id);
        g.lineStyle(sailed ? 4 : open ? 3 : 2, sailed ? 0xf2c45a : open ? 0xffffff : 0x9fb1bf, sailed ? 0.9 : open ? 0.8 : 0.3);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }

    // Nodes.
    for (const n of run.chart.nodes) {
      const { x, y } = this.pos(n);
      const style = KIND_STYLE[n.kind];
      const overrun = n.kind !== 'boss' && n.col <= run.navy;
      const r = n.kind === 'boss' ? NODE_R + 6 : NODE_R;
      g.fillStyle(overrun ? 0x4a1414 : style.color, visited.has(n.id) && n.id !== run.nodeId ? 0.45 : 1).fillCircle(x, y, r);
      if (reach.has(n.id)) {
        const pulse = 3 + Math.sin(time / 200) * 2;
        g.lineStyle(3, run.willBeOverrun(n) ? 0xff5050 : COLORS.select, 1).strokeCircle(x, y, r + pulse);
      } else {
        g.lineStyle(2, 0x000000, 0.6).strokeCircle(x, y, r);
      }
      if (this.hover === n) g.lineStyle(2, 0xffffff, 1).strokeCircle(x, y, r + 9);
    }

    // Your ship.
    const here = this.pos(run.node);
    const bob = Math.sin(time / 300) * 2;
    g.fillStyle(0x2b1a0d, 1).fillTriangle(here.x - 16, here.y - 30 + bob, here.x + 16, here.y - 30 + bob, here.x, here.y - 20 + bob);
    g.fillStyle(0xf3e3b5, 1).fillTriangle(here.x - 2, here.y - 54 + bob, here.x - 2, here.y - 31 + bob, here.x + 14, here.y - 33 + bob);
    g.lineStyle(2, 0x2b1a0d, 1).lineBetween(here.x - 2, here.y - 56 + bob, here.x - 2, here.y - 30 + bob);

    this.updateTip();
    this.bar.refresh();
  }

  private updateTip(): void {
    const n = this.hover;
    if (!n || this.dialog.length) {
      this.tip.setVisible(false);
      return;
    }
    const run = this.run;
    const lines: string[] = [];
    const style = KIND_STYLE[n.kind];
    lines.push(n.kind === 'port' ? `${n.name}: a friendly port` : n.kind === 'start' ? 'Tortuga' : style.label);
    if (n.kind === 'battle') lines.push('A ship. Prize or predator?');
    if (n.kind === 'event') lines.push('Something unusual on the horizon.');
    if (n.kind === 'port') lines.push('Repair the hull, hire crew, rest and refit.');
    if (n.kind === 'empty') lines.push('Nothing but sea. Time to make repairs.');
    if (n.kind === 'boss') lines.push('HMS Relentless guards the channel to the open ocean. No running from this one.');
    const reachable = run.reachable().some((m) => m.id === n.id);
    if (reachable && run.willBeOverrun(n)) lines.push('⚠ The fleet will overrun this before you get there: a Navy ambush.');
    else if (n.kind !== 'boss' && n.col <= run.navy) lines.push('Overrun by the Navy fleet.');
    if (!reachable && n.id !== run.nodeId) lines.push('(Not reachable from here)');
    const { x, y } = this.pos(n);
    this.tip.setText(lines.join('\n'));
    this.tip.setPosition(Math.min(x + 28, SCREEN.w - this.tip.width - 10), Math.max(80, y - this.tip.height - 10));
    this.tip.setVisible(true);
  }
}
