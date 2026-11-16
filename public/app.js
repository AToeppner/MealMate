'use strict';

const els = {
  planSection: document.getElementById('plan-section'),
  reviewSection: document.getElementById('review-section'),
  planForm: document.getElementById('plan-form'),
  meal: document.getElementById('meal'),
  servings: document.getElementById('servings'),
  budget: document.getElementById('budget'),
  planError: document.getElementById('plan-error'),
  aiHint: document.getElementById('ai-hint'),
  modeBadge: document.getElementById('mode-badge'),
  reviewSummary: document.getElementById('review-summary'),
  budgetBar: document.getElementById('budget-bar'),
  swapOffers: document.getElementById('swap-offers'),
  partialNote: document.getElementById('partial-note'),
  ingredientList: document.getElementById('ingredient-list'),
  cartLines: document.getElementById('cart-lines'),
  cartTotal: document.getElementById('cart-total'),
  approveBtn: document.getElementById('approve-btn'),
  approveMsg: document.getElementById('approve-msg'),
  approvedView: document.getElementById('approved-view'),
  newPlan: document.getElementById('new-plan'),
  recipeBookList: document.getElementById('recipe-book-list'),
  recipeBookEmpty: document.getElementById('recipe-book-empty'),
};

let meta = null;
let currentPlan = null;

function usd(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function showError(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data.error ||
        (res.status === 502
          ? 'Live AI request failed (502). Check the server/Render logs and OPENAI_API_KEY / OPENAI_MODEL.'
          : `Request failed (${res.status})`)
    );
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

function setBusy(busy) {
  els.planForm.querySelectorAll('button').forEach((b) => {
    b.disabled = busy;
  });
  els.approveBtn.disabled = busy;
  els.recipeBookList.querySelectorAll('button').forEach((b) => {
    b.disabled = busy;
  });
}

function modeLabel(plan) {
  if (plan.mode === 'live_ai') return 'Live AI plan';
  if (plan.mode === 'recipe_book') return 'Recipe Book reorder';
  if (plan.mode === 'saved_example') {
    return `Saved Example${plan.example_id ? `: ${plan.example_id}` : ''}`;
  }
  return plan.mode || 'Plan';
}

function renderRecipeBook() {
  const recipes = window.MealMateRecipeBook.loadRecipes();
  els.recipeBookEmpty.hidden = recipes.length > 0;
  els.recipeBookList.innerHTML = recipes
    .map((recipe) => {
      const when = recipe.savedAt ? new Date(recipe.savedAt).toLocaleString() : '';
      const budget =
        recipe.budget_cents == null ? 'No budget' : `Budget ${usd(recipe.budget_cents)}`;
      return `
        <li class="recipe-card" data-id="${escapeHtml(recipe.id)}">
          <div>
            <h3>${escapeHtml(recipe.meal)}</h3>
            <p class="meta">${recipe.servings} serving${recipe.servings === 1 ? '' : 's'} · ${budget}${
              when ? ` · ${escapeHtml(when)}` : ''
            }</p>
          </div>
          <div class="recipe-card-actions">
            <button type="button" class="btn secondary" data-reorder="${escapeHtml(recipe.id)}">Reorder</button>
            <button type="button" class="btn ghost" data-remove="${escapeHtml(recipe.id)}">Remove</button>
          </div>
        </li>`;
    })
    .join('');

  els.recipeBookList.querySelectorAll('[data-reorder]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recipe = window.MealMateRecipeBook.getRecipe(btn.getAttribute('data-reorder'));
      if (!recipe) return;
      showError(els.planError, '');
      setBusy(true);
      try {
        const data = await api('/api/plan/from-saved', {
          method: 'POST',
          body: JSON.stringify({
            recipe_id: recipe.id,
            meal: recipe.meal,
            servings: recipe.servings,
            budget_cents: recipe.budget_cents,
            ingredients: recipe.ingredients,
          }),
        });
        els.meal.value = recipe.meal;
        els.servings.value = String(recipe.servings);
        els.budget.value =
          recipe.budget_cents == null ? '' : (recipe.budget_cents / 100).toFixed(2);
        renderPlan(data.plan);
      } catch (err) {
        showError(els.planError, err.message);
      } finally {
        setBusy(false);
      }
    });
  });

  els.recipeBookList.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.MealMateRecipeBook.removeRecipe(btn.getAttribute('data-remove'));
      renderRecipeBook();
    });
  });
}

