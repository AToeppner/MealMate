'use strict';

const UNIT_ALIASES = {
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lbs: 'lb',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  'fl. oz': 'fl oz',
  'fl.oz': 'fl oz',
  floz: 'fl oz',
  cups: 'cup',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  milliliter: 'ml',
  milliliters: 'ml',
  mls: 'ml',
  cloves: 'clove',
  bunches: 'bunch',
  slice: 'slices',
  egg: 'eggs',
  bulb: 'bulbs',
  head: 'heads',
  packs: 'pack',
};

const WEIGHT = new Set(['oz', 'lb']);
const VOLUME = new Set(['fl oz', 'cup', 'ml', 'tsp', 'tbsp']);

function normalizeUnit(unit) {
  if (unit == null) return '';
  const raw = String(unit).trim().toLowerCase().replace(/\s+/g, ' ');
  return UNIT_ALIASES[raw] || raw;
}

function isWeight(unit) {
  return WEIGHT.has(normalizeUnit(unit));
}

function isVolume(unit) {
  return VOLUME.has(normalizeUnit(unit));
}

function toOz(amount, unit) {
  const u = normalizeUnit(unit);
  if (u === 'oz') return amount;
  if (u === 'lb') return amount * 16;
  return null;
}

function toFlOz(amount, unit) {
  const u = normalizeUnit(unit);
  if (u === 'fl oz') return amount;
  if (u === 'cup') return amount * 8;
  if (u === 'ml') return amount / 29.5735295625;
  if (u === 'tbsp') return amount / 2;
  if (u === 'tsp') return amount / 6;
  return null;
}

/**
 * Capacity of one package expressed in the ingredient's unit.
 * Weight oz and fluid oz are never treated as interchangeable.
 */
function packageCapacity(product, ingredientUnit) {
  const need = normalizeUnit(ingredientUnit);
  if (!need) return null;

  const explicit = product.explicit_demo_conversions;
  if (explicit && Object.prototype.hasOwnProperty.call(explicit, need)) {
    return {
      capacity: Number(explicit[need]),
      estimate: true,
      note:
        product.conversion_note ||
        'Approximate demo conversion from catalog explicit_demo_conversions.',
    };
  }

  const prodUnit = normalizeUnit(product.unit);
  const countUnit = product.count_unit ? normalizeUnit(product.count_unit) : null;

  if (countUnit && countUnit === need) {
    return { capacity: Number(product.package_size), estimate: false, note: null };
  }

  if (prodUnit === need) {
    return { capacity: Number(product.package_size), estimate: false, note: null };
  }

  if (isWeight(prodUnit) && isWeight(need)) {
    const pkgOz = toOz(Number(product.package_size), prodUnit);
    const unitOz = toOz(1, need);
    if (pkgOz == null || unitOz == null || unitOz === 0) return null;
    return { capacity: pkgOz / unitOz, estimate: false, note: null };
  }

  // Same-dimension volume: fl oz/cup/ml/tbsp/tsp via toFlOz.
  // Do not convert against weight ounces.
  if (isVolume(prodUnit) && isVolume(need) && !isWeight(prodUnit) && !isWeight(need)) {
    const pkgFl = toFlOz(Number(product.package_size), prodUnit);
    const unitFl = toFlOz(1, need);
    if (pkgFl == null || unitFl == null || unitFl === 0) return null;
    return { capacity: pkgFl / unitFl, estimate: false, note: null };
  }

  return null;
}

function packagesNeeded(quantity, capacity) {
  if (!(quantity > 0) || !(capacity > 0)) return null;
  return Math.ceil(quantity / capacity);
}

module.exports = {
  normalizeUnit,
  isWeight,
  isVolume,
  packageCapacity,
  packagesNeeded,
  toOz,
  toFlOz,
};
