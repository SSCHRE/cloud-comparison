/**
 * Report API for the cloud comparison site (the site itself stays on GitHub Pages).
 *
 *   POST   /api/reports              visitor sends a report (public). body.kind:
 *                                       "correction" (default): wrong info about a provider
 *                                       "general": suggestion, idea, bug report
 *   GET    /api/admin/reports        list all reports           (admin)
 *   POST   /api/admin/reports/<id>   { status: "pending" | "approved" | "denied" }  (admin)
 *   DELETE /api/admin/reports/<id>   (admin)
 *
 * Admin requests send "Authorization: Bearer <ADMIN_PASSWORD>"; the password is a Worker secret.
 * Reports live in the REPORTS KV namespace as "report:<id>".
 */

const MAX = {
  provider: 80,
  field: 80,
  current: 1000,
  correct: 1000,
  source: 500,
  notes: 2000,
  contact: 200,
  category: 80,
  message: 2000,
};
// Anti-spam limits, per visitor (hashed IP). Counters expire on their own via KV TTLs.
const HOURLY_LIMIT = 5; // any submissions per hour
const CORRECTIONS_PER_PROVIDER = 1; // per provider per day
const GENERAL_PER_DAY = 2; // suggestions / feedback per day
const HOUR = 3600;
const DAY = 86400;
const STATUSES = new Set(["pending", "approved", "denied"]);

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

function json(body, status, origin) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/** Constant-time comparison so the password can't be guessed from response timing. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return given.length > 0 && safeEqual(given, env.ADMIN_PASSWORD);
}

/**
 * One-way hash of the visitor's IP, so raw IP addresses are never stored.
 * Salted with a secret (IP_SALT if set, otherwise the admin password) so the hashes
 * can't be reversed by trying every possible IP.
 */
async function visitorId(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const salt = env.IP_SALT || env.ADMIN_PASSWORD || "";
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function readCount(env, key) {
  return Number((await env.REPORTS.get(key)) || 0);
}

async function createReport(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400, origin);
  }

  // Honeypot: real visitors never see or fill this field.
  if (body.website) return json({ ok: true }, 200, origin);

  const kind = body.kind === "general" ? "general" : "correction";
  const report = { kind };
  for (const [key, max] of Object.entries(MAX))
    report[key] = String(body[key] ?? "")
      .trim()
      .slice(0, max);
  if (kind === "correction" && (!report.provider || !report.correct)) {
    return json(
      { error: "Please pick a provider and say what's wrong." },
      400,
      origin,
    );
  }
  if (kind === "general" && !report.message) {
    return json({ error: "Please write a message." }, 400, origin);
  }
  if (report.source && !/^https?:\/\//i.test(report.source)) {
    return json(
      {
        error: "The source should be a link starting with http:// or https://.",
      },
      400,
      origin,
    );
  }

  // Check every limit before storing anything.
  const who = await visitorId(request, env);
  const hourlyKey = `limit:hour:${who}`;
  const kindKey =
    kind === "correction"
      ? `limit:provider:${who}:${report.provider.toLowerCase()}`
      : `limit:general:${who}`;
  const [hourly, kindCount] = await Promise.all([
    readCount(env, hourlyKey),
    readCount(env, kindKey),
  ]);
  if (hourly >= HOURLY_LIMIT) {
    return json(
      { error: "That's a lot of messages in a short time. Please wait an hour." },
      429,
      origin,
    );
  }
  if (kind === "correction" && kindCount >= CORRECTIONS_PER_PROVIDER) {
    return json(
      { error: `You've already reported ${report.provider} today. Thanks, I'll look into it!` },
      429,
      origin,
    );
  }
  if (kind === "general" && kindCount >= GENERAL_PER_DAY) {
    return json(
      { error: `You've already sent ${GENERAL_PER_DAY} messages today. Thanks! Please try again tomorrow.` },
      429,
      origin,
    );
  }

  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    id,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...report,
  };
  await env.REPORTS.put(`report:${id}`, JSON.stringify(record));
  await Promise.all([
    env.REPORTS.put(hourlyKey, String(hourly + 1), { expirationTtl: HOUR }),
    env.REPORTS.put(kindKey, String(kindCount + 1), { expirationTtl: DAY }),
  ]);
  return json({ ok: true, id }, 201, origin);
}

async function listReports(env) {
  const reports = [];
  let cursor;
  do {
    const page = await env.REPORTS.list({ prefix: "report:", cursor });
    const values = await Promise.all(
      page.keys.map((k) => env.REPORTS.get(k.name, "json")),
    );
    reports.push(...values.filter(Boolean));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function handleAdmin(request, env, origin, id) {
  if (!isAdmin(request, env)) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // slow down guessing
    return json({ error: "Wrong password." }, 401, origin);
  }

  if (!id) {
    if (request.method === "GET")
      return json({ reports: await listReports(env) }, 200, origin);
    return json({ error: "Method not allowed." }, 405, origin);
  }

  const key = `report:${id}`;
  const report = await env.REPORTS.get(key, "json");
  if (!report) return json({ error: "Report not found." }, 404, origin);

  if (request.method === "DELETE") {
    await env.REPORTS.delete(key);
    return json({ ok: true }, 200, origin);
  }
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400, origin);
    }
    if (!STATUSES.has(body.status))
      return json({ error: "Unknown status." }, 400, origin);
    const updated = {
      ...report,
      status: body.status,
      reviewedAt: new Date().toISOString(),
    };
    await env.REPORTS.put(key, JSON.stringify(updated));
    return json({ ok: true, report: updated }, 200, origin);
  }
  return json({ error: "Method not allowed." }, 405, origin);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      // Keep CORS headers on crashes so the site shows a real message, not "Failed to fetch".
      console.error(error);
      return json(
        { error: "Something went wrong on the server." },
        500,
        allowedOrigin(request, env),
      );
    }
  },
};

async function route(request, env) {
  const origin = allowedOrigin(request, env);
  const { pathname } = new URL(request.url);

  // CORS preflight (the admin requests send an Authorization header).
  if (request.method === "OPTIONS") {
    if (!origin) return new Response(null, { status: 403 });
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "86400",
        vary: "Origin",
      },
    });
  }

  // Browsers on other sites are refused; curl etc. have no Origin and still need the password for admin.
  if (request.headers.get("origin") && !origin)
    return json({ error: "Origin not allowed." }, 403, "");
  if (!env.REPORTS)
    return json({ error: "Storage is not configured." }, 500, origin);

  if (pathname === "/api/reports" && request.method === "POST")
    return createReport(request, env, origin);

  const admin = pathname.match(/^\/api\/admin\/reports(?:\/([^/]+))?\/?$/);
  if (admin)
    return handleAdmin(
      request,
      env,
      origin,
      admin[1] && decodeURIComponent(admin[1]),
    );

  return json({ error: "Not found." }, 404, origin);
}
