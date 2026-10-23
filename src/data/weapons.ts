import type { WeaponDef } from '../sim/types';

export const WEAPONS: Record<string, WeaponDef> = {
  pdr6: { id: 'pdr6', name: '6-Pounder', hands: 1, loadTime: 8, damage: 1, shots: 1, inaccuracy: 0, price: 20 },
  pdr9: { id: 'pdr9', name: '9-Pounder Long Gun', hands: 1, loadTime: 11, damage: 1, shots: 2, inaccuracy: 0, price: 35 },
  pdr12: { id: 'pdr12', name: '12-Pounder', hands: 2, loadTime: 13, damage: 2, shots: 2, inaccuracy: 0, price: 50 },
  carronade: { id: 'carronade', name: '24-Pdr Short Gun', hands: 2, loadTime: 10, damage: 3, shots: 1, inaccuracy: 10, price: 55 },
  pdr18: { id: 'pdr18', name: '18-Pounder Long Gun', hands: 3, loadTime: 15, damage: 3, shots: 2, inaccuracy: 0, price: 75 },
  swivel: { id: 'swivel', name: 'Swivel Guns', hands: 0, loadTime: 8, damage: 1, shots: 2, inaccuracy: 5, price: 40, fixedShot: 'grape', note: 'grape only · no hands' },
  mortar: { id: 'mortar', name: 'Sea Mortar', hands: 1, loadTime: 16, damage: 3, shots: 1, inaccuracy: 0, price: 65, lob: true, note: 'over bulwarks · 55% hit' },
  chaser: { id: 'chaser', name: 'Bow Chaser', hands: 1, loadTime: 9, damage: 1, shots: 1, inaccuracy: 0, price: 30, chaser: true, note: 'twice as fast at a runner' },
};

export function weapon(id: string): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}
