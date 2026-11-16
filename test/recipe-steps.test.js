'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/server');
const {
  findCachedRecipe,
  planRecipeKey,
  resolveRecipeSteps,
  loadRecipeStepsFile,
} = require('../src/recipe-steps');
const { validateRecipePayload, generateRecipeSteps } = require('../src/openai-plan');
const { createPlanState } = require('../src/cart');
const { loadExamples } = require('../src/catalog');

function request(server, { method, path, body, cookie }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(data || '{}');
          } catch {
            json = { raw: data };
          }
          resolve({
            status: res.statusCode,
            json,
            cookie: (res.headers['set-cookie'] || [])[0] || cookie || null,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('recipe steps helpers', () => {
  const examples = loadExamples();

  it('loads deterministic steps for every saved example id', () => {
    const file = loadRecipeStepsFile();
    for (const example of examples.examples) {
      assert.ok(file.recipes[example.id], `missing recipe steps for ${example.id}`);
      assert.ok(file.recipes[example.id].steps.length >= 3);
    }
  });

  it('validates and normalizes ordered steps', () => {
    const out = validateRecipePayload({
      steps: [
        { order: 2, instruction: 'Cook' },
        { order: 1, instruction: 'Prep' },
      ],
    });
    assert.deepEqual(out.steps, [
      { order: 1, instruction: 'Prep' },
      { order: 2, instruction: 'Cook' },
    ]);
  });

  it('matches cached recipes by example_id and meal name', () => {
    const byId = createPlanState({
      meal: 'Sun-dried tomato vodka pasta',
      servings: 4,
      budget_cents: 3000,
      ingredients: examples.examples[0].ingredients,
      mode: 'saved_example',
      example_id: 'vodka-pasta',
    });
    const cached = findCachedRecipe(byId, examples);
    assert.equal(cached.example_id, 'vodka-pasta');
    assert.equal(cached.match, 'example_id');

    const byMeal = createPlanState({
      meal: 'Sun-dried tomato vodka pasta',
      servings: 4,
      budget_cents: 3000,
      ingredients: examples.examples[0].ingredients,
      mode: 'recipe_book',
      example_id: null,
    });
    const cachedMeal = findCachedRecipe(byMeal, examples);
    assert.equal(cachedMeal.example_id, 'vodka-pasta');
    assert.equal(cachedMeal.match, 'meal_name');
  });

  it('returns deterministic steps offline without calling OpenAI', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const plan = createPlanState({
        meal: 'Spaghetti marinara',
        servings: 2,
        budget_cents: 1000,
        ingredients: examples.examples.find((e) => e.id === 'spaghetti').ingredients,
        mode: 'saved_example',
        example_id: 'spaghetti',
      });
      const recipe = await resolveRecipeSteps(plan, { examples });
      assert.equal(recipe.source, 'saved_example');
      assert.equal(recipe.example_id, 'spaghetti');
      assert.ok(recipe.steps.length >= 3);
      assert.equal(recipe.steps[0].order, 1);
      assert.equal(plan.recipe.cache_key, planRecipeKey(plan));
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it('throws NO_API_KEY for unknown meals when Live AI is not configured', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await assert.rejects(
        () =>
          generateRecipeSteps({
            meal: 'Mystery space lasagna',
            servings: 2,
            ingredients: [{ ingredient: 'noodles', quantity: 8, unit: 'oz' }],
          }),
        (err) => err.code === 'NO_API_KEY'
      );
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});

describe('POST /api/plan/recipe', () => {
  let server;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns cached steps for a saved example (happy path)', async () => {
    const started = await request(server, {
      method: 'POST',
      path: '/api/plan/example',
      body: { example_id: 'vodka-pasta' },
    });
    assert.equal(started.status, 200);
    const cookie = started.cookie.split(';')[0];

    const recipeRes = await request(server, {
      method: 'POST',
      path: '/api/plan/recipe',
      cookie,
      body: {},
    });
    assert.equal(recipeRes.status, 200);
    assert.equal(recipeRes.json.recipe.source, 'saved_example');
    assert.equal(recipeRes.json.recipe.example_id, 'vodka-pasta');
    assert.ok(Array.isArray(recipeRes.json.recipe.steps));
    assert.ok(recipeRes.json.recipe.steps.length >= 3);
    assert.equal(recipeRes.json.recipe.steps[0].order, 1);
    assert.match(recipeRes.json.recipe.steps[0].instruction, /./);
  });

  it('keeps approval available after a recipe failure (unknown meal, no key)', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const started = await request(server, {
        method: 'POST',
        path: '/api/plan/from-saved',
        body: {
          recipe_id: 'rb_unknown',
          meal: 'Mystery space lasagna',
          servings: 2,
          budget_cents: 2000,
          ingredients: [
            { id: 'i1', ingredient: 'spaghetti pasta', quantity: 8, unit: 'oz' },
            { id: 'i2', ingredient: 'marinara sauce', quantity: 12, unit: 'oz' },
          ],
        },
      });
      assert.equal(started.status, 200);
      assert.notEqual(started.json.plan.approval, 'blocked');
      const cookie = started.cookie.split(';')[0];

      const recipeRes = await request(server, {
        method: 'POST',
        path: '/api/plan/recipe',
        cookie,
        body: {},
      });
      assert.equal(recipeRes.status, 429);
      assert.equal(recipeRes.json.code, 'NO_API_KEY');
      assert.equal(recipeRes.json.offer_retry, true);

      const approveRes = await request(server, {
        method: 'POST',
        path: '/api/plan/approve',
        cookie,
        body: {},
      });
      assert.equal(approveRes.status, 200);
      assert.ok(approveRes.json.plan.approved);
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });

  it('requires an active plan', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/api/plan/recipe',
      body: {},
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error || '', /No active meal plan/i);
  });

  it('matches recipe book reorders of known meals without a live key', async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const started = await request(server, {
        method: 'POST',
        path: '/api/plan/from-saved',
        body: {
          recipe_id: 'rb_tacos',
          meal: 'Beef tacos',
          servings: 3,
          budget_cents: 1500,
          ingredients: [
            { id: 'i1', ingredient: 'ground beef', quantity: 0.75, unit: 'lb' },
            { id: 'i2', ingredient: 'taco shells', quantity: 9, unit: 'each' },
            { id: 'i3', ingredient: 'shredded cheddar cheese', quantity: 4, unit: 'oz' },
            { id: 'i4', ingredient: 'salsa', quantity: 0.5, unit: 'cup' },
            { id: 'i5', ingredient: 'taco seasoning', quantity: 1, unit: 'oz' },
            { id: 'i6', ingredient: 'sour cream', quantity: 0.5, unit: 'cup' },
          ],
        },
      });
      assert.equal(started.status, 200);
      const cookie = started.cookie.split(';')[0];

      const recipeRes = await request(server, {
        method: 'POST',
        path: '/api/plan/recipe',
        cookie,
        body: {},
      });
      assert.equal(recipeRes.status, 200);
      assert.equal(recipeRes.json.recipe.source, 'saved_example');
      assert.equal(recipeRes.json.recipe.example_id, 'beef-tacos');
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prev;
    }
  });
});
