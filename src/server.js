'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { loadEnv, isOpenAiConfigured } = require('./load-env');
const envInfo = loadEnv();

const {
  loadCatalog,
  loadExamples,
  cloneCatalog,
  getExample,
} = require('./catalog');
const {
  createPlanState,
  buildReview,
  applyAction,
  attemptApproval,
} = require('./cart');
const { getOrCreate, checkAiRateLimit } = require('./sessions');
const { generateMealPlan } = require('./openai-plan');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const COOKIE = 'mealmate_sid';

const baseCatalog = loadCatalog();
const examples = loadExamples();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

function attachSession(req, res, next) {
  const session = getOrCreate(req.cookies[COOKIE]);
  res.cookie(COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 6,
  });
  req.session = session;
  next();
}

function catalogFor(session) {
  const overrides = session.plan?.stock_overrides || {};
  return cloneCatalog(baseCatalog, overrides);
}

function requirePlan(req, res) {
  if (!req.session.plan) {
    res.status(400).json({ error: 'No active meal plan. Generate With AI or reorder from Recipe Book first.' });
    return null;
  }
  return req.session.plan;
}

function normalizeSavedIngredients(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length < 1) {
    const err = new Error('Recipe Book entries need at least one ingredient.');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  return ingredients.map((item, index) => {
    const ingredient = String(item.ingredient || '').trim();
    const quantity = Number(item.quantity);
    const unit = String(item.unit || '').trim();
    if (!ingredient) {
      const err = new Error(`Ingredient ${index + 1} is missing a name.`);
      err.code = 'INVALID_INPUT';
      throw err;
    }
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      const err = new Error(`Ingredient "${ingredient}" must have a positive quantity.`);
      err.code = 'INVALID_INPUT';
      throw err;
    }
    if (!unit) {
      const err = new Error(`Ingredient "${ingredient}" is missing a unit.`);
      err.code = 'INVALID_INPUT';
      throw err;
    }
    return {
      id: String(item.id || `r${index + 1}`),
      ingredient,
      quantity,
      unit,
      product_id: item.product_id || null,
    };
  });
}

function reviewPayload(session) {
  const catalog = catalogFor(session);
  return buildReview(session.plan, catalog);
}

function parseBudgetCents(budgetUsd) {
  if (budgetUsd === null || budgetUsd === undefined || budgetUsd === '') return null;
  const n = Number(budgetUsd);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error('Budget must be a non-negative number of USD (zero allowed).');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  return Math.round(n * 100);
}

function parseServings(servings) {
  const n = Number(servings);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    const err = new Error('Servings must be a whole number from 1 to 10.');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  return n;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'mealmate',
    openai_configured: isOpenAiConfigured(),
  });
});

app.get('/api/meta', attachSession, (_req, res) => {
  res.json({
    openai_configured: isOpenAiConfigured(),
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  });
});

app.get('/api/plan', attachSession, (req, res) => {
  if (!req.session.plan) {
    return res.json({ plan: null });
  }
  res.json({ plan: reviewPayload(req.session) });
});

// Kept for fixture/tests and older clients; not linked in the UI.
app.post('/api/plan/example', attachSession, (req, res) => {
  try {
    const exampleId = req.body.example_id || 'vodka-pasta';
    const example = getExample(examples, exampleId);
    let budget_cents = example.budget_cents;
    if (req.body.budget_usd !== undefined && req.body.budget_usd !== null && req.body.budget_usd !== '') {
      budget_cents = parseBudgetCents(req.body.budget_usd);
    }
    const servings =
      req.body.servings != null ? parseServings(req.body.servings) : example.servings;

    req.session.plan = createPlanState({
      meal: example.meal,
      servings,
      budget_cents,
      ingredients: example.ingredients,
      mode: 'saved_example',
      example_id: example.id,
      stock_overrides: req.body.stock_overrides || {},
    });

    res.json({ plan: reviewPayload(req.session) });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code || 'ERROR' });
  }
});

