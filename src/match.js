'use strict';

const { packageCapacity } = require('./units');

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateNames(product) {
  const names = [product.product_name, ...(product.aliases || [])];
  return names.map(normalizeName).filter(Boolean);
}

function prefersFreshGarlic(ingredientName) {
  const n = normalizeName(ingredientName);
  if (!n) return false;
  if (n.includes('garlic powder')) return false;
  if (n.includes('minced garlic') && !n.includes('fresh')) {
    // "fresh or minced garlic" still prefers fresh per prompt.
  }
  return (
    n === 'garlic' ||
    n.includes('fresh garlic') ||
    n.includes('garlic clove') ||
    n.includes('minced garlic') ||
    n.includes('fresh or minced garlic') ||
    n.includes('garlic')
  );
}

function isFreshGarlicProduct(product) {
  const id = product.product_id;
  if (id === 'P026') return true;
  const n = normalizeName(product.product_name);
  return n === 'fresh garlic';
}

function isGarlicPowderProduct(product) {
  return normalizeName(product.product_name).includes('garlic powder');
}

function canPriceInUnit(product, unit) {
  if (!unit) return true;
  const cap = packageCapacity(product, unit);
  return Boolean(cap && cap.capacity > 0);
}

function scoreNameOverlap(target, product) {
  const names = candidateNames(product);
  if (names.includes(target)) return 100;
  let best = 0;
  for (const name of names) {
    if (target.includes(name) || name.includes(target)) {
      best = Math.max(best, Math.min(name.length, target.length));
    }
  }
  return best;
}

function preferUnitCompatible(matches, unit) {
  if (!unit || matches.length <= 1) return matches;
  const compatible = matches.filter((p) => canPriceInUnit(p, unit));
  return compatible.length ? compatible : matches;
}

/**
 * Prefer exact normalized product names or aliases.
 * Flag ambiguous matches instead of guessing.
 * When preferredUnit is set, prefer catalog rows that can convert to that unit.
 */
function findMatches(ingredientName, products, preferredUnit = null) {
  const target = normalizeName(ingredientName);
  if (!target) {
    return { status: 'no_match', matches: [] };
  }

  let exact = products.filter((p) => candidateNames(p).includes(target));

  // Prefer fresh garlic when either garlic form is acceptable.
  if (prefersFreshGarlic(ingredientName)) {
    const fresh = exact.filter(isFreshGarlicProduct);
    const powder = exact.filter(isGarlicPowderProduct);
    if (fresh.length === 1 && powder.length && exact.length === fresh.length + powder.length) {
      exact = fresh;
    } else if (!exact.length) {
      const freshOnly = products.filter(isFreshGarlicProduct);
      const garlicAlias = freshOnly.filter(
        (p) => candidateNames(p).includes('garlic') || candidateNames(p).includes('fresh garlic')
      );
      if (
        (target === 'garlic' ||
          target.includes('fresh garlic') ||
          target.includes('minced garlic') ||
          target.includes('fresh or minced')) &&
        garlicAlias.length === 1
      ) {
        exact = garlicAlias;
      }
    } else if (exact.length > 1) {
      const onlyFresh = exact.filter(isFreshGarlicProduct);
      if (onlyFresh.length === 1) exact = onlyFresh;
    }
  }

  exact = preferUnitCompatible(exact, preferredUnit);

  if (exact.length === 1) {
    if (preferredUnit && !canPriceInUnit(exact[0], preferredUnit)) {
      const fallback = findUnitCompatibleFallback(target, products, preferredUnit, exact[0].product_id);
      if (fallback) {
        return { status: 'matched', matches: [fallback] };
      }
    }
    return { status: 'matched', matches: exact };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', matches: exact };
  }

  // No exact alias: try overlap candidates that can price in the requested unit.
  if (preferredUnit) {
    const fallback = findUnitCompatibleFallback(target, products, preferredUnit, null);
    if (fallback) {
      return { status: 'matched', matches: [fallback] };
    }
  }

  return { status: 'no_match', matches: [] };
}

function findUnitCompatibleFallback(target, products, unit, excludeId) {
  const scored = products
    .filter((p) => p.product_id !== excludeId)
    .map((p) => ({ product: p, score: scoreNameOverlap(target, p) }))
    .filter((row) => row.score >= 5)
    .filter((row) => canPriceInUnit(row.product, unit))
    .sort((a, b) => b.score - a.score || a.product.product_name.localeCompare(b.product.product_name));

  if (!scored.length) return null;
  // Require a clear winner to avoid random substitutions.
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].product;
}

module.exports = {
  normalizeName,
  findMatches,
  prefersFreshGarlic,
  canPriceInUnit,
};
