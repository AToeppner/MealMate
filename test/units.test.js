'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { packageCapacity, packagesNeeded } = require('../src/units');
const { loadCatalog, cloneCatalog } = require('../src/catalog');
const { createPlanState, buildReview, attemptApproval } = require('../src/cart');

describe('unit conversions', () => {
  const catalog = loadCatalog();
  const byId = Object.fromEntries(catalog.products.map((p) => [p.product_id, p]));

  it('converts tbsp need against olive oil sold in fl oz', () => {
    const oil = byId.P027;
    const cap = packageCapacity(oil, 'tbsp');
    assert.ok(cap);
    // 17 fl oz * 2 tbsp/fl oz = 34 tbsp per bottle
    assert.equal(cap.capacity, 34);
    assert.equal(packagesNeeded(2, cap.capacity), 1);
  });

  it('converts tsp need against olive oil sold in fl oz', () => {
    const oil = byId.P027;
    const cap = packageCapacity(oil, 'tsp');
    assert.ok(cap);
    // 17 fl oz * 6 tsp/fl oz = 102 tsp per bottle
    assert.equal(cap.capacity, 102);
  });

  it('prices butter requested in tbsp via explicit demo conversion', () => {
    const butter = byId.P029;
    const cap = packageCapacity(butter, 'tbsp');
    assert.ok(cap);
    assert.equal(cap.capacity, 32);
    assert.equal(cap.estimate, true);
    assert.equal(cap.note, null);
  });

  it('approves a live-style plan with butter tbsp and olive oil tbsp', () => {
    const state = createPlanState({
      meal: 'Oil and butter test',
      servings: 2,
      budget_cents: null,
      mode: 'live_ai',
      ingredients: [
        { id: 'b1', ingredient: 'unsalted butter', quantity: 2, unit: 'tbsp' },
        { id: 'o1', ingredient: 'olive oil', quantity: 3, unit: 'tbsp' },
      ],
    });
    const review = buildReview(state, cloneCatalog(catalog));
    assert.notEqual(review.approval, 'blocked');
    assert.ok(review.rows.every((r) => !r.issues?.some((i) => i.code === 'incompatible_unit')));
    const result = attemptApproval(state, cloneCatalog(catalog));
    assert.equal(result.ok, true);
  });

  it('never blocks matched products on awkward units (systemic soft fallback)', () => {
    const state = createPlanState({
      meal: 'Awkward units',
      servings: 2,
      budget_cents: null,
      mode: 'live_ai',
      ingredients: [
        { id: 't1', ingredient: 'tomatoes', quantity: 28, unit: 'oz' },
        { id: 's1', ingredient: 'salt', quantity: 1, unit: 'tsp' },
        { id: 'g1', ingredient: 'sugar', quantity: 1, unit: 'tsp' },
        // Force a count SKU with a weight need via preferred product id later if needed —
        // Roma with oz should soft-convert or rematch, not block.
        { id: 'r1', ingredient: 'roma tomato', quantity: 10, unit: 'oz' },
      ],
    });
    const review = buildReview(state, cloneCatalog(catalog));
    assert.notEqual(review.approval, 'blocked');
    assert.equal(review.issues.filter((i) => i.code === 'incompatible_unit').length, 0);
    for (const row of review.rows) {
      assert.equal(row.conversion_note, null);
      if (!row.pantry && !row.skipped && row.product_id) {
        assert.ok(row.include_in_cart, `expected ${row.ingredient} in cart`);
      }
    }
    const result = attemptApproval(state, cloneCatalog(catalog));
    assert.equal(result.ok, true);
  });
});
