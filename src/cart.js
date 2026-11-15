'use strict';

const { findMatches } = require('./match');
const { packageCapacity, packagesNeeded, normalizeUnit } = require('./units');

function money(cents) {
  return Math.round(Number(cents) || 0);
}

function createIngredientRow(ingredient) {
  return {
    id: ingredient.id,
    ingredient: ingredient.ingredient,
    quantity: Number(ingredient.quantity),
    unit: ingredient.unit,
    pantry: false,
    skipped: false,
    product_id: null,
    packages_override: null,
    confirmed: false,
    prior: null,
  };
}

function createPlanState({
  meal,
  servings,
  budget_cents,
  ingredients,
  mode = 'saved_example',
  example_id = null,
  stock_overrides = {},
}) {
  return {
    meal: String(meal || ''),
    servings: Number(servings),
    budget_cents: budget_cents == null || budget_cents === '' ? null : money(budget_cents),
    mode,
    example_id,
    ingredients: ingredients.map(createIngredientRow),
    budget_acknowledged: false,
    approved: null,
    stock_overrides: { ...stock_overrides },
  };
}

function clearApproval(state) {
  state.approved = null;
  return state;
}

function invalidateBudgetAck(state) {
  state.budget_acknowledged = false;
  return state;
}

function productMap(catalog) {
  return catalog.byId || Object.fromEntries(catalog.products.map((p) => [p.product_id, p]));
}

function resolveMatch(row, catalog) {
  if (row.product_id) {
    const product = productMap(catalog)[row.product_id];
    if (!product) {
      return {
        status: 'no_match',
        product: null,
        matches: [],
        issue: { code: 'no_match', message: 'Selected product is not in the catalog.' },
      };
    }
    const auto = findMatches(row.ingredient, catalog.products, row.unit);
    const isSubstitution =
      auto.status === 'matched' && auto.matches[0].product_id !== product.product_id;
    return {
      status: isSubstitution ? 'substitution' : auto.status === 'ambiguous' && !row.product_id ? 'ambiguous' : 'matched',
      product,
      matches: auto.matches,
      issue: isSubstitution
        ? {
            code: 'substitution',
            message: `Substitution: ${product.product_name} replaces the auto-matched item.`,
          }
        : null,
      auto_product_id: auto.status === 'matched' ? auto.matches[0].product_id : null,
    };
  }

  const result = findMatches(row.ingredient, catalog.products, row.unit);
  if (result.status === 'matched') {
    return {
      status: 'matched',
      product: result.matches[0],
      matches: result.matches,
      issue: null,
      auto_product_id: result.matches[0].product_id,
    };
  }
  if (result.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      product: null,
      matches: result.matches,
      issue: {
        code: 'ambiguous',
        message: `Ambiguous match for "${row.ingredient}". Choose a product.`,
      },
      auto_product_id: null,
    };
  }
  return {
    status: 'no_match',
    product: null,
    matches: [],
    issue: {
      code: 'no_match',
      message: `No catalog match for "${row.ingredient}".`,
    },
    auto_product_id: null,
  };
}

function computePackages(row, product) {
  if (!product) {
    return {
      packages: null,
      capacity: null,
      estimate: false,
      conversion_note: null,
      covered_quantity: null,
      shortfall: false,
      issue: { code: 'no_match', message: 'Cannot price without a matched product.' },
    };
  }

  const cap = packageCapacity(product, row.unit);
  if (!cap || !(cap.capacity > 0)) {
    return {
      packages: null,
      capacity: null,
      estimate: false,
      conversion_note: null,
      covered_quantity: null,
      shortfall: false,
      issue: {
        code: 'incompatible_unit',
        message: `Cannot convert ${row.unit} using ${product.product_name} (${product.package_size} ${product.unit}).`,
      },
    };
  }

  let packages;
  let shortfall = false;
  if (row.packages_override != null) {
    packages = Number(row.packages_override);
    if (!Number.isInteger(packages) || packages < 1) {
      return {
        packages: null,
        capacity: cap.capacity,
        estimate: cap.estimate,
        conversion_note: cap.note,
        covered_quantity: null,
        shortfall: false,
        issue: {
          code: 'invalid_packages',
          message: 'Package count must be a positive whole number.',
        },
      };
    }
    const required = packagesNeeded(row.quantity, cap.capacity);
    if (required != null && packages < required) shortfall = true;
  } else {
    packages = packagesNeeded(row.quantity, cap.capacity);
    if (packages == null) {
      return {
        packages: null,
        capacity: cap.capacity,
        estimate: cap.estimate,
        conversion_note: cap.note,
        covered_quantity: null,
        shortfall: false,
        issue: {
          code: 'incompatible_unit',
          message: 'Could not compute package count.',
        },
      };
    }
  }

  return {
    packages,
    capacity: cap.capacity,
    estimate: cap.estimate,
    conversion_note: cap.note,
    covered_quantity: packages * cap.capacity,
    shortfall,
    issue: null,
  };
}

