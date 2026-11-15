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
  return new OpenAI({ apiKey, timeout: 25000 });
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

async function generateMealPlan({ meal, servings }) {
  const client = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const prompt = [
    'You are MealMate, helping a shopper turn a meal idea into a grocery ingredient list.',
    `Meal: ${meal}`,
    `Servings: ${servings} (whole servings)`,
    'Return only the structured ingredients needed to cook this meal for the servings.',
    'Use positive quantities and catalog-friendly units: oz, lb, fl oz, cup, ml, tsp, tbsp, each, clove, bunch, slices.',
    'Prefer package-aligned units for fats and oils: butter/shortening as oz (or lb); olive oil and other oils as fl oz (or ml/cup).',
    'Reserve tsp/tbsp mainly for seasonings and spices (salt, pepper, chili flakes, spices), not for butter or bottled oils when an oz/fl oz amount is natural.',
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
    const wrapped = new Error(err.message || 'OpenAI request failed');
    wrapped.code = 'OPENAI_ERROR';
    throw wrapped;
  }

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

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('Model returned malformed JSON.');
    err.code = 'MALFORMED_OUTPUT';
    throw err;
  }

  try {
    return validatePlanPayload(parsed);
  } catch (err) {
    err.code = err.code || 'MALFORMED_OUTPUT';
    throw err;
  }
}

module.exports = {
  generateMealPlan,
  validatePlanPayload,
  PLAN_SCHEMA,
};
