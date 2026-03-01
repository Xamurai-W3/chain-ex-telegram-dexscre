import { safeErr } from "../lib/safeErr.js";
import { AGE_RANGES, MCAP_RANGES } from "../lib/wizard.js";

const DEFAULT_BASE = "https://api.dexscreener.com";

function cfgNum(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function cfgStr(name, fallback) {
  const v = String(process.env[name] || "").trim();
  return v || fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowMs() {
  return Date.now();
}

function sanitizePathForLog(path) {
  const p = String(path || "");
  const q = p.indexOf("?");
  const base = q >= 0 ? p.slice(0, q) : p;
  if (base.length <= 200) return base;
  return base.slice(0, 200) + "…";
}

function parseRetryAfterSec(res) {
  const h = res?.headers?.get?.("retry-after");
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);

  const d = Date.parse(h);
  if (Number.isFinite(d)) {
    const sec = Math.round((d - Date.now()) / 1000);
    if (Number.isFinite(sec) && sec >= 0) return sec;
  }

  return null;
}

function normalizeError({ status, retryAfterSec, err }) {
  if (err?.name === "AbortError" || err?.code === "TIMEOUT") {
    return {
      ok: false,
      errorType: "TIMEOUT",
      status: status || null,
      retryAfterSec: retryAfterSec ?? null,
      message: "Request timed out",
    };
  }

  if (status === 429) {
    return {
      ok: false,
      errorType: "RATE_LIMIT",
      status,
      retryAfterSec: retryAfterSec ?? null,
      message: "Rate limited",
    };
  }

  if (status === 400) {
    return {
      ok: false,
      errorType: "BAD_REQUEST",
      status,
      retryAfterSec: null,
      message: "Bad request",
    };
  }

  if (status === 404) {
    return {
      ok: false,
      errorType: "NOT_FOUND",
      status,
      retryAfterSec: null,
      message: "Not found",
    };
  }

  if (typeof status === "number" && status >= 500 && status <= 599) {
    return {
      ok: false,
      errorType: "UPSTREAM_5XX",
      status,
      retryAfterSec: null,
      message: "Upstream server error",
    };
  }

  const msg = String(safeErr(err) || "");
  const lower = msg.toLowerCase();

  const networkHints = [
    "enotfound",
    "eai_again",
    "ecconnreset",
    "socket hang up",
    "fetch failed",
    "network",
  ];

  if (networkHints.some((h) => lower.includes(h))) {
    return {
      ok: false,
      errorType: "NETWORK",
      status: status || null,
      retryAfterSec: null,
      message: "Network error",
    };
  }

  return {
    ok: false,
    errorType: "UNKNOWN",
    status: status || null,
    retryAfterSec: null,
    message: "Unknown error",
  };
}

function isRetryable({ status, err }) {
  if (err?.name === "AbortError" || err?.code === "TIMEOUT") return true;

  // Network-ish failures
  const msg = String(safeErr(err) || "").toLowerCase();
  if (
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  ) {
    return true;
  }

  const s = Number(status);
  if (s === 429) return true;
  if (s === 502 || s === 503 || s === 504) return true;

  return false;
}

function backoffDelayMs({ baseDelayMs, attempt }) {
  const exp = baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.random() * 0.3 * exp;
  const d = exp + jitter;
  return Math.min(30_000, Math.round(d));
}

async function requestJson(operation, path, { timeoutMs, retryMax, retryBaseDelayMs } = {}) {
  const baseUrl = cfgStr("DEXSCREENER_BASE_URL", DEFAULT_BASE).replace(/\/+$/, "");
  const tMs = timeoutMs ?? cfgNum("DEXSCREENER_TIMEOUT_MS", 10_000);
  const rMax = retryMax ?? cfgNum("DEXSCREENER_RETRY_MAX", 2);
  const rBase = retryBaseDelayMs ?? cfgNum("DEXSCREENER_RETRY_BASE_DELAY_MS", 500);

  const url = baseUrl + path;
  const safePath = sanitizePathForLog(path);

  const started = nowMs();

  for (let attempt = 1; attempt <= rMax + 1; attempt++) {
    const attemptStart = nowMs();
    console.log("[dex] start", {
      op: operation,
      path: safePath,
      timeoutMs: tMs,
      attempt,
      maxAttempts: rMax + 1,
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), tMs);

    let res = null;
    let status = null;
    let retryAfterSec = null;

    try {
      res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: {
          accept: "application/json",
          "user-agent": "ChainEXBot/1.0",
        },
      });

      status = res.status;
      retryAfterSec = parseRetryAfterSec(res);

      const text = await res.text();

      if (!res.ok) {
        const err = new Error("HTTP_" + status);
        err.status = status;
        err.response = { data: { message: text?.slice?.(0, 500) || "" } };

        const latencyMs = nowMs() - attemptStart;
        console.warn("[dex] fail", {
          op: operation,
          path: safePath,
          status,
          latencyMs,
          attempt,
          err: safeErr(err),
          retryAfterSec: retryAfterSec ?? null,
        });

        if (attempt <= rMax && isRetryable({ status, err })) {
          const waitMs =
            status === 429 && typeof retryAfterSec === "number"
              ? Math.min(60_000, retryAfterSec * 1000)
              : backoffDelayMs({ baseDelayMs: rBase, attempt });
          await sleep(waitMs);
          continue;
        }

        return normalizeError({ status, retryAfterSec, err });
      }

      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (err) {
        const latencyMs = nowMs() - attemptStart;
        console.warn("[dex] fail", {
          op: operation,
          path: safePath,
          status,
          latencyMs,
          attempt,
          err: safeErr(err),
        });
        return {
          ok: false,
          errorType: "INVALID_RESPONSE",
          status,
          message: "Invalid JSON response",
          retryAfterSec: null,
        };
      }

      const latencyMs = nowMs() - attemptStart;

      // Basic schema guard: the bot expects { pairs: [] }
      const pairsCount = Array.isArray(json?.pairs) ? json.pairs.length : null;

      console.log("[dex] success", {
        op: operation,
        path: safePath,
        status,
        latencyMs,
        attempt,
        pairsCount,
        totalLatencyMs: nowMs() - started,
      });

      return { ok: true, data: json };
    } catch (err) {
      const latencyMs = nowMs() - attemptStart;
      const e = err;

      // Normalize AbortError to TIMEOUT
      if (e?.name === "AbortError") {
        e.code = "TIMEOUT";
      }

      console.warn("[dex] fail", {
        op: operation,
        path: safePath,
        status: status || null,
        latencyMs,
        attempt,
        err: safeErr(e),
      });

      if (attempt <= rMax && isRetryable({ status, err: e })) {
        const waitMs = backoffDelayMs({ baseDelayMs: rBase, attempt });
        await sleep(waitMs);
        continue;
      }

      return normalizeError({ status, retryAfterSec: null, err: e });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    errorType: "UNKNOWN",
    status: null,
    message: "Unknown error",
    retryAfterSec: null,
  };
}