function priceRow(row, product, catalogDemand = {}) {
  const priced = computePackages(row, product);
  if (priced.issue || priced.packages == null || !product) {
    return {
      ...priced,
      line_cents: null,
      include_in_cart: false,
    };
  }

  const demand = (catalogDemand[product.product_id] || 0) + priced.packages;
  if (priced.packages > product.stock || demand > product.stock) {
    return {
      ...priced,
      line_cents: null,
      include_in_cart: false,
      stock_demand: demand,
      issue: {
        code: 'insufficient_stock',
        message: `Only ${product.stock} package(s) of ${product.product_name} in stock; need ${Math.max(
          priced.packages,
          demand
        )}.`,
      },
    };
  }

  return {
    ...priced,
    line_cents: money(priced.packages * product.price_cents),
    include_in_cart: true,
    stock_demand: demand,
    issue: null,
  };
}

function buildReview(state, catalog) {
  const byId = productMap(catalog);
  const rows = [];
  const demand = {};

  // Pass 1: resolve matches and compute package counts (no stock yet).
  const resolved = state.ingredients.map((row) => {
    if (row.pantry || row.skipped) {
      return { row, match: null, skipPricing: true };
    }
    const match = resolveMatch(row, catalog);
    const product = match.product || (row.product_id ? byId[row.product_id] : null);
    const boundRow = {
      ...row,
      product_id: row.product_id || (product ? product.product_id : null),
    };
    const priced = computePackages(boundRow, product);
    if (product && priced.packages != null && !priced.issue) {
      demand[product.product_id] = (demand[product.product_id] || 0) + priced.packages;
    }
    return { row: boundRow, match, product, priced, skipPricing: false };
  });

  const overDemand = new Set(
    Object.entries(demand)
      .filter(([id, pkgs]) => {
        const p = byId[id];
        return p && pkgs > p.stock;
      })
      .map(([id]) => id)
  );

  // Pass 2: apply stock / confirmation issues and build review rows.
  for (const item of resolved) {
    if (item.skipPricing) {
      rows.push(decorateInactive(item.row));
      continue;
    }

    const { row, match, product, priced } = item;
    const issues = [];
    let status = match.status;
    let pendingConfirmation = false;
    let include_in_cart = false;
    let line_cents = null;

    if (!product) {
      issues.push(match.issue || { code: 'no_match', message: 'No match.' });
      status = match.status || 'no_match';
    } else {
      const autoId = match.auto_product_id;
      const isSub =
        match.status === 'substitution' ||
        (autoId && product.product_id !== autoId) ||
        (row.product_id && autoId && row.product_id !== autoId);
      if (isSub) {
        status = 'substitution';
        if (!row.confirmed) {
          issues.push({
            code: 'substitution',
            message: `${product.product_name} is a substitution and needs confirmation.`,
          });
          pendingConfirmation = true;
        }
      } else if (match.status === 'ambiguous' && !state.ingredients.find((i) => i.id === row.id)?.product_id) {
        issues.push(match.issue);
        status = 'ambiguous';
      }

      if (priced.issue) {
        issues.push(priced.issue);
        if (priced.issue.code === 'incompatible_unit') status = 'incompatible_unit';
        if (priced.issue.code === 'no_match') status = 'no_match';
        if (priced.issue.code === 'invalid_packages') status = 'invalid_packages';
      }

      const singleOver = priced.packages != null && priced.packages > product.stock;
      const combinedOver = overDemand.has(product.product_id);
      if (!priced.issue && (singleOver || combinedOver)) {
        const needed = demand[product.product_id] || priced.packages;
        issues.push({
          code: 'insufficient_stock',
          message: `Only ${product.stock} package(s) of ${product.product_name} in stock; need ${needed}.`,
        });
        status = 'insufficient_stock';
      }

      if (priced.shortfall && !row.confirmed) {
        issues.push({
          code: 'quantity_shortfall',
          message: `Selected packages cover about ${priced.covered_quantity} ${normalizeUnit(
            row.unit
          )}, less than the ${row.quantity} ${row.unit} needed.`,
        });
        pendingConfirmation = true;
      }

      const stockOk = !singleOver && !combinedOver;
      if (!priced.issue && priced.packages != null && stockOk) {
        include_in_cart = true;
        line_cents = money(priced.packages * product.price_cents);
      }
    }

    rows.push({
      id: row.id,
      ingredient: row.ingredient,
      quantity: row.quantity,
      unit: row.unit,
      pantry: false,
      skipped: false,
      status,
      product_id: product ? product.product_id : null,
      product_name: product ? product.product_name : null,
      package_label: product ? `${product.package_size} ${product.unit}` : null,
      price_cents: product ? product.price_cents : null,
      stock: product ? product.stock : null,
      packages: priced.packages,
      line_cents: include_in_cart ? line_cents : null,
      include_in_cart,
      estimate: priced.estimate || false,
      conversion_note: priced.conversion_note,
      confirmed: row.confirmed,
      pending_confirmation: pendingConfirmation,
      shortfall: Boolean(priced.shortfall),
      covered_quantity: priced.covered_quantity,
      issues: issues.filter(Boolean),
      match_options: (match.matches || []).map((p) => ({
        product_id: p.product_id,
        product_name: p.product_name,
        price_cents: p.price_cents,
      })),
    });
  }

  const cart_lines = [];
  const lineKey = new Map();
  for (const r of rows) {
    if (!r.include_in_cart || !r.product_id || !r.packages) continue;
    const prev = lineKey.get(r.product_id);
    if (prev) {
      prev.packages += r.packages;
      prev.line_cents = money(prev.packages * byId[r.product_id].price_cents);
    } else {
      const line = {
        product_id: r.product_id,
        product_name: r.product_name,
        packages: r.packages,
        line_cents: r.line_cents,
        ingredient_ids: [r.id],
      };
      lineKey.set(r.product_id, line);
      cart_lines.push(line);
    }
  }

  // Fix ingredient_ids aggregation
  for (const r of rows) {
    if (!r.include_in_cart || !r.product_id) continue;
    const line = lineKey.get(r.product_id);
    if (line && !line.ingredient_ids.includes(r.id)) line.ingredient_ids.push(r.id);
  }

  const total_cents = money(cart_lines.reduce((sum, l) => sum + l.line_cents, 0));
  const budget_cents = state.budget_cents;
  const budget_remaining_cents =
    budget_cents == null ? null : money(budget_cents - total_cents);

  const issues = [];
  for (const r of rows) {
    if (r.pantry || r.skipped) continue;
    for (const issue of r.issues || []) {
      issues.push({ ingredient_id: r.id, code: issue.code, message: issue.message });
    }
  }

  const cheaper_swaps =
    budget_cents != null && total_cents > budget_cents
      ? findCheaperSwaps(state, rows, catalog, total_cents, demand)
      : [];

  const pantry_ingredient_ids = state.ingredients.filter((i) => i.pantry).map((i) => i.id);
  const missing_ingredient_ids = state.ingredients.filter((i) => i.skipped).map((i) => i.id);

  const blockingIssues = issues.filter((i) =>
    ['no_match', 'ambiguous', 'incompatible_unit', 'insufficient_stock', 'invalid_packages', 'substitution', 'quantity_shortfall'].includes(
      i.code
    )
  );

  let approval = 'approved';
  if (blockingIssues.length) {
    approval = 'blocked';
  } else if (budget_cents != null && total_cents > budget_cents && !state.budget_acknowledged) {
    approval = 'requires_budget_acknowledgment';
  } else if (missing_ingredient_ids.length) {
    approval = 'approved_incomplete';
  }

  const partial =
    rows.some((r) => !r.pantry && !r.skipped && !r.include_in_cart) && cart_lines.length > 0;

  return {
    meal: state.meal,
    servings: state.servings,
    mode: state.mode,
    example_id: state.example_id,
    budget_cents,
    budget_acknowledged: state.budget_acknowledged,
    rows,
    cart_lines,
    total_cents,
    budget_remaining_cents,
    pantry_ingredient_ids,
    missing_ingredient_ids,
    issues,
    cheaper_swaps,
    approval,
    partial_estimate: partial,
    approved: state.approved,
  };
}

