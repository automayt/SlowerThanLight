import Phaser from 'phaser';
import { ABOARD_EVENTS } from '../data/events/aboard';
import { WEATHER_EVENTS } from '../data/events/weather';
import { EVENT_SPEAKERS, portraitFor } from '../data/portraits';
import { paintedBackdrop, shade } from '../render/backdrop';
import { cameo, captainOption, Dialogue, INK, INK_RED, onAnyInput, parchment, SPECIAL_COLOR, Typer } from '../render/Dialogue';
import { playLoop } from '../render/sound';
import { currentRun, freshHunger, RunBar } from '../render/RunBar';
import { CAPS_FONT, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, goldText, Sea } from '../render/ui';
import { specialNeed, type Run } from '../sim/Run';
import { loadArtOnDemand } from './PreloadScene';
import { recordDiscovery, saveRun } from './save';
import { onVoyage, voyage } from '../net/voyage';

/** The parchment band along the foot of the painting: the tale on the left, the captain's options on the right. */
const BAND = { x: 40, w: SCREEN.w - 80, bottom: SCREEN.h - 14, pad: 24 };
const TALE = { x: BAND.x + 30, w: 610 };
const OPTS = { w: 500, x: BAND.x + BAND.w - 28 - 500 };
const KEYS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];

const ABOARD = new Set(ABOARD_EVENTS.map((e) => e.id));
const WEATHER = new Set(WEATHER_EVENTS.map((e) => e.id));

/** The painting for an event, or a fitting stand-in: a scene below decks, a squall, or the open sea. */
function eventArt(scene: Phaser.Scene, id: string): string {
  if (scene.textures.exists(`art:event-${id}`)) return `event-${id}`;
  return ABOARD.has(id) ? 'event-fallback-aboard' : WEATHER.has(id) ? 'event-fallback-weather' : 'event-fallback-sea';
}

interface ChoiceRow {
  index: number;
  blocked: string | null;
  special: string | null;
  label: string;
  hints: string[];
}

