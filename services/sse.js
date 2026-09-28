// Server-Sent Events (SSE) broadcaster for dashboard & order tracking
const clients = new Map(); // restaurantId -> Set<res>
const orderClients = new Map(); // orderId -> Set<res>

function addClient(restaurantId, res) {
  if (!clients.has(restaurantId)) {
    clients.set(restaurantId, new Set());
  }
  clients.get(restaurantId).add(res);

  res.on("close", () => {
    const set = clients.get(restaurantId);
    if (set) {
      set.delete(res);
      if (set.size === 0) clients.delete(restaurantId);
    }
  });
}

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

function addOrderClient(orderId, res) {
  const key = Number(orderId);
  if (!orderClients.has(key)) {
    orderClients.set(key, new Set());
  }
  orderClients.get(key).add(res);

  res.on("close", () => {
    const set = orderClients.get(key);
    if (set) {
      set.delete(res);
      if (set.size === 0) orderClients.delete(key);
    }
  });
}

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