function decorateInactive(row) {
  return {
    id: row.id,
    ingredient: row.ingredient,
    quantity: row.quantity,
    unit: row.unit,
    pantry: row.pantry,
    skipped: row.skipped,
    status: row.pantry ? 'pantry' : 'skipped',
    product_id: row.prior?.product_id ?? row.product_id,
    product_name: null,
    package_label: null,
    price_cents: null,
    stock: null,
    packages: null,
    line_cents: null,
    include_in_cart: false,
    estimate: false,
    conversion_note: null,
    confirmed: row.confirmed,
    pending_confirmation: false,
    shortfall: false,
    covered_quantity: null,
    issues: [],
    match_options: [],
  };
}

function findCheaperSwaps(state, rows, catalog, currentTotal, currentDemand) {
  const byId = productMap(catalog);
  const swaps = [];

  for (const reviewRow of rows) {
    if (!reviewRow.include_in_cart || !reviewRow.product_id) continue;
    const original = byId[reviewRow.product_id];
    if (!original) continue;

    const alternatives = catalog.products.filter(
      (p) =>
        Array.isArray(p.budget_alternative_for) &&
        p.budget_alternative_for.includes(original.product_id) &&
        p.stock > 0
    );

    for (const alt of alternatives) {
      const trialRow = {
        ...state.ingredients.find((i) => i.id === reviewRow.id),
        product_id: alt.product_id,
        confirmed: true,
        packages_override: null,
      };
      // Demand without this row's current packages
      const demandWithout = { ...currentDemand };
      demandWithout[original.product_id] =
        (demandWithout[original.product_id] || 0) - reviewRow.packages;
      if (demandWithout[original.product_id] <= 0) delete demandWithout[original.product_id];

      const priced = priceRow(trialRow, alt, demandWithout);
      if (!priced.include_in_cart || priced.packages == null) continue;

      const newTotal = money(currentTotal - reviewRow.line_cents + priced.line_cents);
      const savings = money(currentTotal - newTotal);
      if (savings <= 0) continue;

      swaps.push({
        ingredient_id: reviewRow.id,
        product_id: alt.product_id,
        product_name: alt.product_name,
        packages: priced.packages,
        price_cents: alt.price_cents,
        line_cents: priced.line_cents,
        savings_cents: savings,
        swap_note: alt.swap_note || null,
        replaces_product_id: original.product_id,
        replaces_product_name: original.product_name,
      });
    }
  }

  return swaps;
}

