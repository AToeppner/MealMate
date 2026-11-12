'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  loadCatalog,
  loadExamples,
  loadTestCases,
  cloneCatalog,
  getExample,
} = require('../src/catalog');
const {
  createPlanState,
  applyAction,
  buildReview,
  attemptApproval,
  summarizeForTests,
} = require('../src/cart');

function unorderedLinesEqual(actual, expected) {
  const norm = (lines) =>
    [...lines]
      .map((l) => `${l.product_id}:${l.packages}`)
      .sort()
      .join('|');
  assert.equal(norm(actual), norm(expected));
}

function runCase(testCase, catalogBase, examples) {
  const example = getExample(examples, testCase.example_id);
  const catalog = cloneCatalog(catalogBase, testCase.stock_overrides || {});
  const state = createPlanState({
    meal: example.meal,
    servings: example.servings,
    budget_cents: example.budget_cents,
    ingredients: example.ingredients,
    mode: 'saved_example',
    example_id: example.id,
    stock_overrides: testCase.stock_overrides || {},
  });

  for (const action of testCase.actions || []) {
    applyAction(state, action);
  }

  let review = buildReview(state, catalog);
  const approvalAttempt = attemptApproval(state, catalog);
  review = approvalAttempt.review;

  const summary = summarizeForTests(review);
  return { summary, review, approvalAttempt };
}

describe('cart_test_cases.json fixtures', () => {
  const catalogBase = loadCatalog();
  const examples = loadExamples();
  const { cases } = loadTestCases();

  for (const testCase of cases) {
    it(testCase.id, () => {
      const { summary, review } = runCase(testCase, catalogBase, examples);
      const expected = testCase.expected;

      unorderedLinesEqual(summary.cart_lines, expected.cart_lines);
      assert.equal(summary.total_cents, expected.total_cents);
      assert.equal(summary.budget_remaining_cents, expected.budget_remaining_cents);
      assert.equal(summary.approval, expected.approval);
      assert.deepEqual(
        [...summary.missing_ingredient_ids].sort(),
        [...expected.missing_ingredient_ids].sort()
      );
      assert.deepEqual(
        [...summary.pantry_ingredient_ids].sort(),
        [...expected.pantry_ingredient_ids].sort()
      );

      const issueKey = (i) => `${i.ingredient_id}:${i.code}`;
      assert.deepEqual(
        summary.issues.map(issueKey).sort(),
        expected.issues.map(issueKey).sort()
      );

      if (Object.prototype.hasOwnProperty.call(expected, 'cheaper_swaps')) {
        const swapKey = (s) => `${s.ingredient_id}:${s.product_id}:${s.savings_cents}`;
        assert.deepEqual(
          summary.cheaper_swaps.map(swapKey).sort(),
          expected.cheaper_swaps.map(swapKey).sort()
        );
      }

      // Sanity: review total matches summed included lines
      const summed = review.cart_lines.reduce((n, l) => n + l.line_cents, 0);
      assert.equal(review.total_cents, summed);
    });
  }
});