/** A text event: the painting fills the screen, the tale is written out on parchment, and the captain chooses. */
export class EventScene extends Phaser.Scene {
  private run!: Run;
  private sea: Sea | null = null;
  private bar!: RunBar;
  private choiceButtons: Button[] = [];
  /** Everything on the band, so it can rise when the outcome needs more room. */
  private band!: Phaser.GameObjects.Container;
  private bandTop = 0;
  private bandSheet: Phaser.GameObjects.GameObject[] = [];
  private typers: Typer[] = [];
  private dialogue: Dialogue | null = null;
  /** "Your orders, Captain?", over the options until one is chosen. */
  private ordersHead: Phaser.GameObjects.Text | null = null;
  private ordersFace: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Event');
  }

  preload(): void {
    const run = currentRun(this);
    if (run.encounter.kind !== 'event') return;
    const id = run.encounter.event;
    const files = (this.registry.get('art-files') as string[] | undefined) ?? [];
    if (files.includes(`event-${id}.jpg`)) loadArtOnDemand(this, `event-${id}`);
    else loadArtOnDemand(this, ABOARD.has(id) ? 'event-fallback-aboard' : WEATHER.has(id) ? 'event-fallback-weather' : 'event-fallback-sea');
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    this.choiceButtons = [];
    this.typers = [];
    this.dialogue = null;
    const ev = run.currentEvent();
    recordDiscovery(ev.id);
    playLoop(this, 'waves', 0.22);
    playLoop(this, 'creak', 0.2);

    // The painting over the whole window, drawing the eye in; the open sea if there is none at all.
    const art = paintedBackdrop(this, eventArt(this, ev.id));
    this.sea = art ? null : new Sea(this, SCREEN.w, SCREEN.h);
    shade(this, 230, 60, 0.85);
    this.bar = new RunBar(this, run);

    const title = goldText(this, SCREEN.w / 2, 80, ev.title, 40).setOrigin(0.5, 0).setDepth(2);
    const caption = `${run.sectorDef.name}  ·  leg ${run.legs.sailed} of ${run.legs.total}`;
    this.add.text(SCREEN.w / 2, title.y + title.height + 2, caption, { fontFamily: TITLE_FONT, fontSize: '16px', color: '#e8dcc0', fontStyle: 'italic' }).setOrigin(0.5, 0).setShadow(0, 1, '#000', 4, false, true).setDepth(2);
    if (ev.rarity === 'legendary' || ev.rarity === 'rare') {
      this.add
        .text(SCREEN.w - 48, 84, `✦ ${ev.rarity === 'legendary' ? 'Legendary' : 'Rare'} ✦`, { fontFamily: CAPS_FONT, fontSize: '18px', color: ev.rarity === 'legendary' ? '#ffb347' : SPECIAL_COLOR })
        .setOrigin(1, 0)
        .setShadow(0, 1, '#000', 4, false, true)
        .setDepth(2);
    }

    // What there is to say and to choose, measured before the band is laid out around it.
    const hunger = freshHunger(this, run);
    const tale = run.eventText();
    const speaker = EVENT_SPEAKERS[ev.id];
    const rows = this.choiceRows();

    this.band = this.add.container(0, 0).setDepth(3);
    let ty = 0;
    const parts: Phaser.GameObjects.GameObject[] = [];
    if (hunger) {
      const note = this.add.text(TALE.x, ty, `⚠ ${hunger}`, textStyle(15, INK_RED, { fontStyle: 'italic', wordWrap: { width: TALE.w }, lineSpacing: 3 }));
      parts.push(note);
      ty += note.height + 12;
    }
    let taleH = 0;
    let taleText: Phaser.GameObjects.Text | null = null;
    if (speaker) {
      // Told by one person: their face and name, and the tale in their voice.
      this.dialogue = new Dialogue(this, { x: TALE.x, y: ty, w: TALE.w, portrait: speaker.portrait, name: speaker.name, text: tale, size: 17, onDone: () => this.reveal() });
      taleH = this.dialogue.fullHeight;
      parts.push(this.dialogue);
    } else {
      taleText = this.add.text(TALE.x, ty, '', textStyle(18, INK, { wordWrap: { width: TALE.w }, lineSpacing: 6 }));
      taleH = Typer.measure(taleText, tale);
      parts.push(taleText);
    }
    const leftH = ty + taleH;

    // Your own captain's face beside the question: the decision is theirs.
    const face = (this.ordersFace = cameo(this, portraitFor({ captain: run.captain.id }), OPTS.x, 0, 50));
    const hx = face.length ? OPTS.x + 50 : OPTS.x;
    const head = (this.ordersHead = this.add.text(hx, face.length ? 12 : 0, 'Your orders, Captain?', { fontFamily: TITLE_FONT, fontSize: '19px', color: INK, fontStyle: 'italic' }));
    parts.push(...face, head);
    let cy = Math.max(head.y + head.height, face.length ? 50 : 0) + 8;
    rows.forEach((row, pos) => {
      const b = this.optionButton(row, pos, OPTS.x, cy);
      this.choiceButtons.push(b);
      parts.push(b);
      cy += b.height + 8;
    });
    const rightH = cy - 8;

    const inner = Math.max(150, leftH, rightH);
    this.layBand(inner + BAND.pad * 2);
    // The rule between the tale and the orders, inked down the sheet.
    const rule = this.add.graphics().lineStyle(1.2, 0x2a170a, 0.45).lineBetween(OPTS.x - 22, 6, OPTS.x - 22, inner - 6);
    this.band.add([rule, ...parts]);
    for (const p of parts) (p as unknown as Phaser.GameObjects.Components.Transform).y += BAND.pad;
    rule.y += BAND.pad;

    // The tale is written out; the orders appear once it is (or at once, on a click or key).
    if (taleText) this.typers.push(new Typer(this, taleText, tale, 70, () => this.reveal()));
    const off = onAnyInput(this, () => this.skipAll());
    this.events.once('event-revealed', off);
    for (const b of this.choiceButtons) b.setVisible(false).setAlpha(0);

    rows.forEach((row, pos) => KEYS[pos] && this.input.keyboard!.on(`keydown-${KEYS[pos]}`, () => this.choiceButtons.length && run.canChoose(row.index) && this.choiceButtons[pos].press()));
    onVoyage(this, { choose: (cmd) => this.choose(cmd.index) });
  }

  /** The open choices: special ones only when you have what they need, each with warnings about hidden costs. */
  private choiceRows(): ChoiceRow[] {
    const run = this.run;
    const ev = run.currentEvent();
    return ev.choices
      .map((choice, index) => ({ choice, index }))
      .filter(({ choice, index }) => !specialNeed(choice.needs) || !run.choiceBlocker(index))
      .map(({ choice, index }) => {
        const blocked = run.choiceBlocker(index);
        const time = choice.outcomes.filter((o) => (o.effect.navy ?? 0) > 0).length;
        const fight = choice.outcomes.some((o) => o.effect.battle);
        const eats = choice.outcomes.filter((o) => (o.effect.provisions ?? 0) < 0).length;
        const hints = [
          time ? (time === choice.outcomes.length ? 'costs time' : 'may cost time') : '',
          eats ? (eats === choice.outcomes.length ? 'costs provisions' : 'may cost provisions') : '',
          fight ? 'may mean a fight' : '',
        ].filter(Boolean);
        const label = `${run.fill(choice.label)}${choice.cost ? `  (${choice.cost} gold)` : ''}${blocked && !choice.cost ? `  (${blocked})` : ''}`;
        return { index, blocked, special: specialNeed(choice.needs), label, hints };
      });
  }

  /** One of the captain's options. */
  private optionButton(row: ChoiceRow, pos: number, x: number, y: number): Button {
    const run = this.run;
    const ev = run.currentEvent();
    const b = captainOption(
      this,
      x,
      y,
      OPTS.w,
      { num: pos + 1, label: `${row.special ? `[${row.special}] ` : ''}${row.label}`, sub: row.hints.length ? `· ${row.hints.join(', ')}` : undefined, special: !!row.special, enabled: !row.blocked },
      () => voyage(this, { t: 'choose', index: row.index }, run.fill(ev.choices[row.index].label)),
    );
    if (row.blocked) b.setTip(`Not open to you: ${row.blocked}.`);
    return b;
  }

  /** (Re)draw the parchment sheet under the band, `h` tall, standing on the foot of the screen. */
  private layBand(h: number): void {
    this.bandSheet.forEach((o) => o.destroy());
    this.bandTop = BAND.bottom - h;
    this.bandSheet = parchment(this, BAND.x, 0, BAND.w, h);
    this.band.addAt(this.bandSheet, 0);
    this.band.y = this.bandTop;
  }

  /** Finish the words being written and show the orders. */
  private skipAll(): void {
    this.dialogue?.skip();
    for (const t of this.typers) t.finish();
    this.reveal();
  }

  /** The captain's options fade in, one after another. */
  private reveal(): void {
    if (this.choiceButtons.length === 0 || this.choiceButtons[0].visible) return;
    this.events.emit('event-revealed');
    this.choiceButtons.forEach((b, i) => {
      b.setVisible(true);
      this.tweens.add({ targets: b, alpha: 1, x: { from: b.x + 14, to: b.x }, duration: 220, delay: i * 70, ease: 'Sine.easeOut' });
    });
  }

  private choose(index: number): void {
    const run = this.run;
    if (!this.choiceButtons.length || !run.canChoose(index)) return;
    // A choice that comes from the captain (in co-op) arrives whether or not the words have finished.
    this.skipAll();
    const result = run.chooseEvent(index);
    saveRun(run);
    for (const b of this.choiceButtons) b.destroy();
    this.choiceButtons = [];

    // The outcome in the orders' column, in ink, with what it changed below.
    const said = this.add.text(OPTS.x, 0, result.effect.text, textStyle(18, INK, { wordWrap: { width: OPTS.w }, lineSpacing: 5, fontStyle: 'italic' }));
    const saidH = Typer.measure(said, result.effect.text);
    const changes = result.changes.length ? this.add.text(OPTS.x, 0, result.changes.join('\n'), textStyle(15, '#3b2410', { wordWrap: { width: OPTS.w }, lineSpacing: 4, fontStyle: 'bold' })) : null;
    const need = saidH + (changes ? 14 + changes.height : 0) + 16 + 46;
    const inner = BAND.bottom - this.bandTop - BAND.pad * 2;
    // Make room if it must: the sheet grows upward, carrying the tale with it.
    if (need > inner) this.layBand(need + BAND.pad * 2);
    this.ordersHead?.destroy();
    this.ordersHead = null;
    this.ordersFace.forEach((o) => o.destroy());
    said.setY(BAND.pad);
    changes?.setY(BAND.pad + saidH + 14).setAlpha(0);
    this.band.add(changes ? [said, changes] : [said]);
    this.typers.push(new Typer(this, said, result.effect.text, 75, () => changes && this.tweens.add({ targets: changes, alpha: 1, duration: 260 })));
    onAnyInput(this, () => {
      for (const t of this.typers) t.finish();
      changes?.setAlpha(1);
    });

    const target = run.over ? 'RunEnd' : run.status === 'battle' ? 'Battle' : run.status === 'event' ? 'Event' : 'SeaMap';
    const next = () => {
      this.registry.set('chart-note', result.effect.text);
      if (target === 'Event') this.scene.restart();
      else this.scene.start(target);
    };
    const label = { RunEnd: 'Voyage’s end →', Battle: 'Beat to quarters!', Event: 'Continue →', SeaMap: 'Back to the chart →' }[target];
    const sheetH = BAND.bottom - this.bandTop;
    const go = new Button(this, OPTS.x + OPTS.w - 280, sheetH - BAND.pad - 46, 280, 46, label, next, { size: 18, hint: 'Enter' });
    this.band.add(go);
    this.input.keyboard!.once('keydown-ENTER', () => go.press());
  }

  update(time: number): void {
    this.sea?.draw(time);
    this.bar.refresh();
  }
}