function saveApprovedToRecipeBook(plan) {
  if (!plan?.approved) return;
  const snapshot = window.MealMateRecipeBook.snapshotFromPlan({
    meal: plan.meal,
    servings: plan.servings,
    budget_cents: plan.budget_cents,
    rows: plan.rows,
  });
  // Prefer original ingredient quantities (not skipped-only rows) for reorder.
  snapshot.ingredients = (plan.rows || [])
    .filter((row) => row && row.ingredient)
    .map((row, index) => ({
      id: row.id || `r${index + 1}`,
      ingredient: row.ingredient,
      quantity: Number(row.quantity),
      unit: row.unit,
      product_id: row.product_id || null,
    }));
  window.MealMateRecipeBook.upsertRecipe(snapshot);
  renderRecipeBook();
}

async function init() {
  meta = await api('/api/meta');
  els.aiHint.textContent = meta.openai_configured
    ? 'Approved carts save to Recipe Book on this browser.'
    : 'No OPENAI_API_KEY configured. Add a key to .env (or Render env vars) and restart, or reorder from Recipe Book after you have saved recipes.';

  renderRecipeBook();

  const existing = await api('/api/plan');
  if (existing.plan) renderPlan(existing.plan);
}

els.planForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(els.planError, '');
  setBusy(true);
  try {
    const body = {
      meal: els.meal.value.trim(),
      servings: Number(els.servings.value),
      budget_usd: els.budget.value === '' ? null : Number(els.budget.value),
    };
    const data = await api('/api/plan/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    renderPlan(data.plan);
  } catch (err) {
    showError(
      els.planError,
      `${err.message}${err.data?.offer_retry ? ' You can retry after fixing the key or waiting out rate limits.' : ''}`
    );
  } finally {
    setBusy(false);
  }
});

els.newPlan.addEventListener('click', async () => {
  await api('/api/plan/reset', { method: 'POST', body: '{}' });
  currentPlan = null;
  els.reviewSection.hidden = true;
  els.planSection.hidden = false;
  els.modeBadge.hidden = true;
  els.approvedView.hidden = true;
  renderRecipeBook();
});

els.approveBtn.addEventListener('click', async () => {
  els.approveMsg.textContent = '';
  setBusy(true);
  try {
    const data = await api('/api/plan/approve', { method: 'POST', body: '{}' });
    renderPlan(data.plan);
    saveApprovedToRecipeBook(data.plan);
    els.approveMsg.textContent =
      'Cart approved (simulated snapshot — stock not decremented). Saved to Recipe Book.';
  } catch (err) {
    if (err.data?.plan) renderPlan(err.data.plan);
    els.approveMsg.textContent = explainApproval(err.data?.plan) || err.message;
  } finally {
    setBusy(false);
  }
});

async function runAction(action) {
  setBusy(true);
  try {
    const data = await api('/api/plan/action', {
      method: 'POST',
      body: JSON.stringify(action),
    });
    renderPlan(data.plan);
  } catch (err) {
    els.approveMsg.textContent = err.message;
  } finally {
    setBusy(false);
  }
}

const BLOCKING_ISSUE_CODES = new Set([
  'ambiguous',
  'insufficient_stock',
  'invalid_packages',
  'substitution',
  'quantity_shortfall',
]);

