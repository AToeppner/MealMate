'use strict';

const OpenAI = require('openai');

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ingredients'],
  properties: {
    ingredients: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ingredient', 'quantity', 'unit'],
        properties: {
          ingredient: { type: 'string', minLength: 1 },
          quantity: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

const ALLOWED_UNITS = new Set([
  'oz',
  'lb',
  'fl oz',
  'cup',
  'ml',
  'tsp',
  'tbsp',
  'each',
  'clove',
  'bunch',
  'slices',
  'pack',
  'eggs',
  'bulbs',
  'heads',
]);

function getClient() {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const err = new Error(
      'OPENAI_API_KEY is not configured. Add it to the project-root .env (or Render env vars), restart the server, or reorder from Recipe Book.'
    );
    err.code = 'NO_API_KEY';
    throw err;
  }
  return new OpenAI({ apiKey, timeout: 45000 });
}

function formatOpenAiError(err) {
  const status = err?.status || err?.statusCode || err?.response?.status;
  const apiMessage =
    err?.error?.message ||
    err?.message ||
    (typeof err?.error === 'string' ? err.error : null) ||
    'OpenAI request failed';

  let message = apiMessage;
  if (status === 401 || /incorrect api key|invalid api key|unauthorized/i.test(apiMessage)) {
    message =
      'OpenAI rejected the API key (401). Check OPENAI_API_KEY in .env or Render Environment, then restart/redeploy.';
  } else if (status === 404 || /model_not_found|does not exist|invalid model/i.test(apiMessage)) {
    message = `OpenAI model is unavailable (${process.env.OPENAI_MODEL || 'gpt-6-luna'}). Set OPENAI_MODEL to a model your key can use (e.g. gpt-6-luna or gpt-4o-mini), then restart/redeploy.`;
  } else if (status === 429 || /rate limit/i.test(apiMessage)) {
    message = 'OpenAI rate limit hit. Wait a bit and retry.';
  } else if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(apiMessage)) {
    message = 'OpenAI request timed out. Retry — free hosts can be slow on the first call.';
  } else if (status) {
    message = `OpenAI error (${status}): ${apiMessage}`;
  }

  const wrapped = new Error(message);
  wrapped.code = 'OPENAI_ERROR';
  wrapped.status = status;
  return wrapped;
}

