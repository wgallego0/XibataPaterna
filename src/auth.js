import crypto from 'node:crypto';
import { getDb, commit, id, token } from './store.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function createSession(parentId) {
  const session = {
    token: token(24),
    parentId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  commit((db) => {
    db.sessions = db.sessions.filter((s) => new Date(s.expiresAt) > new Date());
    db.sessions.push(session);
  });
  return session;
}

export function destroySession(sessionToken) {
  commit((db) => {
    db.sessions = db.sessions.filter((s) => s.token !== sessionToken);
  });
}

export function parentFromRequest(req) {
  const sessionToken = readCookie(req, 'xp_session');
  if (!sessionToken) return null;
  const db = getDb();
  const session = db.sessions.find((s) => s.token === sessionToken);
  if (!session) return null;
  if (new Date(session.expiresAt) <= new Date()) {
    destroySession(sessionToken);
    return null;
  }
  return db.parents.find((p) => p.id === session.parentId) || null;
}

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export function sessionCookie(value, { maxAge = SESSION_TTL_MS / 1000, secure } = {}) {
  const parts = [
    `xp_session=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function publicParent(parent) {
  if (!parent) return null;
  const { id: parentId, name, email, createdAt } = parent;
  return { id: parentId, name, email, createdAt };
}

export function createParent({ name, email, password }) {
  const { salt, hash } = hashPassword(password);
  const parent = {
    id: id('p_'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  commit((db) => db.parents.push(parent));
  return parent;
}
