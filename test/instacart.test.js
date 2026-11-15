'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Instacart deep link helper', () => {
  it('builds a search URL from approved cart lines', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'instacart.js'), 'utf8');
    const sandbox = { window: {}, console };
    vm.runInNewContext(source, sandbox);
    const url = sandbox.window.MealMateInstacart.buildInstacartSearchUrl({
      cart_lines: [
        { product_name: 'Olive Oil' },
        { product_name: 'Unsalted Butter' },
      ],
    });
    assert.ok(url.startsWith('https://www.instacart.com/store/s?k='));
    assert.match(url, /Olive%20Oil/);
    assert.match(url, /Unsalted%20Butter/);
  });
});
