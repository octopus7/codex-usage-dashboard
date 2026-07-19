const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const USAGE_TYPES = ["5h", "week"];
const MAX_BATCH_SIZE = 100;
const MAX_QUERY_RANGE_SECONDS = 366 * 24 * 60 * 60;
const MAX_SERIES_POINTS_PER_TYPE = 1200;
const MAX_TABLE_ROWS = 300;
const SESSION_COOKIE_NAME = "codex_admin_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 128;
const PBKDF2_ITERATIONS = 30_000;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCK_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;

const STATIC_SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

const SELECT_COLUMNS = `
  id,
  usage_type AS usageType,
  recorded_at AS recordedAt,
  used_percent AS usedPercent,
  source,
  external_id AS externalId,
  note,
  metadata_json AS metadataJson,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const OUTER_COLUMNS = `
  id,
  usageType,
  recordedAt,
  usedPercent,
  source,
  externalId,
  note,
  metadataJson,
  createdAt,
  updatedAt
`;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
        return new Response(null, { status: 204, headers: JSON_HEADERS });
      }

      if (url.pathname.startsWith("/api/")) {
        return await routeApi(request, env, url);
      }

      return withStaticSecurityHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error("Unhandled error", error);
      return jsonResponse(
        { ok: false, error: "internal_error", message: "서버 처리 중 오류가 발생했습니다." },
        500
      );
    }
  }
};

async function routeApi(request, env, url) {
  if (!env.DB) {
    return jsonResponse(
      { ok: false, error: "database_not_configured", message: "D1 바인딩 DB가 설정되지 않았습니다." },
      500
    );
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    await env.DB.batch([
      env.DB.prepare("SELECT usage_type FROM codex_usage LIMIT 0"),
      env.DB.prepare("SELECT id FROM admin_credentials LIMIT 0"),
      env.DB.prepare("SELECT token_hash FROM admin_sessions LIMIT 0")
    ]);
    return jsonResponse({
      ok: true,
      service: "codex-usage-dashboard",
      schema: "dual-series-percent-only-v2",
      usageTypes: USAGE_TYPES,
      now: Math.floor(Date.now() / 1000)
    });
  }

  if (request.method === "GET" && url.pathname === "/api/admin/status") {
    return getAdminStatus(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/setup") {
    if (!isSameOriginRequest(request)) return forbiddenOrigin();
    return setupAdmin(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    if (!isSameOriginRequest(request)) return forbiddenOrigin();
    return loginAdmin(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    if (!isSameOriginRequest(request)) return forbiddenOrigin();
    return logoutAdmin(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/usage") {
    return getUsage(env, url);
  }

  if (request.method === "POST" && url.pathname === "/api/usage") {
    const authorized = await authorizeBearer(request, [env.INGEST_TOKEN]);
    if (!authorized) return ingestUnauthorized();
    return insertUsage(request, env, false);
  }

  if (request.method === "POST" && url.pathname === "/api/usage/manual") {
    if (!isSameOriginRequest(request)) return forbiddenOrigin();
    const session = await requireAdminSession(request, env);
    if (!session) return adminUnauthorized();
    return insertUsage(request, env, true);
  }

  const deleteMatch = url.pathname.match(/^\/api\/usage\/(\d+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    if (!isSameOriginRequest(request)) return forbiddenOrigin();
    const session = await requireAdminSession(request, env);
    if (!session) return adminUnauthorized();
    return deleteUsage(env, Number(deleteMatch[1]));
  }

  return jsonResponse(
    { ok: false, error: "not_found", message: "API 경로를 찾을 수 없습니다." },
    404
  );
}

async function getUsage(env, url) {
  const now = Math.floor(Date.now() / 1000);
  const end = parseInteger(url.searchParams.get("end"), now);
  const start = parseInteger(url.searchParams.get("start"), end - 24 * 60 * 60);
  const bucket = parseInteger(url.searchParams.get("bucket"), 0);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
    return jsonResponse(
      { ok: false, error: "invalid_range", message: "start는 end보다 작은 Unix 초 단위 정수여야 합니다." },
      400
    );
  }

  if (end - start > MAX_QUERY_RANGE_SECONDS) {
    return jsonResponse(
      { ok: false, error: "range_too_large", message: "한 번에 조회할 수 있는 최대 범위는 366일입니다." },
      400
    );
  }

  if (!Number.isInteger(bucket) || bucket < 0 || bucket > 7 * 24 * 60 * 60) {
    return jsonResponse(
      { ok: false, error: "invalid_bucket", message: "bucket 값이 올바르지 않습니다." },
      400
    );
  }

  const statements = [];

  for (const usageType of USAGE_TYPES) {
    statements.push(
      env.DB.prepare(`
        SELECT ${SELECT_COLUMNS}
        FROM codex_usage
        WHERE usage_type = ? AND recorded_at < ?
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1
      `).bind(usageType, start)
    );

    if (bucket > 0) {
      statements.push(
        env.DB.prepare(`
          WITH source AS (
            SELECT
              ${SELECT_COLUMNS},
              CAST(recorded_at / ? AS INTEGER) AS bucketKey,
              used_percent AS progressValue,
              LAG(used_percent) OVER (ORDER BY recorded_at ASC, id ASC) AS previousProgress,
              LEAD(used_percent) OVER (ORDER BY recorded_at ASC, id ASC) AS nextProgress
            FROM codex_usage
            WHERE usage_type = ?
              AND recorded_at >= ?
              AND recorded_at < ?
          ),
          ranked AS (
            SELECT
              *,
              ROW_NUMBER() OVER (
                PARTITION BY bucketKey
                ORDER BY recordedAt DESC, id DESC
              ) AS bucketRank,
              ROW_NUMBER() OVER (
                ORDER BY recordedAt ASC, id ASC
              ) AS firstRank,
              ROW_NUMBER() OVER (
                ORDER BY recordedAt DESC, id DESC
              ) AS lastRank
            FROM source
          )
          SELECT ${OUTER_COLUMNS}
          FROM ranked
          WHERE bucketRank = 1
             OR firstRank = 1
             OR lastRank = 1
             OR (previousProgress IS NOT NULL AND progressValue < previousProgress)
             OR (nextProgress IS NOT NULL AND nextProgress < progressValue)
          ORDER BY recordedAt ASC, id ASC
          LIMIT ?
        `).bind(bucket, usageType, start, end, MAX_SERIES_POINTS_PER_TYPE)
      );
    } else {
      statements.push(
        env.DB.prepare(`
          SELECT ${SELECT_COLUMNS}
          FROM codex_usage
          WHERE usage_type = ?
            AND recorded_at >= ?
            AND recorded_at < ?
          ORDER BY recorded_at ASC, id ASC
          LIMIT ?
        `).bind(usageType, start, end, MAX_SERIES_POINTS_PER_TYPE)
      );
    }
  }

  statements.push(
    env.DB.prepare(`
      SELECT ${SELECT_COLUMNS}
      FROM codex_usage
      WHERE recorded_at >= ? AND recorded_at < ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT ?
    `).bind(start, end, MAX_TABLE_ROWS)
  );

  statements.push(
    env.DB.prepare(`
      SELECT usage_type AS usageType, COUNT(*) AS count
      FROM codex_usage
      WHERE recorded_at >= ? AND recorded_at < ?
      GROUP BY usage_type
    `).bind(start, end)
  );

  const results = await env.DB.batch(statements);
  const series = Object.fromEntries(USAGE_TYPES.map((usageType) => [usageType, []]));
  const baselines = Object.fromEntries(USAGE_TYPES.map((usageType) => [usageType, null]));
  let cursor = 0;

  for (const usageType of USAGE_TYPES) {
    const carryResult = results[cursor++];
    const pointsResult = results[cursor++];
    baselines[usageType] = carryResult.results?.[0]
      ? normalizeRow(carryResult.results[0])
      : null;
    series[usageType] = (pointsResult.results || []).map(normalizeRow);
  }

  const entriesResult = results[cursor++];
  const countsResult = results[cursor++];
  const entries = (entriesResult.results || []).map(normalizeRow);
  const counts = Object.fromEntries(USAGE_TYPES.map((usageType) => [usageType, 0]));

  for (const row of countsResult.results || []) {
    if (USAGE_TYPES.includes(row.usageType)) counts[row.usageType] = Number(row.count || 0);
  }

  const summaries = Object.fromEntries(
    USAGE_TYPES.map((usageType) => [
      usageType,
      buildSummary(baselines[usageType], series[usageType], counts[usageType])
    ])
  );
  const totalCount = USAGE_TYPES.reduce((sum, usageType) => sum + counts[usageType], 0);

  return jsonResponse({
    ok: true,
    range: { start, end, bucket },
    usageTypes: USAGE_TYPES,
    series,
    baselines,
    summaries,
    entries,
    counts,
    totalCount,
    entriesTruncated: totalCount > entries.length
  });
}

async function insertUsage(request, env, manual) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      { ok: false, error: "invalid_json", message: "JSON 요청 본문이 필요합니다." },
      400
    );
  }

  let items;
  if (Array.isArray(payload)) {
    items = payload;
  } else if (Array.isArray(payload?.items)) {
    items = payload.items;
  } else {
    items = [payload];
  }

  if (items.length === 0 || items.length > MAX_BATCH_SIZE) {
    return jsonResponse(
      {
        ok: false,
        error: "invalid_batch_size",
        message: `한 번에 1개부터 ${MAX_BATCH_SIZE}개까지 전송할 수 있습니다.`
      },
      400
    );
  }

  const idempotencyKey = request.headers.get("Idempotency-Key");
  const now = Math.floor(Date.now() / 1000);
  const normalized = [];

  try {
    for (let index = 0; index < items.length; index += 1) {
      normalized.push(
        normalizeInput(items[index], {
          now,
          manual,
          idempotencyKey: items.length === 1 ? idempotencyKey : null
        })
      );
    }
  } catch (error) {
    return jsonResponse(
      { ok: false, error: "validation_error", message: error.message },
      400
    );
  }

  const sql = `
    INSERT INTO codex_usage (
      usage_type, recorded_at, used_percent, source, external_id, note,
      metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(usage_type, source, external_id) DO UPDATE SET
      recorded_at = excluded.recorded_at,
      used_percent = excluded.used_percent,
      note = excluded.note,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `;

  const statements = normalized.map((item) =>
    env.DB.prepare(sql).bind(
      item.usageType,
      item.recordedAt,
      item.usedPercent,
      item.source,
      item.externalId,
      item.note,
      item.metadataJson,
      now,
      now
    )
  );

  const results = await env.DB.batch(statements);

  return jsonResponse(
    {
      ok: true,
      accepted: normalized.length,
      acceptedByType: normalized.reduce(
        (totals, item) => ({ ...totals, [item.usageType]: totals[item.usageType] + 1 }),
        { "5h": 0, week: 0 }
      ),
      ids: results
        .map((result) => result.meta?.last_row_id)
        .filter((value) => value !== undefined && value !== null)
    },
    201
  );
}

async function deleteUsage(env, id) {
  if (!Number.isSafeInteger(id) || id <= 0) {
    return jsonResponse(
      { ok: false, error: "invalid_id", message: "삭제할 ID가 올바르지 않습니다." },
      400
    );
  }

  const existing = await env.DB.prepare(`
    SELECT id, usage_type AS usageType
    FROM codex_usage
    WHERE id = ?
  `).bind(id).first();

  if (!existing) {
    return jsonResponse(
      { ok: false, error: "not_found", message: "삭제할 데이터를 찾지 못했습니다." },
      404
    );
  }

  await env.DB.prepare("DELETE FROM codex_usage WHERE id = ?").bind(id).run();

  return jsonResponse({
    ok: true,
    deletedId: id,
    usageType: existing.usageType
  });
}

function normalizeInput(input, options) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("각 데이터 항목은 JSON 객체여야 합니다.");
  }

  const usageType = normalizeUsageType(input.usageType ?? input.usage_type);
  const recordedAt = parseTimestamp(input.recordedAt ?? input.recorded_at, options.now);

  const rawUsedPercent = input.usedPercent ?? input.used_percent;
  if (rawUsedPercent === undefined || rawUsedPercent === null || rawUsedPercent === "") {
    throw new Error("usedPercent가 필요합니다.");
  }

  const usedPercent = finiteNumber(rawUsedPercent, null, "usedPercent");
  if (usedPercent < 0 || usedPercent > 100) {
    throw new Error("usedPercent는 0 이상 100 이하여야 합니다.");
  }

  const source = truncateString(
    options.manual ? (input.source || "manual") : (input.source || "external"),
    64
  );
  const externalId = truncateString(
    input.externalId ?? input.external_id ?? options.idempotencyKey ?? null,
    160
  );
  const note = truncateString(input.note ?? null, 1000);
  const metadataJson = serializeMetadata(input.metadata);
  if (!source) throw new Error("source 값이 비어 있습니다.");

  return { usageType, recordedAt, usedPercent, source, externalId, note, metadataJson };
}

function normalizeUsageType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "weekly") return "week";
  if (normalized === "5-hour" || normalized === "5hour") return "5h";
  if (!USAGE_TYPES.includes(normalized)) {
    throw new Error('usageType은 "5h" 또는 "week"여야 합니다.');
  }
  return normalized;
}

function normalizeRow(row) {
  return {
    ...row,
    id: Number(row.id),
    recordedAt: Number(row.recordedAt),
    usedPercent: row.usedPercent === null ? null : Number(row.usedPercent),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    metadata: parseMetadata(row.metadataJson)
  };
}

function buildSummary(carry, points, eventCount) {
  const startState = carry || points[0] || null;
  const latest = points[points.length - 1] || carry || null;
  if (!latest) {
    return { startState: null, latest: null, eventCount, carriedAtStart: false, utilizationPercent: null, utilizationChange: null };
  }
  const startPercent = utilizationPercent(startState);
  const latestPercent = utilizationPercent(latest);
  return {
    startState, latest, eventCount, carriedAtStart: Boolean(carry),
    utilizationPercent: latestPercent,
    utilizationChange: startPercent !== null && latestPercent !== null ? latestPercent - startPercent : null
  };
}

function utilizationPercent(row) {
  if (!row || row.usedPercent === null || row.usedPercent === undefined) return null;
  return row.usedPercent;
}

async function getAdminStatus(request, env) {
  const credential = await env.DB.prepare(
    "SELECT id FROM admin_credentials WHERE id = 1"
  ).first();
  const session = credential ? await getAdminSession(request, env) : null;

  return jsonResponse({
    ok: true,
    configured: Boolean(credential),
    authenticated: Boolean(session),
    sessionExpiresAt: session?.expiresAt ?? null,
    passwordMinLength: PASSWORD_MIN_LENGTH
  });
}

async function setupAdmin(request, env) {
  const existing = await env.DB.prepare(
    "SELECT id FROM admin_credentials WHERE id = 1"
  ).first();

  if (existing) {
    return jsonResponse(
      {
        ok: false,
        error: "admin_already_configured",
        message: "관리자 비밀번호가 이미 설정되어 있습니다. 로그인해 주세요."
      },
      409
    );
  }

  const passwordResult = await readPasswordRequest(request);
  if (passwordResult.response) return passwordResult.response;

  const now = Math.floor(Date.now() / 1000);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePasswordHash(
    passwordResult.password,
    salt,
    PBKDF2_ITERATIONS
  );

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO admin_credentials (
      id,
      password_hash,
      password_salt,
      password_iterations,
      created_at,
      updated_at
    ) VALUES (1, ?, ?, ?, ?, ?)
  `).bind(
    bytesToBase64Url(passwordHash),
    bytesToBase64Url(salt),
    PBKDF2_ITERATIONS,
    now,
    now
  ).run();

  if (!result.meta?.changes) {
    return jsonResponse(
      {
        ok: false,
        error: "admin_already_configured",
        message: "다른 요청에서 관리자 비밀번호 설정이 완료되었습니다. 로그인해 주세요."
      },
      409
    );
  }

  await cleanupAuthTables(env, now);
  const session = await createAdminSession(env, now);

  return jsonResponse(
    {
      ok: true,
      configured: true,
      authenticated: true,
      sessionExpiresAt: session.expiresAt,
      message: "관리자 비밀번호를 설정하고 로그인했습니다."
    },
    201,
    { "Set-Cookie": buildSessionCookie(request, session.token, SESSION_TTL_SECONDS) }
  );
}

