// backend/config/db.js
const mysql = require('mysql2/promise');
require('dotenv').config();
const path = require("path");
const fs = require("fs");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  // Hosted TiDB/MySQL gateways close idle TCP connections aggressively, so a
  // pooled connection can silently become stale while the app is quiet.
  //   - connectTimeout: don't hang forever opening a socket
  //   - enableKeepAlive + keepAliveInitialDelay: keep idle sockets alive
  connectTimeout: 30000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 15000,
  ssl: process.env.DB_CA_PATH
    ? {
        ca: fs.readFileSync(path.resolve(__dirname, process.env.DB_CA_PATH)),
        rejectUnauthorized: true,
      }
    : undefined,
});

// ─────────────────────────────────────────────────────────────
//  Stale-connection resilience
// ─────────────────────────────────────────────────────────────
// The first query after a quiet period can fail with ECONNRESET /
// PROTOCOL_CONNECTION_LOST / EPIPE because the gateway already closed the
// pooled socket. mysql2 does NOT auto-destroy the connection for these codes,
// so we retry ONCE after discarding the cached idle connections — the retry
// then uses a brand-new socket.

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

// Best-effort: close every currently-idle connection so the retry opens a
// fresh one. `pool.pool` is the core (callback) pool under mysql2/promise.
// This mirrors what mysql2 itself does on idle-timeout, guarded so a cleanup
// failure can never break the request.
function dropIdleConnections() {
  const core = pool.pool;
  if (!core || !core._freeConnections) return;
  try {
    const free = core._freeConnections;
    const snapshot = [];
    for (let i = 0; i < free.length; i++) snapshot.push(free.get(i));
    for (const conn of snapshot) {
      try {
        conn._pool = null;            // mark as removed so release() early-returns
        conn.destroy();               // close the stale socket
        core._removeConnection(conn); // splice from the pool queues
      } catch (_) {
        /* already gone — ignore */
      }
    }
  } catch (_) {
    /* cleanup must never throw into the request path */
  }
}

// Save the original methods before overwriting them.
const rawQuery = pool.query.bind(pool);
const rawExecute = pool.execute.bind(pool);

async function withConnectionRetry(fn, sql, values) {
  try {
    return await fn(sql, values);
  } catch (err) {
    if (isRetryableError(err)) {
      console.warn(
        `[db] Query failed with ${err.code || err.message}; dropping stale ` +
          `connections and retrying once.`
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
