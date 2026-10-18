import Phaser from 'phaser';
import { playLoop } from '../render/sound';
import { placeArt } from '../render/art';
import { currentRun, freshHunger, RunBar } from '../render/RunBar';
import { CAPS_FONT, COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, divider, frame, gild, goldText, panel, Sea } from '../render/ui';
import { specialNeed, type Run } from '../sim/Run';
import { loadArtOnDemand } from './PreloadScene';
import { recordDiscovery, saveRun } from './save';
import { onVoyage, voyage } from '../net/voyage';

/** The colour of a choice your ship, fittings, crew or friends make possible. */
const SPECIAL_COLOR = '#8fc7ff';

const X = 40;
const Y = 88;
const W = SCREEN.w - 80;
const H = SCREEN.h - Y - 16;
const ART = { x: X + 28, y: Y + 76, w: 640, h: 360 };

/** A text event: read the situation, make a choice, live with the result. */
export class EventScene extends Phaser.Scene {
  private run!: Run;
  private sea!: Sea;
  private bar!: RunBar;
  private choiceButtons: Button[] = [];
  /** Text column, beside the illustration when there is one. */
  private tx = 0;
  private tw = 0;
  private choicesY = 0;

  constructor() {
    super('Event');
  }

  preload(): void {
    const run = currentRun(this);
    if (run.encounter.kind === 'event') loadArtOnDemand(this, `event-${run.encounter.event}`);
  }

  create(): void {
    const run = (this.run = currentRun(this));
    saveRun(run);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    playLoop(this, 'waves', 0.22);
    playLoop(this, 'creak', 0.2);
    this.bar = new RunBar(this, run);
    this.choiceButtons = [];
    const ev = run.currentEvent();
    recordDiscovery(ev.id);

    panel(this, X, Y, W, H);
    const title = goldText(this, SCREEN.w / 2, Y + 14, ev.title, 36).setOrigin(0.5, 0);
    divider(this, SCREEN.w / 2, title.y + title.height + 4, Math.max(260, title.width + 120));
    const rarity = ev.rarity === 'legendary' ? 'Legendary' : ev.rarity === 'rare' ? 'Rare' : '';
    if (rarity) this.add.text(X + W - 26, Y + 22, `✦ ${rarity} ✦`, { fontFamily: CAPS_FONT, fontSize: '17px', color: ev.rarity === 'legendary' ? '#ffb347' : '#8fc7ff' }).setOrigin(1, 0);
    const art = placeArt(this, `event-${ev.id}`, ART.x, ART.y, ART.w, ART.h, false);
    if (art) {
      frame(this, ART.x - 4, ART.y - 4, ART.w + 8, ART.h + 8);
      // A caption under the picture, as in a bound log.
      const caption = `${run.sectorDef.name}  ·  leg ${run.legs.sailed} of ${run.legs.total}`;
      this.add.text(ART.x + ART.w / 2, ART.y + ART.h + 14, caption, { fontFamily: TITLE_FONT, fontSize: '17px', color: COLORS.textDim, fontStyle: 'italic' }).setOrigin(0.5, 0);
    }
    this.tx = art ? ART.x + ART.w + 32 : X + 120;
    this.tw = art ? X + W - this.tx - 28 : W - 240;

    // Hunger on the way here comes first, once: a chained event that follows does not repeat it.
    let top = ART.y;
    const hunger = freshHunger(this, run);
    if (hunger) {
      const note = this.add.text(this.tx, top, `⚠ ${hunger}`, textStyle(15, COLORS.textWarn, { fontStyle: 'italic', wordWrap: { width: this.tw }, lineSpacing: 3 }));
      top += note.height + 14;
    }
    let body = this.tale(run.eventText(), this.tx, top, this.tw, 17, 5);

    // Each choice wraps to the column, with its warnings on a smaller second line, and the button grows to fit.
    // Special choices (a fitting, a ship, a skilled hand...) only show when you have what they need, marked in blue.
    const open = ev.choices.map((choice, i) => ({ choice, i })).filter(({ choice, i }) => !specialNeed(choice.needs) || !run.choiceBlocker(i));
    const choices = open.map(({ choice, i }, pos) => {
      const blocked = run.choiceBlocker(i);
      const special = specialNeed(choice.needs);
      // Warn about hidden costs: time lost to the fleet, or a fight.
      const time = choice.outcomes.filter((o) => (o.effect.navy ?? 0) > 0).length;
      const fight = choice.outcomes.some((o) => o.effect.battle);
      const eats = choice.outcomes.filter((o) => (o.effect.provisions ?? 0) < 0).length;
      const hints = [
        time ? (time === choice.outcomes.length ? 'costs time' : 'may cost time') : '',
        eats ? (eats === choice.outcomes.length ? 'costs provisions' : 'may cost provisions') : '',
        fight ? 'may mean a fight' : '',
      ].filter(Boolean);
      const label = `${pos + 1}. ${special ? `[${special}] ` : ''}${run.fill(choice.label)}${choice.cost ? `  (${choice.cost} gold)` : ''}${blocked && !choice.cost ? `  (${blocked})` : ''}`;
      const text = this.add.text(0, 0, label, textStyle(16, special ? SPECIAL_COLOR : COLORS.text, { wordWrap: { width: this.tw - 32 }, lineSpacing: 2 }));
      const hint = hints.length ? this.add.text(0, 0, `· ${hints.join(', ')}`, textStyle(13, COLORS.gold, { fontStyle: 'italic', wordWrap: { width: this.tw - 32 } })) : null;
      const h = Math.max(44, 10 + text.height + (hint ? 2 + hint.height : 0) + 10);
      return { blocked, text, hint, h, index: i };
    });
    const gap = 10;
    const total = choices.reduce((n, c) => n + c.h + gap, -gap);
    // Long tales give up a little type size before the choices are pushed out of the panel.
    if (body.bottom + 28 + total > Y + H - 16) {
      body.parts.forEach((o) => o.destroy());
      body = this.tale(run.eventText(), this.tx, top, this.tw, 15, 3);
    }
    this.choicesY = body.bottom + Math.max(12, Math.min(28, Y + H - 16 - total - body.bottom));

    let cy = this.choicesY;
    choices.forEach(({ blocked, text, hint, h, index }) => {
      const b = new Button(this, this.tx, cy, this.tw, h, '', () => voyage(this, { t: 'choose', index }, run.fill(ev.choices[index].label)));
      // The button's own one-line label is unused; the wrapped lines ride in the button instead.
      b.label.setVisible(false);
      text.setPosition(16, 10);
      hint?.setPosition(16, 10 + text.height + 2);
      b.add(hint ? [text, hint] : [text]);
      b.setEnabled(!blocked);
      if (blocked) b.setTip(`Not open to you: ${blocked}.`);
      if (blocked) [text, hint].forEach((o) => o?.setAlpha(0.4));
      this.choiceButtons.push(b);
      cy += h + gap;
    });
    const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    choices.forEach(({ index }, pos) => keys[pos] && this.input.keyboard!.on(`keydown-${keys[pos]}`, () => this.choiceButtons.length && run.canChoose(index) && this.choiceButtons[pos].press()));
    onVoyage(this, { choose: (cmd) => this.choose(cmd.index) });
  }