async function loginAdmin(request, env) {
  const credential = await env.DB.prepare(`
    SELECT
      password_hash AS passwordHash,
      password_salt AS passwordSalt,
      password_iterations AS passwordIterations
    FROM admin_credentials
    WHERE id = 1
  `).first();

  if (!credential) {
    return jsonResponse(
      {
        ok: false,
        error: "admin_not_configured",
        message: "관리자 비밀번호가 아직 없습니다. 최초 비밀번호를 설정해 주세요."
      },
      409
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const clientKey = await getLoginClientKey(request);
  const rateLimit = await getLoginRateLimit(env, clientKey, now);

  if (rateLimit.lockedUntil > now) {
    const retryAfterSeconds = Math.max(1, rateLimit.lockedUntil - now);
    return jsonResponse(
      {
        ok: false,
        error: "login_rate_limited",
        message: "로그인 실패가 반복되어 잠시 차단되었습니다.",
        retryAfterSeconds
      },
      429,
      { "Retry-After": String(retryAfterSeconds) }
    );
  }

  const passwordResult = await readPasswordRequest(request);
  if (passwordResult.response) return passwordResult.response;

  let suppliedHash;
  let expectedHash;
  try {
    suppliedHash = await derivePasswordHash(
      passwordResult.password,
      base64UrlToBytes(String(credential.passwordSalt)),
      Number(credential.passwordIterations)
    );
    expectedHash = base64UrlToBytes(String(credential.passwordHash));
  } catch (error) {
    console.error("Stored administrator credential is invalid", error);
    return jsonResponse(
      {
        ok: false,
        error: "credential_error",
        message: "저장된 관리자 인증정보를 읽을 수 없습니다. README의 비밀번호 초기화 절차를 확인하세요."
      },
      500
    );
  }

  if (!timingSafeEqualBytes(suppliedHash, expectedHash)) {
    const failure = await recordLoginFailure(env, clientKey, now);
    const locked = failure.lockedUntil > now;
    return jsonResponse(
      {
        ok: false,
        error: locked ? "login_rate_limited" : "invalid_password",
        message: locked
          ? "로그인 실패가 반복되어 잠시 차단되었습니다."
          : "비밀번호가 올바르지 않습니다.",
        attemptsRemaining: Math.max(0, LOGIN_MAX_FAILURES - failure.failedCount),
        retryAfterSeconds: locked ? failure.lockedUntil - now : null
      },
      locked ? 429 : 401,
      locked ? { "Retry-After": String(failure.lockedUntil - now) } : {}
    );
  }

  await Promise.all([
    clearLoginFailures(env, clientKey),
    cleanupAuthTables(env, now)
  ]);

  const session = await createAdminSession(env, now);
  return jsonResponse(
    {
      ok: true,
      configured: true,
      authenticated: true,
      sessionExpiresAt: session.expiresAt,
      message: "관리자로 로그인했습니다."
    },
    200,
    { "Set-Cookie": buildSessionCookie(request, session.token, SESSION_TTL_SECONDS) }
  );
}

async function logoutAdmin(request, env) {
  const token = getCookieValue(request, SESSION_COOKIE_NAME);
  if (token) {
    const tokenHash = await sha256Base64Url(token);
    await env.DB.prepare(
      "DELETE FROM admin_sessions WHERE token_hash = ?"
    ).bind(tokenHash).run();
  }

  return jsonResponse(
    { ok: true, configured: true, authenticated: false, message: "로그아웃했습니다." },
    200,
    { "Set-Cookie": clearSessionCookie(request) }
  );
}

async function requireAdminSession(request, env) {
  return getAdminSession(request, env);
}

async function getAdminSession(request, env) {
  const token = getCookieValue(request, SESSION_COOKIE_NAME);
  if (!token || token.length < 32 || token.length > 256) return null;

  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await sha256Base64Url(token);
  const session = await env.DB.prepare(`
    SELECT
      token_hash AS tokenHash,
      expires_at AS expiresAt,
      last_seen_at AS lastSeenAt
    FROM admin_sessions
    WHERE token_hash = ? AND expires_at > ?
  `).bind(tokenHash, now).first();

  if (!session) return null;

  const normalized = {
    tokenHash: String(session.tokenHash),
    expiresAt: Number(session.expiresAt),
    lastSeenAt: Number(session.lastSeenAt)
  };

  if (normalized.lastSeenAt < now - 15 * 60) {
    await env.DB.prepare(`
      UPDATE admin_sessions
      SET last_seen_at = ?
      WHERE token_hash = ?
    `).bind(now, normalized.tokenHash).run();
    normalized.lastSeenAt = now;
  }

  return normalized;
}

async function createAdminSession(env, now) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await sha256Base64Url(token);
  const expiresAt = now + SESSION_TTL_SECONDS;

  await env.DB.prepare(`
    INSERT INTO admin_sessions (
      token_hash,
      created_at,
      expires_at,
      last_seen_at
    ) VALUES (?, ?, ?, ?)
  `).bind(tokenHash, now, expiresAt, now).run();

  return { token, tokenHash, expiresAt };
}

async function readPasswordRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return {
      response: jsonResponse(
        { ok: false, error: "invalid_json", message: "JSON 요청 본문이 필요합니다." },
        400
      )
    };
  }

  const password = body?.password;
  if (typeof password !== "string") {
    return {
      response: jsonResponse(
        { ok: false, error: "invalid_password", message: "비밀번호를 입력하세요." },
        400
      )
    };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      response: jsonResponse(
        {
          ok: false,
          error: "password_too_short",
          message: `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`
        },
        400
      )
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      response: jsonResponse(
        {
          ok: false,
          error: "password_too_long",
          message: `비밀번호는 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다.`
        },
        400
      )
    };
  }

  if (!password.trim()) {
    return {
      response: jsonResponse(
        { ok: false, error: "invalid_password", message: "공백만으로 된 비밀번호는 사용할 수 없습니다." },
        400
      )
    };
  }

  return { password };
}

