'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadCatalog, loadExamples, cloneCatalog, getExample } = require('../src/catalog');
const {
  createPlanState,
  applyAction,
  buildReview,
  attemptApproval,
} = require('../src/cart');
const { validatePlanPayload } = require('../src/openai-plan');

describe('focused coverage', () => {
  const catalogBase = loadCatalog();
  const examples = loadExamples();

  it('duplicate-product stock aggregates demand across ingredients', () => {
    const catalog = cloneCatalog(catalogBase, { P033: 1 });
    const state = createPlanState({
      meal: 'Double rice',
      servings: 2,
      budget_cents: 5000,
      mode: 'saved_example',
      ingredients: [
        { id: 'a', ingredient: 'white rice', quantity: 32, unit: 'oz' },
        { id: 'b', ingredient: 'white rice', quantity: 32, unit: 'oz' },
      ],
    });

    const review = buildReview(state, catalog);
    assert.equal(review.approval, 'blocked');
    assert.ok(review.issues.some((i) => i.code === 'insufficient_stock'));
    assert.equal(review.cart_lines.length, 0);
    assert.ok(review.rows.every((r) => r.status === 'insufficient_stock'));
  });

  it('malformed model output is rejected by validatePlanPayload', () => {
    assert.throws(() => validatePlanPayload(null), /no ingredients/i);
    assert.throws(() => validatePlanPayload({ ingredients: [] }), /no ingredients/i);
    assert.throws(
      () =>
        validatePlanPayload({
          ingredients: [{ ingredient: 'pasta', quantity: 0, unit: 'oz' }],
        }),
      /positive quantity/i
    );
    assert.throws(
      () =>
        validatePlanPayload({
          ingredients: [{ ingredient: '', quantity: 1, unit: 'oz' }],
        }),
      /missing a name/i
    );
    assert.throws(
      () =>
        validatePlanPayload({
          ingredients: [{ ingredient: 'pasta', quantity: 8, unit: '' }],
        }),
      /missing a unit/i
    );

    const ok = validatePlanPayload({
      ingredients: [{ ingredient: 'penne pasta', quantity: 16, unit: 'oz' }],
    });
    assert.equal(ok.ingredients[0].id, 'ai1');
  });

  it('stale approval clears when the cart is edited', () => {
    const example = getExample(examples, 'beef-tacos');
    const catalog = cloneCatalog(catalogBase);
    const state = createPlanState({
      meal: example.meal,
      servings: example.servings,
      budget_cents: example.budget_cents,
      ingredients: example.ingredients,
      mode: 'saved_example',
      example_id: example.id,
    });
    applyAction(state, { action: 'toggle_pantry', ingredient_id: 'i3' });
    const first = attemptApproval(state, catalog);
    assert.equal(first.ok, true);
    assert.ok(state.approved);

    applyAction(state, { action: 'toggle_pantry', ingredient_id: 'i6' });
    assert.equal(state.approved, null);
    const review = buildReview(state, catalog);
    assert.equal(review.approved, null);
  });

  it('miso tofu udon blocks approval until miso is addressed', () => {
    const example = getExample(examples, 'partial');
    const catalog = cloneCatalog(catalogBase);
    const state = createPlanState({
      meal: example.meal,
      servings: example.servings,
      budget_cents: example.budget_cents,
      ingredients: example.ingredients,
      mode: 'saved_example',
      example_id: example.id,
    });

    let review = buildReview(state, catalog);
    assert.equal(review.approval, 'blocked');
    assert.ok(review.issues.some((i) => i.ingredient_id === 'i3' && i.code === 'no_match'));
    let attempt = attemptApproval(state, catalog);
    assert.equal(attempt.ok, false);

    applyAction(state, { action: 'skip', ingredient_id: 'i3' });
    attempt = attemptApproval(state, catalog);
    assert.equal(attempt.ok, true);
    assert.equal(attempt.review.approval, 'approved_incomplete');
    assert.deepEqual(attempt.review.missing_ingredient_ids, ['i3']);
  });
});
