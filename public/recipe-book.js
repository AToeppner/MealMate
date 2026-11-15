'use strict';

const STORAGE_KEY = 'mealmate.recipeBook.v1';
const MAX_RECIPES = 20;

function loadRecipes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecipes(recipes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes.slice(0, MAX_RECIPES)));
}

function snapshotFromPlan(plan) {
  const ingredients = (plan.ingredients || plan.rows || [])
    .filter((row) => row && row.ingredient)
    .map((row, index) => ({
      id: row.id || `r${index + 1}`,
      ingredient: row.ingredient,
      quantity: Number(row.quantity),
      unit: row.unit,
      product_id: row.product_id || null,
    }))
    .filter((row) => row.quantity > 0 && row.unit);

  return {
    id: `rb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
    meal: plan.meal,
    servings: plan.servings,
    budget_cents: plan.budget_cents == null ? null : plan.budget_cents,
    ingredients,
  };
}

function upsertRecipe(snapshot) {
  if (!snapshot?.meal || !Array.isArray(snapshot.ingredients) || snapshot.ingredients.length < 1) {
    return loadRecipes();
  }
  const existing = loadRecipes().filter((r) => r.id !== snapshot.id);
  existing.unshift(snapshot);
  saveRecipes(existing);
  return existing;
}

function getRecipe(id) {
  return loadRecipes().find((r) => r.id === id) || null;
}

function removeRecipe(id) {
  const next = loadRecipes().filter((r) => r.id !== id);
  saveRecipes(next);
  return next;
}

window.MealMateRecipeBook = {
  STORAGE_KEY,
  MAX_RECIPES,
  loadRecipes,
  saveRecipes,
  snapshotFromPlan,
  upsertRecipe,
  getRecipe,
  removeRecipe,
};
