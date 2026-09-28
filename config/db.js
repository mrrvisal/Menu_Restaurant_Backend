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

