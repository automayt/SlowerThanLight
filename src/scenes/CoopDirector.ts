import Phaser from 'phaser';
import { coop } from '../net/CoopClient';
import type { ServerMessage } from '../net/protocol';
import { handlerScene, runVoyage } from '../net/voyage';
import { setRun } from '../render/RunBar';
import { COLORS, SCREEN, textStyle } from '../render/theme';
import { applyVoyage, voyageCheck } from '../sim/commands';
import { sceneFor } from './save';

export const COOP_DIRECTOR = 'CoopDirector';

/** Scenes that are part of the game itself (not the music or co-op directors). */
const GAME_SCENES = ['Title', 'ShipSelect', 'SeaMap', 'Event', 'Hail', 'Port', 'Battle', 'Result', 'RunEnd', 'Logbook', 'CoopLobby'];

/** How long after a command to check this copy of the voyage still matches the server's (the chart animates a jump first). */
const CHECK_AFTER = 1500;

/**
 * Keeps a co-op player's game in step with the server: replays the captain's commands through whichever screen is
 * showing, moves everyone to the right screen when the voyage moves on, and shows the crew's suggestions and news.
 * A hidden scene that runs alongside the others for as long as co-op is on.
 */
export class CoopDirector extends Phaser.Scene {
  private off: (() => void) | null = null;
  private toasts: Phaser.GameObjects.Container[] = [];
  /** The server's fingerprint after the last command, to compare once this copy has caught up. */
  private pendingCheck: string | null = null;
  private checkTimer: Phaser.Time.TimerEvent | null = null;
  /** Arrived mid-voyage: go to the battle as soon as it is sent. */
  private joinBattle = false;
  /** Who decides, in the corner of the voyage screens, for anyone who is not the captain. */
  private badge!: Phaser.GameObjects.Text;

  constructor() {
    super(COOP_DIRECTOR);
  }

  create(): void {
    const link = coop();
    if (!link) return;
    this.off = link.on((m) => this.onMessage(m));
    this.badge = this.add.text(16, 74, '', textStyle(13, COLORS.gold, { fontStyle: 'italic', backgroundColor: '#07111add', padding: { x: 8, y: 3 } })).setDepth(90);
    this.events.once('shutdown', () => this.off?.());
  }

  /** The game scene on screen. */
  private current(): Phaser.Scene | null {
    return this.game.scene.getScenes(true).find((s) => GAME_SCENES.includes(s.scene.key)) ?? null;
  }

  private go(key: string): void {
    const now = this.current();
    if (!now) this.game.scene.start(key);
    else if (now.scene.key === key) now.scene.restart();
    else now.scene.start(key);
  }

  private onMessage(m: ServerMessage): void {
    const link = coop();
    if (!link) return;
    switch (m.t) {
      case 'voyageSync': {
        const run = link.run!;
        setRun(this, run);
        this.pendingCheck = null;
        this.registry.set('chart-note', `Aboard ${run.def.name}, ${run.sectorDef.name}.`);
        if (run.over) this.go('RunEnd');
        else if (run.status === 'battle') this.joinBattle = true;
        else this.go(sceneFor(run));
        break;
      }
      case 'battleStart':
        if (this.joinBattle) {
          this.joinBattle = false;
          this.go('Battle');
        }
        break;
      case 'voyage': {
        const run = link.run;
        if (!run) return link.send({ t: 'sync' });
        this.verify();
        const scene = handlerScene(m.cmd);
        if (scene) runVoyage(scene, m.cmd);
        else {
          // The screen for it is not showing (someone lingered on another): apply it, and catch up to where the voyage is.
          applyVoyage(run, m.cmd);
          this.go(run.over ? 'RunEnd' : sceneFor(run));
        }
        this.pendingCheck = m.check;
        this.checkTimer?.remove();
        this.checkTimer = this.time.delayedCall(CHECK_AFTER, () => this.verify());
        if (!link.has('captain')) this.toast(`${m.by} gives the order.`, COLORS.textDim);
        break;
      }
      case 'battleEnd':
        setRun(this, link.run!);
        // The battle screen takes it from here; anyone not watching the battle catches up.
        if (this.current()?.scene.key !== 'Battle') this.go(link.run!.over ? 'RunEnd' : sceneFor(link.run!));
        break;
      case 'suggest':
        this.toast(`${m.by} suggests: ${m.label}`, COLORS.gold);
        break;
      case 'notice':
        this.toast(m.text, COLORS.text);
        break;
      case 'error':
        this.toast(m.text, COLORS.textWarn);
        break;
      case 'crew':
        if (!m.crew && this.current()?.scene.key !== 'CoopLobby' && this.current()?.scene.key !== 'Title') this.go('CoopLobby');
        break;
    }
  }

  /** Once the last command has played out here, this copy should match the server's; if not, ask for the voyage whole. */
  private verify(): void {
    const link = coop();
    if (!this.pendingCheck || !link?.run) return;
    if (voyageCheck(link.run) !== this.pendingCheck) {
      console.warn('Co-op voyage drifted from the server; resyncing.');
      link.send({ t: 'sync' });
    }
    this.pendingCheck = null;
  }

  /** A line of news at the top of the screen that fades after a few seconds. */
  toast(text: string, color: string): void {
    const t = this.add.text(0, 0, text, textStyle(15, color, { wordWrap: { width: 640 } })).setOrigin(0.5, 0);
    const bg = this.add.rectangle(0, -6, t.width + 28, t.height + 12, 0x07111a, 0.88).setOrigin(0.5, 0).setStrokeStyle(1, COLORS.panelEdge, 0.8);
    const box = this.add.container(SCREEN.w / 2, 78, [bg, t]).setDepth(100);
    this.toasts.push(box);
    this.layoutToasts();
    this.tweens.add({
      targets: box,
      alpha: 0,
      delay: 4200,
      duration: 600,
      onComplete: () => {
        box.destroy();
        this.toasts = this.toasts.filter((x) => x !== box);
        this.layoutToasts();
      },
    });
  }

  private layoutToasts(): void {
    let y = 78;
    for (const box of this.toasts.slice(-4)) {
      box.setY(y);
      y += box.getBounds().height + 6;
    }
  }

  update(): void {
    // Anyone but the captain is told their clicks on the voyage are suggestions.
    const link = coop();
    const key = this.current()?.scene.key ?? '';
    const voyage = ['SeaMap', 'Event', 'Hail', 'Port', 'Result'].includes(key);
    const captain = link?.holder('captain');
    this.badge.setVisible(!!link && voyage && !link.has('captain'));
    if (this.badge.visible) this.badge.setText(`Captain ${captain ?? '—'} decides; your choices are suggestions.`);
    // Stay drawn over whichever scene is showing.
    if (this.game.scene.getIndex(this) !== this.game.scene.getScenes(false).length - 1) this.scene.bringToTop();
  }
}

/** Run the director (once) for as long as co-op is on. */
export function startCoopDirector(game: Phaser.Game): void {
  if (!game.scene.getScene(COOP_DIRECTOR)) game.scene.add(COOP_DIRECTOR, CoopDirector, true);
  else game.scene.run(COOP_DIRECTOR);
}

export function stopCoopDirector(game: Phaser.Game): void {
  if (game.scene.getScene(COOP_DIRECTOR)) game.scene.stop(COOP_DIRECTOR);
}
