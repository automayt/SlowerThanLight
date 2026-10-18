import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { playLoop, playSfx, stopLoop } from '../render/sound';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, divider, frame, goldText, panel, Sea } from '../render/ui';
import { type Run } from '../sim/Run';
import { chartIcon, chartRose, chartSerpent, chartShip, SEAL } from '../render/chartIcons';
import { nodeById, type NodeKind, type SeaNode } from '../sim/SeaChart';
import { onVoyage, voyage } from '../net/voyage';
import { applyVoyage } from '../sim/commands';
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
/** Rings around the seals you can sail to: gold, or red where the Navy will be waiting. */
const RING = 0xb8860b;
const RING_AMBUSH = 0xc0201a;
const NUMBER_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
/** What a mark on the chart is, for a suggestion to the captain. */
const KIND_NAMES: Partial<Record<NodeKind, string>> = { battle: 'the sail on the horizon', event: 'the unknown waters', port: 'port', empty: 'open sea', exit: 'the passage', boss: 'the blockade' };

/** The chart's key, in the footer's right-hand corner. */
const LEGEND_W = 430;
const LEGEND_H = 60;

interface SectorLook {
  /** Multiplied into the parchment. */
  tint: number;
  islands: number;
  serpent: boolean;
  /** A wash over the paper: the King's Waters are colder and darker. */
  wash: number;
  washAlpha: number;
}

/** Each stretch of sea is drawn by a different hand: bright islands to windward, ochre and serpents on the Main, cold grey near the King. */
const SECTOR_LOOKS: SectorLook[] = [
  { tint: 0xfff8ea, islands: 6, serpent: false, wash: 0x000000, washAlpha: 0 },
  { tint: 0xf4d6a0, islands: 4, serpent: true, wash: 0x5a2a08, washAlpha: 0.06 },
  { tint: 0xd6d4cc, islands: 3, serpent: true, wash: 0x0e2234, washAlpha: 0.12 },
];