function explainApproval(plan) {
  if (!plan) return '';
  if (plan.approval === 'blocked') {
    const codes = [
      ...new Set(
        (plan.issues || [])
          .filter((i) => BLOCKING_ISSUE_CODES.has(i.code))
          .map((i) => i.code)
      ),
    ].join(', ');
    return `Approval blocked until issues are resolved${codes ? ` (${codes})` : ''}. Use Skip or Already have on problem ingredients.`;
  }
  if ((plan.unmatched_ingredient_ids || []).length) {
    return 'Unmatched ingredients stay in review but are left out of the estimated total and budget. You can still approve.';
  }
  return '';
}

function renderPlan(plan) {
  currentPlan = plan;
  els.planSection.hidden = true;
  els.reviewSection.hidden = false;

  els.modeBadge.hidden = false;
  els.modeBadge.textContent = modeLabel(plan);

  els.reviewSummary.textContent = `${plan.meal} · ${plan.servings} serving${plan.servings === 1 ? '' : 's'}`;

  if (plan.budget_cents != null) {
    els.budgetBar.hidden = false;
    const remaining = plan.budget_remaining_cents;
    const over = remaining < 0;
    els.budgetBar.classList.toggle('over', over);
    els.budgetBar.textContent = over
      ? `Budget ${usd(plan.budget_cents)} · Over by ${usd(-remaining)}`
      : `Budget ${usd(plan.budget_cents)} · Remaining ${usd(remaining)}`;
  } else {
    els.budgetBar.hidden = true;
  }

  els.partialNote.hidden = !plan.partial_estimate;
  els.partialNote.textContent = plan.partial_estimate
    ? 'Estimated cart is partial: some ingredients are unmatched, unpriceable, or out of stock.'
    : '';

  renderSwaps(plan.cheaper_swaps || []);
  renderIngredients(plan.rows || []);
  renderCart(plan);

  els.approveBtn.disabled = plan.approval === 'blocked';
  els.approveMsg.textContent = plan.approved ? '' : explainApproval(plan);

  if (plan.approved) {
    els.approvedView.hidden = false;
    const skipped = (plan.approved.skipped_ingredient_ids || [])
      .map((id) => plan.rows.find((r) => r.id === id)?.ingredient || id)
      .join(', ');
    const unmatched = (plan.approved.unmatched_ingredient_ids || [])
      .map((id) => plan.rows.find((r) => r.id === id)?.ingredient || id)
      .join(', ');
    const shortfalls = (plan.approved.shortfalls || [])
      .map((s) => `${s.ingredient}: needed ${s.needed}, covered ${s.covered}`)
      .join('; ');
    const instacartUrl = window.MealMateInstacart.buildInstacartSearchUrl(plan);
    els.approvedView.innerHTML = `
      <h3>Approved cart</h3>
      <p><strong>Total:</strong> ${usd(plan.approved.total_cents)}</p>
      <p>Status: ${plan.approved.status}</p>
      ${skipped ? `<p><strong>Skipped ingredients:</strong> ${skipped}</p>` : ''}
      ${unmatched ? `<p><strong>Unmatched (left out of estimate):</strong> ${unmatched}</p>` : ''}
      ${shortfalls ? `<p><strong>Confirmed shortfalls:</strong> ${shortfalls}</p>` : ''}
      <p class="hint">Saved to Recipe Book on this browser. Any later cart edit clears this approval.</p>
      <div class="approved-actions">
        ${
          instacartUrl
            ? `<a class="btn secondary" href="${instacartUrl}" target="_blank" rel="noopener noreferrer">Open on Instacart</a>`
            : ''
        }
      </div>
    `;
  } else {
    els.approvedView.hidden = true;
    els.approvedView.innerHTML = '';
  }
}

