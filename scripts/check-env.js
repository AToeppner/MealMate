'use strict';

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: true,
});

const key = String(process.env.OPENAI_API_KEY || '').trim();
const model = process.env.OPENAI_MODEL || '';

console.log(
  JSON.stringify(
    {
      env_path: path.join(__dirname, '..', '.env'),
      key_length: key.length,
      starts_sk: key.startsWith('sk-'),
      has_quotes: key.startsWith('"') || key.startsWith("'"),
      has_whitespace: /\s/.test(key),
      model,
    },
    null,
    2
  )
);