async function derivePasswordHash(password, salt, iterations) {
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 2_000_000) {
    throw new Error("Invalid PBKDF2 iteration count");
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

async function authorizeBearer(request, expectedTokens) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return false;

  const provided = header.slice("Bearer ".length).trim();
  if (!provided) return false;

  for (const expected of expectedTokens.filter(Boolean)) {
    if (await timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

async function timingSafeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(left))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(right)))
  ]);
  return timingSafeEqualBytes(new Uint8Array(leftDigest), new Uint8Array(rightDigest));
}

function timingSafeEqualBytes(left, right) {
  if (!left.length || !right.length) return false;
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (left[index % left.length] || 0) ^ (right[index % right.length] || 0);
  }
  return mismatch === 0;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(value))
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function getLoginClientKey(request) {
  const address =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown-client";
  return sha256Base64Url(`admin-login:${address}`);
}

async function getLoginRateLimit(env, clientKey, now) {
  const row = await env.DB.prepare(`
    SELECT
      failed_count AS failedCount,
      window_started_at AS windowStartedAt,
      locked_until AS lockedUntil
    FROM admin_login_attempts
    WHERE client_key = ?
  `).bind(clientKey).first();

  if (!row) return { failedCount: 0, windowStartedAt: now, lockedUntil: 0 };

  const normalized = {
    failedCount: Number(row.failedCount),
    windowStartedAt: Number(row.windowStartedAt),
    lockedUntil: Number(row.lockedUntil)
  };

  if (normalized.lockedUntil <= now && normalized.windowStartedAt < now - LOGIN_WINDOW_SECONDS) {
    await clearLoginFailures(env, clientKey);
    return { failedCount: 0, windowStartedAt: now, lockedUntil: 0 };
  }

  return normalized;
}

