import type { WeaponDef } from '../sim/types';

export const WEAPONS: Record<string, WeaponDef> = {
  pdr6: { id: 'pdr6', name: '6-Pounder', hands: 1, loadTime: 8, damage: 1, shots: 1, inaccuracy: 0, price: 20 },
  pdr9: { id: 'pdr9', name: '9-Pounder Long Gun', hands: 1, loadTime: 11, damage: 1, shots: 2, inaccuracy: 0, price: 35 },
  pdr12: { id: 'pdr12', name: '12-Pounder', hands: 2, loadTime: 13, damage: 2, shots: 2, inaccuracy: 0, price: 50 },
  carronade: { id: 'carronade', name: '24-Pdr Short Gun', hands: 2, loadTime: 12, damage: 3, shots: 1, inaccuracy: 10, price: 55 },
  pdr18: { id: 'pdr18', name: '18-Pounder Long Gun', hands: 3, loadTime: 15, damage: 3, shots: 2, inaccuracy: 0, price: 75 },
};

export function weapon(id: string): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`Unknown weapon: ${id}`);
  return w;
}