function applyAction(state, action) {
  clearApproval(state);
  const type = action.action;

  if (type === 'acknowledge_budget') {
    state.budget_acknowledged = true;
    return state;
  }

  if (type === 'set_budget') {
    state.budget_cents = action.budget_cents == null ? null : money(action.budget_cents);
    invalidateBudgetAck(state);
    return state;
  }

  const ingredient = state.ingredients.find((i) => i.id === action.ingredient_id);
  if (!ingredient && type !== 'acknowledge_budget') {
    throw new Error(`Unknown ingredient: ${action.ingredient_id}`);
  }

  if (type === 'toggle_pantry') {
    if (ingredient.pantry) {
      const prior = ingredient.prior || {};
      ingredient.pantry = false;
      ingredient.product_id = prior.product_id ?? ingredient.product_id;
      ingredient.packages_override =
        prior.packages_override !== undefined ? prior.packages_override : ingredient.packages_override;
      ingredient.confirmed = prior.confirmed ?? ingredient.confirmed;
      ingredient.skipped = false;
      ingredient.prior = null;
    } else {
      ingredient.prior = {
        product_id: ingredient.product_id,
        packages_override: ingredient.packages_override,
        confirmed: ingredient.confirmed,
        skipped: ingredient.skipped,
      };
      ingredient.pantry = true;
      ingredient.skipped = false;
    }
    invalidateBudgetAck(state);
    return state;
  }

  if (type === 'skip') {
    ingredient.skipped = true;
    ingredient.pantry = false;
    ingredient.confirmed = false;
    invalidateBudgetAck(state);
    return state;
  }

  if (type === 'unskip') {
    ingredient.skipped = false;
    invalidateBudgetAck(state);
    return state;
  }

  if (type === 'swap') {
    ingredient.product_id = action.product_id;
    ingredient.confirmed = false;
    ingredient.skipped = false;
    ingredient.pantry = false;
    ingredient.packages_override = null;
    invalidateBudgetAck(state);
    return state;
  }

  if (type === 'confirm') {
    ingredient.confirmed = true;
    invalidateBudgetAck(state);
    return state;
  }

  if (type === 'set_packages') {
    const packages = Number(action.packages);
    if (!Number.isInteger(packages) || packages < 1) {
      throw new Error('Package count must be a positive whole number.');
    }
    ingredient.packages_override = packages;
    ingredient.confirmed = false;
    ingredient.skipped = false;
    ingredient.pantry = false;
    invalidateBudgetAck(state);
    return state;
  }

  if (type === 'set_quantity') {
    const quantity = Number(action.quantity);
    if (!(quantity > 0)) throw new Error('Quantity must be positive.');
    ingredient.quantity = quantity;
    if (action.unit) ingredient.unit = action.unit;
    ingredient.confirmed = false;
    ingredient.packages_override = null;
    invalidateBudgetAck(state);
    return state;
  }

  throw new Error(`Unknown action: ${type}`);
}

