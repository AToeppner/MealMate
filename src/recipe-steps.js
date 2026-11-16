'use strict';

const fs = require('fs');
const path = require('path');
const { generateRecipeSteps, validateRecipePayload } = require('./openai-plan');

const DATA_PATH = path.join(__dirname, '..', 'data', 'recipe_steps.json');

let cachedFile = null;

function loadRecipeStepsFile() {
  if (cachedFile) return cachedFile;
  cachedFile = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  return cachedFile;
}

function normalizeMealKey(meal) {
  return String(meal || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ingredientFingerprint(ingredients) {
  return (ingredients || [])
    .map((item) => {
      const name = String(item.ingredient || '')
        .trim()
        .toLowerCase();
      const qty = Number(item.quantity);
      const unit = String(item.unit || '')
        .trim()
        .toLowerCase();
      return `${name}|${qty}|${unit}`;
    })
    .sort()
    .join(';');
}

function planRecipeKey(plan) {
  return [
    normalizeMealKey(plan.meal),
    String(plan.servings),
    ingredientFingerprint(plan.ingredients),
  ].join('::');
}

function findCachedRecipe(plan, examples) {
  const file = loadRecipeStepsFile();
  const recipes = file.recipes || {};

  if (plan.example_id && recipes[plan.example_id]) {
    return {
      example_id: plan.example_id,
      entry: recipes[plan.example_id],
      match: 'example_id',
    };
  }

  const mealKey = normalizeMealKey(plan.meal);
  if (!mealKey || !examples?.examples) return null;

  for (const example of examples.examples) {
    if (normalizeMealKey(example.meal) !== mealKey) continue;
    if (!recipes[example.id]) continue;
    return {
      example_id: example.id,
      entry: recipes[example.id],
      match: 'meal_name',
    };
  }

  return null;
}

function buildCachedPayload(plan, cached) {
  const steps = validateRecipePayload({
    steps: (cached.entry.steps || []).map((step, index) => ({
      order: step.order != null ? step.order : index + 1,
      instruction: step.instruction,
    })),
  }).steps;

  return {
    meal: plan.meal,
    servings: plan.servings,
    title: cached.entry.title || plan.meal,
    steps,
    source: 'saved_example',
    example_id: cached.example_id,
    cache_key: planRecipeKey(plan),
  };
}

function activeIngredients(plan) {
  return (plan.ingredients || [])
    .filter((row) => row && !row.skipped && !row.pantry)
    .map((row) => ({
      ingredient: row.ingredient,
      quantity: row.quantity,
      unit: row.unit,
    }));
}

/**
 * Resolve step-by-step instructions for the current plan.
 * Known Saved Examples use deterministic cached steps (offline-friendly).
 * Otherwise Live AI is used when OPENAI_API_KEY is configured.
 */
async function resolveRecipeSteps(plan, { examples, forceRefresh = false } = {}) {
  if (!plan) {
    const err = new Error('No active meal plan. Generate With AI or reorder from Recipe Book first.');
    err.code = 'NO_PLAN';
    throw err;
  }

  const cacheKey = planRecipeKey(plan);
  if (!forceRefresh && plan.recipe && plan.recipe.cache_key === cacheKey && Array.isArray(plan.recipe.steps)) {
    return plan.recipe;
  }

  const cached = findCachedRecipe(plan, examples);
  if (cached) {
    const recipe = buildCachedPayload(plan, cached);
    plan.recipe = recipe;
    return recipe;
  }

  const ingredients = activeIngredients(plan);
  if (ingredients.length < 1) {
    const err = new Error('Add at least one ingredient (undo Skip / Already have) before viewing a recipe.');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const generated = await generateRecipeSteps({
    meal: plan.meal,
    servings: plan.servings,
    ingredients,
  });

  const recipe = {
    meal: plan.meal,
    servings: plan.servings,
    title: plan.meal,
    steps: generated.steps,
    source: 'live_ai',
    example_id: plan.example_id || null,
    cache_key: cacheKey,
  };
  plan.recipe = recipe;
  return recipe;
}

function clearRecipe(plan) {
  if (plan) plan.recipe = null;
}

module.exports = {
  loadRecipeStepsFile,
  normalizeMealKey,
  planRecipeKey,
  findCachedRecipe,
  resolveRecipeSteps,
  clearRecipe,
  activeIngredients,
};
