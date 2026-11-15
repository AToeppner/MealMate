'use strict';

/**
 * Thin Instacart deep-link helper (no partner API).
 * Builds a storefront search URL from approved cart product names.
 */
function buildInstacartSearchUrl(plan) {
  const names = [];
  const lines = plan?.cart_lines || [];
  for (const line of lines) {
    if (line?.product_name) names.push(String(line.product_name).trim());
  }
  if (!names.length && Array.isArray(plan?.rows)) {
    for (const row of plan.rows) {
      if (row?.pantry || row?.skipped) continue;
      if (row?.product_name) names.push(String(row.product_name).trim());
      else if (row?.ingredient) names.push(String(row.ingredient).trim());
    }
  }
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return null;
  const query = unique.slice(0, 8).join(' ');
  return `https://www.instacart.com/store/s?k=${encodeURIComponent(query)}`;
}

window.MealMateInstacart = {
  buildInstacartSearchUrl,
};