function attemptApproval(state, catalog) {
  const review = buildReview(state, catalog);
  if (review.approval === 'blocked' || review.approval === 'requires_budget_acknowledgment') {
    return { ok: false, review };
  }

  const shortfalls = review.rows
    .filter((r) => r.shortfall && r.confirmed && !r.pantry && !r.skipped)
    .map((r) => ({
      ingredient_id: r.id,
      ingredient: r.ingredient,
      needed: `${r.quantity} ${r.unit}`,
      covered: `${r.covered_quantity} ${normalizeUnit(r.unit)}`,
    }));

  state.approved = {
    at: new Date().toISOString(),
    total_cents: review.total_cents,
    cart_lines: review.cart_lines,
    skipped_ingredient_ids: review.missing_ingredient_ids,
    pantry_ingredient_ids: review.pantry_ingredient_ids,
    shortfalls,
    status: review.approval,
  };
  review.approved = state.approved;
  return { ok: true, review };
}

function summarizeForTests(review) {
  return {
    cart_lines: review.cart_lines.map((l) => ({
      product_id: l.product_id,
      packages: l.packages,
    })),
    total_cents: review.total_cents,
    budget_remaining_cents: review.budget_remaining_cents,
    approval: review.approval,
    missing_ingredient_ids: review.missing_ingredient_ids,
    pantry_ingredient_ids: review.pantry_ingredient_ids,
    issues: review.issues.map((i) => ({
      ingredient_id: i.ingredient_id,
      code: i.code,
    })),
    cheaper_swaps: review.cheaper_swaps.map((s) => ({
      ingredient_id: s.ingredient_id,
      product_id: s.product_id,
      savings_cents: s.savings_cents,
    })),
  };
}

module.exports = {
  createPlanState,
  createIngredientRow,
  buildReview,
  applyAction,
  attemptApproval,
  summarizeForTests,
  clearApproval,
};
