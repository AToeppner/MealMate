'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

/**
 * Load project-root `.env` reliably.
 * - Resolves the file next to package.json (not process.cwd())
 * - Fills keys that are missing or whitespace-only (empty shell/IDE presets
 *   otherwise block dotenv's default non-override behavior)
 * - Trims OPENAI_API_KEY after load
 */
function loadEnv() {
  const result = {
    path: ENV_PATH,
    exists: fs.existsSync(ENV_PATH),
    loaded: false,
    error: null,
  };

  if (!result.exists) {
    return result;
  }

  try {
    const parsed = dotenv.parse(fs.readFileSync(ENV_PATH));
    for (const [key, value] of Object.entries(parsed)) {
      const current = process.env[key];
      if (current === undefined || String(current).trim() === '') {
        process.env[key] = value;
      }
    }
    result.loaded = true;
  } catch (err) {
    result.error = err.message;
  }

  if (typeof process.env.OPENAI_API_KEY === 'string') {
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY.trim();
  }

  return result;
}

function isOpenAiConfigured() {
  return Boolean((process.env.OPENAI_API_KEY || '').trim());
}

module.exports = {
  loadEnv,
  isOpenAiConfigured,
  ENV_PATH,
  ROOT,
};
