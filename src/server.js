'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

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
    res.status(400).json({ error: 'No active meal plan. Generate or load a saved example first.' });
    return null;
  }
  return req.session.plan;
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
    openai_configured: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.get('/api/meta', attachSession, (_req, res) => {
  res.json({
    openai_configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    examples: examples.examples.map((e) => ({
      id: e.id,
      meal: e.meal,
      servings: e.servings,
      budget_cents: e.budget_cents,
    })),
    demo_fill: {
      meal:
        'Sun-dried tomato vodka pasta with penne, butter, chili flakes, fresh basil, fresh or minced garlic, sun-dried tomatoes, heavy cream, marinara, Parmesan, black pepper, and vodka',
      servings: 4,
      budget_usd: 30,
      example_id: 'vodka-pasta',
    },
  });
});

app.get('/api/plan', attachSession, (req, res) => {
  if (!req.session.plan) {
    return res.json({ plan: null });
  }
  res.json({ plan: reviewPayload(req.session) });
});

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
    const status =
      err.code === 'NO_API_KEY' || err.code === 'RATE_LIMIT'
        ? 429
        : err.code === 'INVALID_INPUT'
          ? 400
          : 502;
    res.status(status).json({
      error: err.message,
      code: err.code || 'OPENAI_ERROR',
      offer_saved_example: true,
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
  });
}

module.exports = app;
