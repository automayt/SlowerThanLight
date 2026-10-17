import Phaser from 'phaser';
import { POWER_IDS, power, relation } from '../data/powers';
import { STANDING_MAX, STANDING_MIN, TIERS, tierName, type TierId } from '../sim/Diplomacy';
import { describeCommission, type Run } from '../sim/Run';
import type { PowerId } from '../sim/types';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from './theme';
import { Button, panel } from './ui';

/** Band colours for the standing bar, coldest to warmest. */
const BAND: Record<TierId, number> = { feud: 0x7a1e1e, hostile: 0x8a4a2a, wary: 0x5a5a4a, friendly: 0x3f6a3a, allied: 0x2f7a5a };

const fraction = (v: number) => (v - STANDING_MIN) / (STANDING_MAX - STANDING_MIN);

/**
 * A standing bar: the five bands laid end to end from blood feud to allied, and a marker where you stand.
 * Returns the objects drawn, so callers can clear them.
 */
export function standingBar(scene: Phaser.Scene, x: number, y: number, w: number, h: number, value: number, depth = 0): Phaser.GameObjects.GameObject[] {
  const g = scene.add.graphics().setDepth(depth);
  TIERS.forEach((t, i) => {
    const from = fraction(t.min);
    const to = fraction(TIERS[i + 1]?.min ?? STANDING_MAX);
    g.fillStyle(BAND[t.id], 0.85).fillRect(x + from * w, y, (to - from) * w, h);
  });
  g.lineStyle(1, COLORS.panelEdge, 1).strokeRect(x, y, w, h);
  const mx = x + fraction(value) * w;
  g.fillStyle(0xf2e6c8, 1).fillTriangle(mx - 6, y - 5, mx + 6, y - 5, mx, y + 3);
  g.fillRect(mx - 1, y, 2, h);
  return [g];
}

/** A power's name in its own ink. */
export function powerColor(id: PowerId): string {
  return power(id).color;
}

/** Who a power is at odds with and who it favours, in a line. */
function relations(id: PowerId): string {
  const enemies = POWER_IDS.filter((p) => p !== id && relation(id, p) <= -1).map((p) => power(p).short);
  const rivals = POWER_IDS.filter((p) => p !== id && relation(id, p) === -0.5).map((p) => power(p).short);
  const friends = POWER_IDS.filter((p) => p !== id && relation(id, p) > 0).map((p) => power(p).short);
  return [enemies.length ? `At war with ${enemies.join(', ')}` : '', rivals.length ? `rivals of ${rivals.join(', ')}` : '', friends.length ? `friends of ${friends.join(', ')}` : '']
    .filter(Boolean)
    .join('; ');
}

/**
 * The captain's ledger of standing: how every power regards you, what that means, who hates whom, and any work or
 * escort in hand. A modal overlay; `onClose` runs once it is gone.
 */
export class Ledger {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  closed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    run: Run,
    private readonly onClose: () => void = () => {},
  ) {
    const w = 900;
    const h = 600;
    const x = (SCREEN.w - w) / 2;
    const y = (SCREEN.h - h) / 2;
    const d = 60;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(d + 1);
      this.objects.push(o);
      return o;
    };
    const shade = scene.add.rectangle(0, 0, SCREEN.w, SCREEN.h, 0x000000, 0.6).setOrigin(0).setDepth(d).setInteractive();
    shade.on('pointerdown', () => this.close());
    this.objects.push(shade, panel(scene, x, y, w, h, { modal: true }).setDepth(d));
    add(scene.add.text(SCREEN.w / 2, y + 16, 'Standing at Sea', { fontFamily: TITLE_FONT, fontSize: '30px', color: COLORS.gold }).setOrigin(0.5, 0));
    add(scene.add.text(SCREEN.w / 2, y + 56, 'How the powers regard you. Fighting a flag angers it and pleases its enemies.', textStyle(13, COLORS.textDim)).setOrigin(0.5, 0));

    const rowH = 82;
    const barX = x + 230;
    const barW = 300;
    POWER_IDS.forEach((id, i) => {
      const ry = y + 92 + i * rowH;
      const p = power(id);
      const v = run.standing[id];
      const tier = run.tier(id);
      add(scene.add.text(x + 30, ry, p.name, { fontFamily: TITLE_FONT, fontSize: '20px', color: p.color }));
      add(scene.add.text(x + 30, ry + 28, relations(id), textStyle(12, COLORS.textDim, { wordWrap: { width: 190 } })));
      for (const o of standingBar(scene, barX, ry + 8, barW, 12, v)) add(o);
      add(scene.add.text(barX, ry + 26, `${tierName(tier)}  (${v > 0 ? '+' : ''}${v})`, textStyle(14, COLORS.text, { fontStyle: 'bold' })));
      add(scene.add.text(barX + barW + 24, ry + 2, TIERS.find((t) => t.id === tier)!.blurb, textStyle(12, COLORS.text, { wordWrap: { width: x + w - 30 - (barX + barW + 24) }, lineSpacing: 2 })));
    });

    const notes = [
      run.commission ? `Commission: ${describeCommission(run.commission)}` : 'No commission in hand. Ports offer work.',
      run.escort ? `In company: ${run.escort.name}, who will fight beside you in your next battle.` : '',
    ].filter(Boolean);
    add(scene.add.text(x + 30, y + h - 104, notes.join('\n'), textStyle(13, COLORS.gold, { wordWrap: { width: w - 60 }, lineSpacing: 4 })));
    const close = new Button(scene, SCREEN.w / 2 - 80, y + h - 52, 160, 38, 'Close', () => this.close(), { size: 15, hint: 'Esc' });
    this.objects.push(close.setDepth(d + 1));
    scene.input.keyboard?.once('keydown-ESC', () => this.close());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const items = this.objects;
    // After this click finishes dispatching.
    this.scene.time.delayedCall(0, () => items.forEach((o) => o.destroy()));
    this.onClose();
  }
}

const opened = new WeakMap<Phaser.Scene, Ledger>();

/** Open the ledger over a scene, unless it is already open there. */
export function openLedger(scene: Phaser.Scene, run: Run): Ledger {
  const now = opened.get(scene);
  if (now && !now.closed) return now;
  const ledger = new Ledger(scene, run, () => opened.delete(scene));
  opened.set(scene, ledger);
  scene.events.once('shutdown', () => opened.delete(scene));
  return ledger;
}

/** Whether the ledger is open over a scene (its keys should wait). */
export function ledgerOpen(scene: Phaser.Scene): boolean {
  return opened.has(scene);
}
