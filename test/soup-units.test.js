'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadCatalog, cloneCatalog } = require('../src/catalog');
const { createPlanState, buildReview, attemptApproval } = require('../src/cart');
const { findMatches } = require('../src/match');

describe('tomato soup unit / match fixes', () => {
  const catalog = loadCatalog();

  it('matches weight tomatoes to canned tomatoes, not Roma each', () => {
    const result = findMatches('tomatoes', catalog.products, 'oz');
    assert.equal(result.status, 'matched');
    assert.equal(result.matches[0].product_id, 'P113');
  });

  it('prices salt and sugar requested in tsp', () => {
    const state = createPlanState({
      meal: 'Tomato soup',
      servings: 4,
      budget_cents: null,
      mode: 'live_ai',
      ingredients: [
        { id: 'i1', ingredient: 'tomatoes', quantity: 28, unit: 'oz' },
        { id: 'i2', ingredient: 'garlic', quantity: 2, unit: 'clove' },
        { id: 'i3', ingredient: 'salt', quantity: 1, unit: 'tsp' },
        { id: 'i4', ingredient: 'black pepper', quantity: 0.5, unit: 'tsp' },
        { id: 'i5', ingredient: 'sugar', quantity: 1, unit: 'tsp' },
      ],
    });
    const review = buildReview(state, cloneCatalog(catalog));
    assert.notEqual(review.approval, 'blocked');
    assert.ok(!review.issues.some((i) => i.code === 'incompatible_unit'));
    const tomato = review.rows.find((r) => r.ingredient === 'tomatoes');
    assert.equal(tomato.product_id, 'P113');
    const result = attemptApproval(state, cloneCatalog(catalog));
    assert.equal(result.ok, true);
  });

  it('still matches fresh tomatoes counted as each to Roma', () => {
    const result = findMatches('fresh tomatoes', catalog.products, 'each');
    assert.equal(result.status, 'matched');
    assert.equal(result.matches[0].product_id, 'P046');
  });
});
