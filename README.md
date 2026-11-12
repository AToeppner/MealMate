# MealMate

MealMate helps students and young professionals turn a meal idea into a grocery cart. A grocery retailer could use it to reduce item-by-item search and make carts easier to complete.

This repo is a local prototype: **Node.js 24 + Express + plain HTML/CSS/JS + OpenAI Node SDK**, with session-scoped state (no database) and a read-only simulated grocery catalog.

## Features

1. **Plan** — meal description, servings (1–10), optional USD budget (including $0)
2. **Generate** — Live AI (OpenAI Responses API) or curated **Saved Example** offline plans
3. **Review / match / price** — catalog matching, package math, pantry / skip / swap / quantity controls
4. **Budget** — remaining/overage, linked cheaper substitutes, explicit over-budget acknowledgment
5. **Approve** — server-side revalidation; simulated snapshot (no payment, stock not decremented)

## Local setup

Requirements: **Node.js 24+**

```bash
cp .env.example .env
# Optional later: set OPENAI_API_KEY in .env (do not commit the key)
npm install
npm start
```

Open `http://localhost:3000` (or the `PORT` you set).

```bash
npm test
```

Health check: `GET /health`

The server binds to `0.0.0.0` and `process.env.PORT` (default `3000`).

### Modes

- **Live AI** — requires `OPENAI_API_KEY` in `.env`. Optional `OPENAI_MODEL` (default `gpt-4.1-mini`). Bounded with a simple per-IP rate limit.
- **Saved Example** — uses `data/meal_examples.json`. Never labeled as live AI output.

If live generation fails, the UI offers retry or Saved Example mode. Both modes share the same cart path.

### Demo fill

Use **Fill vodka pasta demo** for sun-dried tomato vodka pasta (4 servings, $30) with the demo ingredient list in the meal description. In Live AI mode, Generate calls OpenAI; for a deterministic walkthrough use **Use Saved Example**.

## Data

| File | Role |
|------|------|
| `data/grocery_catalog.json` | Simulated products (`price_cents`, stock, aliases, conversions). **Read-only.** |
| `data/meal_examples.json` | Curated offline / saved-example plans |
| `data/cart_test_cases.json` | Deterministic acceptance fixtures |

## Render (document for later — not deployed in this pass)

Target: low-traffic **Render Free** web service.

Suggested settings when you deploy:

- **Runtime**: Node
- **Build command**: `npm install`
- **Start command**: `npm start`
- **Instance**: Free web service
- **Health check path**: `/health`
- **Environment**: set `OPENAI_API_KEY`, optionally `OPENAI_MODEL`, `PORT` (Render sets `PORT` automatically)

Before a class presentation: open the Render URL once to warm the free instance, or keep `npm start` running locally as a backup. Add secrets only in the Render dashboard — never commit `.env`.

## MIST 5400 Track 2 — evaluation metrics

| Metric | Definition | Result |
|--------|------------|--------|
| Correct cart outcomes | Share of fixture / scripted cases with expected cart lines, totals, and approval state | _(run `npm test`; record pass rate here)_ |
| Completed carts / attempted trials | Approvals completed ÷ user trials attempted (team or outside users) | _(blank until trials)_ |
| Median time to approval | Median minutes from meal entry to successful approval | _(blank until trials)_ |

### Trial recording procedure

1. Start from a fresh browser session (or **New plan**).
2. Record: date, participant (or “team”), mode (Live AI / Saved Example), meal text, servings, budget.
3. Note blockers (no match, stock, budget ack, etc.) and whether approval succeeded.
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
- **Mock-data limitations**: fixed catalog, approximate unit conversions (`explicit_demo_conversions`), no real payment or inventory decrement, no personalization.

### What AI built vs what the team should verify

- **AI-assisted build**: app scaffold, matching/pricing engine, fixture tests, Saved Example + Live AI paths, local UI, README.
- **Team should verify / describe from experience**: live OpenAI demos with a real key, outside-user trials and metric collection, Render deploy/warmup, retailer narrative and ROI numbers, any catalog gaps found in class.

## How to run (summary)

```bash
npm install
npm test
npm start
```

Live AI verification requires `OPENAI_API_KEY` in `.env`. Without a key, use Saved Example mode; treat live AI checks as skipped.
