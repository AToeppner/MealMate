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
const COUNTISH = new Set(['each', 'clove', 'bunch', 'slices', 'pack', 'eggs', 'bulbs', 'heads']);

// Generic dry-pantry density used only when a SKU has no explicit map.
const OZ_PER_TSP_DRY = 0.2;
// Generic produce/count weight used when recipe asks for oz against an each-sold item.
const OZ_PER_EACH_DEFAULT = 4;

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

function isCountish(unit) {
  return COUNTISH.has(normalizeUnit(unit));
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

function spoonToTsp(amount, unit) {
  const u = normalizeUnit(unit);
  if (u === 'tsp') return amount;
  if (u === 'tbsp') return amount * 3;
  return null;
}

/**
 * Capacity of one package expressed in the ingredient's unit.
 * Weight oz and fluid oz are never treated as interchangeable.
 * Missing conversions fall back to generic estimates (never null for matched sellable units when possible).
 */
function packageCapacity(product, ingredientUnit) {
  const need = normalizeUnit(ingredientUnit);
  if (!need) return null;

  const explicit = product.explicit_demo_conversions;
  if (explicit && Object.prototype.hasOwnProperty.call(explicit, need)) {
    return {
      capacity: Number(explicit[need]),
      estimate: true,
      // Keep UI quiet — estimates should not look like errors.
      note: null,
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
  if (isVolume(prodUnit) && isVolume(need) && !isWeight(prodUnit) && !isWeight(need)) {
    const pkgFl = toFlOz(Number(product.package_size), prodUnit);
    const unitFl = toFlOz(1, need);
    if (pkgFl == null || unitFl == null || unitFl === 0) return null;
    return { capacity: pkgFl / unitFl, estimate: false, note: null };
  }

  // Generic: weight-sold pantry ↔ tsp/tbsp (common Live AI seasoning output).
  if (isWeight(prodUnit) && (need === 'tsp' || need === 'tbsp')) {
    const pkgOz = toOz(Number(product.package_size), prodUnit);
    if (pkgOz == null || pkgOz <= 0) return null;
    const tspCapacity = pkgOz / OZ_PER_TSP_DRY;
    const capacity = need === 'tbsp' ? tspCapacity / 3 : tspCapacity;
    return { capacity, estimate: true, note: null };
  }

  // Generic: recipe weight against count-sold produce (each/bunch/...).
  if ((isCountish(prodUnit) || (countUnit && isCountish(countUnit))) && isWeight(need)) {
    const countPerPkg = Number(product.package_size) || 1;
    const ozPerPkg = countPerPkg * OZ_PER_EACH_DEFAULT;
    const unitOz = toOz(1, need);
    if (unitOz == null || unitOz === 0) return null;
    return { capacity: ozPerPkg / unitOz, estimate: true, note: null };
  }

  // Generic: recipe count against weight-sold package (treat oz≈count heuristically poorly —
  // skip; cart soft-fallback handles remaining cases).
  if (isWeight(prodUnit) && isCountish(need)) {
    const pkgOz = toOz(Number(product.package_size), prodUnit);
    if (pkgOz == null || pkgOz <= 0) return null;
    return { capacity: pkgOz / OZ_PER_EACH_DEFAULT, estimate: true, note: null };
  }

  // Spoon amounts against fluid packages already handled; spoon against count is rare.
  if (isCountish(prodUnit) && (need === 'tsp' || need === 'tbsp')) {
    const countPerPkg = Number(product.package_size) || 1;
    // Assume one count unit ≈ 6 tsp (tablespoon-ish produce measure) — last-resort estimate.
    const tspCapacity = countPerPkg * 6;
    const capacity = need === 'tbsp' ? tspCapacity / 3 : tspCapacity;
    return { capacity, estimate: true, note: null };
  }

  void spoonToTsp;
  return null;
}

function packagesNeeded(quantity, capacity) {
  if (!(quantity > 0) || !(capacity > 0)) return null;
  return Math.ceil(quantity / capacity);
}

/**
 * Last-resort capacity: one package is assumed to cover the requested amount.
 * Used so matched products never hard-block on unit math.
 */
function softPackageCapacity(quantity) {
  const qty = Number(quantity);
  if (!(qty > 0)) return { capacity: 1, estimate: true, note: null, soft: true };
  return { capacity: qty, estimate: true, note: null, soft: true };
}

module.exports = {
  normalizeUnit,
  isWeight,
  isVolume,
  isCountish,
  packageCapacity,
  packagesNeeded,
  softPackageCapacity,
  toOz,
  toFlOz,
  OZ_PER_TSP_DRY,
  OZ_PER_EACH_DEFAULT,
};
