const crypto = require("crypto");

// Extract client IP honoring reverse-proxy headers
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();

  return (req.ip || (req.connection && req.connection.remoteAddress) || "")
    .replace("::ffff:", "")
    .replace("::1", "127.0.0.1");
}

function isPrivateIp(ip) {
  if (!ip || ip === "unknown") return true;
  return (
    ip === "127.0.0.1" ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^169\.254\./.test(ip)
  );
}

// Parse User-Agent into browser, OS, and device type
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

  // Fallback device type detection
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) {
    deviceType = "tablet";
  } else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) {
    deviceType = "mobile";
  }

  return { browser, browserVersion, os, osVersion, deviceType };
}

function deviceSummary(parsed) {
  const osLabel = parsed.osVersion
    ? `${parsed.os} ${parsed.osVersion}`
    : parsed.os;
  const browserLabel = parsed.browserVersion
    ? `${parsed.browser} ${parsed.browserVersion.split(".")[0]}`
    : parsed.browser;
  return `${browserLabel} on ${osLabel}`;
}

// Extract full device information from request
function extractDeviceInfo(req) {
  const body = req.body || {};
  const info = body.deviceInfo || {};
  const ua = req.headers["user-agent"] || "";
  const parsed = parseUserAgent(ua);

  let deviceId = String(req.headers["x-device-id"] || info.deviceId || "")
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
    platform: String(info.platform || "").slice(0, 60),
    hardware: String(info.hardware || "").slice(0, 120),
    userAgent: String(ua).slice(0, 512),
    ip_address: getClientIp(req),
  };
}

// IP Geolocation lookup (best-effort, fire-and-forget)
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
      latitude: typeof data.lat === "number" ? data.lat : null,
      longitude: typeof data.lon === "number" ? data.lon : null,
      asn: data.as || null,
      org: data.org || null,
      isProxy: Boolean(data.proxy),
      isHosting: Boolean(data.hosting),
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