async function recordLoginFailure(env, clientKey, now) {
  const current = await getLoginRateLimit(env, clientKey, now);
  const withinWindow = current.windowStartedAt >= now - LOGIN_WINDOW_SECONDS;
  const failedCount = withinWindow ? current.failedCount + 1 : 1;
  const windowStartedAt = withinWindow ? current.windowStartedAt : now;
  const lockedUntil = failedCount >= LOGIN_MAX_FAILURES ? now + LOGIN_LOCK_SECONDS : 0;

  await env.DB.prepare(`
    INSERT INTO admin_login_attempts (
      client_key,
      failed_count,
      window_started_at,
      locked_until,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      failed_count = excluded.failed_count,
      window_started_at = excluded.window_started_at,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at
  `).bind(clientKey, failedCount, windowStartedAt, lockedUntil, now).run();

  return { failedCount, windowStartedAt, lockedUntil };
}

async function clearLoginFailures(env, clientKey) {
  await env.DB.prepare(
    "DELETE FROM admin_login_attempts WHERE client_key = ?"
  ).bind(clientKey).run();
}

async function cleanupAuthTables(env, now) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "DELETE FROM admin_login_attempts WHERE updated_at < ?"
    ).bind(now - 7 * 24 * 60 * 60)
  ]);
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const key = item.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function buildSessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`
  ].join("; ") + secure;
}

function clearSessionCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0"
  ].join("; ") + secure;
}

function isSameOriginRequest(request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === expectedOrigin;

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function ingestUnauthorized() {
  return jsonResponse(
    { ok: false, error: "unauthorized", message: "올바른 INGEST_TOKEN Bearer 토큰이 필요합니다." },
    401,
    { "WWW-Authenticate": "Bearer" }
  );
}

function adminUnauthorized() {
  return jsonResponse(
    { ok: false, error: "admin_login_required", message: "관리자 로그인이 필요합니다." },
    401
  );
}

function forbiddenOrigin() {
  return jsonResponse(
    { ok: false, error: "forbidden_origin", message: "같은 사이트에서 보낸 요청만 허용됩니다." },
    403
  );
}

function withStaticSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function parseInteger(value, fallback) {
  if (value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? number : Number.NaN;
}

function parseTimestamp(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;

  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
    if (seconds <= 0) throw new Error("recordedAt 시간이 올바르지 않습니다.");
    return seconds;
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() && Number.isFinite(numeric)) {
      return parseTimestamp(numeric, fallback);
    }

    const milliseconds = Date.parse(value);
    if (!Number.isNaN(milliseconds)) return Math.floor(milliseconds / 1000);
  }

  throw new Error("recordedAt은 ISO 8601 문자열 또는 Unix timestamp여야 합니다.");
}

function finiteNumber(value, fallback, fieldName) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} 값이 숫자가 아닙니다.`);
  return number;
}

function optionalFiniteNumber(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  return finiteNumber(value, null, fieldName);
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${fieldName} 값은 0 이상의 정수여야 합니다.`);
  }
  return number;
}

function truncateString(value, maxLength) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, maxLength) || null;
}

function serializeMetadata(value) {
  if (value === undefined || value === null) return null;
  const serialized = JSON.stringify(value);
  if (serialized.length > 8192) throw new Error("metadata는 JSON 문자열 기준 8KB 이하여야 합니다.");
  return serialized;
}

function parseMetadata(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
