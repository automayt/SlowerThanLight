import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { playLoop, stopLoop } from '../render/sound';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, panel, Sea } from '../render/ui';
import { type Run } from '../sim/Run';
import { SECTORS } from '../data/voyage';
import { chartIcon, chartShip, SEAL } from '../render/chartIcons';
import type { NodeKind, SeaNode } from '../sim/SeaChart';
import { saveRun } from './save';

const LEFT = 90;
const RIGHT = SCREEN.w - 90;
const TOP = 130;
const BOTTOM = 560;
const NODE_R = 20;
/** The parchment chart the voyage is laid out on. */
const CHART = { x: 30, y: 106, w: SCREEN.w - 60, h: 482 };
/** Ink colours on parchment. */
const INK = 0x2a170a;
const RED_INK = 0x8a1c1c;
/** Clean parchment, for labels and notes laid over the chart. */
const PAPER = 0xefe2bf;

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
  private tipBg!: Phaser.GameObjects.Graphics;
  private dialog: Phaser.GameObjects.GameObject[] = [];
  private ship!: Phaser.GameObjects.Image;
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
    playLoop(this, 'creak', 0.2);
    this.parchment();
    this.g = this.add.graphics();
    this.bar = new RunBar(this, run);

    const sectorLine = `${run.sectorDef.name}  ·  Sector ${run.sector + 1} of ${SECTORS.length}`;
    this.add.text(SCREEN.w / 2, 76, sectorLine, { fontFamily: TITLE_FONT, fontSize: '24px', color: COLORS.gold, stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5, 0);

    for (const node of run.chart.nodes) {
      const { x, y } = this.pos(node);
      const style = KIND_STYLE[node.kind];
      this.add.image(x, y, chartIcon(this, node.kind)).setScale(node.kind === 'boss' || node.kind === 'exit' ? 0.62 : 0.5).setDepth(2);
      const label = node.kind === 'port' || node.kind === 'start' || node.kind === 'exit' ? (node.name ?? style.label) : style.label;
      const big = node.kind === 'boss' || node.kind === 'exit' ? 6 : 0;
      // The name under the seal, on a scrap of clean parchment, kept inside the chart's frame.
      const name = this.add.text(0, y + NODE_R + big + 5, label, { fontFamily: TITLE_FONT, fontSize: '14px', color: '#2a170a', fontStyle: 'italic' }).setDepth(2);
      const inset = 16;
      name.setX(Phaser.Math.Clamp(x - name.width / 2, CHART.x + inset, CHART.x + CHART.w - inset - name.width));
      this.add
        .graphics()
        .setDepth(1.9)
        .fillStyle(PAPER, 0.82)
        .fillRoundedRect(name.x - 5, name.y - 1, name.width + 10, name.height + 2, 6)
        .lineStyle(1, INK, 0.3)
        .strokeRoundedRect(name.x - 5, name.y - 1, name.width + 10, name.height + 2, 6);
      const hit = this.add.circle(x, y, NODE_R + 6, 0x000000, 0.001).setDepth(3);
      hit.setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => (this.hover = node));
      hit.on('pointerout', () => this.hover === node && (this.hover = null));
      hit.on('pointerdown', () => this.sailTo(node));
    }

    // Footer: the last thing that happened, then a hint, stacked by their measured heights.
    const hint =
      run.provisions <= 3
        ? `⚠ ${run.provisions === 0 ? 'No provisions left: every jump now costs the crew health' : `Only ${run.provisions} provisions left`}. Buy more in port, or take them from prizes.`
        : 'Click a highlighted node to sail on, or across to explore its neighbour (a jump and a day’s provisions). The red tide is the Navy: nodes it overruns become ambushes.';
    const words = this.add.text(20, 0, this.lastWords(), textStyle(14, COLORS.text, { wordWrap: { width: SCREEN.w - 48 }, maxLines: 3 })).setDepth(6);
    const help = this.add.text(20, 0, hint, textStyle(13, run.provisions <= 3 ? COLORS.textWarn : COLORS.textDim, { wordWrap: { width: SCREEN.w - 48 }, maxLines: 2 })).setDepth(6);
    const footH = 8 + words.height + 4 + help.height + 8;
    const footY = Math.max(CHART.y + CHART.h + 10, SCREEN.h - 8 - footH);
    panel(this, 8, footY, SCREEN.w - 16, SCREEN.h - 8 - footY).setDepth(5);
    words.setY(footY + 8);
    help.setY(words.y + words.height + 4);

    this.ship = this.add.image(0, 0, chartShip(this)).setScale(0.62).setDepth(4).setOrigin(0.5, 1);

    // The tooltip: a note in ink on a slip of parchment.
    this.tipBg = this.add.graphics().setDepth(20).setVisible(false);
    this.tip = this.add
      .text(0, 0, '', { fontFamily: TITLE_FONT, fontSize: '14px', color: '#2a170a', lineSpacing: 2, padding: { x: 10, y: 7 }, wordWrap: { width: 270 } })
      .setDepth(21)
      .setVisible(false);

    if (run.encounter.kind === 'empty' && run.status === 'chart' && this.registry.get('fresh-jump')) {
      const title = run.encounter.title ?? 'Open Water';
      const text = [run.hungerNote, run.encounter.text].filter(Boolean).join('\n\n');
      this.showDialog(title, text, [['Continue', () => this.closeDialog()]], run.encounter.title ? 'blockade' : undefined);
    }
    this.registry.set('fresh-jump', false);
  }

  /** Lay out the aged chart, with a dark frame, on the table of the sea. */
  private parchment(): void {
    const { x, y, w, h } = CHART;
    this.add.rectangle(x + 6, y + 8, w, h, 0x000000, 0.45).setOrigin(0).setDepth(-1);
    if (this.textures.exists('art:tex-chart')) {
      const img = this.add.image(x + w / 2, y + h / 2, 'art:tex-chart').setDepth(-1);
      const scale = Math.max(w / img.width, h / img.height);
      img.setScale(scale);
      img.setCrop((img.width - w / scale) / 2, (img.height - h / scale) / 2, w / scale, h / scale);
    } else {
      this.add.rectangle(x, y, w, h, 0xd9c49a).setOrigin(0).setDepth(-1);
    }
    // Darkened, worn edges.
    const edge = this.add.graphics().setDepth(-1);
    for (let i = 0; i < 10; i++) {
      edge.lineStyle(3, 0x3a2410, 0.06 + i * 0.012);
      edge.strokeRect(x + i * 2, y + i * 2, w - i * 4, h - i * 4);
    }
    edge.lineStyle(3, 0x2a170a, 1).strokeRect(x, y, w, h);
    edge.lineStyle(1, 0x2a170a, 0.6).strokeRect(x + 7, y + 7, w - 14, h - 14);
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
    const w = 520;
    // Measure the words first; the box (and the painting, if it must) is sized around them.
    const body = this.add.text(0, 0, text, textStyle(15, COLORS.text, { wordWrap: { width: w - 52 }, lineSpacing: 4 })).setDepth(32);
    const head = 66;
    const foot = 20 + 42 + 18;
    const room = SCREEN.h - 24 - head - body.height - foot;
    // A 16:9 painting, shrunk to fit beside long text, or left out if it would be a postage stamp.
    const picH = art && this.textures.exists(`art:${art}`) ? Math.min(270, room - 12) : 0;
    const pic = picH >= 120 ? { w: Math.round(picH * (16 / 9)), h: picH } : null;
    const h = head + (pic ? pic.h + 12 : 0) + body.height + foot;
    const x = (SCREEN.w - w) / 2;
    const y = Math.max(12, (SCREEN.h - h) / 2);
    const shade = this.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.45).setOrigin(0).setDepth(30).setInteractive();
    const box = panel(this, x, y, w, h, { modal: true }).setDepth(31);
    const t = this.add.text(SCREEN.w / 2, y + 18, title, { fontFamily: TITLE_FONT, fontSize: '30px', color: COLORS.gold }).setOrigin(0.5, 0).setDepth(32);
    this.dialog = [shade, box, t];
    if (pic && art) {
      const img = placeArt(this, art, x + (w - pic.w) / 2, y + 62, pic.w, pic.h, false);
      if (img) this.dialog.push(img.setDepth(32));
    }
    body.setPosition(x + 26, y + head + (pic ? pic.h + 12 : 0));
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

    // The fleet: a wash of red ink from the west edge up to its front.
    const top = CHART.y + 3;
    const bottom = CHART.y + CHART.h - 3;
    const front = Math.min(CHART.x + CHART.w - 3, Math.max(CHART.x, this.colX(run.navy)));
    if (front > CHART.x) {
      g.fillStyle(RED_INK, 0.22).fillRect(CHART.x + 3, top, front - CHART.x - 3, bottom - top);
      g.lineStyle(3, RED_INK, 0.85);
      g.beginPath();
      for (let y = top; y <= bottom; y += 6) {
        const x = front + Math.sin(y / 18 + time / 400) * 5;
        if (y === top) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    // Where the fleet will be after your next jump.
    const next = this.colX(run.navy + run.navySpeed);
    if (next > CHART.x && run.status === 'chart') {
      g.lineStyle(1.5, RED_INK, 0.55);
      for (let y = top + 4; y < bottom - 6; y += 16) g.lineBetween(next, y, next, y + 8);
    }

    // Cross-channels within a column: exploring sideways costs a jump.
    for (let col = 1; col < run.chart.columns - 1; col++) {
      const column = run.chart.nodes.filter((n) => n.col === col).sort((a, b) => a.y - b.y);
      for (let i = 0; i + 1 < column.length; i++) {
        const a = this.pos(column[i]);
        const b = this.pos(column[i + 1]);
        const open = (column[i].id === run.nodeId && reach.has(column[i + 1].id)) || (column[i + 1].id === run.nodeId && reach.has(column[i].id));
        g.lineStyle(open ? 2.5 : 1.5, INK, open ? 0.85 : 0.25);
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
        g.lineStyle(sailed ? 3.5 : open ? 3 : 1.8, sailed ? RED_INK : INK, sailed ? 0.9 : open ? 0.9 : 0.35);
        g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }

    // Nodes.
    for (const n of run.chart.nodes) {
      const { x, y } = this.pos(n);
      const overrun = n.kind !== 'boss' && n.kind !== 'exit' && n.col <= run.navy;
      const r = n.kind === 'boss' || n.kind === 'exit' ? NODE_R + 6 : NODE_R;
      const faded = visited.has(n.id) && n.id !== run.nodeId;
      // A wax seal with a darker rim.
      g.fillStyle(0x000000, 0.25).fillCircle(x + 2, y + 3, r);
      g.fillStyle(overrun ? 0x5a2a20 : SEAL[n.kind], faded ? 0.5 : 1).fillCircle(x, y, r);
      // The pressed ring where the seal's stamp met the wax.
      g.lineStyle(1.5, 0x000000, faded ? 0.12 : 0.28).strokeCircle(x, y, r * 0.8);
      g.lineStyle(2.5, INK, faded ? 0.5 : 0.95).strokeCircle(x, y, r);
      if (reach.has(n.id)) {
        const pulse = 4 + Math.sin(time / 200) * 2;
        g.lineStyle(3, run.willBeOverrun(n) ? 0xc0201a : 0xb8860b, 1).strokeCircle(x, y, r + pulse);
      }
      if (this.hover === n) g.lineStyle(2, INK, 1).strokeCircle(x, y, r + 10);
    }

    // Your ship, riding just above her node.
    const here = this.pos(run.node);
    this.ship.setPosition(here.x, here.y - NODE_R - 2 + Math.sin(time / 300) * 2).setAngle(Math.sin(time / 520) * 3);

    this.updateTip();
    this.bar.refresh();
  }

  private updateTip(): void {
    const n = this.hover;
    if (!n || this.dialog.length) {
      this.tip.setVisible(false);
      this.tipBg.setVisible(false);
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
    this.tip.setText(lines.join('\n'));
    const at = this.tipSpot(n, this.tip.width, this.tip.height);
    this.tip.setPosition(at.x, at.y).setVisible(true);
    this.tipBg
      .clear()
      .fillStyle(0x000000, 0.3)
      .fillRoundedRect(at.x + 3, at.y + 4, this.tip.width, this.tip.height, 5)
      .fillStyle(PAPER, 0.98)
      .fillRoundedRect(at.x, at.y, this.tip.width, this.tip.height, 5)
      .lineStyle(1.5, INK, 0.8)
      .strokeRoundedRect(at.x, at.y, this.tip.width, this.tip.height, 5)
      .setVisible(true);
  }

  /** Where the note for a node goes: beside, above or below it, wherever it hides the fewest other nodes. */
  private tipSpot(n: SeaNode, w: number, h: number): { x: number; y: number } {
    const { x, y } = this.pos(n);
    const r = NODE_R + 10;
    const spots = [
      { x: x + r + 8, y: y - h / 2 },
      { x: x - r - 8 - w, y: y - h / 2 },
      { x: x - w / 2, y: y - r - 12 - h },
      { x: x - w / 2, y: y + r + 26 },
    ].map((p) => ({ x: Phaser.Math.Clamp(p.x, 10, SCREEN.w - w - 10), y: Phaser.Math.Clamp(p.y, CHART.y + 4, SCREEN.h - h - 10) }));
    // Nodes (with their labels below) under the note; covering the hovered node itself is worst of all.
    const covers = (p: { x: number; y: number }) =>
      this.run.chart.nodes.reduce((count, m) => {
        const q = this.pos(m);
        const hit = q.x + 40 > p.x && q.x - 40 < p.x + w && q.y + NODE_R + 24 > p.y && q.y - NODE_R - 6 < p.y + h;
        return count + (hit ? (m.id === n.id ? 10 : 1) : 0);
      }, 0);
    return spots.reduce((best, p) => (covers(p) < covers(best) ? p : best));
  }
}