  /**
   * The tale, set like a page of a book: its first letter a gilt drop cap two lines deep, the opening lines wrapped
   * beside it, the rest at full measure below. Tales that open with a quotation mark go without.
   */
  private tale(text: string, x: number, y: number, w: number, size: number, spacing: number): { parts: Phaser.GameObjects.Text[]; bottom: number } {
    const style = (width: number) => textStyle(size, COLORS.text, { wordWrap: { width }, lineSpacing: spacing });
    if (!/^[A-Z]/.test(text)) {
      const t = this.add.text(x, y, text, style(w));
      return { parts: [t], bottom: t.y + t.height };
    }
    const cap = gild(this.add.text(x - 2, y - size * 0.32, text[0], { fontFamily: TITLE_FONT, fontSize: `${Math.round(size * 3.3)}px`, color: COLORS.gold, stroke: '#1a0e05', strokeThickness: 3 }));
    const indent = cap.width + 6;
    const rest = text.slice(1);
    const head = this.add.text(x + indent, y, rest, style(w - indent));
    const lines = head.getWrappedText();
    if (lines.length <= 2) return { parts: [cap, head], bottom: Math.max(head.y + head.height, cap.y + cap.height) };
    // Cut the text after the second wrapped line: find where those lines end in the original.
    let at = 0;
    for (const line of lines.slice(0, 2)) {
      const found = rest.indexOf(line.trim(), at);
      if (found >= 0) at = found + line.trim().length;
    }
    head.setText(rest.slice(0, at));
    const tail = this.add.text(x, head.y + head.height + spacing, rest.slice(at).replace(/^[ \t]*\n?/, ''), style(w));
    return { parts: [cap, head, tail], bottom: tail.y + tail.height };
  }

  private choose(index: number): void {
    const run = this.run;
    if (!this.choiceButtons.length || !run.canChoose(index)) return;
    const result = run.chooseEvent(index);
    saveRun(run);
    for (const b of this.choiceButtons) b.destroy();
    this.choiceButtons = [];

    divider(this, this.tx + this.tw / 2, this.choicesY - 4, Math.min(240, this.tw), COLORS.brass, 0.6);
    const said = this.add.text(this.tx, this.choicesY + 12, result.effect.text, textStyle(17, COLORS.gold, { wordWrap: { width: this.tw }, lineSpacing: 5, fontStyle: 'italic' }));
    if (result.changes.length) {
      this.add.text(this.tx, said.y + said.height + 18, result.changes.join('\n'), textStyle(15, COLORS.text, { wordWrap: { width: this.tw }, lineSpacing: 4 }));
    }

    const target = run.over ? 'RunEnd' : run.status === 'battle' ? 'Battle' : run.status === 'event' ? 'Event' : 'SeaMap';
    const next = () => {
      this.registry.set('chart-note', result.effect.text);
      if (target === 'Event') this.scene.restart();
      else this.scene.start(target);
    };
    const label = { RunEnd: 'Voyage’s end →', Battle: 'Beat to quarters!', Event: 'Continue →', SeaMap: 'Back to the chart →' }[target];
    const go = new Button(this, SCREEN.w / 2 - 140, Y + H - 66, 280, 46, label, next, { size: 18, hint: 'Enter' });
    this.input.keyboard!.once('keydown-ENTER', () => go.press());
  }

  update(time: number): void {
    this.sea.draw(time);
    this.bar.refresh();
  }
}