function renderSwaps(swaps) {
  if (!swaps.length) {
    els.swapOffers.hidden = true;
    els.swapOffers.innerHTML = '';
    return;
  }
  els.swapOffers.hidden = false;
  els.swapOffers.innerHTML = swaps
    .map(
      (s) => `
      <div class="swap-card">
        <p>
          Budget swap: use <strong>${escapeHtml(s.product_name)}</strong> instead of
          ${escapeHtml(s.replaces_product_name)} and save ${usd(s.savings_cents)}.
          ${s.swap_note ? escapeHtml(s.swap_note) : ''}
        </p>
        <button type="button" class="btn secondary" data-swap="${s.ingredient_id}" data-product="${s.product_id}">
          Apply swap
        </button>
      </div>`
    )
    .join('');

  els.swapOffers.querySelectorAll('[data-swap]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await runAction({
        action: 'swap',
        ingredient_id: btn.getAttribute('data-swap'),
        product_id: btn.getAttribute('data-product'),
      });
    });
  });
}

function renderIngredients(rows) {
  els.ingredientList.innerHTML = rows
    .map((row) => {
      const dimmed = row.pantry || row.skipped ? 'dimmed' : '';
      const product = row.product_name
        ? `${escapeHtml(row.product_name)} · ${escapeHtml(row.package_label || '')}`
        : 'No match';
      const line =
        row.include_in_cart && row.line_cents != null
          ? `${row.packages} pkg · ${usd(row.line_cents)}`
          : row.pantry
            ? 'Already have'
            : row.skipped
              ? 'Skipped from recipe'
              : 'Excluded from estimate';
      const issues = (row.issues || [])
        .filter((i) => i.code !== 'incompatible_unit')
        .map((i) => `<p class="issue">${escapeHtml(i.message)}</p>`)
        .join('');

      const confirmBtn =
        row.pending_confirmation && !row.pantry && !row.skipped
          ? `<button type="button" class="btn secondary" data-action="confirm" data-id="${row.id}">Confirm selection</button>`
          : '';

      return `
        <li class="ingredient ${dimmed}" data-id="${row.id}">
          <div class="ingredient-top">
            <div>
              <h3>${escapeHtml(row.ingredient)}</h3>
              <p class="meta">Need ${row.quantity} ${escapeHtml(row.unit)} · ${product}</p>
              <p class="meta">${line}</p>
              ${issues}
            </div>
          </div>
          <div class="row-actions">
            <button type="button" class="btn ghost" data-action="toggle_pantry" data-id="${row.id}">
              ${row.pantry ? 'Undo already have' : 'Already have this ingredient?'}
            </button>
            <button type="button" class="btn ghost" data-action="${row.skipped ? 'unskip' : 'skip'}" data-id="${row.id}">
              ${row.skipped ? 'Undo skip' : 'Skip (not in recipe)'}
            </button>
            ${confirmBtn}
            <label class="qty-edit">
              <span class="visually-hidden">Packages</span>
              <input type="number" min="1" step="1" value="${row.packages || 1}" data-packages="${row.id}" ${
                row.pantry || row.skipped ? 'disabled' : ''
              } />
              <button type="button" class="btn ghost" data-action="set_packages" data-id="${row.id}">Set pkgs</button>
            </label>
          </div>
        </li>`;
    })
    .join('');

  els.ingredientList.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'set_packages') {
        const input = els.ingredientList.querySelector(`input[data-packages="${id}"]`);
        const packages = Number(input.value);
        await runAction({ action: 'set_packages', ingredient_id: id, packages });
        return;
      }
      await runAction({ action, ingredient_id: id });
    });
  });
}

function renderCart(plan) {
  const lines = plan.cart_lines || [];
  els.cartLines.innerHTML = lines.length
    ? lines
        .map(
          (l) =>
            `<li><span>${escapeHtml(l.product_name)} × ${l.packages}</span><span>${usd(l.line_cents)}</span></li>`
        )
        .join('')
    : '<li><span>No priced lines yet</span><span></span></li>';
  els.cartTotal.textContent = `Estimated total: ${usd(plan.total_cents || 0)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init().catch((err) => {
  showError(els.planError, err.message);
});
