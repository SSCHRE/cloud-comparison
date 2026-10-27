/**
 * Report API for the cloud comparison site (the site itself stays on GitHub Pages).
 *
 *   POST   /api/reports              visitor reports wrong info (public)
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
};
const RATE_LIMIT = 5; // reports per IP per hour
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

async function createReport(request, env, origin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400, origin);
  }

  // Honeypot: real visitors never see or fill this field.
  if (body.website) return json({ ok: true }, 200, origin);

  const report = {};
  for (const [key, max] of Object.entries(MAX))
    report[key] = String(body[key] ?? "")
      .trim()
      .slice(0, max);
  if (!report.provider || !report.correct) {
    return json(
      { error: "Please pick a provider and say what's wrong." },
      400,
      origin,
    );
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

  const ip = request.headers.get("cf-connecting-ip") || "local";
  const rateKey = `rate:${ip}`;
  const count = Number((await env.REPORTS.get(rateKey)) || 0);
  if (count >= RATE_LIMIT) {
    return json(
      { error: "Too many reports from you in the last hour." },
      429,
      origin,
    );
  }
  await env.REPORTS.put(rateKey, String(count + 1), { expirationTtl: 3600 });

  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const record = {
    id,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...report,
  };
  await env.REPORTS.put(`report:${id}`, JSON.stringify(record));
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
