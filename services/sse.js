// backend/services/sse.js
// Simple Server-Sent Events (SSE) broadcaster for real-time order notifications

// Map of restaurantId -> Set of connected SSE clients
const clients = new Map();

/**
 * Add a client connection for a restaurant
 * @param {number} restaurantId - The restaurant ID
 * @param {object} res - The Express response object
 */
function addClient(restaurantId, res) {
  if (!clients.has(restaurantId)) {
    clients.set(restaurantId, new Set());
  }
  clients.get(restaurantId).add(res);

  // Remove client when connection closes
  res.on("close", () => {
    const set = clients.get(restaurantId);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        clients.delete(restaurantId);
      }
    }
  });
}

/**
 * Broadcast an event to all connected clients for a restaurant
 * @param {number} restaurantId - The restaurant ID
 * @param {string} event - The event name
 * @param {object} data - The event data payload
 */
function broadcast(restaurantId, event, data) {
  const set = clients.get(restaurantId);
  if (!set || set.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) {
    try {
      client.write(payload);
    } catch (err) {
      console.error("SSE broadcast error:", err.message);
      set.delete(client);
    }
  }
}

// Map of orderId -> Set of connected tracking clients (guest order tracker)
const orderClients = new Map();

/**
 * Add a guest tracking client for a single order
 * @param {number} orderId - The order ID
 * @param {object} res - The Express response object
 */
function addOrderClient(orderId, res) {
  const key = Number(orderId);
  if (!orderClients.has(key)) {
    orderClients.set(key, new Set());
  }
  orderClients.get(key).add(res);

  // Remove client when connection closes
  res.on("close", () => {
    const set = orderClients.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) {
        orderClients.delete(key);
      }
    }
  });
}

/**
 * Emit an event to every guest tracking this single order
 * @param {number} orderId - The order ID
 * @param {string} event - The event name
 * @param {object} data - The event data payload
 */
function emitOrder(orderId, event, data) {
  const set = orderClients.get(Number(orderId));
  if (!set || set.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of set) {
    try {
      client.write(payload);
    } catch (err) {
      console.error("SSE order emit error:", err.message);
      set.delete(client);
    }
  }
}

module.exports = { addClient, broadcast, addOrderClient, emitOrder };