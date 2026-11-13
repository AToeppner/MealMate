'use strict';

const crypto = require('crypto');

const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 6;

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function touch(session) {
  session.updatedAt = Date.now();
  return session;
}

function getSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return null;
  }
  return touch(session);
}

function createSession() {
  const id = newId();
  const session = touch({
    id,
    plan: null,
    createdAt: Date.now(),
  });
  sessions.set(id, session);
  return session;
}

function getOrCreate(id) {
  return getSession(id) || createSession();
}

function resetPlan(session) {
  session.plan = null;
  touch(session);
}

// Simple in-memory rate limit for live AI.
const aiHits = new Map();

function checkAiRateLimit(ip, { max = 8, windowMs = 600000 } = {}) {
  const key = ip || 'unknown';
  const now = Date.now();
  let entry = aiHits.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
  }
  entry.count += 1;
  aiHits.set(key, entry);
  if (entry.count > max) {
    const err = new Error('Live AI rate limit exceeded. Try Saved Example mode or wait and retry.');
    err.code = 'RATE_LIMIT';
    throw err;
  }
}

module.exports = {
  getSession,
  createSession,
  getOrCreate,
  resetPlan,
  checkAiRateLimit,
  _sessions: sessions,
};
