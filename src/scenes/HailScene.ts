import Phaser from 'phaser';
import { enemy } from '../data/enemies';
import { power } from '../data/powers';
import { NEMESIS } from '../data/nemesis';
import { craneLine, hailLine, portraitFor, shipMasterPortrait, withoutQuotes } from '../data/portraits';
import { paintedBackdrop, shade } from '../render/backdrop';
import { cameo, captainOption, Dialogue, INK, INK_RED, onAnyInput, parchment, Typer } from '../render/Dialogue';
import { ledgerOpen, openLedger, standingBar } from '../render/Ledger';
import { currentRun, freshHunger, RunBar } from '../render/RunBar';
import { playSfx, setMood } from '../render/sound';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, goldText, panel, Sea } from '../render/ui';
import { tierName } from '../sim/Diplomacy';
import type { HailOption, Run } from '../sim/Run';
import { loadArtOnDemand } from './PreloadScene';
import { saveRun } from './save';
import { onVoyage, voyage } from '../net/voyage';

const BAND = { x: 40, w: SCREEN.w - 80, bottom: SCREEN.h - 14, pad: 22 };
const LEFT = { x: BAND.x + 28, w: 610 };
const OPTS = { w: 500, x: BAND.x + BAND.w - 28 - 500 };
const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];

/** Odds and price of an answer, in a few words. */
function terms(o: HailOption): string {
  return [o.cost ? `${o.cost} gold` : '', o.chance !== undefined ? `${Math.round(o.chance * 100)}% chance` : '', o.fight === 'maybe' ? 'may mean a fight' : '']
    .filter(Boolean)
    .join(' · ');
}

/** A sail in sight: her painting fills the screen, her master calls across, and you answer: talk, pay, trick, threaten, or fight. */
export class HailScene extends Phaser.Scene {
  private run!: Run;
  private sea: Sea | null = null;
  private bar!: RunBar;
  private buttons: Button[] = [];
  private band!: Phaser.GameObjects.Container;
  private bandTop = 0;
  private sheet: Phaser.GameObjects.GameObject[] = [];
  private head: Phaser.GameObjects.Text | null = null;
  private face: Phaser.GameObjects.GameObject[] = [];
  private typers: Typer[] = [];
  private dialogue: Dialogue | null = null;

  constructor() {
    super('Hail');
  }

  preload(): void {
    const run = currentRun(this);
    if (run.encounter.kind === 'battle') loadArtOnDemand(this, this.artKey(run));
  }

  private artKey(run: Run): string {
    const id = run.encounter.kind === 'battle' ? run.encounter.enemy : '';
    return id === 'frigate' ? 'blockade' : `enemy-${id}`;
  }

