const pg = require('pg');
const path = require('path');
const fs = require('fs');

let dbType = 'sqlite';
let pgPool = null;
let sqliteDb = null;

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (connectionString) {
  dbType = 'postgres';
  pgPool = new pg.Pool({
    connectionString: connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  console.log('Database connected: PostgreSQL');
} else {
  dbType = 'sqlite';
  const { Database } = require('node-sqlite3-wasm');
  const isVercel = process.env.VERCEL;
  const dbPath = isVercel ? path.resolve('/tmp', 'paperplane.sqlite') : path.resolve(__dirname, 'paperplane.sqlite');
  sqliteDb = new Database(dbPath);
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  console.log(`Database connected: SQLite/WASM (${dbPath})`);
}

/**
 * Internal raw SQL query function.
 */
const queryInternal = (text, params = []) => {
  return new Promise((resolve, reject) => {
    if (dbType === 'postgres') {
      pgPool.query(text, params, (err, res) => {
        if (err) return reject(err);
        resolve({
          rows: res.rows || [],
          rowCount: res.rowCount || 0
        });
      });
    } else {
      try {
        // Translate $1, $2 -> ? for SQLite
        let sqliteText = text.replace(/\$\d+/g, '?');
        const lowerText = sqliteText.trim().toLowerCase();

        if (lowerText.includes('returning')) {
          // Strip RETURNING clause and use lastInsertRowid
          const withoutReturning = sqliteText.replace(/\s+returning\s+\S+/i, '');
          const stmt = sqliteDb.prepare(withoutReturning);
          const info = stmt.run(params);
          stmt.finalize();
          resolve({
            rows: [{ id: info.lastInsertRowid }],
            rowCount: info.changes,
            lastID: info.lastInsertRowid
          });
        } else if (lowerText.startsWith('select')) {
          const stmt = sqliteDb.prepare(sqliteText);
          const rows = stmt.all(params);
          stmt.finalize();
          resolve({
            rows: rows || [],
            rowCount: rows ? rows.length : 0
          });
        } else {
          const stmt = sqliteDb.prepare(sqliteText);
          const info = stmt.run(params);
          stmt.finalize();
          resolve({
            rows: [{ id: info.lastInsertRowid }],
            rowCount: info.changes,
            lastID: info.lastInsertRowid
          });
        }
      } catch (err) {
        reject(err);
      }
    }
  });
};

/**
 * Initialize database tables using SQL schema file.
 */
const initDbInternal = async () => {
  if (dbType === 'postgres') {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await queryInternal(sql);
    console.log('PostgreSQL schema initialized.');
  } else {
    const schemaPath = path.join(__dirname, 'schema-sqlite.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    sqliteDb.exec(sql);
    console.log('SQLite schema initialized.');
  }
};

let initPromise = null;
const ensureDbInitialized = () => {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await initDbInternal();
        // Check if database needs auto-seeding
        const checkRes = await queryInternal('SELECT COUNT(*) as count FROM delivery_agents');
        const count = parseInt(checkRes.rows[0].count || 0);
        if (count === 0) {
          console.log('Database is empty. Auto-seeding...');
          const { seed } = require('./seed');
          await seed(false);
          console.log('Database auto-seeded successfully.');
        }
      } catch (err) {
        console.error('Failed to auto-initialize/seed database:', err);
        // Clear promise so it retries on next request if it failed
        initPromise = null;
        throw err;
      }
    })();
  }
  return initPromise;
};

/**
 * Unified SQL query function.
 * Automatically waits for database initialization.
 */
const query = async (text, params = []) => {
  await ensureDbInitialized();
  return queryInternal(text, params);
};

const initDb = async () => {
  await ensureDbInitialized();
};

module.exports = {
  query,
  initDb,
  dbType
};
