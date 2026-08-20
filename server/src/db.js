import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

const SCHEMA_LICENSES = `
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  stripe_session_id TEXT,
  stripe_customer_id TEXT,
  discord_id TEXT
)`;

const SCHEMA_ACTIVATIONS = `
CREATE TABLE IF NOT EXISTS activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL,
  hwid TEXT NOT NULL,
  device_name TEXT,
  activated_at INTEGER NOT NULL,
  last_seen INTEGER
)`;

let db;
let dbKind = 'json';

if (process.env.DATABASE_URL) {
  // Postgres (hébergement) : asynchrone, persistant, gratuit via Neon/Render.
  try {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
    db = createPgDb(pool);
    dbKind = 'postgres';
  } catch (err) {
    console.warn('[db] Postgres indisponible: ' + err.message);
    db = null;
  }
}

if (!db) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(path.join(dataDir, 'licenses.db'));
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA_LICENSES);
    db.exec(SCHEMA_ACTIVATIONS);
    // Migration : ajout de la colonne discord_id sur d'anciennes bases SQLite
    try { db.prepare('ALTER TABLE licenses ADD COLUMN discord_id TEXT').run(); } catch {}
    dbKind = 'sqlite';
  } catch (err) {
    console.warn('[db] better-sqlite3 indisponible, bascule sur un stockage JSON: ' + err.message);
    db = createJsonDb();
  }
}

export default db;
export { dbKind };

// ---------------------------------------------------------------- Postgres

function createPgDb(pool) {
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

  (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'monthly',
      status TEXT NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      stripe_session_id TEXT,
      stripe_customer_id TEXT,
      discord_id TEXT
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS activations (
      id SERIAL PRIMARY KEY,
      license_id BIGINT NOT NULL,
      hwid TEXT NOT NULL,
      device_name TEXT,
      activated_at BIGINT NOT NULL,
      last_seen BIGINT
    )`);
    // Migrations idempotentes (aucun effet si les colonnes sont déjà au bon type)
    await pool.query('ALTER TABLE licenses ALTER COLUMN created_at TYPE BIGINT');
    await pool.query('ALTER TABLE licenses ALTER COLUMN expires_at TYPE BIGINT');
    await pool.query('ALTER TABLE activations ALTER COLUMN license_id TYPE BIGINT');
    await pool.query('ALTER TABLE activations ALTER COLUMN activated_at TYPE BIGINT');
    await pool.query('ALTER TABLE activations ALTER COLUMN last_seen TYPE BIGINT');
    readyResolve();
  })().catch(err => {
    console.error('[db] Initialisation Postgres échouée:', err.message);
    readyReject();
  });

  function translate(sql) {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  }

  const api = {
    kind: 'postgres',
    pool,
    ready,
    pragma: () => {},
    exec: async (sql) => { await pool.query(sql); },
    prepare(sql) {
      const q = translate(sql);
      const isInsert = /^\s*insert/i.test(sql);
      return {
        run: async (...params) => {
          if (isInsert) {
            const r = await pool.query(q + ' RETURNING id', params);
            return { lastInsertRowid: r.rows[0]?.id, changes: r.rowCount };
          }
          const r = await pool.query(q, params);
          return { changes: r.rowCount };
        },
        get: async (...params) => {
          const r = await pool.query(q + ' LIMIT 1', params);
          return r.rows[0];
        },
        all: async (...params) => {
          const r = await pool.query(q, params);
          return r.rows;
        }
      };
    }
  };
  return api;
}

// ---------------------------------------------------------------- JSON fallback

function createJsonDb() {
  const file = path.join(dataDir, 'licenses.json');
  const state = {
    licenses: [],
    activations: [],
    _seq: { licenses: 0, activations: 0 }
  };
  const load = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return structuredClone(state); }
  };
  const save = (s) => fs.writeFileSync(file, JSON.stringify(s, null, 2));
  let store = load();

  const api = {
    kind: 'json',
    ready: Promise.resolve(),
    pragma: () => {},
    exec: () => {},
    prepare(sql) {
      const exec = (sqliteQuery, params) => {
        const lower = sqliteQuery.toLowerCase().trim();
        if (lower.startsWith('insert')) {
          const isLicenses = sqliteQuery.includes('licenses');
          const obj = params ? (Array.isArray(params) ? Object.fromEntries(['key','email','plan','status','created_at','expires_at','stripe_session_id','stripe_customer_id','discord_id'].map((k,i)=>[k,params[i]])) : params) : {};
          obj.id = ++store._seq[isLicenses ? 'licenses' : 'activations'];
          obj.stripe_session_id = obj.stripe_session_id || null;
          obj.stripe_customer_id = obj.stripe_customer_id || null;
          obj.discord_id = obj.discord_id ?? null;
          obj.last_seen = obj.last_seen ?? null;
          store[isLicenses ? 'licenses' : 'activations'].push(obj);
          save(store);
          return { lastInsertRowid: obj.id, changes: 1 };
        }
        if (lower.startsWith('select')) {
          const isLicenses = sqliteQuery.includes('licenses') && !sqliteQuery.includes('activations');
          let rows = store[isLicenses ? 'licenses' : 'activations'];
          if (params) {
            const p = Array.isArray(params) ? params : [params];
            for (const val of p) {
              if (val == null) continue;
              const k = String(val);
              rows = rows.filter(r => {
                const needle = sqliteQuery.toLowerCase();
                if (needle.includes('key =')) return r.key === k;
                if (needle.includes('id =')) return r.id === val;
                if (needle.includes('license_id =')) return r.license_id === val;
                if (needle.includes('hwid =')) return r.hwid === k;
                if (needle.includes('discord_id =')) return String(r.discord_id || '') === k;
                return true;
              });
            }
          }
          return { all: () => rows, get: () => rows[0] || undefined };
        }
        if (lower.startsWith('update')) {
          const paramsArr = Array.isArray(params) ? params : [];
          const isLicenses = sqliteQuery.includes('licenses');
          const setClause = sqliteQuery.match(/SET\s+([\s\S]*?)\s+WHERE/i)?.[1] || '';
          const idIdx = sqliteQuery.toLowerCase().includes('id =') ? paramsArr.length - 1 : -1;
          const row = (store[isLicenses ? 'licenses' : 'activations']).find(r => r.id === paramsArr[idIdx]);
          if (row) {
            for (const pair of setClause.split(',')) {
              const [, col, val] = pair.trim().match(/^(\w+)\s*=\s*(.+)$/) || [];
              if (!col) continue;
              if (/^'|^"/.test(val.trim())) row[col] = val.trim().slice(1, -1);
              else if (val.trim().toLowerCase() === 'null') row[col] = null;
              else row[col] = Number(val.trim());
            }
            save(store);
          }
          return { changes: row ? 1 : 0 };
        }
        if (lower.startsWith('delete')) {
          const id = Array.isArray(params) ? params[0] : params;
          const isLicenses = sqliteQuery.includes('licenses');
          const arr = store[isLicenses ? 'licenses' : 'activations'];
          const before = arr.length;
          const cleaned = arr.filter(r => r.id !== id);
          store[isLicenses ? 'licenses' : 'activations'] = cleaned;
          if (cleaned.length !== before) save(store);
          return { changes: before - cleaned.length };
        }
        return { all: () => [], get: () => undefined, changes: 0 };
      };
      return {
        run: (...p) => exec(sql, p),
        get: (...p) => exec(sql, p).get(),
        all: (...p) => exec(sql, p).all()
      };
    }
  };
  return api;
}