/** A small seeded random, so a chart's ornaments stay put when you come back to it. */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far a point lies from a segment. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Phaser.Math.Clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

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
  /** Routes, channels and seals: redrawn only when the voyage moves, not every frame. */
  private chartG!: Phaser.GameObjects.Graphics;
  /** The fleet's tide, its edge rippling, under the seals. */
  private fleetG!: Phaser.GameObjects.Graphics;
  /** Pulsing rings and the hover ring, over the seals. */
  private g!: Phaser.GameObjects.Graphics;
  /** Where you can sail next, top to bottom: number keys pick from this. */
  private reach: SeaNode[] = [];
  private ambush = new Set<number>();
  private badges: Phaser.GameObjects.GameObject[] = [];
  private hover: SeaNode | null = null;
  private tip!: Phaser.GameObjects.Text;
  private tipBg!: Phaser.GameObjects.Graphics;
  private dialog: Phaser.GameObjects.GameObject[] = [];
  private ship!: Phaser.GameObjects.Image;
  /** Enter-key shortcut of the open dialog, removed when the dialog closes. */
  private dialogEnter: (() => void) | null = null;
  /** The passage being inked in, while the ship sails it. */
  private sailing: { from: { x: number; y: number }; to: { x: number; y: number }; t: number; ink: Phaser.GameObjects.Graphics } | null = null;

  constructor() {
    super('SeaMap');
  }

  init(): void {
    this.hover = null;
    this.dialog = [];
    this.badges = [];
    this.sailing = null;
  }

  preload(): void {
    if (!this.textures.exists('art:chart-paper')) this.load.image('art:chart-paper', 'art/chart-paper.jpg');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    stopLoop(this, 'shanty');
    playLoop(this, 'waves', 0.25);
    playLoop(this, 'creak', 0.2);
    this.parchment();
    this.fleetG = this.add.graphics().setDepth(-0.5);
    this.chartG = this.add.graphics();
    this.g = this.add.graphics().setDepth(0.5);
    this.bar = new RunBar(this, run);

    // The sector's name between two brass flourishes (the strip above says which of the three it is).
    const heading = goldText(this, SCREEN.w / 2, 72, run.sectorDef.name, 28).setOrigin(0.5, 0);
    const mid = heading.y + heading.height / 2 + 1;
    divider(this, SCREEN.w / 2 - heading.width / 2 - 80, mid, 130);
    divider(this, SCREEN.w / 2 + heading.width / 2 + 80, mid, 130);

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
      hit.on('pointerover', () => {
        this.hover = node;
        this.updateTip();
      });
      hit.on('pointerout', () => {
        if (this.hover !== node) return;
        this.hover = null;
        this.updateTip();
      });
      hit.on('pointerdown', () => this.chooseNode(node));
    }
    this.refreshChart();
    NUMBER_KEYS.forEach((key, i) => this.input.keyboard!.on(`keydown-${key}`, () => this.reach[i] && this.chooseNode(this.reach[i])));
    // The captain's course, when it is set (by this player alone, or by the server in co-op).
    onVoyage(this, {
      jump: (cmd) => {
        const node = nodeById(this.run.chart, cmd.node);
        this.closeDialog();
        if (!this.sailing) return this.sailTo(node);
        // Still sailing the last leg: take the new one without the animation.
        applyVoyage(this.run, cmd);
        this.scene.restart();
      },
    });

    // Footer: the last thing that happened, then a hint, stacked by their measured heights; the chart's key on the right.
    const hint =
      run.provisions <= 3
        ? `⚠ ${run.provisions === 0 ? 'No provisions left: every jump now costs the crew health' : `Only ${run.provisions} provisions left`}. Buy more in port, or take them from prizes.`
        : 'Click a ringed seal, or press its number, to sail there. Sailing across a column explores a neighbour, at the cost of a jump and a day’s provisions.';
    const textW = SCREEN.w - 48 - LEGEND_W;
    const words = this.add.text(20, 0, this.lastWords(), textStyle(14, COLORS.text, { wordWrap: { width: textW }, maxLines: 3 })).setDepth(6);
    const help = this.add.text(20, 0, hint, textStyle(13, run.provisions <= 3 ? COLORS.textWarn : COLORS.textDim, { wordWrap: { width: textW }, maxLines: 2 })).setDepth(6);
    const footH = Math.max(LEGEND_H, 8 + words.height + 4 + help.height + 8);
    const footY = Math.max(CHART.y + CHART.h + 10, SCREEN.h - 8 - footH);
    panel(this, 8, footY, SCREEN.w - 16, SCREEN.h - 8 - footY).setDepth(5);
    words.setY(footY + 8);
    help.setY(words.y + words.height + 4);
    this.legend(SCREEN.w - 16 - LEGEND_W, footY + (SCREEN.h - 8 - footY - LEGEND_H) / 2 + 6);

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

  /** What the rings and the red ink on the chart mean. */
  private legend(x: number, y: number): void {
    const g = this.add.graphics().setDepth(6);
    const col = LEGEND_W / 2;
    const entries: [number, number, (cx: number, cy: number) => void, string][] = [
      [0, 0, (cx, cy) => g.lineStyle(3, RING, 1).strokeCircle(cx, cy, 8), 'You can sail here'],
      [col, 0, (cx, cy) => g.lineStyle(3, RING_AMBUSH, 1).strokeCircle(cx, cy, 8), 'Navy ambush if you go'],
      [0, 24, (cx, cy) => g.fillStyle(RED_INK, 0.7).fillRect(cx - 9, cy - 7, 18, 14).lineStyle(2, RING_AMBUSH, 1).lineBetween(cx + 9, cy - 7, cx + 9, cy + 7), 'The Navy fleet'],
      [col, 24, (cx, cy) => {
        g.lineStyle(2, RING_AMBUSH, 1);
        g.lineBetween(cx, cy - 9, cx, cy - 3).lineBetween(cx, cy + 2, cx, cy + 8);
      }, 'The fleet after your next jump'],
    ];
    for (const [dx, dy, draw, label] of entries) {
      draw(x + dx + 10, y + dy + 9);
      this.add.text(x + dx + 26, y + dy + 1, label, textStyle(13, COLORS.textDim)).setDepth(6);
    }
  }

  /** Recompute where you can go and redraw the static chart. */
  private refreshChart(): void {
    const run = this.run;
    this.reach = run.reachable().sort((a, b) => a.y - b.y || a.col - b.col);
    this.ambush = new Set(this.reach.filter((n) => run.willBeOverrun(n)).map((n) => n.id));
    this.drawChart(this.chartG.clear());
    // Number badges beside each seal you can sail to.
    for (const o of this.badges) o.destroy();
    this.badges = [];
    this.reach.forEach((n, i) => {
      const { x, y } = this.pos(n);
      const r = n.kind === 'boss' || n.kind === 'exit' ? NODE_R + 6 : NODE_R;
      const bx = x - r - 6;
      const by = y - r + 2;
      const disc = this.add.circle(bx, by, 9, this.ambush.has(n.id) ? RING_AMBUSH : RING).setStrokeStyle(1.5, INK).setDepth(3.5);
      const num = this.add.text(bx, by, `${i + 1}`, textStyle(12, '#fff8e6', { fontStyle: 'bold' })).setOrigin(0.5).setDepth(3.6);
      this.badges.push(disc, num);
    });
  }

  /** Everything on the chart that stays put until the next jump: the fleet's next mark, channels, routes and seals. */
  private drawChart(g: Phaser.GameObjects.Graphics): void {
    const run = this.run;
    const reach = new Set(this.reach.map((n) => n.id));
    const visited = new Set(run.visited);
    const top = CHART.y + 3;
    const bottom = CHART.y + CHART.h - 3;

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

    // Nodes: a wax seal with a darker rim.
    for (const n of run.chart.nodes) {
      const { x, y } = this.pos(n);
      const overrun = n.kind !== 'boss' && n.kind !== 'exit' && n.col <= run.navy;
      const r = n.kind === 'boss' || n.kind === 'exit' ? NODE_R + 6 : NODE_R;
      const faded = visited.has(n.id) && n.id !== run.nodeId;
      g.fillStyle(0x000000, 0.25).fillCircle(x + 2, y + 3, r);
      g.fillStyle(overrun ? 0x5a2a20 : SEAL[n.kind], faded ? 0.5 : 1).fillCircle(x, y, r);
      // The pressed ring where the seal's stamp met the wax.
      g.lineStyle(1.5, 0x000000, faded ? 0.12 : 0.28).strokeCircle(x, y, r * 0.8);
      g.lineStyle(2.5, INK, faded ? 0.5 : 0.95).strokeCircle(x, y, r);
    }
  }

  /**
   * Lay out the chart on the table of the sea: blank parchment tinted for the sector, then everything the
   * cartographer inked on it, drawn once: rhumb lines, a compass rose, islands, wave marks, perhaps a serpent,
   * and a neatline with a scale of degrees. All of it keeps clear of the seals and the routes.
   */
  private parchment(): void {
    const { x, y, w, h } = CHART;
    const look = SECTOR_LOOKS[Math.min(this.run.sector, SECTOR_LOOKS.length - 1)];
    this.add.rectangle(x + 6, y + 9, w, h, 0x000000, 0.45).setOrigin(0).setDepth(-1);
    const paper = this.textures.exists('art:chart-paper') ? 'art:chart-paper' : this.textures.exists('art:tex-chart') ? 'art:tex-chart' : null;
    if (paper) {
      const img = this.add.image(x + w / 2, y + h / 2, paper).setDepth(-1).setTint(look.tint);
      const scale = Math.max(w / img.width, h / img.height);
      img.setScale(scale);
      img.setCrop((img.width - w / scale) / 2, (img.height - h / scale) / 2, w / scale, h / scale);
    } else {
      this.add.rectangle(x, y, w, h, 0xd9c49a).setOrigin(0).setDepth(-1);
    }
    if (look.washAlpha) this.add.rectangle(x, y, w, h, look.wash, look.washAlpha).setOrigin(0).setDepth(-1);

    const rand = seeded(this.run.seed * 7 + this.run.sector * 101 + 3);
    const nodes = this.run.chart.nodes.map((n) => this.pos(n));
    const routes = this.run.chart.nodes.flatMap((n) => n.next.map((id) => [this.pos(n), this.pos(this.run.chart.nodes[id])]));
    const placed: { x: number; y: number; r: number }[] = [];
    /** Room for an ornament of radius r: off the seals (and their names below), the routes and each other. */
    const clearance = (px: number, py: number) =>
      Math.min(
        px - x - 14,
        x + w - 14 - px,
        py - y - 14,
        y + h - 14 - py,
        ...nodes.map((n) => Math.min(Math.hypot(px - n.x, py - n.y), Math.hypot(px - n.x, py - n.y - NODE_R - 14)) - NODE_R - 26),
        ...routes.map(([a, b]) => segDist(px, py, a.x, a.y, b.x, b.y) - 6),
        ...placed.map((o) => Math.hypot(px - o.x, py - o.y) - o.r - 10),
      );
    /** The roomiest of a few hundred random spots, or null if none has room for r. */
    const spot = (r: number, tries = 260, padX = 20) => {
      let best: { x: number; y: number; room: number } | null = null;
      for (let i = 0; i < tries; i++) {
        const px = x + padX + rand() * (w - 2 * padX);
        const py = y + 20 + rand() * (h - 40);
        const room = clearance(px, py);
        if (room >= r && (!best || room > best.room)) best = { x: px, y: py, room };
      }
      return best;
    };

    const g = this.add.graphics().setDepth(-1);
    // The rose sits in the roomiest water; rhumb lines run out from it and from a second, unmarked centre.
    const rose = spot(60, 400) ?? { x: x + 140, y: y + h - 120, room: 60 };
    const roseR = Phaser.Math.Clamp(rose.room, 60, 92);
    const centres = [rose, { x: x + w - (rose.x - x), y: y + h - (rose.y - y) }];
    for (const c of centres) {
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        // Out to the edge of the chart.
        const t = Math.min(dx > 0 ? (x + w - 10 - c.x) / dx : dx < 0 ? (x + 10 - c.x) / dx : Infinity, dy > 0 ? (y + h - 10 - c.y) / dy : dy < 0 ? (y + 10 - c.y) / dy : Infinity);
        g.lineStyle(i % 4 === 0 ? 1.1 : 0.8, i % 8 === 4 ? RED_INK : INK, i % 4 === 0 ? 0.2 : 0.11);
        g.lineBetween(c.x, c.y, c.x + dx * t, c.y + dy * t);
      }
    }
    this.add.image(rose.x, rose.y, chartRose(this)).setDepth(-1).setScale((roseR * 2) / 256).setAlpha(0.8).setAngle(-8 + rand() * 16);
    placed.push({ x: rose.x, y: rose.y, r: roseR });

    // Islands: an inked coast, ringed by the fading water-lines of an engraved chart, with a few hills.
    for (let i = 0; i < look.islands; i++) {
      const r = 16 + rand() * 20;
      const at = spot(r * 1.5 + 4);
      if (!at) break;
      this.island(g, at.x, at.y, Math.min(r, (at.room - 4) / 1.5), rand);
      placed.push({ x: at.x, y: at.y, r: r * 1.5 });
    }
    if (look.serpent) {
      // It is wider than it is tall: keep its ends off the neatline.
      // Smaller, if the chart is crowded.
      for (const scale of [1, 0.72]) {
        const at = spot(62 * scale, 400, 126 * scale);
        if (!at) continue;
        this.add.image(at.x, at.y, chartSerpent(this)).setDepth(-1).setAlpha(0.75).setScale(scale).setFlipX(rand() < 0.5);
        placed.push({ x: at.x, y: at.y, r: 62 * scale });
        break;
      }
    }
    // Wave marks scattered over the open water.
    for (let i = 0; i < 26; i++) {
      const at = spot(12, 30);
      if (!at) continue;
      g.lineStyle(1, INK, 0.28);
      for (const dx of [-5, 5]) {
        g.beginPath();
        g.arc(at.x + dx, at.y, 5, Math.PI * 1.15, Math.PI * 1.85);
        g.strokePath();
      }
      placed.push({ x: at.x, y: at.y, r: 8 });
    }

    // Darkened, worn edges.
    const edge = this.add.graphics().setDepth(-1);
    for (let i = 0; i < 10; i++) {
      edge.lineStyle(3, 0x3a2410, 0.05 + i * 0.01);
      edge.strokeRect(x + i * 2, y + i * 2, w - i * 4, h - i * 4);
    }
    // The neatline: a double rule with a scale of degrees between, in alternate black and white.
    edge.lineStyle(1.5, INK, 0.9).strokeRect(x + 6, y + 6, w - 12, h - 12);
    edge.lineStyle(1, INK, 0.9).strokeRect(x + 11, y + 11, w - 22, h - 22);
    edge.fillStyle(INK, 0.75);
    const step = 24;
    for (let px = x + 11, k = 0; px < x + w - 11; px += step, k++) {
      if (k % 2) continue;
      const len = Math.min(step, x + w - 11 - px);
      edge.fillRect(px, y + 6, len, 5).fillRect(px, y + h - 11, len, 5);
    }
    for (let py = y + 11, k = 0; py < y + h - 11; py += step, k++) {
      if (k % 2) continue;
      const len = Math.min(step, y + h - 11 - py);
      edge.fillRect(x + 6, py, 5, len).fillRect(x + w - 11, py, 5, len);
    }
    frame(this, x - 4, y - 4, w + 8, h + 8, -0.9, false);
  }

  private island(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, rand: () => number): void {
    const k = [rand() * 6.3, rand() * 6.3, rand() * 6.3];
    const stretch = 0.7 + rand() * 0.6;
    const coast = Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2;
      const rr = r * (1 + 0.24 * Math.sin(2 * a + k[0]) + 0.13 * Math.sin(3 * a + k[1]) + 0.08 * Math.sin(5 * a + k[2]));
      return new Phaser.Math.Vector2(cx + Math.cos(a) * rr * stretch * 1.25, cy + Math.sin(a) * rr / stretch * 0.8);
    });
    const ring = (s: number) => coast.map((p) => new Phaser.Math.Vector2(cx + (p.x - cx) * s + 0, cy + (p.y - cy) * s));
    for (const [s, alpha] of [
      [1.5, 0.1],
      [1.32, 0.16],
      [1.16, 0.26],
    ]) g.lineStyle(1, INK, alpha).strokePoints(ring(s), true, true);
    g.fillStyle(0xc9a86a, 0.45).fillPoints(coast, true, true);
    g.lineStyle(1.6, INK, 0.75).strokePoints(coast, true, true);
    // Hills, as little inked arches.
    const hills = 1 + Math.floor(r / 12);
    g.lineStyle(1, INK, 0.5);
    for (let i = 0; i < hills; i++) {
      const hx = cx + (rand() - 0.5) * r * 0.8;
      const hy = cy + (rand() - 0.5) * r * 0.4;
      g.beginPath();
      g.arc(hx, hy + 4, 5, Math.PI * 1.1, Math.PI * 1.9);
      g.strokePath();
    }
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

  /** Ink the passage in red as the ship sails it, then make the jump. */
  /** Choose a course: sail there (alone or as captain), or suggest it to the captain. */
  private chooseNode(node: SeaNode): void {
    if (this.dialog.length || this.sailing) return;
    if (!this.run.reachable().some((n) => n.id === node.id)) return;
    voyage(this, { t: 'jump', node: node.id }, `Set a course for ${node.name ?? KIND_NAMES[node.kind] ?? 'that mark'}`);
  }

  private sailTo(node: SeaNode): void {
    if (this.dialog.length || this.sailing) return;
    if (!this.run.reachable().some((n) => n.id === node.id)) return;
    this.hover = null;
    this.updateTip();
    const sail = (this.sailing = { from: this.pos(this.run.node), to: this.pos(node), t: 0, ink: this.add.graphics().setDepth(0.4) });
    playSfx(this, 'click', 0.2);
    this.tweens.add({
      targets: sail,
      t: 1,
      duration: 560,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const { from, to, t, ink } = sail;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        ink.clear().lineStyle(3.5, RED_INK, 0.9).lineBetween(from.x, from.y, x, y);
        // A wet blot at the pen's tip.
        ink.fillStyle(RED_INK, 0.9).fillCircle(x, y, 2.6);
      },
      onComplete: () => {
        sail.ink.destroy();
        this.sailing = null;
        this.arrive(node);
      },
    });
  }

  private arrive(node: SeaNode): void {
    const run = this.run;
    playSfx(this, 'quill', 0.5);
    const enc = run.jump(node.id);
    saveRun(run);
    this.registry.set('chart-note', '');
    this.hover = null;
    this.refreshChart();
    switch (enc.kind) {
      case 'battle': {
        // A ship sighted rather than sprung on you is hailed before anyone fires.
        if (run.status === 'hail') {
          this.scene.start('Hail');
          break;
        }
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
    const head = 76;
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
    const t = goldText(this, SCREEN.w / 2, y + 16, title, 32).setOrigin(0.5, 0).setDepth(32);
    this.dialog = [shade, box, t, divider(this, SCREEN.w / 2, y + 62, 220).setDepth(32)];
    if (pic && art) {
      const img = placeArt(this, art, x + (w - pic.w) / 2, y + 72, pic.w, pic.h, false);
      if (img) this.dialog.push(img.setDepth(32), ...frame(this, x + (w - pic.w) / 2 - 3, y + 69, pic.w + 6, pic.h + 6, 32.1, false));
    }
    body.setPosition(x + 26, y + head + (pic ? pic.h + 12 : 0));
    this.dialog.push(body);
    const made = buttons.map(([label, fn], i) => {
      const bw = 220;
      const bx = SCREEN.w / 2 - (buttons.length * (bw + 12) - 12) / 2 + i * (bw + 12);
      const b = new Button(this, bx, y + h - 60, bw, 42, label, fn, { size: 17, hint: i === 0 ? 'Enter' : undefined }).setDepth(32);
      this.dialog.push(b);
      return b;
    });
    if (this.dialogEnter) this.input.keyboard!.off('keydown-ENTER', this.dialogEnter);
    const enter = () => {
      this.dialogEnter = null;
      if (this.dialog.length) made[0].press();
    };
    this.dialogEnter = enter;
    this.input.keyboard!.once('keydown-ENTER', enter);
    this.updateTip();
  }

  private closeDialog(): void {
    for (const o of this.dialog) o.destroy();
    this.dialog = [];
    if (this.dialogEnter) this.input.keyboard!.off('keydown-ENTER', this.dialogEnter);
    this.dialogEnter = null;
  }

  update(time: number): void {
    const run = this.run;
    this.sea.draw(time);

    // The fleet: a wash of red ink from the west edge up to its rippling front.
    const f = this.fleetG.clear();
    const top = CHART.y + 3;
    const bottom = CHART.y + CHART.h - 3;
    const front = Math.min(CHART.x + CHART.w - 3, Math.max(CHART.x, this.colX(run.navy)));
    if (front > CHART.x) {
      f.fillStyle(RED_INK, 0.22).fillRect(CHART.x + 3, top, front - CHART.x - 3, bottom - top);
      f.lineStyle(3, RED_INK, 0.85);
      f.beginPath();
      for (let y = top; y <= bottom; y += 6) {
        const x = front + Math.sin(y / 18 + time / 400) * 5;
        if (y === top) f.moveTo(x, y);
        else f.lineTo(x, y);
      }
      f.strokePath();
    }

    const g = this.g.clear();
    const pulse = 4 + Math.sin(time / 200) * 2;
    for (const n of this.reach) {
      const { x, y } = this.pos(n);
      const r = n.kind === 'boss' || n.kind === 'exit' ? NODE_R + 6 : NODE_R;
      g.lineStyle(3, this.ambush.has(n.id) ? RING_AMBUSH : RING, 1).strokeCircle(x, y, r + pulse);
    }
    if (this.hover && !this.dialog.length) {
      const { x, y } = this.pos(this.hover);
      const r = this.hover.kind === 'boss' || this.hover.kind === 'exit' ? NODE_R + 6 : NODE_R;
      g.lineStyle(2, INK, 1).strokeCircle(x, y, r + 10);
    }

    // Your ship, riding just above her node, or on her way along the passage being inked.
    const sail = this.sailing;
    const here = sail ? { x: sail.from.x + (sail.to.x - sail.from.x) * sail.t, y: sail.from.y + (sail.to.y - sail.from.y) * sail.t } : this.pos(run.node);
    this.ship.setPosition(here.x, here.y - NODE_R - 2 + Math.sin(time / 300) * 2).setAngle(Math.sin(time / 520) * 3);
    this.ship.setFlipX(!!sail && sail.to.x < sail.from.x);
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
    const reachable = this.reach.includes(n);
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
