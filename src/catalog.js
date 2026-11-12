'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadJson(name) {
  const filePath = path.join(DATA_DIR, name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCatalog() {
  return loadJson('grocery_catalog.json');
}

function loadExamples() {
  return loadJson('meal_examples.json');
}

function loadTestCases() {
  return loadJson('cart_test_cases.json');
}

function cloneCatalog(catalog, stockOverrides = {}) {
  const products = catalog.products.map((p) => {
    const copy = { ...p, aliases: [...(p.aliases || [])] };
    if (copy.explicit_demo_conversions) {
      copy.explicit_demo_conversions = { ...copy.explicit_demo_conversions };
    }
    if (copy.budget_alternative_for) {
      copy.budget_alternative_for = [...copy.budget_alternative_for];
    }
    if (Object.prototype.hasOwnProperty.call(stockOverrides, copy.product_id)) {
      copy.stock = Number(stockOverrides[copy.product_id]);
    }
    return copy;
  });
  return {
    ...catalog,
    products,
    byId: Object.fromEntries(products.map((p) => [p.product_id, p])),
  };
}

function getExample(examples, exampleId) {
  const found = examples.examples.find((e) => e.id === exampleId);
  if (!found) throw new Error(`Unknown example: ${exampleId}`);
  return found;
}

module.exports = {
  DATA_DIR,
  loadCatalog,
  loadExamples,
  loadTestCases,
  cloneCatalog,
  getExample,
};