app.post('/api/plan/from-saved', attachSession, (req, res) => {
  try {
    const meal = String(req.body.meal || '').trim();
    if (!meal) {
      return res.status(400).json({ error: 'Meal name is required.', code: 'INVALID_INPUT' });
    }
    const servings = parseServings(req.body.servings != null ? req.body.servings : 4);
    const budget_cents = parseBudgetCents(
      req.body.budget_usd !== undefined
        ? req.body.budget_usd
        : req.body.budget_cents != null
          ? Number(req.body.budget_cents) / 100
          : null
    );
    const ingredients = normalizeSavedIngredients(req.body.ingredients);

    req.session.plan = createPlanState({
      meal,
      servings,
      budget_cents,
      ingredients,
      mode: 'recipe_book',
      example_id: req.body.recipe_id || null,
      stock_overrides: req.body.stock_overrides || {},
    });

    // Re-apply preferred product matches from the saved snapshot when present.
    for (const item of ingredients) {
      if (!item.product_id) continue;
      const row = req.session.plan.ingredients.find((r) => r.id === item.id);
      if (row) {
        row.product_id = item.product_id;
        row.confirmed = true;
      }
    }

    res.json({ plan: reviewPayload(req.session) });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code || 'ERROR' });
  }
});

app.post('/api/plan/generate', attachSession, async (req, res) => {
  try {
    const meal = String(req.body.meal || '').trim();
    if (!meal) {
      return res.status(400).json({ error: 'Meal name or description is required.', code: 'INVALID_INPUT' });
    }
    const servings = parseServings(req.body.servings);
    const budget_cents = parseBudgetCents(req.body.budget_usd);

    checkAiRateLimit(req.ip, {
      max: Number(process.env.AI_RATE_LIMIT_MAX) || 8,
      windowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS) || 600000,
    });

    const generated = await generateMealPlan({ meal, servings });
    req.session.plan = createPlanState({
      meal,
      servings,
      budget_cents,
      ingredients: generated.ingredients,
      mode: 'live_ai',
      example_id: null,
    });
    res.json({ plan: reviewPayload(req.session) });
  } catch (err) {
    console.error('POST /api/plan/generate failed', err.code || err.name, err.message);
    const status =
      err.code === 'NO_API_KEY' || err.code === 'RATE_LIMIT'
        ? 429
        : err.code === 'INVALID_INPUT'
          ? 400
          : 502;
    res.status(status).json({
      error: err.message || 'Live AI generate failed.',
      code: err.code || 'OPENAI_ERROR',
      offer_retry: true,
    });
  }
});

app.post('/api/plan/action', attachSession, (req, res) => {
  try {
    const plan = requirePlan(req, res);
    if (!plan) return;
    applyAction(plan, req.body || {});
    res.json({ plan: reviewPayload(req.session) });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code || 'ERROR' });
  }
});

app.post('/api/plan/approve', attachSession, (req, res) => {
  try {
    const plan = requirePlan(req, res);
    if (!plan) return;
    const catalog = catalogFor(req.session);
    const result = attemptApproval(plan, catalog);
    if (!result.ok) {
      return res.status(409).json({
        error: 'Approval blocked',
        code: 'APPROVAL_BLOCKED',
        plan: result.review,
      });
    }
    res.json({ plan: result.review });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code || 'ERROR' });
  }
});

app.post('/api/plan/reset', attachSession, (req, res) => {
  req.session.plan = null;
  res.json({ plan: null });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error', err.message);
  res.status(500).json({ error: 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`MealMate listening on http://${HOST}:${PORT}`);
    if (envInfo.error) {
      console.warn(`Could not read .env (${envInfo.path}): ${envInfo.error}`);
    } else if (!envInfo.exists) {
      console.log('No .env file found (optional). Live AI needs OPENAI_API_KEY.');
    } else if (!isOpenAiConfigured()) {
      console.log(
        '.env loaded but OPENAI_API_KEY is empty. Live AI disabled; Recipe Book still works.'
      );
    } else {
      console.log('OPENAI_API_KEY configured — Live AI enabled.');
    }
  });
}

module.exports = app;
