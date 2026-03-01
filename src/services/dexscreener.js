import { safeErr } from "../lib/safeErr.js";
import { AGE_RANGES, MCAP_RANGES } from "../lib/wizard.js";

const API_BASE = "https://api.dexscreener.com";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const txOk = !!txns24 && ((txns24.buys || 0) + (txns24.sells || 0) > 0);

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
  // Deterministic tie-breaker: prefer higher liquidity, then higher 24h volume, then newest pair.
  const aL = a._liquidityUsd || 0;
  const bL = b._liquidityUsd || 0;
  if (aL !== bL) return aL > bL;

  const aV = a._volumeH24 || 0;
  const bV = b._volumeH24 || 0;
  if (aV !== bV) return aV > bV;

  const aT = a._pairCreatedAt || 0;
  const bT = b._pairCreatedAt || 0;
  if (aT !== bT) return aT > bT;

  // stable fallback
  return String(a._pairAddress || "") > String(b._pairAddress || "");
}

async function fetchJson(url, { timeoutMs = 15_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      const err = new Error("HTTP_" + r.status);
      err.response = { data: { message: txt || "Dexscreener error" } };
      throw err;
    }
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function findTokensWithFilters(filters, { maxCandidates = 200 } = {}) {
  const chain = String(filters?.selectedChain || "").toUpperCase();
  const dexChain = chainToDex(chain);
  if (!dexChain) return [];

  const ageLabel = String(filters?.selectedAgeRange || "");
  const mcapLabel = String(filters?.selectedMarketCapRange || "");

  const { minMs, maxMs } = ageWindowMs(ageLabel);
  const { min, max } = mcapWindow(mcapLabel);

  const requireTelegram = !!filters?.requireTelegram;
  const requireDiscord = !!filters?.requireDiscord;
  const requireWebsite = !!filters?.requireWebsite;

  const url = `${API_BASE}/latest/dex/pairs/${encodeURIComponent(dexChain)}`;

  console.log("[dex] fetch start", { chain, url });

  try {
    // Dexscreener can sometimes be flaky; do one retry on network errors.
    let json;
    try {
      json = await fetchJson(url, { timeoutMs: 15_000 });
    } catch (e) {
      console.warn("[dex] fetch retry", { chain, err: safeErr(e) });
      await sleep(750);
      json = await fetchJson(url, { timeoutMs: 15_000 });
    }

    const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
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
        // newest first, then liquidity desc, then volume desc
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

    console.log("[dex] fetch success", {
      chain,
      fetched: pairs.length,
      candidates: candidates.length,
      active,
      inAge,
      inMcap,
      socialOk,
      final: out.length,
      ageRange: AGE_RANGES.includes(ageLabel) ? ageLabel : "(unknown)",
      mcapRange: MCAP_RANGES.includes(mcapLabel) ? mcapLabel : "(unknown)",
    });

    return out;
  } catch (e) {
    console.warn("[dex] fetch failure", { chain, err: safeErr(e) });
    throw e;
  }
}
