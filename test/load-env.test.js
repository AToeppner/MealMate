'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const BACKUP_PATH = path.join(ROOT, '.env.load-env-test.bak');

function runLoaderProbe(overrides = {}) {
  const script = `
    const { loadEnv, isOpenAiConfigured } = require('./src/load-env');
    const info = loadEnv();
    process.stdout.write(JSON.stringify({
      exists: info.exists,
      loaded: info.loaded,
      configured: isOpenAiConfigured(),
      key: process.env.OPENAI_API_KEY || null,
      port: process.env.PORT || null,
    }));
  `;
  const env = { ...process.env, ...overrides };
  // Ensure explicit clears win over the parent environment.
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
  }
  delete env.NODE_OPTIONS;

  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'probe failed');
  }
  return JSON.parse(result.stdout);
}

describe('loadEnv', () => {
  let hadEnv = false;

  before(() => {
    hadEnv = fs.existsSync(ENV_PATH);
    if (hadEnv) {
      fs.renameSync(ENV_PATH, BACKUP_PATH);
    }
  });

  after(() => {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
    if (hadEnv) {
      fs.renameSync(BACKUP_PATH, ENV_PATH);
    } else if (fs.existsSync(BACKUP_PATH)) {
      fs.unlinkSync(BACKUP_PATH);
    }
  });

  beforeEach(() => {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
  });

  afterEach(() => {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
  });

  it('loads OPENAI_API_KEY from project-root .env', () => {
    fs.writeFileSync(ENV_PATH, 'OPENAI_API_KEY=sk-from-file\nPORT=4123\n');
    const out = runLoaderProbe({ OPENAI_API_KEY: undefined, PORT: undefined });
    assert.equal(out.loaded, true);
    assert.equal(out.configured, true);
    assert.equal(out.key, 'sk-from-file');
    assert.equal(out.port, '4123');
  });

  it('overrides empty preset OPENAI_API_KEY from .env', () => {
    fs.writeFileSync(ENV_PATH, 'OPENAI_API_KEY=sk-filled\n');
    const out = runLoaderProbe({ OPENAI_API_KEY: '' });
    assert.equal(out.key, 'sk-filled');
    assert.equal(out.configured, true);
  });

  it('does not override a real existing OPENAI_API_KEY', () => {
    fs.writeFileSync(ENV_PATH, 'OPENAI_API_KEY=sk-from-file\n');
    const out = runLoaderProbe({ OPENAI_API_KEY: 'sk-from-shell' });
    assert.equal(out.key, 'sk-from-shell');
  });

  it('trims whitespace around the key', () => {
    fs.writeFileSync(ENV_PATH, 'OPENAI_API_KEY="  sk-trimmed  "\n');
    const out = runLoaderProbe({ OPENAI_API_KEY: undefined });
    assert.equal(out.key, 'sk-trimmed');
  });

  it('reports missing .env without throwing', () => {
    const out = runLoaderProbe({ OPENAI_API_KEY: undefined });
    assert.equal(out.exists, false);
    assert.equal(out.loaded, false);
    assert.equal(out.configured, false);
  });
});
