import Phaser from 'phaser';
import { COLORS, SCREEN, textStyle } from '../render/theme';

interface ArtManifest {
  files: string[];
}

/** Loads the painted illustrations listed in public/art/manifest.json. The game runs fine without any of them. */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const label = this.add.text(SCREEN.w / 2, SCREEN.h / 2, 'Loading…', textStyle(18, COLORS.textDim)).setOrigin(0.5);
    this.load.on('progress', (p: number) => label.setText(`Loading… ${Math.round(p * 100)}%`));
    // Loaded as text: without a manifest the dev server answers with index.html, which must not crash the JSON parser.
    this.load.on('filecomplete-text-art-manifest', (_key: string, _type: string, data: string) => {
      for (const file of parseManifest(data)) this.load.image(artKey(file), `art/${file}`);
    });
    this.load.text('art-manifest', 'art/manifest.json');
  }

  create(): void {
    this.scene.start('Title');
  }
}

/** Image files listed in the manifest; none when it is missing or malformed. */
function parseManifest(text: string): string[] {
  try {
    const files = (JSON.parse(text) as ArtManifest).files;
    return Array.isArray(files) ? files.filter((f) => typeof f === 'string' && /^[\w-]+\.(jpe?g|png|webp)$/i.test(f)) : [];
  } catch {
    return [];
  }
}

/** Texture key for an art file: "event-storm.jpg" → "art:event-storm". */
export function artKey(file: string): string {
  return `art:${file.replace(/\.[a-z]+$/i, '')}`;
}
