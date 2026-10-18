import Phaser from 'phaser';
import { PLAYER_SHIPS } from '../data/ships';
import { coop, endCoop, startCoop } from '../net/CoopClient';
import type { CrewState } from '../net/protocol';
import { COLORS, SCREEN, TITLE_FONT, textStyle } from '../render/theme';
import { Button, goldText, panel, Sea } from '../render/ui';
import { ROLE_BLURBS, ROLE_NAMES, ROLES, type Role } from '../sim/commands';
import { DIFFICULTY, type Difficulty } from '../sim/Run';
import { startCoopDirector, stopCoopDirector } from './CoopDirector';

const BOX = { x: 120, y: 40, w: SCREEN.w - 240, h: SCREEN.h - 80 };

/**
 * Sail Together: name yourself, raise a crew or join one on this network, choose your jobs aboard, and (as captain)
 * pick the ship and weigh anchor. Roles nobody takes are worked by an AI first mate.
 */
export class CoopLobbyScene extends Phaser.Scene {
  private sea!: Sea;
  private dyn: Phaser.GameObjects.GameObject[] = [];
  private off: (() => void) | null = null;
  private editing = false;
  private draft = '';
  private nameText!: Phaser.GameObjects.Text;

  constructor() {
    super('CoopLobby');
  }

  create(): void {
    const link = startCoop();
    startCoopDirector(this.game);
    this.sea = new Sea(this, SCREEN.w, SCREEN.h);
    this.dyn = [];
    this.editing = false;
    panel(this, BOX.x, BOX.y, BOX.w, BOX.h);
    goldText(this, SCREEN.w / 2, BOX.y + 14, 'Sail Together', 38).setOrigin(0.5, 0);
    this.add
      .text(SCREEN.w / 2, BOX.y + 64, 'One ship, a crew of friends. The captain sets the course; the gunner and bosun fight her. Empty posts go to the first mate.', textStyle(14, COLORS.textDim, { fontStyle: 'italic', wordWrap: { width: BOX.w - 80 }, align: 'center' }))
      .setOrigin(0.5, 0);

    // Your name: click it (or press N) and type.
    this.add.text(BOX.x + 40, BOX.y + 108, 'Your name', textStyle(13, COLORS.textDim));
    this.nameText = this.add.text(BOX.x + 40, BOX.y + 128, '', { fontFamily: TITLE_FONT, fontSize: '22px', color: COLORS.gold }).setInteractive({ useHandCursor: true });
    this.nameText.on('pointerdown', () => this.startEditing());
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.typed(e));

