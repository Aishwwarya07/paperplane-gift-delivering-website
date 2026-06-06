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
  const sqlite3 = require('sqlite3').verbose();
  const isVercel = process.env.VERCEL;
  const dbPath = isVercel ? path.resolve('/tmp', 'paperplane.sqlite') : path.resolve(__dirname, 'paperplane.sqlite');
  const exists = fs.existsSync(dbPath);
  sqliteDb = new sqlite3.Database(dbPath);
  sqliteDb.run('PRAGMA foreign_keys = ON;');
  console.log(`Database connected: SQLite (${dbPath})`);
}

/**
 * Unified SQL query function.
 * Automatically translates Postgres placeholder syntax ($1, $2) to SQLite syntax (?)
 * and returns a standard structure: { rows: Array, rowCount: Number }
 */
const query = (text, params = []) => {
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
      // Translate $1, $2 -> ? for SQLite
      let sqliteText = text;
      sqliteText = sqliteText.replace(/\$\d+/g, '?');

      const lowerText = sqliteText.trim().toLowerCase();
      // If it returns data, run as db.all, else run as db.run
      if (lowerText.startsWith('select') || lowerText.includes('returning')) {
        sqliteDb.all(sqliteText, params, (err, rows) => {
          if (err) return reject(err);
          resolve({
            rows: rows || [],
            rowCount: rows ? rows.length : 0
          });
        });
      } else {
        sqliteDb.run(sqliteText, params, function (err) {
          if (err) return reject(err);
          // Standardize insert response for SQLite returning id
          resolve({
            rows: [{ id: this.lastID }],
            rowCount: this.changes,
            lastID: this.lastID
          });
        });
      }
    }
  });
};

/**
 * Initialize database tables using SQL schema file.
 */
const initDb = async () => {
  if (dbType === 'postgres') {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await query(sql);
    console.log('PostgreSQL schema initialized.');
  } else {
    const schemaPath = path.join(__dirname, 'schema-sqlite.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    // SQLite node client does not execute multiple statements in one query() easily unless we use db.exec.
    // So we'll use sqliteDb.exec for initializing schema.
    await new Promise((resolve, reject) => {
      sqliteDb.exec(sql, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    console.log('SQLite schema initialized.');
  }
};

module.exports = {
  query,
  initDb,
  dbType
};
