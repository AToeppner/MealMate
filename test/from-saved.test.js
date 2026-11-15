'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const app = require('../src/server');

function request(server, { method, path, body, cookie }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(data || '{}');
          } catch {
            json = { raw: data };
          }
          resolve({
            status: res.statusCode,
            json,
            cookie: (res.headers['set-cookie'] || [])[0] || cookie || null,
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('POST /api/plan/from-saved', () => {
  let server;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('loads a recipe book snapshot into the cart review flow', async () => {
    const first = await request(server, {
      method: 'POST',
      path: '/api/plan/from-saved',
      body: {
        recipe_id: 'rb_test',
        meal: 'Butter oil reorder',
        servings: 2,
        budget_cents: 2500,
        ingredients: [
          { id: 'i1', ingredient: 'unsalted butter', quantity: 2, unit: 'tbsp' },
          { id: 'i2', ingredient: 'olive oil', quantity: 1, unit: 'tbsp' },
        ],
      },
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.plan.mode, 'recipe_book');
    assert.equal(first.json.plan.meal, 'Butter oil reorder');
    assert.notEqual(first.json.plan.approval, 'blocked');
    assert.ok(first.json.plan.cart_lines.length >= 1);

    const cookie = first.cookie.split(';')[0];
    const again = await request(server, {
      method: 'GET',
      path: '/api/plan',
      cookie,
    });
    assert.equal(again.status, 200);
    assert.equal(again.json.plan.mode, 'recipe_book');
  });
});