    new Button(this, BOX.x + 40, BOX.y + BOX.h - 60, 180, 40, '← Title', () => this.leaveCoop(), { size: 16, hint: 'Esc' });
    this.input.keyboard!.on('keydown-ESC', () => !this.editing && this.leaveCoop());
    this.off = link.on(() => this.draw());
    this.events.once('shutdown', () => this.off?.());
    this.draw();
  }

  private leaveCoop(): void {
    endCoop();
    stopCoopDirector(this.game);
    this.scene.start('Title');
  }

  private startEditing(): void {
    this.editing = true;
    this.draft = coop()?.name ?? '';
    this.draw();
  }

  private typed(e: KeyboardEvent): void {
    if (!this.editing) {
      if (e.key === 'n' || e.key === 'N') this.startEditing();
      return;
    }
    if (e.key === 'Enter') {
      this.editing = false;
      coop()?.setName(this.draft);
    } else if (e.key === 'Escape') this.editing = false;
    else if (e.key === 'Backspace') this.draft = this.draft.slice(0, -1);
    else if (e.key.length === 1 && this.draft.length < 20) this.draft += e.key;
    this.draw();
  }

  private clear(): void {
    for (const o of this.dyn) o.destroy();
    this.dyn = [];
  }

  private draw(): void {
    const link = coop();
    if (!link) return;
    // Redraw after the click that caused it has finished dispatching.
    this.time.delayedCall(0, () => {
      this.clear();
      this.nameText.setText(this.editing ? `${this.draft}▌` : `${link.name}  ✎`);
      const status = link.status === 'open' ? '' : link.status === 'connecting' ? 'Hailing the server…' : 'No answer from the server. Is `npm run server` running on the host?';
      if (status) this.dyn.push(this.add.text(BOX.x + BOX.w - 40, BOX.y + 128, status, textStyle(13, COLORS.textWarn, { wordWrap: { width: 420 }, align: 'right' })).setOrigin(1, 0));
      if (link.crew) this.drawCrew(link.crew);
      else this.drawCrews();
    });
  }

  /** Not in a crew yet: the crews on this server, and a button to raise your own. */
  private drawCrews(): void {
    const link = coop()!;
    const x = BOX.x + 40;
    let y = BOX.y + 180;
    this.dyn.push(this.add.text(x, y, 'Crews in port', { fontFamily: TITLE_FONT, fontSize: '20px', color: COLORS.gold }));
    y += 34;
    if (!link.crews.length) {
      this.dyn.push(this.add.text(x, y, 'No crews yet. Raise one, and tell your friends to open this game and choose Sail Together.', textStyle(14, COLORS.text, { fontStyle: 'italic' })));
      y += 34;
    }
    for (const c of link.crews.slice(0, 6)) {
      const line = `${c.code}  ·  Captain ${c.captain}  ·  ${c.ship}  ·  ${c.online}/${c.players} aboard${c.sailing ? '  ·  under way' : ''}`;
      this.dyn.push(this.add.text(x, y + 8, line, textStyle(15)));
      this.dyn.push(new Button(this, BOX.x + BOX.w - 200, y, 160, 34, c.sailing ? 'Join the voyage' : 'Join', () => link.send({ t: 'join', code: c.code }), { size: 14 }));
      y += 44;
    }
    this.dyn.push(new Button(this, SCREEN.w / 2 - 130, BOX.y + BOX.h - 66, 260, 46, 'Raise a new crew', () => link.send({ t: 'create' }), { size: 18 }));
  }

  /** In a crew: who is aboard and in which post, your posts, and (captain) the ship and the start. */
  private drawCrew(crew: CrewState): void {
    const link = coop()!;
    const captain = link.has('captain');
    const x = BOX.x + 40;
    let y = BOX.y + 180;
    this.dyn.push(this.add.text(x, y, `Crew ${crew.code}`, { fontFamily: TITLE_FONT, fontSize: '22px', color: COLORS.gold }));
    y += 36;
    for (const m of crew.members) {
      const posts = m.roles.map((r) => ROLE_NAMES[r]).join(', ') || 'no post';
      this.dyn.push(this.add.text(x, y, `${m.online ? '●' : '○'} ${m.name}${m.id === link.id ? ' (you)' : ''}  —  ${posts}`, textStyle(15, m.online ? COLORS.text : COLORS.textDim)));
      y += 24;
    }
    const mate = ROLES.filter((r) => !crew.members.some((m) => m.online && m.roles.includes(r)));
    if (mate.length) {
      this.dyn.push(this.add.text(x, y, `The first mate works: ${mate.map((r) => ROLE_NAMES[r]).join(', ')}`, textStyle(13, COLORS.textDim, { fontStyle: 'italic' })));
      y += 22;
    }

    // Your posts: toggles, with what each does.
    y += 14;
    this.dyn.push(this.add.text(x, y, 'Your posts', textStyle(13, COLORS.textDim)));
    y += 22;
    ROLES.forEach((r: Role, i) => {
      const mine = link.has(r);
      const holder = crew.members.find((m) => m.roles.includes(r) && m.id !== link.id);
      const b = new Button(this, x + i * 200, y, 190, 36, ROLE_NAMES[r], () => {
        const roles = mine ? link.roles.filter((x) => x !== r) : [...link.roles, r];
        link.send({ t: 'roles', roles });
      }, { size: 15, tip: `${ROLE_BLURBS[r]}${holder ? ` Now: ${holder.name}.` : ''}` });
      b.setOn(mine);
      this.dyn.push(b);
    });
    y += 50;

    if (crew.phase === 'lobby') {
      const rx = BOX.x + BOX.w / 2 + 40;
      let ry = BOX.y + 180;
      this.dyn.push(this.add.text(rx, ry, captain ? 'Choose her' : 'The captain chooses the ship', textStyle(13, COLORS.textDim)));
      ry += 22;
      for (const s of PLAYER_SHIPS) {
        const b = new Button(this, rx, ry, 300, 32, `${s.name} · ${s.className}`, () => link.send({ t: 'setup', ship: s.id, difficulty: crew.difficulty }), { size: 14 });
        b.setOn(crew.ship === s.id).setEnabled(captain);
        this.dyn.push(b);
        ry += 38;
      }
      ry += 6;
      (Object.keys(DIFFICULTY) as Difficulty[]).forEach((d, i) => {
        const b = new Button(this, rx + i * 102, ry, 96, 30, DIFFICULTY[d].label, () => link.send({ t: 'setup', ship: crew.ship, difficulty: d }), { size: 13, tip: DIFFICULTY[d].blurb });
        b.setOn(crew.difficulty === d).setEnabled(captain);
        this.dyn.push(b);
      });
      if (captain) this.dyn.push(new Button(this, SCREEN.w / 2 - 130, BOX.y + BOX.h - 66, 260, 46, 'Weigh anchor →', () => link.send({ t: 'start' }), { size: 18 }));
      else this.dyn.push(this.add.text(SCREEN.w / 2, BOX.y + BOX.h - 52, 'Waiting for the captain to weigh anchor…', textStyle(15, COLORS.textDim, { fontStyle: 'italic' })).setOrigin(0.5, 0));
    } else if (crew.phase === 'voyage') {
      this.dyn.push(new Button(this, SCREEN.w / 2 - 130, BOX.y + BOX.h - 66, 260, 46, 'Back aboard →', () => link.send({ t: 'sync' }), { size: 18 }));
    }
    this.dyn.push(new Button(this, BOX.x + BOX.w - 220, BOX.y + BOX.h - 60, 180, 40, 'Leave the crew', () => link.send({ t: 'leave' }), { size: 15 }));
  }

  update(time: number): void {
    this.sea.draw(time);
  }
}
