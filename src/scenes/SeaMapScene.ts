import Phaser from 'phaser';
import { placeArt } from '../render/art';
import { seaEvent } from '../data/voyage';
import { enemy } from '../data/enemies';
import { power } from '../data/powers';
import { NEMESIS } from '../data/nemesis';
import { playSfx, setMood } from '../render/sound';
import { currentRun, RunBar } from '../render/RunBar';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, divider, frame, goldText, panel, Sea } from '../render/ui';
import { type Run } from '../sim/Run';
import { chartCloud, chartIcon, chartRose, chartSerpent, chartShip, SEAL } from '../render/chartIcons';
import { onAnyInput } from '../render/Dialogue';
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
/** Shoal water: the ink of a reef shortcut. */
const SHOAL_INK = 0x1d5a66;
/** Rings around the seals you can sail to: gold, or red where the Navy will be waiting. */
const RING = 0xb8860b;
const RING_AMBUSH = 0xc0201a;
const NUMBER_KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
/** What a mark on the chart is, for a suggestion to the captain. */
const KIND_NAMES: Partial<Record<NodeKind, string>> = { battle: 'the sail on the horizon', event: 'the unknown waters', port: 'port', empty: 'open sea', exit: 'the passage', boss: 'the blockade' };

/** The chart's key, in the footer's right-hand corner. */
const LEGEND_W = 430;
const LEGEND_H = 60;

/** The light over the chart, one step of the day per jump: multiplied into the paper and everything inked on it. */
const DAYLIGHT: { name: string; tint: number }[] = [
  { name: 'dawn', tint: 0xffe9d6 },
  { name: 'forenoon', tint: 0xffffff },
  { name: 'afternoon', tint: 0xfff2dc },
  { name: 'dusk', tint: 0xf9d6b4 },
  { name: 'night', tint: 0xaab3d8 },
];

/** A ship on her way: the passage she follows, how far along it she is, and the pen inking it behind her. */
interface Passage {
  pts: Phaser.Math.Vector2[];
  /** Distance along the passage at each point. */
  at: number[];
  t: number;
  ink: Phaser.GameObjects.Graphics;
  tween: Phaser.Tweens.Tween | null;
}

/** A cloud drifting over the chart, in the fog over waters you have not reached. */
interface Cloud {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  speed: number;
  alpha: number;
}

/** Points along a route as a pen would ink it: never quite straight, the same wobble every time it is drawn. */
function inkPoints(a: { x: number; y: number }, b: { x: number; y: number }, seed: number): Phaser.Math.Vector2[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const n = Math.max(6, Math.round(len / 12));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const w = Math.sin(t * Math.PI) * (Math.sin(t * 7 + seed) * 1.6 + Math.sin(t * 19 + seed * 1.7) * 0.6);
    return new Phaser.Math.Vector2(a.x + (b.x - a.x) * t + nx * w, a.y + (b.y - a.y) * t + ny * w);
  });
}

/** Stroke a polyline. */
function strokeLine(g: Phaser.GameObjects.Graphics, pts: Phaser.Math.Vector2[]): void {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  g.strokePath();
}