  create(): void {
    const run = (this.run = currentRun(this));
    if (run.encounter.kind !== 'battle') return void this.scene.start('SeaMap');
    saveRun(run);
    this.buttons = [];
    this.typers = [];
    this.sheet = [];
    const enc = run.encounter;
    // Crane, or a ship that means you harm: the chart's uneasy music.
    if (enc.nemesis || enc.boss) setMood(this, { tense: true });
    const foe = enemy(enc.enemy);
    const flag = power(foe.power);

    this.sea = paintedBackdrop(this, this.artKey(run), { push: 0.07 }) ? null : new Sea(this, SCREEN.w, SCREEN.h);
    shade(this, 240, 60, 0.8);
    this.bar = new RunBar(this, run);
    goldText(this, SCREEN.w / 2, 80, `Sail ho: ${enc.name}`, 36).setOrigin(0.5, 0).setDepth(2);
    this.flagCard(run);

    // Who calls across the water, and what they say.
    const fleeing = enc.intent === 'wary' && foe.ai.fleeAt >= 1;
    const who = enc.nemesis
      ? { portrait: portraitFor('crane'), name: NEMESIS.captain, role: `Captain of ${NEMESIS.ship}`, line: craneLine(enc.text, run.nemesis.met) }
      : enc.intent === 'commodore'
        ? { portrait: portraitFor({ power: 'crown' }), name: 'The Commodore’s lieutenant', role: `Under a flag of truce from ${enc.name}`, line: hailLine('commodore', false, enc.name) }
        : { portrait: shipMasterPortrait(foe.power, enc.name), name: `Master of ${enc.name}`, role: `${foe.ship.className} · ${flag.name}`, line: hailLine(enc.intent ?? 'wary', fleeing, enc.name) };
    const narration = [enc.nemesis ? withoutQuotes(enc.text) : enc.text, run.hailText()].join(' ');

    this.band = this.add.container(0, 0).setDepth(3);
    const parts: Phaser.GameObjects.GameObject[] = [];
    let ly = 0;
    const hunger = freshHunger(this, run);
    if (hunger) {
      const note = this.add.text(LEFT.x, ly, `⚠ ${hunger}`, textStyle(15, INK_RED, { fontStyle: 'italic', wordWrap: { width: LEFT.w }, lineSpacing: 3 }));
      parts.push(note);
      ly += note.height + 10;
    }
    const tale = this.add.text(LEFT.x, ly, '', textStyle(16, INK, { wordWrap: { width: LEFT.w }, lineSpacing: 4 }));
    const taleH = Typer.measure(tale, narration);
    parts.push(tale);
    ly += taleH + 14;
    this.dialogue = new Dialogue(this, { x: LEFT.x, y: ly, w: LEFT.w, portrait: who.portrait, name: who.name, role: who.role, text: `“${who.line}”`, portraitH: 120, size: 18, autoStart: false });
    parts.push(this.dialogue);
    const leftH = ly + this.dialogue.fullHeight;
    // The sighting is written first; then the master speaks.
    this.dialogue.setAlpha(0);
    const speak = () => {
      if (!this.dialogue?.active || this.dialogue.alpha > 0) return;
      this.dialogue.setAlpha(1);
      this.dialogue.say(`“${who.line}”`, () => this.reveal());
    };
    this.typers.push(new Typer(this, tale, narration, 80, speak));

    const face = (this.face = cameo(this, portraitFor({ captain: run.captain.id }), OPTS.x, 0, 50));
    const hx = face.length ? OPTS.x + 50 : OPTS.x;
    const head = (this.head = this.add.text(hx, face.length ? 12 : 0, enc.nemesis ? 'Answer him, Captain.' : 'How do you answer her?', { fontFamily: TITLE_FONT, fontSize: '19px', color: INK, fontStyle: 'italic' }));
    parts.push(...face, head);
    let cy = Math.max(head.y + head.height, face.length ? 50 : 0) + 8;
    const options = run.hailOptions();
    options.forEach((o, i) => {
      const b = captainOption(
        this,
        OPTS.x,
        cy,
        OPTS.w,
        { num: i + 1, label: `${o.label}${o.blocker ? `  (${o.blocker})` : ''}`, sub: [o.detail, terms(o)].filter(Boolean).join('  ·  '), enabled: o.available, tip: o.blocker ?? undefined },
        () => voyage(this, { t: 'hail', id: o.id }, o.label),
      );
      this.buttons.push(b);
      parts.push(b);
      cy += b.height + 8;
    });
    const inner = Math.max(150, leftH, cy - 8);
    this.layBand(inner + BAND.pad * 2);
    const rule = this.add.graphics().lineStyle(1.2, 0x2a170a, 0.45).lineBetween(OPTS.x - 22, 6, OPTS.x - 22, inner - 6);
    this.band.add([rule, ...parts]);
    for (const p of [rule, ...parts]) (p as unknown as Phaser.GameObjects.Components.Transform).y += BAND.pad;
    for (const b of this.buttons) b.setVisible(false).setAlpha(0);

    // A click or key writes everything out at once and shows the answers.
    const off = onAnyInput(this, () => this.skipAll(speak));
    this.events.once('hail-revealed', off);
    options.forEach((_, i) => this.input.keyboard!.on(`keydown-${KEYS[i]}`, () => !ledgerOpen(this) && this.buttons[i]?.press()));
    onVoyage(this, { hail: (cmd) => this.choose(options.find((o) => o.id === cmd.id)!) });
  }

