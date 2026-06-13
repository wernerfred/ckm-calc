const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || process.cwd());
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const CATALOG_FILE = path.join(DATA_DIR, "catalogs.json");
const SESSION_COOKIE_NAME = "ckm_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const adminSessions = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const DEFAULT_CATALOGS = {
  punsch: [
    { id: "punsch", name: "Punsch", price: 4, autoDeposit: true },
    { id: "kinderpunsch", name: "Kinderpunsch", price: 3, autoDeposit: true },
    { id: "schuss", name: "Schuss", price: 1.5, autoDeposit: false },
    { id: "bier", name: "Bier", price: 3, autoDeposit: false },
    { id: "deposit", name: "Pfand", price: 2, autoDeposit: false }
  ],
  cocktail: [
    { id: "kaffe_heisse_schokolade", name: "Kaffe / Heiße Schokolade", price: 2.5, autoDeposit: true },
    { id: "lumumba_apfelpunsch", name: "Lumumba / Apfelpunsch", price: 4, autoDeposit: true },
    { id: "apfelpunsch_alkfr", name: "Apfelpunsch alkfr.", price: 3, autoDeposit: true },
    { id: "glueh_gin_schneezauber", name: "Glüh Gin / Schneezauber", price: 5, autoDeposit: true },
    { id: "schnaps", name: "Schnaps", price: 2, autoDeposit: true },
    { id: "nussschnaps", name: "Nussschnaps", price: 3, autoDeposit: true },
    { id: "deposit", name: "Pfand", price: 2, autoDeposit: false }
  ],
  wurstel: [
    { id: "w2", name: "2 Würstel", price: 3.5, autoDeposit: false },
    { id: "w4", name: "4 Würstel", price: 6, autoDeposit: false },
    { id: "kaltgetraenk", name: "Kaltgetränk", price: 2.5, autoDeposit: false },
    { id: "bier", name: "Bier", price: 3, autoDeposit: false }
  ]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePrice(value, fallback) {
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  if (Number.isNaN(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function sanitizeItems(items, fallbackItems) {
  if (!Array.isArray(items)) {
    return clone(fallbackItems);
  }

  const safe = items
    .map((item, index) => {
      const fallback = fallbackItems[index] || fallbackItems[0] || { id: `item-${index}`, name: `Item ${index + 1}`, price: 0 };
      const id = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : fallback.id;
      const name = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : fallback.name;
      return {
        id,
        name,
        price: normalizePrice(item?.price, fallback.price || 0),
        autoDeposit: Boolean(item?.autoDeposit)
      };
    })
    .filter((item) => item.id);

  return safe.length ? safe : clone(fallbackItems);
}

function sanitizeCatalogs(catalogs) {
  return {
    punsch: sanitizeItems(catalogs?.punsch, DEFAULT_CATALOGS.punsch),
    cocktail: sanitizeItems(catalogs?.cocktail, DEFAULT_CATALOGS.cocktail),
    wurstel: sanitizeItems(catalogs?.wurstel, DEFAULT_CATALOGS.wurstel)
  };
}

async function readCatalogs() {
  try {
    const raw = await fsp.readFile(CATALOG_FILE, "utf8");
    return sanitizeCatalogs(JSON.parse(raw));
  } catch {
    return clone(DEFAULT_CATALOGS);
  }
}

async function writeCatalogs(catalogs) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(CATALOG_FILE, JSON.stringify(sanitizeCatalogs(catalogs), null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  fs.createReadStream(filePath).pipe(res);
}

function resolvePublicPath(urlPath) {
  const safePath = path.normalize(urlPath).replace(/^\/+/, "");
  const resolved = path.join(PUBLIC_DIR, safePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return resolved;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const pairs = header.split(";").map((part) => part.trim()).filter(Boolean);
  const cookies = {};
  pairs.forEach((part) => {
    const index = part.indexOf("=");
    if (index > 0) {
      const key = part.slice(0, index);
      const value = part.slice(index + 1);
      cookies[key] = decodeURIComponent(value);
    }
  });
  return cookies;
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of adminSessions.entries()) {
    if (expiresAt <= now) {
      adminSessions.delete(token);
    }
  }
}

function isAdminAuthenticated(req) {
  pruneExpiredSessions();
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return false;
  }
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    adminSessions.delete(token);
    return false;
  }
  adminSessions.set(token, Date.now() + SESSION_TTL_MS);
  return true;
}

function setAuthCookie(res, token) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`
  );
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isAdminPagePath(pathname) {
  return pathname === "/admin.html" || pathname === "/admin-edit.html";
}

function isAdminAssetPath(pathname) {
  return pathname === "/admin.js" || pathname === "/admin.css";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const authenticated = isAdminAuthenticated(req);
  const adminConfigured = Boolean(ADMIN_PASSWORD);

  if (url.pathname === "/api/admin/status" && req.method === "GET") {
    return sendJson(res, 200, { configured: adminConfigured, authenticated });
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    if (!adminConfigured) {
      return sendJson(res, 503, { error: "admin password not configured" });
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const password = typeof parsed?.password === "string" ? parsed.password : "";
      if (password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: "invalid credentials" });
      }
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      adminSessions.set(token, Date.now() + SESSION_TTL_MS);
      setAuthCookie(res, token);
      return sendJson(res, 200, { ok: true });
    } catch {
      return sendJson(res, 400, { error: "invalid payload" });
    }
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    if (token) {
      adminSessions.delete(token);
    }
    clearAuthCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === "/api/catalogs" && req.method === "GET") {
    const catalogs = await readCatalogs();
    return sendJson(res, 200, catalogs);
  }

  if (url.pathname === "/api/catalogs" && req.method === "PUT") {
    if (!adminConfigured) {
      return sendJson(res, 503, { error: "admin password not configured" });
    }
    if (!authenticated) {
      return sendJson(res, 401, { error: "unauthorized" });
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}");
      const sanitized = sanitizeCatalogs(parsed);
      await writeCatalogs(sanitized);
      return sendJson(res, 200, sanitized);
    } catch {
      return sendJson(res, 400, { error: "invalid payload" });
    }
  }

  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405);
    return res.end();
  }

  const pathName = url.pathname === "/" ? "/index.html" : url.pathname;
  if (isAdminPagePath(pathName) && !authenticated) {
    res.writeHead(302, { Location: "/admin-login.html", "Cache-Control": "no-store" });
    return res.end();
  }
  if (isAdminAssetPath(pathName) && !authenticated) {
    res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    return res.end("Unauthorized");
  }

  const resolved = resolvePublicPath(pathName);
  if (!resolved) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const stat = await fsp.stat(resolved);
    if (stat.isFile()) {
      if (req.method === "HEAD") {
        const ext = path.extname(resolved).toLowerCase();
        const type = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
        return res.end();
      }
      return sendFile(res, resolved);
    }
  } catch {
    // continue to 404
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

server.listen(PORT, HOST, async () => {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const catalogs = await readCatalogs();
  await writeCatalogs(catalogs);
  console.log(`CKM server running on http://${HOST}:${PORT}`);
  console.log(`Catalog file: ${CATALOG_FILE}`);
});
