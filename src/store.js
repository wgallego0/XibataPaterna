import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = {
  version: 1,
  parents: [],
  children: [],
  routines: [],
  tasks: [],
  proactive: [],
  sessions: [],
};

let db = null;
let writeQueue = Promise.resolve();

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    db = structuredClone(EMPTY_DB);
    persistSync();
    return db;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = { ...structuredClone(EMPTY_DB), ...parsed };
  } catch (err) {
    // Never lose data silently: keep the unreadable file around for inspection.
    const backup = `${DB_FILE}.corrupt-${Date.now()}`;
    fs.renameSync(DB_FILE, backup);
    console.error(`[store] db.json ilegível (${err.message}). Backup em ${backup}. Iniciando base vazia.`);
    db = structuredClone(EMPTY_DB);
    persistSync();
  }
  return db;
}

function persistSync() {
  ensureDir();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function getDb() {
  if (!db) load();
  return db;
}

/**
 * Runs `mutator` against the in-memory db and persists the result.
 * Writes are serialized so concurrent requests never interleave a partial file.
 */
export function commit(mutator) {
  const current = getDb();
  const result = mutator(current);
  writeQueue = writeQueue.then(async () => {
    ensureDir();
    const tmp = `${DB_FILE}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((err) => console.error('[store] falha ao gravar db.json:', err));
  return result;
}

export function id(prefix = '') {
  return `${prefix}${crypto.randomBytes(9).toString('base64url')}`;
}

export function token(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}
