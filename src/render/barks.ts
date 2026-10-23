import type { CritKind } from '../sim/Crits';
import type { OrderId } from '../sim/Orders';

/** What the crews shout, and how critical hits are told: the words only, for BattleScene to show. */

export interface CritTelling {
  /** Big floating headline over the room. */
  title: string;
  /** Log line when it happens to us ({room}, {name}). */
  ours: string;
  /** Log line when it happens to her. */
  theirs: string;
  /** What our people cry when it happens to us. */
  cry: string[];
  /** What our people cheer when it happens to her. */
  cheer: string[];
}

export const CRIT_TELLING: Record<CritKind, CritTelling> = {
  magazine: {
    title: 'MAGAZINE EXPLODES!',
    ours: 'Our powder goes up! The {room} is an inferno!',
    theirs: 'Her magazine goes up with a roar!',
    cry: ['The powder! Get clear!', 'Fire in the magazine!'],
    cheer: ['Her powder’s gone up! Huzzah!', 'Did you see that? Huzzah!'],
  },
  powder: {
    title: 'POWDER FIRE!',
    ours: 'A cartridge goes up on our gun deck!',
    theirs: 'A powder fire breaks out on her gun deck!',
    cry: ['Powder fire! Wet the cartridges!', 'Gun deck’s burning!'],
    cheer: ['That’s her gun deck ablaze!', 'Her powder’s alight!'],
  },
  mast: {
    title: 'MAST FALLS!',
    ours: 'Our mast goes by the board! We’ve lost way.',
    theirs: 'Her mast comes crashing down! She’s lost way.',
    cry: ['Stand from under! The mast!', 'Mast’s coming down!'],
    cheer: ['Her mast’s gone by the board!', 'Timber! Ha!'],
  },
  helmsman: {
    title: 'HELMSMAN DOWN!',
    ours: '{name} is struck down at the wheel!',
    theirs: 'Her helmsman is cut down at the wheel!',
    cry: ['They’ve hit the wheel!', 'Someone take the helm!'],
    cheer: ['Got their helmsman!', 'Her wheel’s unmanned!'],
  },
  bulwarks: {
    title: 'BULWARKS STOVE IN!',
    ours: 'Our bulwarks are stove in, every layer down!',
    theirs: 'Her bulwarks are stove in! She’s open to our guns.',
    cry: ['The bulwarks are gone!', 'She’s smashed our bulwarks!'],
    cheer: ['Her bulwarks are matchwood!', 'Now pour it into her!'],
  },
  waterline: {
    title: 'HOLED BELOW THE WATERLINE!',
    ours: 'We’re holed below the waterline! Man the pumps!',
    theirs: 'Holed her below the waterline!',
    cry: ['She’s taking water fast! Pumps!', 'Holed below! Pumps, pumps!'],
    cheer: ['Right on her waterline!', 'She’ll be wading soon!'],
  },
  splinters: {
    title: 'SPLINTERS!',
    ours: 'Splinters scythe through the {room}!',
    theirs: 'Splinters scythe through her {room}!',
    cry: ['Splinters! Get down!', 'Ahh! My arm!'],
    cheer: ['That’ll thin ’em out!', 'Right through her!'],
  },
};

/** What her officers shout when she gives an order (ours shout ORDERS[id].shout). */
export const ENEMY_SHOUTS: Record<OrderId, string> = {
  rake: 'Fire as she bears! Rake them!',
  sail: 'Crowd on sail! Hard over!',
  steel: 'Cutlasses! Cut them down!',
};

/** How an order of hers is called out to the player, and what to do about it. */
export const ENEMY_ORDER_WARNING: Record<OrderId, string> = {
  rake: 'SHE RAKES: HER NEXT VOLLEY HITS HARD',
  sail: 'SHE CROWDS ON SAIL: HARD TO HIT FOR A FEW SECONDS',
  steel: 'HER BOARDERS DRAW COLD STEEL',
};

export const ORDER_LOG: Record<OrderId, string> = {
  rake: 'Rake her! For a few seconds every ball flies true and hits hard.',
  sail: 'All hands aloft! She is hard to hit, but the guns load slower.',
  steel: 'Cold steel! Our people fight like devils.',
};

export const ENEMY_ORDER_LOG: Record<OrderId, string> = {
  rake: 'Her captain orders a raking fire. Her next volley will hurt.',
  sail: 'She crowds on sail: she is hard to hit for a few seconds.',
  steel: 'Her captain sends his people in with cold steel.',
};

export const BOARDED_CRIES = ['Repel boarders!', 'Boarders! To arms!', 'They’re coming over the side!'];
export const BOARDING_CRIES = ['Over the side, lads!', 'Boarders away!', 'Follow me, boys!'];
export const FIRE_CRIES = ['Fire! Fire!', 'Buckets! Quick!', 'She’s burning!'];
export const FALLEN_CRIES = ['Man down!', 'They got {name}!', '{name}! No!'];
export const GOOD_HIT_CHEERS = ['Square in her ribs!', 'Ha! Hulled her!', 'Give her another!'];

export function pickLine(lines: string[], vars: Record<string, string> = {}): string {
  const line = lines[Math.floor(Math.random() * lines.length)];
  return line.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}
