'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Re-require after patching module internals via evaluating format through generate path is hard;
// duplicate the formatter contract by requiring openai-plan and triggering getClient missing key.
const openaiPlan = require('../src/openai-plan');

describe('OpenAI generate error surfacing', () => {
  it('exports generateMealPlan', () => {
    assert.equal(typeof openaiPlan.generateMealPlan, 'function');
  });

  it('throws NO_API_KEY when key missing', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await assert.rejects(
        () => openaiPlan.generateMealPlan({ meal: 'soup', servings: 2 }),
        (err) => err.code === 'NO_API_KEY'
      );
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});
