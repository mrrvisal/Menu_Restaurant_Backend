const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 15000,
  // ─── TIMESTAMP PARSING (fixes the "7h ago" bug) ──────────────
  // The DB session runs on UTC (`@@system_time_zone = 'UTC'`), so `created_at`
  // columns hold true UTC. mysql2's default (timezone: "local") parses a
  // DATETIME/TIMESTAMP by APPLYING THE NODE PROCESS OFFSET — on a UTC+7
  // machine a row stored as 16:21 UTC came back as 16:21+07:00 = 09:21Z, so
  // a call placed seconds ago rendered as "7h ago" in the dashboard.
  // "Z" tells mysql2 the value is already UTC, so the Date is the real
  // instant and the browser localises it correctly. Override with
  // DB_TIMEZONE only if the DB session is deliberately offset from UTC.
  timezone: process.env.DB_TIMEZONE || "Z",
  ssl: process.env.DB_CA_PATH
    ? {
        ca: fs.readFileSync(path.resolve(__dirname, process.env.DB_CA_PATH)),
        rejectUnauthorized: true,
      }
    : undefined,
});

// Retryable error codes for dropped idle/stale connections
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ER_SERVER_SHUTDOWN",
]);

function isRetryableError(err) {
  return !!err && RETRYABLE_CODES.has(err.code);
}

// Safely close cached idle connections so retries use a fresh socket
function dropIdleConnections() {
  const core = pool.pool;
  if (!core || !core._freeConnections) return;

  try {
    const free = core._freeConnections;
    const snapshot = [];
    for (let i = 0; i < free.length; i++) snapshot.push(free.get(i));

    for (const conn of snapshot) {
      try {
        conn._pool = null;
        conn.destroy();
        core._removeConnection(conn);
      } catch (_) {
        // Ignore already closed connections
      }
    }
  } catch (_) {
    // Prevent cleanup errors from affecting request
  }
}

const rawQuery = pool.query.bind(pool);
const rawExecute = pool.execute.bind(pool);

async function withConnectionRetry(fn, sql, values) {
  try {
    return await fn(sql, values);
  } catch (err) {
    if (isRetryableError(err)) {
      console.warn(
        `[db] Query failed (${err.code || err.message}). Dropping stale connections and retrying once.`,
      );
      dropIdleConnections();
      return await fn(sql, values);
    }
    throw err;
  }
}

pool.query = (sql, values) => withConnectionRetry(rawQuery, sql, values);
pool.execute = (sql, values) => withConnectionRetry(rawExecute, sql, values);

module.exports = pool;

