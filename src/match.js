'use strict';

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

/**
 * Prefer exact normalized product names or aliases.
 * Flag ambiguous matches instead of guessing.
 */
function findMatches(ingredientName, products) {
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
      const garlicAlias = freshOnly.filter((p) => candidateNames(p).includes('garlic') || candidateNames(p).includes('fresh garlic'));
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
      const fresh = exact.filter(isFreshGarlicProduct);
      if (fresh.length === 1) exact = fresh;
    }
  }

  if (exact.length === 1) {
    return { status: 'matched', matches: exact };
  }
  if (exact.length > 1) {
    return { status: 'ambiguous', matches: exact };
  }
  return { status: 'no_match', matches: [] };
}

module.exports = {
  normalizeName,
  findMatches,
  prefersFreshGarlic,
};
