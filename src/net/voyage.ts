import type Phaser from 'phaser';
import { currentRun } from '../render/RunBar';
import { applyVoyage, type VoyageCommand } from '../sim/commands';
import { coop } from './CoopClient';

type Handlers = { [K in VoyageCommand['t']]?: (cmd: Extract<VoyageCommand, { t: K }>) => void };

const registered = new Map<Phaser.Scene, Handlers>();

/**
 * Say how a scene carries out voyage commands: the same code runs whether this player clicked (alone) or the
 * captain's command arrived from the server (co-op), so every player's screen shows the same thing.
 */
export function onVoyage(scene: Phaser.Scene, handlers: Handlers): void {
  registered.set(scene, handlers);
  scene.events.once('shutdown', () => registered.delete(scene));
}

/** Carry out a command through the scene that showed it, or apply it to the voyage directly. Returns whether a scene took it. */
export function runVoyage(scene: Phaser.Scene, cmd: VoyageCommand): boolean {
  const handler = registered.get(scene)?.[cmd.t] as ((c: VoyageCommand) => void) | undefined;
  if (handler) {
    handler(cmd);
    return true;
  }
  applyVoyage(currentRun(scene), cmd);
  return false;
}

/** The active scene that has said how to carry out this command, if any. */
export function handlerScene(cmd: VoyageCommand): Phaser.Scene | null {
  for (const [scene, handlers] of registered) if (handlers[cmd.t] && scene.scene.isActive()) return scene;
  return null;
}

/**
 * A voyage decision from this player. Alone, it happens now. In co-op the captain's goes to the server and happens
 * when it comes back (on every player's screen at once); anyone else's becomes a suggestion to the captain.
 */
export function voyage(scene: Phaser.Scene, cmd: VoyageCommand, label: string): void {
  const link = coop();
  if (!link) {
    runVoyage(scene, cmd);
    return;
  }
  if (link.has('captain')) link.send({ t: 'voyage', cmd });
  else link.send({ t: 'suggest', label });
}

/** Whether this player decides the voyage (always, alone). */
export function decides(): boolean {
  const link = coop();
  return !link || link.has('captain');
}