function validatePlanPayload(payload) {
  if (!payload || !Array.isArray(payload.ingredients) || payload.ingredients.length < 1) {
    throw new Error('Model returned no ingredients.');
  }
  const ingredients = payload.ingredients.map((item, index) => {
    const ingredient = String(item.ingredient || '').trim();
    const quantity = Number(item.quantity);
    const unit = String(item.unit || '').trim();
    if (!ingredient) throw new Error(`Ingredient ${index + 1} is missing a name.`);
    if (!(quantity > 0) || !Number.isFinite(quantity)) {
      throw new Error(`Ingredient "${ingredient}" must have a positive quantity.`);
    }
    if (!unit) throw new Error(`Ingredient "${ingredient}" is missing a unit.`);
    const unitNorm = unit.toLowerCase();
    // Accept common catalog-compatible units; app matching/pricing validates further.
    if (![...ALLOWED_UNITS].some((u) => unitNorm === u || unitNorm === `${u}s`)) {
      // still allow through if non-empty; pricing may flag incompatible
    }
    return {
      id: `ai${index + 1}`,
      ingredient,
      quantity,
      unit,
    };
  });
  return { ingredients };
}

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: {
      type: 'array',
      minItems: 3,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['order', 'instruction'],
        properties: {
          order: { type: 'integer', minimum: 1 },
          instruction: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

function validateRecipePayload(payload) {
  if (!payload || !Array.isArray(payload.steps) || payload.steps.length < 1) {
    throw new Error('Model returned no recipe steps.');
  }
  const steps = payload.steps.map((item, index) => {
    const instruction = String(item.instruction || '').trim();
    const orderRaw = item.order != null ? Number(item.order) : index + 1;
    const order = Number.isInteger(orderRaw) && orderRaw > 0 ? orderRaw : index + 1;
    if (!instruction) {
      throw new Error(`Recipe step ${index + 1} is missing an instruction.`);
    }
    return { order, instruction };
  });
  steps.sort((a, b) => a.order - b.order);
  return {
    steps: steps.map((step, index) => ({
      order: index + 1,
      instruction: step.instruction,
    })),
  };
}

function parseModelJson(response) {
  let raw = response.output_text;
  if (!raw && Array.isArray(response.output)) {
    const texts = [];
    for (const item of response.output) {
      if (!item.content) continue;
      for (const part of item.content) {
        if (part.type === 'output_text' || part.type === 'text') texts.push(part.text);
      }
    }
    raw = texts.join('');
  }

  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Model returned malformed JSON.');
    err.code = 'MALFORMED_OUTPUT';
    throw err;
  }
}

async function generateMealPlan({ meal, servings }) {
  const client = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-6-luna';

  const prompt = [
    'You are MealMate, helping a shopper turn a meal idea into a grocery ingredient list.',
    `Meal: ${meal}`,
    `Servings: ${servings} (whole servings)`,
    'Return only the structured ingredients needed to cook this meal for the servings.',
    'Use positive quantities and catalog-friendly units: oz, lb, fl oz, cup, ml, tsp, tbsp, each, clove, bunch, slices.',
    'Prefer package-aligned units for fats and oils: butter/shortening as oz (or lb); olive oil and other oils as fl oz (or ml/cup).',
    'Reserve tsp/tbsp mainly for seasonings and spices (salt, pepper, chili flakes, spices), not for butter or bottled oils when an oz/fl oz amount is natural.',
    'For soups and sauces that need tomatoes by weight (oz/lb), name canned tomatoes (diced/crushed) rather than generic fresh tomatoes counted as each.',
    'Prefer fresh garlic when garlic is needed (not garlic powder), unless the meal explicitly needs powder.',
    'Do not include pantry-only assumptions. Do not price or match products.',
  ].join('\n');

  let response;
  try {
    response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'meal_plan',
          strict: true,
          schema: PLAN_SCHEMA,
        },
      },
    });
  } catch (err) {
    console.error('OpenAI generate failed', {
      model,
      status: err?.status || err?.statusCode,
      message: err?.message,
    });
    throw formatOpenAiError(err);
  }

  let parsed;
  try {
    parsed = parseModelJson(response);
  } catch (err) {
    throw err;
  }

  try {
    return validatePlanPayload(parsed);
  } catch (err) {
    err.code = err.code || 'MALFORMED_OUTPUT';
    throw err;
  }
}

async function generateRecipeSteps({ meal, servings, ingredients }) {
  const client = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-6-luna';

  const ingredientLines = (ingredients || [])
    .map((item) => `- ${item.quantity} ${item.unit} ${item.ingredient}`)
    .join('\n');

  const prompt = [
    'You are MealMate, writing clear home-cook recipe instructions.',
    `Meal: ${meal}`,
    `Servings: ${servings}`,
    'Ingredients available for this meal:',
    ingredientLines || '- (none listed)',
    'Return only structured cooking steps that use these ingredients for this meal and servings.',
    'Write concise, ordered steps a beginner can follow (prep, cook, finish).',
    'Do not invent major ingredients that are not listed. Do not price or match grocery products.',
    'Do not include shopping advice. Instructions only.',
  ].join('\n');

  let response;
  try {
    response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'recipe_steps',
          strict: true,
          schema: RECIPE_SCHEMA,
        },
      },
    });
  } catch (err) {
    console.error('OpenAI recipe steps failed', {
      model,
      status: err?.status || err?.statusCode,
      message: err?.message,
    });
    throw formatOpenAiError(err);
  }

  let parsed;
  try {
    parsed = parseModelJson(response);
  } catch (err) {
    throw err;
  }

  try {
    return validateRecipePayload(parsed);
  } catch (err) {
    err.code = err.code || 'MALFORMED_OUTPUT';
    throw err;
  }
}

module.exports = {
  generateMealPlan,
  generateRecipeSteps,
  validatePlanPayload,
  validateRecipePayload,
  PLAN_SCHEMA,
  RECIPE_SCHEMA,
};