function chainToDex(chain) {
  const c = String(chain || "").toUpperCase();
  if (c === "ETH") return "ethereum";
  if (c === "SOL") return "solana";
  if (c === "BSC") return "bsc";
  if (c === "BASE") return "base";
  return "";
}

function ageWindowMs(label) {
  const l = String(label || "");
  const day = 24 * 60 * 60 * 1000;
  if (l === "1 Day") return { minMs: 0, maxMs: 1 * day };
  if (l === "2–3 Days") return { minMs: 1 * day, maxMs: 3 * day };
  if (l === "4–7 Days") return { minMs: 3 * day, maxMs: 7 * day };
  if (l === "1–2 Weeks") return { minMs: 7 * day, maxMs: 14 * day };
  if (l === "2–4 Weeks") return { minMs: 14 * day, maxMs: 28 * day };
  if (l === "1–3 Months") return { minMs: 28 * day, maxMs: 90 * day };
  if (l === "3–6 Months") return { minMs: 90 * day, maxMs: 180 * day };
  if (l === "6–12 Months") return { minMs: 180 * day, maxMs: 365 * day };
  return { minMs: 0, maxMs: 365 * day };
}

function mcapWindow(label) {
  const l = String(label || "");
  const k = 1000;
  if (l === "10k–25k") return { min: 10 * k, max: 25 * k };
  if (l === "25k–50k") return { min: 25 * k, max: 50 * k };
  if (l === "50k–100k") return { min: 50 * k, max: 100 * k };
  if (l === "100k–250k") return { min: 100 * k, max: 250 * k };
  if (l === "250k–500k") return { min: 250 * k, max: 500 * k };
  return { min: 0, max: Number.POSITIVE_INFINITY };
}

