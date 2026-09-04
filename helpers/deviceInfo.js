// backend/helpers/deviceInfo.js
// ─── DEVICE FINGERPRINTING HELPERS ─────────────────────────
// Captures everything important about a device that accesses an
// account: a stable client-generated device id, parsed user agent
// (browser / OS / device type), screen, timezone, language and IP
// (with a best-effort city/country lookup for private owners).
const crypto = require("crypto");

// Extract the caller IP, honouring reverse-proxy headers (nginx /
// Cloudflare set x-forwarded-for / x-real-ip before Express sees it).
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  return (req.ip || (req.connection && req.connection.remoteAddress) || "")
    .replace("::ffff:", "")
    .replace("::1", "127.0.0.1");
}

function isPrivateIp(ip) {
  if (!ip) return true;
  return (
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("172.17.") ||
    ip.startsWith("172.18.") ||
    ip.startsWith("172.19.") ||
    ip.startsWith("172.2") ||
    ip.startsWith("172.30.") ||
    ip.startsWith("172.31.") ||
    ip.startsWith("169.254.") ||
    ip === "unknown" ||
    ip === ""
  );
}

// Parse a User-Agent string into browser / OS / device type.
// Lightweight regex approach — no external dependency needed.
function parseUserAgent(ua) {
  ua = String(ua || "");
  let browser = "Unknown";
  let browserVersion = "";
  let os = "Unknown";
  let osVersion = "";
  let deviceType = "desktop";

  // ── Browser (order matters: Edge/Opera before Chrome before Safari) ──
  const edge = ua.match(/Edg(?:e|A|iOS)?\/([\d.]+)/);
  const opera = ua.match(/(?:OPR|Opera)[ /]([\d.]+)/);
  const firefox = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/);
  const chrome = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);
  if (edge) {
    browser = "Edge";
    browserVersion = edge[1];
  } else if (opera) {
    browser = "Opera";
    browserVersion = opera[1];
  } else if (firefox) {
    browser = "Firefox";
    browserVersion = firefox[1];
  } else if (chrome) {
    browser = "Chrome";
    browserVersion = chrome[1];
  } else if (safari) {
    browser = "Safari";
    browserVersion = safari[1];
  } else if (/MSIE|Trident/.test(ua)) {
    browser = "IE";
    const m = ua.match(/(?:MSIE |rv:)([\d.]+)/);
    browserVersion = m ? m[1] : "";
  }

  // ── OS ──
  const windows = ua.match(/Windows NT ([\d.]+)/);
  const android = ua.match(/Android ([\d.]+)/);
  const ios = ua.match(/(?:iPhone|iPad).*OS ([\d_]+)/);
  const mac = ua.match(/Mac OS X ([\d_.]+)/);
  if (windows) {
    os = "Windows";
    osVersion = windows[1];
    if (parseFloat(windows[1]) >= 10) osVersion = "10/11";
  } else if (android) {
    os = "Android";
    osVersion = android[1];
    deviceType = /Mobile/.test(ua) ? "mobile" : "tablet";
  } else if (ios) {
    os = "iOS";
    osVersion = ios[1].replace(/_/g, ".");
    deviceType = /iPad/.test(ua) ? "tablet" : "mobile";
  } else if (/iPhone|iPod/.test(ua)) {
    os = "iOS";
    deviceType = "mobile";
  } else if (mac) {
    os = "macOS";
    osVersion = mac[1].replace(/_/g, ".");
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  } else if (/CrOS/.test(ua)) {
    os = "ChromeOS";
  }

  // ── Device type fallbacks ──
  if (/iPad|Tablet|PlayBook|Silk/.test(ua)) deviceType = "tablet";
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/.test(ua))
    deviceType = "mobile";

  return { browser, browserVersion, os, osVersion, deviceType };
}

// Friendly label, e.g. "Chrome 126 on Windows 10/11"
function deviceSummary(parsed) {
  const osLabel = parsed.osVersion
    ? `${parsed.os} ${parsed.osVersion}`
    : parsed.os;
  const browserLabel = parsed.browserVersion
    ? `${parsed.browser} ${parsed.browserVersion.split(".")[0]}`
    : parsed.browser;
  return `${browserLabel} on ${osLabel}`;
}

// Collect everything from the request + client-sent info (headers/body).
// The frontend sends an X-Device-Id header and a deviceInfo object at login.
function extractDeviceInfo(req) {
  const body = req.body || {};
  const info = body.deviceInfo || {};
  const ua = req.headers["user-agent"] || "";
  const parsed = parseUserAgent(ua);

  // Stable id: prefer the client's persisted UUID; fall back to a hash
  // of UA+IP so repeat visits from the same device still group together.
  let deviceId = String(
    req.headers["x-device-id"] || info.deviceId || "",
  )
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  if (!deviceId) {
    deviceId = crypto
      .createHash("sha256")
      .update(`${ua}|${getClientIp(req)}`)
      .digest("hex")
      .slice(0, 32);
  }

  return {
    deviceId,
    deviceName: info.deviceName || deviceSummary(parsed),
    deviceType: info.deviceType || parsed.deviceType,
    browser: parsed.browser,
    browserVersion: parsed.browserVersion,
    os: parsed.os,
    osVersion: parsed.osVersion,
    screen: String(info.screen || "").slice(0, 20),
    timezone: String(info.timezone || "").slice(0, 60),
    language: String(info.language || "").slice(0, 20),
    // ── extra forensic data ──
    platform: String(info.platform || "").slice(0, 60),
    hardware: String(info.hardware || "").slice(0, 120),
    userAgent: String(ua).slice(0, 512),
    ip_address: getClientIp(req),
  };
}

// Best-effort geolocation of the IP (free endpoint, no API key).
// Never throws — on failure resolves null and the row keeps IP-only info.
// Runs fire-and-forget after login so it never blocks the response.
async function lookupIpLocation(ip) {
  try {
    if (!ip || isPrivateIp(ip)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(
        ip,
      )}?fields=city,regionName,country,isp,org,as,lat,lon,proxy,hosting`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.status === "fail") return null;
    return {
      city: data.city || null,
      region: data.regionName || null,
      country: data.country || null,
      isp: data.isp || null,
      // ── extra: exact location + network owner + security flags ──
      latitude: typeof data.lat === "number" ? data.lat : null,
      longitude: typeof data.lon === "number" ? data.lon : null,
      asn: data.as || null,
      org: data.org || null,
      isProxy: !!data.proxy,
      isHosting: !!data.hosting,
    };
  } catch {
    return null;
  }
}

module.exports = {
  getClientIp,
  isPrivateIp,
  parseUserAgent,
  deviceSummary,
  extractDeviceInfo,
  lookupIpLocation,
};
