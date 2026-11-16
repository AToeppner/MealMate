# MealMate

MealMate helps students and young professionals turn a meal idea into a grocery cart. A grocery retailer could use it to reduce item-by-item search and make carts easier to complete.

This repo is a local prototype: **Node.js 24 + Express + plain HTML/CSS/JS + OpenAI Node SDK**, with session-scoped state (no database) and a read-only simulated grocery catalog.

## Features

1. **Plan** — meal description, servings (1–10), optional USD budget (including $0)
2. **Generate** — Live AI (OpenAI Responses API)
3. **Recipe Book** — approved carts saved in the browser (`localStorage`) for reorder between sessions
4. **Review / match / price** — catalog matching, package math, pantry / skip / swap / quantity controls
5. **Budget** — remaining/overage shown as informational, linked cheaper substitutes; over-budget does not block approval
6. **Approve** — server-side revalidation; simulated snapshot (no payment, stock not decremented). Unmatched / unpriceable ingredients stay visible, are left out of the estimated total and budget, and do not block approval (disclosed on the snapshot).
7. **Instacart link** — after approve, optional deep-link search on Instacart (no partner API)

## Local setup

Requirements: **Node.js 24+**

```bash
cp .env.example .env
# For Live AI: put your key on the OPENAI_API_KEY= line in .env (do not commit .env)
npm install
npm start
```

Open `http://localhost:3000` (or the `PORT` you set).

**Live AI key tips:** keep `.env` in the project root (same folder as `package.json`), use `OPENAI_API_KEY=sk-...` with no spaces around `=`, then **restart** `npm start`. Startup logs whether the key was picked up. Recipe Book works without a key once you have approved carts on that browser.

```bash
npm test
```

Health check: `GET /health`

The server binds to `0.0.0.0` and `process.env.PORT` (default `3000`).

### Modes

- **Live AI** — requires `OPENAI_API_KEY` in `.env` (or Render env). Optional `OPENAI_MODEL` (default `gpt-4.1-mini`). Bounded with a simple per-IP rate limit.
- **Recipe Book** — browser-local history of **approved** carts. Reorder runs through the same match/price/Skip/Already have/Approve flow. Cleared if site data is cleared.

`data/meal_examples.json` remains for automated fixtures only (not shown in the UI).

## Data

| File | Role |
|------|------|
| `data/grocery_catalog.json` | Simulated products (`price_cents`, stock, aliases, conversions). **Read-only.** |
| `data/meal_examples.json` | Curated offline fixtures for `npm test` |
| `data/cart_test_cases.json` | Deterministic acceptance fixtures |

## Deploy on Render

Blueprint file: [`render.yaml`](render.yaml).

1. Push this repo to GitHub.
2. In [Render](https://render.com): **New → Blueprint** (or Web Service) and connect the repo.
3. Settings (also in `render.yaml`):
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Health check path**: `/health`
   - **Instance**: Free web service is fine for class demos
4. Set secret env var **`OPENAI_API_KEY`** in the Render dashboard (do not commit it). Optional: `OPENAI_MODEL`.
5. Deploy, then open the Render URL once to warm the free instance before a presentation.

Recipe Book storage is **per browser**, so demos that reorder should use the same browser that approved the cart.

## Instacart (thin slice)

After Approve, MealMate can open an Instacart storefront **search** URL built from cart product names. This is not an official cart API / OAuth integration.

## MIST 5400 Track 2 — evaluation metrics

| Metric | Definition | Result |
|--------|------------|--------|
| Correct cart outcomes | Share of fixture / scripted cases with expected cart lines, totals, and approval state | _(run `npm test`; record pass rate here)_ |
| Completed carts / attempted trials | Approvals completed ÷ user trials attempted (team or outside users) | _(blank until trials)_ |
| Median time to approval | Median minutes from meal entry to successful approval | _(blank until trials)_ |

### Trial recording procedure

1. Start from a fresh browser session (or **New plan**).
2. Record: date, participant (or “team”), mode (Live AI / Recipe Book), meal text, servings, budget.
3. Note blockers (no match, stock, etc.) and whether approval succeeded.
4. Capture start timestamp (meal entry) and end timestamp (approval or abandon).
5. Log findings and product changes in the table below.

### Findings and changes

| Date | Scenario | Outcome | Notes / change |
|------|----------|---------|----------------|
| | | | |

## Product write-up notes (placeholders)

- **Retailer buyer**: grocery / digital commerce stakeholder seeking higher cart completion and less friction vs item-by-item search.
- **Shopper value**: one meal idea → matched packages, prices, budget help, and an explicit approve step.
- **Likely cost drivers**: LLM tokens per generation, hosting, future catalog/integration work, support for edge-case ingredients.
- **ROI assumptions**: _(team: lift in completed carts, time saved per shop, conversion vs search baseline — fill from trials)_
- **Mock-data limitations**: fixed catalog, approximate unit conversions (`explicit_demo_conversions`), no real payment or inventory decrement, Recipe Book is browser-local only.

### What AI built vs what the team should verify

- **AI-assisted build**: app scaffold, matching/pricing engine, fixture tests, Live AI + Recipe Book paths, unit conversion fixes, Instacart deep-link, Render blueprint, local UI, README.
- **Team should verify / describe from experience**: live OpenAI demos with a real key, outside-user trials and metric collection, Render deploy/warmup, retailer narrative and ROI numbers, catalog gaps found in class.

## How to run (summary)

```bash
npm install
npm test
npm start
```

Live AI verification requires `OPENAI_API_KEY` in `.env` or Render. Without a key, generate is disabled; Recipe Book reorder still works for previously approved carts on that browser.