function getCreatedAtMs(pair) {
  const v = pair?.pairCreatedAt;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isActivePair(pair) {
  const liqUsd = pair?.liquidity?.usd;
  const vol24 = pair?.volume?.h24;
  const txns24 = pair?.txns?.h24;

  const liquidityOk = typeof liqUsd === "number" && Number.isFinite(liqUsd) && liqUsd > 0;
  const volumeOk = typeof vol24 === "number" && Number.isFinite(vol24) && vol24 > 0;
  const txOk = !!txns24 && (Number(txns24.buys || 0) + Number(txns24.sells || 0) > 0);

  return liquidityOk && (volumeOk || txOk);
}

function pickSocialUrl(info, kind) {
  const socials = Array.isArray(info?.socials) ? info.socials : [];
  for (const s of socials) {
    const type = String(s?.type || "").toLowerCase();
    const url = String(s?.url || "");
    if (!url) continue;
    if (kind === "telegram" && type === "telegram") return url;
    if (kind === "discord" && type === "discord") return url;
  }
  return "";
}

function pickWebsiteUrl(info) {
  const websites = Array.isArray(info?.websites) ? info.websites : [];
  for (const w of websites) {
    const url = String(w?.url || "");
    if (url) return url;
  }
  return "";
}

function normalizePair(pair) {
  const baseToken = pair?.baseToken || {};
  const info = pair?.info || {};

  const chainId = String(pair?.chainId || "");
  const ca = String(baseToken?.address || "");
  const tokenName = String(baseToken?.name || baseToken?.symbol || "Unknown").trim() || "Unknown";
  const url = String(pair?.url || "").trim();

  const telegramUrl = pickSocialUrl(info, "telegram") || "";
  const discordUrl = pickSocialUrl(info, "discord") || "";
  const websiteUrl = pickWebsiteUrl(info) || "";

  return {
    chainId,
    tokenName,
    contractAddress: ca,
    dexscreenerUrl: url,
    telegramUrl: telegramUrl || undefined,
    discordUrl: discordUrl || undefined,
    websiteUrl: websiteUrl || undefined,
    _pairCreatedAt: getCreatedAtMs(pair),
    _marketCap: typeof pair?.marketCap === "number" ? pair.marketCap : null,
    _liquidityUsd: typeof pair?.liquidity?.usd === "number" ? pair.liquidity.usd : null,
    _volumeH24: typeof pair?.volume?.h24 === "number" ? pair.volume.h24 : null,
    _pairAddress: String(pair?.pairAddress || ""),
  };
}

function betterRep(a, b) {
  const aL = a._liquidityUsd || 0;
  const bL = b._liquidityUsd || 0;
  if (aL !== bL) return aL > bL;

  const aV = a._volumeH24 || 0;
  const bV = b._volumeH24 || 0;
  if (aV !== bV) return aV > bV;

  const aT = a._pairCreatedAt || 0;
  const bT = b._pairCreatedAt || 0;
  if (aT !== bT) return aT > bT;

  return String(a._pairAddress || "") > String(b._pairAddress || "");
}

function validatePairsSchema(json) {
  if (!json || typeof json !== "object") {
    return {
      ok: false,
      errorType: "INVALID_RESPONSE",
      status: null,
      message: "Missing JSON object",
      retryAfterSec: null,
    };
  }

  if (!Array.isArray(json.pairs)) {
    return {
      ok: false,
      errorType: "INVALID_RESPONSE",
      status: null,
      message: "Missing pairs[] in response",
      retryAfterSec: null,
    };
  }

  return { ok: true, data: json };
}

export function dexscreenerUserMessage(errResult) {
  const t = String(errResult?.errorType || "UNKNOWN");

  if (t === "TIMEOUT" || t === "NETWORK") {
    return "DexScreener is taking too long to respond right now. Please try again in a moment.";
  }

  if (t === "RATE_LIMIT") {
    const sec = Number(errResult?.retryAfterSec);
    if (Number.isFinite(sec) && sec > 0) {
      return `Rate limited by DexScreener. Please wait ${sec}s and try again.`;
    }
    return "Rate limited by DexScreener. Please wait a minute and try again.";
  }

  if (t === "UPSTREAM_5XX") {
    return "DexScreener is having issues (server error). Please try again shortly.";
  }

  if (t === "INVALID_RESPONSE") {
    return "Received an unexpected response from DexScreener. Please try again later.";
  }

  return "Unable to fetch data from DexScreener. Please try again later.";
}

export async function fetchLatestDexPairs(dexChain) {
  const path = `/latest/dex/pairs/${encodeURIComponent(dexChain)}`;
  const res = await requestJson("latest_dex_pairs", path);
  if (!res.ok) return res;

  const validated = validatePairsSchema(res.data);
  if (!validated.ok) return validated;

  return { ok: true, data: validated.data };
}

export async function findTokensWithFilters(filters, { maxCandidates = 200 } = {}) {
  const chain = String(filters?.selectedChain || "").toUpperCase();
  const dexChain = chainToDex(chain);
  if (!dexChain) return { ok: true, data: [] };

  const ageLabel = String(filters?.selectedAgeRange || "");
  const mcapLabel = String(filters?.selectedMarketCapRange || "");

  const { minMs, maxMs } = ageWindowMs(ageLabel);
  const { min, max } = mcapWindow(mcapLabel);

  const requireTelegram = !!filters?.requireTelegram;
  const requireDiscord = !!filters?.requireDiscord;
  const requireWebsite = !!filters?.requireWebsite;

  const fetched = await fetchLatestDexPairs(dexChain);
  if (!fetched.ok) return fetched;

  const pairs = Array.isArray(fetched?.data?.pairs) ? fetched.data.pairs : [];
  const candidates = pairs.slice(0, Math.max(0, maxCandidates));

  const now = Date.now();

  let active = 0;
  let inAge = 0;
  let inMcap = 0;
  let socialOk = 0;

  const dedup = new Map();

  for (const p of candidates) {
    if (!p || String(p.chainId || "").toLowerCase() !== dexChain) continue;

    if (!isActivePair(p)) continue;
    active++;

    const createdAt = getCreatedAtMs(p);
    if (!createdAt) continue;

    const ageMs = now - createdAt;
    if (!(ageMs >= minMs && ageMs <= maxMs)) continue;
    inAge++;

    const marketCap = typeof p?.marketCap === "number" ? p.marketCap : null;
    if (marketCap === null) continue;
    if (!(marketCap >= min && marketCap <= max)) continue;
    inMcap++;

    const n = normalizePair(p);

    if (requireTelegram && !n.telegramUrl) continue;
    if (requireDiscord && !n.discordUrl) continue;
    if (requireWebsite && !n.websiteUrl) continue;
    socialOk++;

    const ca = String(n.contractAddress || "").toLowerCase();
    if (!ca) continue;

    const key = dexChain + ":" + ca;
    const prev = dedup.get(key);
    if (!prev || betterRep(n, prev)) dedup.set(key, n);
  }

  const out = Array.from(dedup.values())
    .sort((a, b) => {
      const at = a._pairCreatedAt || 0;
      const bt = b._pairCreatedAt || 0;
      if (at !== bt) return bt - at;

      const al = a._liquidityUsd || 0;
      const bl = b._liquidityUsd || 0;
      if (al !== bl) return bl - al;

      const av = a._volumeH24 || 0;
      const bv = b._volumeH24 || 0;
      return bv - av;
    })
    .map((x) => ({
      tokenName: x.tokenName,
      contractAddress: x.contractAddress,
      dexscreenerUrl: x.dexscreenerUrl,
      telegramUrl: x.telegramUrl,
      discordUrl: x.discordUrl,
      websiteUrl: x.websiteUrl,
    }));

  console.log("[dex] filter summary", {
    chain,
    dexChain,
    fetchedPairs: pairs.length,
    candidates: candidates.length,
    active,
    inAge,
    inMcap,
    socialOk,
    final: out.length,
    ageRange: AGE_RANGES.includes(ageLabel) ? ageLabel : "(unknown)",
    mcapRange: MCAP_RANGES.includes(mcapLabel) ? mcapLabel : "(unknown)",
  });

  return { ok: true, data: out };
}