/** A ring drawn by hand in ink: twice round, never quite closing, never quite the same. */
function inkRing(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, width: number, seed: number): void {
  for (let pass = 0; pass < 2; pass++) {
    g.lineStyle(pass ? width * 0.6 : width, color, pass ? 0.55 : 0.9);
    g.beginPath();
    const start = seed + pass * 1.9;
    for (let i = 0; i <= 40; i++) {
      const a = start + (i / 40) * Math.PI * 2.08;
      const rr = r + pass * 1.6 + Math.sin(a * 3 + seed) * 1.1 + Math.sin(a * 5 + pass) * 0.6;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr * 0.96;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  }
}

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
const SECTOR_LOOKS: Record<string, SectorLook> = {
  windward: { tint: 0xfff8ea, islands: 6, serpent: false, wash: 0x000000, washAlpha: 0 },
  main: { tint: 0xf4d6a0, islands: 4, serpent: true, wash: 0x5a2a08, washAlpha: 0.06 },
  // The Mosquito Coast: a greener sheet, crowded with cays and logwood islands.
  coast: { tint: 0xe4ecca, islands: 8, serpent: false, wash: 0x1e3a14, washAlpha: 0.07 },
  kings: { tint: 0xd6d4cc, islands: 3, serpent: true, wash: 0x0e2234, washAlpha: 0.12 },
};

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
  private squadron: Phaser.GameObjects.Image[] = [];
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
  private sailing: Passage | null = null;
  /** Foam astern of the ship as she sails. */
  private wake: { x: number; y: number; age: number; side: number }[] = [];
  private wakeG!: Phaser.GameObjects.Graphics;
  private clouds: Cloud[] = [];
  /** Thunderheads riding the fleet's front, and its lightning. */
  private storm: Phaser.GameObjects.Image[] = [];
  private flash = { at: 0, power: 0, y: 0, seed: 0 };
  /** The Black Dog's sail on the horizon, when Crane is near. */
  private crane: { img: Phaser.GameObjects.Image; x: number; y: number } | null = null;
  /** Lamplight around the ship by night. */
  private lantern: Phaser.GameObjects.Arc | null = null;

  constructor() {
    super('SeaMap');
  }

  init(): void {
    this.hover = null;
    this.dialog = [];
    this.badges = [];
    this.sailing = null;
    this.wake = [];
    this.clouds = [];
    this.storm = [];
    this.crane = null;
    this.lantern = null;
  }

  preload(): void {
    if (!this.textures.exists('art:chart-paper')) this.load.image('art:chart-paper', 'art/chart-paper.jpg');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    // The chart unrolls as you come to it (not when it is merely redrawn after a quiet jump); a new sector's is news.
    const sector = `${run.seed}:${run.sector}`;
    if (!this.registry.get('fresh-jump')) playSfx(this, 'chart', 0.45);
    if (this.registry.get('chart-sector') !== sector) {
      if (run.sector > 0) this.time.delayedCall(500, () => playSfx(this, 'discovery', 0.55));
      this.registry.set('chart-sector', sector);
    }
    this.parchment();
    this.fleetG = this.add.graphics().setDepth(-0.5);
    // The squadron hunting you: three of the King's ships at the front of the tide.
    this.squadron = [0, 1, 2].map(() => this.add.image(0, 0, chartShip(this, true)).setScale(0.42).setDepth(2.6).setFlipX(false));
    this.chartG = this.add.graphics();
    this.g = this.add.graphics().setDepth(0.5);
    const inked = this.add.graphics().setDepth(2.1);
    this.bar = new RunBar(this, run);

    // The sector's name between two brass flourishes (the strip above says which of the three it is).
    const heading = goldText(this, SCREEN.w / 2, 72, run.sectorDef.name, 28).setOrigin(0.5, 0);
    const mid = heading.y + heading.height / 2 + 1;
    divider(this, SCREEN.w / 2 - heading.width / 2 - 80, mid, 130);
    divider(this, SCREEN.w / 2 + heading.width / 2 + 80, mid, 130);

    for (const node of run.chart.nodes) {
      const { x, y } = this.pos(node);
      const style = KIND_STYLE[node.kind];
      // The stamp in the wax, pressed a little askew as a hand would.
      this.add.image(x, y, chartIcon(this, node.kind)).setScale(node.kind === 'boss' || node.kind === 'exit' ? 0.62 : 0.5).setDepth(2).setAngle(((node.id * 37) % 13) - 6);
      // A lead the story has put on the chart: ringed by hand in brown ink, and the tale's name instead of "Unknown".
      const lead = node.story ? seaEvent(node.story) : null;
      if (lead) inkRing(inked, x, y, NODE_R + 6, 0x7a4a06, 2.6, node.id);
      // Silas Crane lies in wait: a ring of red ink, and his ship's name.
      if (node.nemesis) inkRing(inked, x, y, NODE_R + 6, RED_INK, 2.8, node.id + 3);
      // What a tavern rumour told you is here.
      const heard = !lead && node.rumour ? seaEvent(node.rumour) : null;
      const scouted = node.kind === 'battle' && node.scouted && node.enemy && !node.nemesis ? enemy(node.enemy).ship.className : null;
      const label = node.nemesis
        ? NEMESIS.ship
        : lead
          ? lead.title
          : heard
            ? heard.title
            : scouted
              ? scouted
              : node.kind === 'port' || node.kind === 'start' || node.kind === 'exit'
                ? (node.name ?? style.label)
                : style.label;
      const big = node.kind === 'boss' || node.kind === 'exit' ? 6 : 0;
      const ink = node.nemesis ? '#8a1c1c' : lead ? '#7a4a06' : heard || scouted ? '#1d4a66' : '#2a170a';
      // The name under the seal, written in ink straight onto the paper (scraped clean around the letters), kept inside the chart's frame.
      const name = this.add
        .text(0, y + NODE_R + big + 5, label, { fontFamily: TITLE_FONT, fontSize: '15px', color: ink, fontStyle: lead || node.nemesis ? 'bold italic' : 'italic', stroke: '#efe2bf', strokeThickness: 4 })
        .setDepth(2)
        .setAngle(((node.id * 53) % 5) - 2);
      const inset = 16;
      name.setX(Phaser.Math.Clamp(x - name.width / 2, CHART.x + inset, CHART.x + CHART.w - inset - name.width));
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
    // Each shortcut through the shoals is named along its curve.
    for (const n of run.chart.nodes) {
      for (const id of n.reef ?? []) {
        const at = this.reefCurve(n, nodeById(run.chart, id)).getPoint(0.5);
        const tag = this.add.text(at.x, at.y, 'shoals', { fontFamily: TITLE_FONT, fontSize: '12px', color: '#1d5a66', fontStyle: 'bold italic' }).setOrigin(0.5).setDepth(1.95);
        this.add.rectangle(tag.x, tag.y, tag.width + 8, tag.height, PAPER, 0.8).setDepth(1.9);
      }
    }
    this.refreshChart();
    this.skyAndWeather();
    setMood(this, this.weather());
    // A click or key while the ship is under way hurries her along (the course is already set).
    onAnyInput(this, () => this.sailing?.tween?.setTimeScale(4));
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

    this.wakeG = this.add.graphics().setDepth(3.9);
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
      [0, 24, (cx, cy) => g.fillStyle(0x2a3038, 0.9).fillRect(cx - 9, cy - 7, 18, 14).fillStyle(RED_INK, 0.45).fillRect(cx - 9, cy - 7, 18, 14).lineStyle(2, RING_AMBUSH, 1).lineBetween(cx + 9, cy - 7, cx + 9, cy + 7), 'The Navy fleet'],
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
      // How the leg lies to the wind, written along it.
      const sail = run.pointOfSail(run.node, n);
      if (sail !== 'beam') {
        const from = this.pos(run.node);
        const tag = this.add
          .text((from.x + x) / 2, (from.y + y) / 2 - 10, sail === 'foul' ? 'foul wind' : 'fair wind', { fontFamily: TITLE_FONT, fontSize: '12px', color: sail === 'foul' ? '#8a1c10' : '#1f5a3a', fontStyle: 'bold italic' })
          .setOrigin(0.5)
          .setDepth(3.4);
        const back = this.add.rectangle(tag.x, tag.y, tag.width + 8, tag.height, PAPER, 0.85).setDepth(3.3);
        this.badges.push(back, tag);
      }
    });
    // The wind, in the chart's top corner: an arrow blowing the way it blows.
    const wx = CHART.x + 52;
    const wy = CHART.y + 34;
    const toward = run.wind + Math.PI;
    const g = this.add.graphics().setDepth(3.4);
    const tip = { x: wx + Math.cos(toward) * 22, y: wy + Math.sin(toward) * 22 };
    const tail = { x: wx - Math.cos(toward) * 22, y: wy - Math.sin(toward) * 22 };
    g.fillStyle(PAPER, 0.85).fillCircle(wx, wy, 28).lineStyle(1.5, INK, 0.5).strokeCircle(wx, wy, 28);
    g.lineStyle(3, INK, 0.9).lineBetween(tail.x, tail.y, tip.x, tip.y);
    g.fillStyle(INK, 0.9).fillTriangle(
      tip.x + Math.cos(toward) * 6,
      tip.y + Math.sin(toward) * 6,
      tip.x + Math.cos(toward + 2.5) * 10,
      tip.y + Math.sin(toward + 2.5) * 10,
      tip.x + Math.cos(toward - 2.5) * 10,
      tip.y + Math.sin(toward - 2.5) * 10,
    );
    const label = this.add.text(wx + 36, wy, `Wind ${run.windName} · ${DAYLIGHT[run.jumps % DAYLIGHT.length].name}`, { fontFamily: TITLE_FONT, fontSize: '13px', color: '#2a170a', fontStyle: 'italic' }).setOrigin(0, 0.5).setDepth(3.4);
    const labelBack = this.add.rectangle(label.x - 4, wy, label.width + 8, label.height, PAPER, 0.8).setOrigin(0, 0.5).setDepth(3.3);
    this.badges.push(g, labelBack, label);
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
        const pts = inkPoints(a, b, n.id * 31 + m.id);
        // Sailed passages soak into the paper: a faint bleed under the line.
        if (sailed) strokeLine(g.lineStyle(6, RED_INK, 0.12), pts);
        strokeLine(g.lineStyle(sailed ? 3.2 : open ? 2.8 : 1.6, sailed ? RED_INK : INK, sailed ? 0.88 : open ? 0.88 : 0.32), pts);
      }
    }

    // Shortcuts through the shoals: a dotted curve of shoal-ink, red once sailed.
    for (const n of run.chart.nodes) {
      for (const id of n.reef ?? []) {
        const m = nodeById(run.chart, id);
        const sailed = visited.has(n.id) && visited.has(m.id) && run.visited.indexOf(m.id) === run.visited.indexOf(n.id) + 1;
        const open = n.id === run.nodeId && reach.has(m.id);
        const pts = this.reefCurve(n, m).getPoints(28);
        g.lineStyle(sailed ? 3.5 : open ? 3.5 : 2.5, sailed ? RED_INK : SHOAL_INK, sailed || open ? 0.95 : 0.75);
        for (let i = 0; i + 1 < pts.length; i += sailed ? 1 : 2) g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
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
    const look = SECTOR_LOOKS[this.run.sectorId] ?? SECTOR_LOOKS.windward;
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

  /** The curve a shoal shortcut is drawn along: bowed away from the nearest mark in the column it skips. */
  private reefCurve(from: SeaNode, to: SeaNode): Phaser.Curves.QuadraticBezier {
    const a = this.pos(from);
    const b = this.pos(to);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const skipped = this.run.chart.nodes.filter((n) => n.col === from.col + 1).map((n) => this.pos(n));
    const near = skipped.sort((p, q) => Math.abs(p.y - mid.y) - Math.abs(q.y - mid.y))[0];
    const bow = near && near.y > mid.y ? -1 : 1;
    const off = near ? Math.max(0, 46 - Math.abs(near.y - mid.y)) + 12 : 12;
    return new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(a.x, a.y), new Phaser.Math.Vector2(mid.x, mid.y + bow * off * 2), new Phaser.Math.Vector2(b.x, b.y));
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
    const run = this.run;
    const from = this.pos(run.node);
    const to = this.pos(node);
    // The passage as the chart has it: through the shoals on its curve, otherwise the inked line.
    const pts = run.isReef(node) ? this.reefCurve(run.node, node).getPoints(40) : inkPoints(from, to, run.node.id * 31 + node.id);
    const at = [0];
    for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + pts[i].distance(pts[i - 1]));
    const total = at[at.length - 1];
    const sail: Passage = (this.sailing = { pts, at, t: 0, ink: this.add.graphics().setDepth(0.4), tween: null });
    playSfx(this, 'sail', 0.35);
    sail.tween = this.tweens.add({
      targets: sail,
      t: 1,
      duration: Phaser.Math.Clamp(total * 7, 1300, 2300),
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        // The pen follows the ship: red ink up to her, a wet blot at its tip.
        const tip = this.along(sail, sail.t);
        const drawn = sail.pts.filter((_, i) => sail.at[i] < sail.t * total);
        drawn.push(new Phaser.Math.Vector2(tip.x, tip.y));
        const ink = sail.ink.clear();
        if (drawn.length > 1) {
          strokeLine(ink.lineStyle(6, RED_INK, 0.12), drawn);
          strokeLine(ink.lineStyle(3.2, RED_INK, 0.9), drawn);
        }
        ink.fillStyle(RED_INK, 0.9).fillCircle(tip.x, tip.y, 2.8);
      },
      onComplete: () => {
        sail.tween = null;
        playSfx(this, 'quill', 0.4);
        // A breath at the mark before the next scene.
        this.time.delayedCall(320, () => {
          sail.ink.destroy();
          this.sailing = null;
          this.arrive(node);
        });
      },
    });
  }

  /** Where along a passage the ship is at t (0 to 1), and which way she is heading. */
  private along(sail: Passage, t: number): { x: number; y: number; dx: number; dy: number } {
    const d = t * sail.at[sail.at.length - 1];
    let i = 1;
    while (i < sail.at.length - 1 && sail.at[i] < d) i++;
    const a = sail.pts[i - 1];
    const b = sail.pts[i];
    const f = Phaser.Math.Clamp((d - sail.at[i - 1]) / (sail.at[i] - sail.at[i - 1] || 1), 0, 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: b.x - a.x, dy: b.y - a.y };
  }

  /**
   * The weather and the hour over the chart: clouds over the waters ahead, the storm the fleet sails in, the Black
   * Dog's sail if Crane is near, and the light of the hour (easing from the last jump's).
   */
  private skyAndWeather(): void {
    const run = this.run;
    const rand = seeded(run.seed * 13 + run.sector * 7 + run.jumps);
    // Everything adrift is kept inside the chart's neatline.
    const clip = this.make.graphics({}, false).fillStyle(0xffffff).fillRect(CHART.x + 6, CHART.y + 6, CHART.w - 12, CHART.h - 12);
    const mask = clip.createGeometryMask();
    this.events.once('shutdown', () => {
      mask.destroy();
      clip.destroy();
    });

    for (let i = 0; i < 16; i++) {
      const img = this.add
        .image(0, 0, chartCloud(this, i % 4))
        .setDepth(2.5)
        .setScale(0.9 + rand() * 0.8)
        .setFlipX(rand() < 0.5)
        .setMask(mask);
      this.clouds.push({ img, x: CHART.x + rand() * CHART.w, y: CHART.y + 20 + rand() * (CHART.h - 40), speed: 5 + rand() * 7, alpha: 0.55 + rand() * 0.3 });
    }
    // Thunderheads piled along the front, some ahead of it and some behind, so its edge billows.
    for (let i = 0; i < 13; i++) {
      const img = this.add
        .image(0, 0, chartCloud(this, i % 4, true))
        .setDepth(2.55)
        .setScale(0.5 + rand() * 0.3)
        .setFlipX(rand() < 0.5)
        .setMask(mask);
      img.setData('dx', -46 + rand() * 50);
      this.storm.push(img);
    }
    this.flash.at = this.time.now + 1500 + rand() * 2500;

    const lair = run.nemesis.done ? undefined : run.chart.nodes.find((n) => n.nemesis);
    const near = lair ? lair.col - run.node.col : 0;
    if (lair && near > 0 && near <= 2) {
      const p = this.pos(lair);
      const x = Math.min(p.x + 38, CHART.x + CHART.w - 30);
      const img = this.add.image(x, p.y - 22, chartShip(this, 'crane')).setScale(0.48).setDepth(2.62).setAlpha(0).setFlipX(true);
      this.tweens.add({ targets: img, alpha: near === 1 ? 0.95 : 0.7, duration: 1400, delay: 400 });
      this.crane = { img, x, y: p.y - 22 };
    }

    const now = run.jumps % DAYLIGHT.length;
    const was = (this.registry.get('chart-light') as number | undefined) ?? now;
    this.registry.set('chart-light', now);
    const veil = this.add.rectangle(CHART.x, CHART.y, CHART.w, CHART.h, DAYLIGHT[was].tint).setOrigin(0).setDepth(2.58).setBlendMode(Phaser.BlendModes.MULTIPLY);
    if (was !== now) {
      const a = Phaser.Display.Color.ValueToColor(DAYLIGHT[was].tint);
      const b = Phaser.Display.Color.ValueToColor(DAYLIGHT[now].tint);
      this.tweens.addCounter({
        from: 0,
        to: 100,
        duration: 2200,
        ease: 'Sine.easeInOut',
        onUpdate: (tw) => {
          const c = Phaser.Display.Color.Interpolate.ColorWithColor(a, b, 100, tw.getValue() ?? 0);
          veil.setFillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
        },
      });
    }
    if (DAYLIGHT[now].name === 'night' || DAYLIGHT[now].name === 'dusk') {
      this.lantern = this.add.circle(0, 0, 30, 0xff9a30, DAYLIGHT[now].name === 'night' ? 0.12 : 0.06).setDepth(3.8).setBlendMode(Phaser.BlendModes.ADD);
    }
  }

  /** How near the fleet's storm is: 1 when it is on you, 0 three columns or more astern. */
  private stormNear(): number {
    const gap = this.run.node.col - this.run.navy;
    return Phaser.Math.Clamp(1 - (gap - 0.5) / 2.5, 0, 1);
  }

  /** The weather and the danger, for the music and the ambience: the storm, the wind it brings, Crane, a battered hull. */
  private weather(): { tense: boolean; wind: number; storm: number } {
    const run = this.run;
    const storm = this.stormNear();
    const night = DAYLIGHT[run.jumps % DAYLIGHT.length].name === 'night';
    const battered = run.condition.hull / Math.max(1, run.fit.hull) < 0.35;
    return { tense: !!this.crane || storm > 0.6 || battered, wind: Math.min(1, 0.3 + 0.5 * storm + (night ? 0.1 : 0)), storm: storm * storm };
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
    // Its ships ride at the front of the tide, or hull-down at the chart's edge while it is still astern.
    this.squadron.forEach((ship, i) => {
      const astern = front <= CHART.x + 20;
      ship.setPosition(Math.max(CHART.x + 22, front - 14) + Math.sin(time / 900 + i) * 2, top + (bottom - top) * (0.22 + 0.28 * i) + Math.sin(time / 600 + i * 2) * 3);
      ship.setAlpha(astern ? 0.55 : 0.95);
    });
    // It sails in its own weather: a grey murk of rain behind a wall of thunderheads, lit now and then by lightning.
    const wall = Math.max(CHART.x + 30, front);
    const dt = Math.min(0.05, this.game.loop.delta / 1000);
    if (front > CHART.x) {
      const w = front - CHART.x - 3;
      f.fillStyle(0x1e262e, 0.3).fillRect(CHART.x + 3, top, w, bottom - top);
      f.fillStyle(RED_INK, 0.13).fillRect(CHART.x + 3, top, w, bottom - top);
      f.lineStyle(1, 0x1a2028, 0.32);
      for (let i = 0; i < Math.min(70, w / 4); i++) {
        const rx = CHART.x + 8 + ((i * 97.3 + time * 0.05) % Math.max(1, w - 8));
        const ry = top + ((i * 61.7 + time * 0.32) % (bottom - top - 16));
        f.lineBetween(rx, ry, rx - 4, ry + 12);
      }
      f.lineStyle(2, RED_INK, 0.7);
      f.beginPath();
      for (let y = top; y <= bottom; y += 6) {
        const x = front + Math.sin(y / 18 + time / 400) * 5;
        if (y === top) f.moveTo(x, y);
        else f.lineTo(x, y);
      }
      f.strokePath();
    }
    this.storm.forEach((c, i) => {
      const y = top + ((i + 0.5) * (bottom - top)) / this.storm.length;
      c.setPosition(wall + (c.getData('dx') as number) + Math.sin(time / 1300 + i * 1.7) * 6, y + Math.sin(time / 900 + i) * 4);
      c.setAlpha(front > CHART.x ? 0.92 : 0.6);
    });
    if (time > this.flash.at) {
      this.flash = { at: time + 2600 + Math.random() * 4800, power: 1, y: top + 30 + Math.random() * (bottom - top - 60), seed: Math.random() * 100 };
      // Its thunder, later and softer the further off the storm is.
      const near = this.stormNear();
      if (near > 0.05) this.time.delayedCall(250 + (1 - near) * 1600, () => playSfx(this, 'thunder', { volume: 0.12 + 0.4 * near, x: wall }));
    }
    if (this.flash.power > 0.03) {
      const p = this.flash.power;
      // A forked bolt out of the front of the storm, and the murk lit behind it.
      if (front > CHART.x) f.fillStyle(0xfff8e0, 0.18 * p).fillRect(CHART.x + 3, top, front - CHART.x - 3, bottom - top);
      f.lineStyle(2, 0xfffbe8, 0.95 * p);
      f.beginPath();
      let bx = wall - 10;
      let by = this.flash.y - 40;
      f.moveTo(bx, by);
      for (let k = 1; k <= 6; k++) {
        bx += Math.sin(this.flash.seed + k * 2.3) * 9 - 3;
        by += 13;
        f.lineTo(bx, by);
      }
      f.strokePath();
      this.storm.forEach((c) => c.setTint(Phaser.Display.Color.GetColor(255, 255, Math.round(255 - 40 * p))).setAlpha(Math.min(1, c.alpha + 0.1 * p)));
      this.flash.power *= Math.pow(0.02, dt);
      if (this.flash.power <= 0.03) this.storm.forEach((c) => c.clearTint());
    }

    // Clouds drift with the wind; over the waters you have not reached they thicken into fog.
    const colW = (RIGHT - LEFT) / (run.chart.columns - 1);
    const toward = run.wind + Math.PI;
    const vx = Math.cos(toward);
    const vy = Math.sin(toward) * 0.4;
    const shipX = this.ship?.x ?? this.pos(run.node).x;
    for (const c of this.clouds) {
      c.x += vx * c.speed * dt;
      c.y += vy * c.speed * dt;
      if (c.x > CHART.x + CHART.w + 100) c.x = CHART.x - 100;
      if (c.x < CHART.x - 100) c.x = CHART.x + CHART.w + 100;
      if (c.y > CHART.y + CHART.h + 40) c.y = CHART.y - 40;
      if (c.y < CHART.y - 40) c.y = CHART.y + CHART.h + 40;
      const fog = Phaser.Math.Clamp((c.x - shipX - colW * 1.2) / (colW * 0.9), 0, 1);
      c.img.setPosition(c.x, c.y).setAlpha(c.alpha * fog * fog * (3 - 2 * fog));
    }
    if (this.crane) this.crane.img.setPosition(this.crane.x + Math.sin(time / 1700) * 5, this.crane.y + Math.sin(time / 640) * 1.5).setAngle(Math.sin(time / 700) * 3);

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

    // Your ship, riding just above her node, or down on the passage being inked as she sails it, a wake astern.
    const sail = this.sailing;
    const rest = -NODE_R - 2;
    if (sail) {
      const p = this.along(sail, sail.t);
      const k = Math.sin(Math.PI * Math.min(1, sail.t * 1.15));
      const lift = rest * (1 - k) + 6 * k;
      const dir = p.dx < 0 ? -1 : 1;
      const heel = Phaser.Math.Clamp(Phaser.Math.RadToDeg(Math.atan2(p.dy, Math.abs(p.dx) || 1)) * 0.35, -12, 12) * dir;
      this.ship.setPosition(p.x, p.y + lift + Math.sin(time / 200) * 1.2).setAngle(heel + Math.sin(time / 260) * 2.5).setFlipX(dir < 0);
      if (sail.t > 0.03 && sail.t < 0.98) this.wake.push({ x: p.x - dir * 15, y: p.y + lift - 7, age: 0, side: dir });
    } else {
      const here = this.pos(run.node);
      this.ship.setPosition(here.x, here.y + rest + Math.sin(time / 300) * 2).setAngle(Math.sin(time / 520) * 3);
    }
    const wg = this.wakeG.clear();
    for (const w of this.wake) {
      w.age += dt;
      const fade = 1 - w.age / 1.1;
      if (fade <= 0) continue;
      const spread = 2 + w.age * 9;
      wg.fillStyle(0x1d3a4a, 0.45 * fade).fillCircle(w.x - w.side * w.age * 6, w.y - spread * 0.4, 1.3).fillCircle(w.x - w.side * w.age * 6, w.y + spread * 0.5, 1.3);
    }
    this.wake = this.wake.filter((w) => w.age < 1.1);
    this.lantern?.setPosition(this.ship.x, this.ship.y - 14).setRadius(28 + Math.sin(time / 180) * 1.5);
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
    const lead = n.story ? seaEvent(n.story) : null;
    const heard = !lead && n.rumour ? seaEvent(n.rumour) : null;
    const foe = n.kind === 'battle' && n.enemy ? enemy(n.enemy) : null;
    if (n.nemesis) {
      lines.push(`${NEMESIS.ship}: Silas Crane`);
      lines.push(`Your old quartermaster, with a grudge. ${run.nemesisBounty()} gold on his head.`);
      lines.push(run.nemesisFinal ? 'This time he fights to the end.' : 'He runs when beaten, and comes back tougher: cripple her sails.');
    } else lines.push(lead ? `${lead.title}: a lead to follow` : heard ? `${heard.title}: so the tavern says` : n.kind === 'port' ? `${n.name}: a friendly port` : n.kind === 'start' ? 'Tortuga' : style.label);
    if (lead) lines.push('Something from earlier in the voyage waits here.');
    if (heard) lines.push(n.rumour === 'rumour-wreck' ? 'A wreck an old salt marked for you. Her strongbox may still be aboard.' : 'A tale told in the tavern. It waits here, if it still can.');
    if (n.kind === 'battle' && !n.nemesis) lines.push(n.scouted && foe ? `Scouted: a ${foe.ship.className.toLowerCase()} under ${power(foe.power).short}'s colours.` : 'A ship. Prize or predator?');
    if (n.kind === 'event' && !lead && !heard) lines.push('Something unusual on the horizon.');
    if (n.kind === 'port') lines.push('Repair the hull, hire crew, rest and refit.');
    if (n.kind === 'empty') lines.push('Open sea. Time for repairs, if nothing happens aboard.');
    if (n.kind === 'boss') lines.push('HMS Relentless guards the channel to the open ocean. No running from this one.');
    if (n.kind === 'exit') lines.push(`A passage into ${n.name}. Tougher ships, richer prizes, and the fleet loses your trail for a while.`);
    const reachable = this.reach.includes(n);
    if (reachable && run.isLateral(n)) lines.push('Across the column: exploring costs a jump and a day’s provisions.');
    if (reachable && run.isReef(n)) lines.push(`Through the shoals: skips a column, gaining on the fleet. ${Math.round(run.reefOdds() * 100)}% chance of a clean passage; otherwise a scraped hull, or aground (hull, mast and time).`);
    const sail = reachable ? run.pointOfSail(run.node, n) : 'beam';
    if (sail === 'foul') lines.push('Foul wind: a day lost beating to windward (an extra day’s provisions), and the fleet gains.');
    if (sail === 'fair') lines.push('Fair wind: you gain on the fleet.');
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
