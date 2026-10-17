import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { playLoop, stopLoop } from '../render/sound';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { type Run } from '../sim/Run';
import { SECTORS } from '../data/voyage';
import type { NodeKind, SeaNode } from '../sim/SeaChart';
import { saveRun } from './save';

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
  exit: { color: 0xd8b45a, label: 'Passage', glyph: '»' },
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
  /** Enter-key shortcut of the open dialog, removed when the dialog closes. */
  private dialogEnter: (() => void) | null = null;

  constructor() {
    super('SeaMap');
  }

  init(): void {
    this.hover = null;
    this.dialog = [];
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    stopLoop(this, 'shanty');
    playLoop(this, 'waves', 0.25);
    this.g = this.add.graphics();
    this.bar = new RunBar(this, run);

    const sectorLine = `${run.sectorDef.name}  ·  Sector ${run.sector + 1} of ${SECTORS.length}`;
    this.add.text(SCREEN.w / 2, 84, sectorLine, { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5, 0);

    for (const node of run.chart.nodes) {
      const { x, y } = this.pos(node);
      const style = KIND_STYLE[node.kind];
      this.add.text(x, y, style.glyph, textStyle(node.kind === 'boss' || node.kind === 'exit' ? 22 : 18, '#ffffff', { fontStyle: 'bold' })).setOrigin(0.5).setDepth(2);
      const label = node.kind === 'port' || node.kind === 'start' || node.kind === 'exit' ? (node.name ?? style.label) : style.label;
      this.add.text(x, y + NODE_R + 4, label, textStyle(12, COLORS.textDim)).setOrigin(0.5, 0).setDepth(2);
      const hit = this.add.circle(x, y, NODE_R + 6, 0x000000, 0.001).setDepth(3);
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => (this.hover = node));
      hit.on('pointerout', () => this.hover === node && (this.hover = null));
      hit.on('pointerdown', () => this.sailTo(node));
    }

    panel(this, 8, SCREEN.h - 74, SCREEN.w - 16, 66);
    this.add.text(20, SCREEN.h - 66, this.lastWords(), textStyle(14, COLORS.text, { wordWrap: { width: SCREEN.w - 60 } }));
    const hint =
      run.provisions <= 3
        ? `⚠ ${run.provisions === 0 ? 'No provisions left: every jump now costs the crew health' : `Only ${run.provisions} provisions left`}. Buy more in port, or take them from prizes.`
        : 'Click a highlighted node to sail on, or across to explore its neighbour (a jump and a day’s provisions). The red tide is the Navy: nodes it overruns become ambushes.';
    this.add.text(20, SCREEN.h - 32, hint, textStyle(12, run.provisions <= 3 ? COLORS.textWarn : COLORS.textDim));

    this.tip = this.add
      .text(0, 0, '', textStyle(13, COLORS.text, { backgroundColor: '#000000dd', padding: { x: 8, y: 5 }, wordWrap: { width: 280 } }))
      .setDepth(20)
      .setVisible(false);

    if (run.encounter.kind === 'empty' && run.status === 'chart' && this.registry.get('fresh-jump')) {
      const title = run.encounter.title ?? 'Open Water';
      const text = [run.hungerNote, run.encounter.text].filter(Boolean).join('\n\n');
      this.showDialog(title, text, [['Continue', () => this.closeDialog()]], run.encounter.title ? 'blockade' : undefined);
    }
    this.registry.set('fresh-jump', false);
  }

  /** The most recent thing that happened, for the footer. */
  private lastWords(): string {
    const note = this.registry.get('chart-note') as string | undefined;
    if (note) return note;
    if (this.run.jumps === 0) return 'You slip out of Tortuga at dawn. Somewhere astern, a Royal Navy squadron has your scent. Three stretches of sea lie between you and freedom.';
    return this.run.node.kind === 'start' ? `${this.run.sectorDef.blurb}` : 'The chart is spread on the captain’s table.';
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
    saveRun(run);
    this.registry.set('chart-note', '');
    switch (enc.kind) {
      case 'battle': {
        const foe = run.currentEnemy();
        const title = enc.boss ? 'The Blockade' : enc.ambush ? 'Overrun!' : 'Sail Ho!';
        const hunger = run.hungerNote ? `${run.hungerNote}\n\n` : '';
        this.showDialog(title, `${hunger}${enc.text}\n\n${enc.name}, ${foe.ship.className}.`, [['Beat to quarters!', () => this.scene.start('Battle')]], enc.boss ? 'blockade' : `enemy-${foe.id}`);
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

  private showDialog(title: string, text: string, buttons: [string, () => void][], art?: string): void {
    const pic = art && this.textures.exists(`art:${art}`) ? { w: 480, h: 270 } : null;
    const w = 520;
    const h = 250 + (pic ? pic.h + 12 : 0);
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2;
    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.45).setOrigin(0).setDepth(30).setInteractive();
    const box = panel(this, x, y, w, h).setDepth(31);
    const t = this.add.text(SCREEN.w / 2, y + 18, title, { fontFamily: TITLE_FONT, fontSize: '30px', color: COLORS.gold }).setOrigin(0.5, 0).setDepth(32);
    this.dialog = [shade, box, t];
    if (pic && art) {
      const img = placeArt(this, art, x + (w - pic.w) / 2, y + 62, pic.w, pic.h, false);
      if (img) this.dialog.push(img.setDepth(32));
    }
    const body = this.add.text(x + 26, y + 66 + (pic ? pic.h + 12 : 0), text, textStyle(15, COLORS.text, { wordWrap: { width: w - 52 }, lineSpacing: 4 })).setDepth(32);
    this.dialog.push(body);
    buttons.forEach(([label, fn], i) => {
      const bw = 220;
      const bx = SCREEN.w / 2 - (buttons.length * (bw + 12) - 12) / 2 + i * (bw + 12);
      const b = new Button(this, bx, y + h - 60, bw, 42, label, fn, { size: 17 }).setDepth(32);
      this.dialog.push(b);
    });
    if (this.dialogEnter) this.input.keyboard!.off('keydown-ENTER', this.dialogEnter);
    const enter = () => {
      this.dialogEnter = null;
      if (this.dialog.length) buttons[0][1]();
    };
    this.dialogEnter = enter;
    this.input.keyboard!.once('keydown-ENTER', enter);
  }

  private closeDialog(): void {
    for (const o of this.dialog) o.destroy();
    this.dialog = [];
    if (this.dialogEnter) this.input.keyboard!.off('keydown-ENTER', this.dialogEnter);
    this.dialogEnter = null;
  }

  update(time: number): void {
    const run = this.run;
    const g = this.g;
    this.sea.draw(time);
    g.clear();

    const reach = new Set(run.reachable().map((n) => n.id));
    const visited = new Set(run.visited);

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
    const next = this.colX(run.navy + run.navySpeed);
    if (next > 0 && run.status === 'chart') {
      g.lineStyle(1, 0xd23c3c, 0.45);
      for (let y = 82; y < SCREEN.h - 80; y += 16) g.lineBetween(next, y, next, y + 8);
    }

    // Cross-channels within a column: exploring sideways costs a jump.
    for (let col = 1; col < run.chart.columns - 1; col++) {
      const column = run.chart.nodes.filter((n) => n.col === col).sort((a, b) => a.y - b.y);
      for (let i = 0; i + 1 < column.length; i++) {
        const a = this.pos(column[i]);
        const b = this.pos(column[i + 1]);
        const open = (column[i].id === run.nodeId && reach.has(column[i + 1].id)) || (column[i + 1].id === run.nodeId && reach.has(column[i].id));
        g.lineStyle(open ? 2.5 : 1.5, open ? 0xffffff : 0x9fb1bf, open ? 0.7 : 0.18);
        for (let t = 0; t < 1; t += 0.12) {
          const t2 = Math.min(1, t + 0.06);
          g.lineBetween(a.x + (b.x - a.x) * t, a.y + NODE_R + (b.y - a.y - 2 * NODE_R) * t, a.x + (b.x - a.x) * t2, a.y + NODE_R + (b.y - a.y - 2 * NODE_R) * t2);
        }
      }
    }

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
      const overrun = n.kind !== 'boss' && n.kind !== 'exit' && n.col <= run.navy;
      const r = n.kind === 'boss' || n.kind === 'exit' ? NODE_R + 6 : NODE_R;
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
    if (n.kind === 'empty') lines.push('Open sea. Time for repairs, if nothing happens aboard.');
    if (n.kind === 'boss') lines.push('HMS Relentless guards the channel to the open ocean. No running from this one.');
    if (n.kind === 'exit') lines.push(`A passage into ${n.name}. Tougher ships, richer prizes, and the fleet loses your trail for a while.`);
    const reachable = run.reachable().some((m) => m.id === n.id);
    if (reachable && run.isLateral(n)) lines.push('Across the column: exploring costs a jump and a day’s provisions.');
    if (reachable && run.provisions === 0) lines.push('⚠ No provisions: the crew will go hungry.');
    if (reachable && run.willBeOverrun(n)) lines.push('⚠ The fleet will overrun this before you get there: a Navy ambush.');
    else if (n.kind !== 'boss' && n.kind !== 'exit' && n.col <= run.navy) lines.push('Overrun by the Navy fleet.');
    if (!reachable && n.id !== run.nodeId) lines.push('(Not reachable from here)');
    const { x, y } = this.pos(n);
    this.tip.setText(lines.join('\n'));
    this.tip.setPosition(Math.min(x + 28, SCREEN.w - this.tip.width - 10), Math.max(80, y - this.tip.height - 10));
    this.tip.setVisible(true);
  }
}
