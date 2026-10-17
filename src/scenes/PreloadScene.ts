import Phaser from 'phaser';
import { applySound, installMusicDirector, soundKey } from '../render/sound';
import { COLORS, SCREEN, textStyle } from '../render/theme';

interface Manifest {
  files: string[];
  /** Audio only: music beds, which the music director streams in after the first screen is up. */
  music?: string[];
}

/**
 * Loads the painted illustrations listed in public/art/manifest.json. Backdrops load up front; event
 * vignettes load on demand when their event opens (see loadArtOnDemand). The game runs fine without any of them.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const label = this.add.text(SCREEN.w / 2, SCREEN.h / 2, 'Loading…', textStyle(18, COLORS.textDim)).setOrigin(0.5);
    this.load.on('progress', (p: number) => label.setText(`Loading… ${Math.round(p * 100)}%`));
    // Loaded as text: without a manifest the dev server answers with index.html, which must not crash the JSON parser.
    this.load.on('filecomplete-text-art-manifest', (_key: string, _type: string, data: string) => {
      const files = parseManifest(data);
      this.registry.set('art-files', files);
      for (const file of files) if (!file.startsWith('event-')) this.load.image(artKey(file), `art/${file}`);
    });
    this.load.text('art-manifest', 'art/manifest.json');
    this.load.on('filecomplete-text-audio-manifest', (_key: string, _type: string, data: string) => {
      for (const file of parseManifest(data, AUDIO)) this.load.audio(soundKey(file), `audio/${file}`);
      this.registry.set('music-files', parseManifest(data, AUDIO, 'music'));
    });
    this.load.text('audio-manifest', 'audio/manifest.json');
  }

  create(): void {
    applySound(this.game);
    installMusicDirector(this.game, (this.registry.get('music-files') as string[] | undefined) ?? []);
    this.scene.start('Title');
  }
}

/** Queue a piece of art in a scene's preload() if the manifest lists it and it is not loaded yet. */
export function loadArtOnDemand(scene: Phaser.Scene, name: string): void {
  const files = (scene.registry.get('art-files') as string[] | undefined) ?? [];
  const file = files.find((f) => artKey(f) === `art:${name}`);
  if (file && !scene.textures.exists(artKey(file))) scene.load.image(artKey(file), `art/${file}`);
}

const AUDIO = /\.(ogg|mp3|wav|m4a)$/i;

/** Files of one kind listed in the manifest (under "files" unless told otherwise); none when it is missing or malformed. */
function parseManifest(text: string, kind = /\.(jpe?g|png|webp)$/i, list: keyof Manifest = 'files'): string[] {
  try {
    const files = (JSON.parse(text) as Manifest)[list];
    return Array.isArray(files) ? files.filter((f) => typeof f === 'string' && /^[\w-]+\.\w+$/.test(f) && kind.test(f)) : [];
  } catch {
    return [];
  }
}

/** Texture key for an art file: "event-storm.jpg" → "art:event-storm". */
export function artKey(file: string): string {
  return `art:${file.replace(/\.[a-z]+$/i, '')}`;
}