  /** Whose flag she flies and how that flag regards you, on a small card under the title. */
  private flagCard(run: Run): void {
    const enc = run.encounter;
    if (enc.kind !== 'battle') return;
    const foe = enemy(enc.enemy);
    const flag = power(foe.power);
    const x = 40;
    const y = 132;
    const w = 380;
    panel(this, x, y, w, enc.nemesis ? 118 : 128).setDepth(2);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(2.1) && o;
    if (enc.nemesis) {
      // Crane flies no flag but his own: his quarrel is with you, and nobody else takes sides.
      add(this.add.text(x + 16, y + 12, `${foe.ship.className} · Captain ${NEMESIS.captain}`, { fontFamily: TITLE_FONT, fontSize: '19px', color: COLORS.textWarn }));
      const { met, grudge } = run.nemesis;
      const story = met <= 1 ? 'The first time you have met since you marooned him.' : `Your ${['second', 'third', 'fourth'][met - 2] ?? 'next'} meeting. He has got away from you ${grudge === 1 ? 'once' : `${grudge} times`}.`;
      add(this.add.text(x + 16, y + 42, `${story} No flag will take sides in this.`, textStyle(13, COLORS.text, { wordWrap: { width: w - 32 } })));
      return;
    }
    add(this.add.text(x + 16, y + 12, `${foe.ship.className} · ${flag.name}`, { fontFamily: TITLE_FONT, fontSize: '19px', color: flag.color }));
    for (const o of standingBar(this, x + 16, y + 46, w - 32, 10, run.standing[foe.power])) add(o);
    add(this.add.text(x + 16, y + 62, `${flag.name} regard${foe.power === 'brethren' || foe.power === 'trade' ? '' : 's'} you as ${tierName(run.tier(foe.power)).toLowerCase()} (${run.standing[foe.power]})`, textStyle(13, COLORS.text)));
    new Button(this, x + 16, y + 86, 180, 30, 'Standing at sea', () => openLedger(this, run), { size: 13, hint: 'L' }).setDepth(2.1);
  }

  private layBand(h: number): void {
    this.sheet.forEach((o) => o.destroy());
    this.bandTop = BAND.bottom - h;
    this.sheet = parchment(this, BAND.x, 0, BAND.w, h);
    this.band.addAt(this.sheet, 0);
    this.band.y = this.bandTop;
  }

  private skipAll(speak?: () => void): void {
    for (const t of this.typers) t.finish();
    speak?.();
    this.dialogue?.skip();
    this.reveal();
  }

  private reveal(): void {
    if (!this.buttons.length || this.buttons[0].visible) return;
    this.events.emit('hail-revealed');
    this.buttons.forEach((b, i) => {
      b.setVisible(true);
      this.tweens.add({ targets: b, alpha: 1, x: { from: b.x + 14, to: b.x }, duration: 220, delay: i * 70, ease: 'Sine.easeOut' });
    });
  }

  private choose(o: HailOption): void {
    const run = this.run;
    if (!this.buttons.length || !o.available) return;
    // The captain's answer (in co-op) goes through whether or not the words have finished.
    for (const t of this.typers) t.finish();
    this.dialogue?.setAlpha(1);
    this.dialogue?.skip();
    const result = run.hail(o.id);
    saveRun(run);
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    if (result.fight) playSfx(this, 'boarders', 0.4);
    else if (result.changes.some((c) => c.includes('gold'))) playSfx(this, 'coins', 0.5);

    const said = this.add.text(OPTS.x, 0, result.text, textStyle(17, INK, { wordWrap: { width: OPTS.w }, lineSpacing: 5, fontStyle: 'italic' }));
    const saidH = Typer.measure(said, result.text);
    const changes = result.changes.length ? this.add.text(OPTS.x, 0, result.changes.join('\n'), textStyle(15, '#3b2410', { wordWrap: { width: OPTS.w }, lineSpacing: 4, fontStyle: 'bold' })) : null;
    const need = saidH + (changes ? 14 + changes.height : 0) + 16 + 46;
    if (need > BAND.bottom - this.bandTop - BAND.pad * 2) this.layBand(need + BAND.pad * 2);
    this.head?.destroy();
    this.head = null;
    this.face.forEach((o) => o.destroy());
    said.setY(BAND.pad);
    changes?.setY(BAND.pad + saidH + 14).setAlpha(0);
    this.band.add(changes ? [said, changes] : [said]);
    this.typers.push(new Typer(this, said, result.text, 75, () => changes && this.tweens.add({ targets: changes, alpha: 1, duration: 260 })));
    onAnyInput(this, () => {
      for (const t of this.typers) t.finish();
      changes?.setAlpha(1);
    });

    const target = run.over ? 'RunEnd' : result.fight ? 'Battle' : 'SeaMap';
    const next = () => {
      if (!result.fight) this.registry.set('chart-note', result.text);
      this.scene.start(target);
    };
    const label = { RunEnd: 'Voyage’s end →', Battle: 'Beat to quarters!', SeaMap: 'Back to the chart →' }[target];
    const go = new Button(this, OPTS.x + OPTS.w - 260, BAND.bottom - this.bandTop - BAND.pad - 46, 260, 46, label, next, { size: 18, hint: 'Enter' });
    this.band.add(go);
    this.input.keyboard!.once('keydown-ENTER', () => go.press());
  }

  update(time: number): void {
    this.sea?.draw(time);
    this.bar.refresh();
  }
}
