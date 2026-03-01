import { Bot } from "grammy";

import { safeErr } from "./lib/safeErr.js";
import {
  clearSession,
  getOrCreateSession,
  getSession,
  cleanupSessions,
} from "./lib/session.js";
import {
  keyboardForStep,
  parseCallback,
  promptText,
  AGE_RANGES,
  MCAP_RANGES,
} from "./lib/wizard.js";
import {
  findTokensWithFilters,
  dexscreenerUserMessage,
  fetchLatestDexPairs,
} from "./services/dexscreener.js";
import { formatTokensPage } from "./lib/format.js";
import { buildBotProfile } from "./botProfile.js";

const WELCOME_TEXT =
  "Welcome to Chain EX 🔍\nFind early tokens filtered by chain, age, market cap, and social presence.";

const NO_TOKENS_TEXT =
  "No tokens found with selected filters. Try widening age or market cap range.";

const NO_MORE_TEXT =
  "No more tokens match your filters. Try adjusting your criteria.";

const PAGE_SIZE = 10;

const botProfile = buildBotProfile();

function userIdOf(ctx) {
  return ctx?.from?.id;
}

function ensureSession(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return null;
  return getOrCreateSession(uid);
}

async function safeAnswerCb(ctx, text) {
  try {
    if (text) await ctx.answerCallbackQuery({ text });
    else await ctx.answerCallbackQuery();
  } catch {}
}

function parseAdminIds() {
  const raw = String(process.env.ADMIN_TELEGRAM_IDS || "").trim();
  if (!raw) return { enabled: false, ids: new Set() };
  const ids = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return { enabled: ids.size > 0, ids };
}

function chainToDex(chain) {
  const c = String(chain || "").toUpperCase();
  if (c === "ETH") return "ethereum";
  if (c === "SOL") return "solana";
  if (c === "BSC") return "bsc";
  if (c === "BASE") return "base";
  return "";
}

async function sendOrEditStep(ctx, step) {
  const uid = userIdOf(ctx);
  if (!uid) return;

  const s = getOrCreateSession(uid);

  // Harden session state
  s.step = Number(step) || 1;
  s.flowId = String(s.flowId || "");
  s.updatedAtMs = Date.now();

  const text = promptText(s.step);
  const kb = keyboardForStep(s.step, s.flowId);

  // Prefer editing the wizard message (less clutter). If edit fails, send a new one.
  try {
    if (s.lastWizardMessageId && ctx.chat?.id) {
      await ctx.api.editMessageText(ctx.chat.id, s.lastWizardMessageId, text, {
        reply_markup: kb,
      });
      return;
    }
  } catch (e) {
    console.warn("[wizard] edit failed, sending new", { err: safeErr(e) });
  }

  const m = await ctx.reply(text, { reply_markup: kb });
  s.lastWizardMessageId = m?.message_id;
}

function newFlowId() {
  return String(Date.now()) + ":" + String(Math.floor(Math.random() * 100000));
}

async function startWizard(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;

  console.log("[cmd] /start", { userId: uid });

  // /start clears search state and sends welcome message
  clearSession(uid);
  const s = getOrCreateSession(uid);
  s.flowId = newFlowId();
  s.step = 1;

  await ctx.reply(WELCOME_TEXT);
  await sendOrEditStep(ctx, 1);
}

async function restartWizard(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;

  console.log("[cmd] /restart", { userId: uid });

  // /restart clears current session state and starts step 1 without re-sending welcome
  clearSession(uid);
  const s = getOrCreateSession(uid);
  s.flowId = newFlowId();
  s.step = 1;

  await sendOrEditStep(ctx, 1);
}

async function showNextPage(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;
  console.log("[cmd] /next", { userId: uid });

  const s = getSession(uid);
  if (!s || !Array.isArray(s.results) || s.results.length === 0) {
    await ctx.reply("Run /start to begin a new search.");
    return;
  }

  const start = Number(s.pageIndex || 0) * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  const page = s.results.slice(start, end);
  if (page.length === 0) {
    await ctx.reply(NO_MORE_TEXT);
    return;
  }

  const txt = formatTokensPage(page);
  await ctx.reply(txt);

  s.pageIndex = Number(s.pageIndex || 0) + 1;
  s.updatedAtMs = Date.now();

  if (end < s.results.length) {
    await ctx.reply("Type /next to see more results.");
  }
}

async function computeResults(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;

  const s = getSession(uid);
  if (!s) return;

  // per-user in-flight guard
  if (s.fetching) {
    await safeAnswerCb(ctx, "Working on your search…");
    return;
  }

  s.fetching = true;
  s.updatedAtMs = Date.now();

  console.log("[wizard] fetch begin", {
    userId: uid,
    chain: s.selectedChain,
    age: s.selectedAgeRange,
    mcap: s.selectedMarketCapRange,
    requireTelegram: s.requireTelegram,
    requireDiscord: s.requireDiscord,
    requireWebsite: s.requireWebsite,
  });

  try {
    await safeAnswerCb(ctx);
    await ctx.reply("Fetching tokens…");

    const res = await findTokensWithFilters(s);

    if (!res.ok) {
      console.warn("[wizard] fetch error", {
        userId: uid,
        errorType: res.errorType,
        status: res.status || null,
      });

      // If there is already cached results, keep them and allow /next to paginate.
      const haveCached = Array.isArray(s.results) && s.results.length > 0;
      if (haveCached) {
        await ctx.reply(dexscreenerUserMessage(res));
        return;
      }

      await ctx.reply(dexscreenerUserMessage(res) + " You can try /restart.");
      return;
    }

    const results = Array.isArray(res.data) ? res.data : [];

    s.results = results;
    s.pageIndex = 0;

    if (s.results.length === 0) {
      console.log("[wizard] fetch done (empty)", { userId: uid });
      await ctx.reply(NO_TOKENS_TEXT);
      return;
    }

    console.log("[wizard] fetch done", { userId: uid, results: s.results.length });

    const first = s.results.slice(0, PAGE_SIZE);
    await ctx.reply(formatTokensPage(first));

    s.pageIndex = 1;

    if (s.results.length > PAGE_SIZE) {
      await ctx.reply("Type /next to see more results.");
    }
  } catch (e) {
    console.warn("[wizard] fetch exception", { userId: uid, err: safeErr(e) });

    const haveCached = Array.isArray(s.results) && s.results.length > 0;
    if (haveCached) {
      await ctx.reply("DexScreener is taking too long to respond right now. Please try again in a moment.");
      return;
    }

    await ctx.reply("DexScreener is taking too long to respond right now. Please try again in a moment. You can try /restart.");
  } finally {
    s.fetching = false;
    s.updatedAtMs = Date.now();
  }
}

function rePromptCurrentStep(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;
  const s = getOrCreateSession(uid);
  const step = Number(s.step || 1);
  return sendOrEditStep(ctx, step);
}

export function createBot(token) {
  const bot = new Bot(token);

  // Lightweight memory log and session cleanup
  setInterval(() => {
    cleanupSessions({ maxAgeMs: 60 * 60 * 1000 });
    const m = process.memoryUsage();
    console.log("[mem]", {
      rssMB: Math.round(m.rss / 1e6),
      heapUsedMB: Math.round(m.heapUsed / 1e6),
    });
  }, 60_000).unref();

  // Commands MUST be registered before callbacks/catch-alls.
  bot.command("start", async (ctx) => startWizard(ctx));

  bot.command("help", async (ctx) => {
    const uid = userIdOf(ctx);
    console.log("[cmd] /help", { userId: uid });
    await ctx.reply(
      "Chain EX helps you find early tokens with filters. Run /start (or /restart) to begin, tap the buttons to choose filters, then use /next to see more results."
    );
  });

  bot.command("restart", async (ctx) => restartWizard(ctx));
  bot.command("next", async (ctx) => showNextPage(ctx));

  bot.command("dexhealth", async (ctx) => {
    const uid = String(userIdOf(ctx) || "");
    const admin = parseAdminIds();

    console.log("[cmd] /dexhealth", {
      userId: uid || null,
      adminEnabled: admin.enabled,
    });

    if (!admin.enabled) {
      await ctx.reply("Admin features are disabled.");
      return;
    }

    if (!uid || !admin.ids.has(uid)) {
      await ctx.reply("Not authorized.");
      return;
    }

    const s = getSession(uid);
    const chain = s?.selectedChain || "ETH";
    const dexChain = chainToDex(chain) || "ethereum";

    const started = Date.now();
    const res = await fetchLatestDexPairs(dexChain);
    const latencyMs = Date.now() - started;

    if (res.ok) {
      const pairsCount = Array.isArray(res.data?.pairs) ? res.data.pairs.length : 0;
      await ctx.reply(`OK latencyMs=${latencyMs} pairs=${pairsCount}`);
      return;
    }

    await ctx.reply(
      `FAIL errorType=${String(res.errorType || "UNKNOWN")} status=${res.status || "(none)"} latencyMs=${latencyMs}`
    );
  });

  // Callback handler for wizard
  bot.on("callback_query:data", async (ctx) => {
    const uid = userIdOf(ctx);
    const data = ctx.callbackQuery?.data;

    if (!uid) {
      await safeAnswerCb(ctx);
      return;
    }

    const parsed = parseCallback(data);
    if (!parsed) {
      console.log("[wizard] unknown callback", { userId: uid });
      await safeAnswerCb(ctx, "That menu is outdated. Use /restart.");
      await rePromptCurrentStep(ctx);
      return;
    }

    const s = ensureSession(ctx);
    if (!s) {
      await safeAnswerCb(ctx);
      return;
    }

    // Defensive session hardening
    s.flowId = String(s.flowId || "");
    s.step = Number(s.step || 1);

    console.log("[wizard] callback", {
      userId: uid,
      flowId: parsed.flowId,
      step: parsed.step,
      key: parsed.key,
      val: parsed.val,
      currentStep: s.step,
    });

    // flowId mismatch: user clicked old buttons
    if (String(parsed.flowId) !== String(s.flowId)) {
      await safeAnswerCb(ctx, "That menu is outdated. Use /restart.");
      await rePromptCurrentStep(ctx);
      return;
    }

    // Out-of-order presses: recover by re-sending current prompt
    if (Number(parsed.step) !== Number(s.step)) {
      await safeAnswerCb(ctx);
      await rePromptCurrentStep(ctx);
      return;
    }

    // Apply selection for current step
    try {
      if (s.step === 1 && parsed.key === "chain") {
        s.selectedChain = String(parsed.val || "");
        s.step = 2;
        await safeAnswerCb(ctx);
        await sendOrEditStep(ctx, 2);
        return;
      }

      if (s.step === 2 && parsed.key === "age") {
        const idx = Number(parsed.val);
        const label = AGE_RANGES[idx];
        if (!label) {
          await safeAnswerCb(ctx, "That menu is outdated. Use /restart.");
          await rePromptCurrentStep(ctx);
          return;
        }
        s.selectedAgeRange = label;
        s.step = 3;
        await safeAnswerCb(ctx);
        await sendOrEditStep(ctx, 3);
        return;
      }

      if (s.step === 3 && parsed.key === "mcap") {
        const idx = Number(parsed.val);
        const label = MCAP_RANGES[idx];
        if (!label) {
          await safeAnswerCb(ctx, "That menu is outdated. Use /restart.");
          await rePromptCurrentStep(ctx);
          return;
        }
        s.selectedMarketCapRange = label;
        s.step = 4;
        await safeAnswerCb(ctx);
        await sendOrEditStep(ctx, 4);
        return;
      }

      if (s.step === 4 && parsed.key === "tel") {
        s.requireTelegram = String(parsed.val) === "1";
        s.step = 5;
        await safeAnswerCb(ctx);
        await sendOrEditStep(ctx, 5);
        return;
      }

      if (s.step === 5 && parsed.key === "disc") {
        s.requireDiscord = String(parsed.val) === "1";
        s.step = 6;
        await safeAnswerCb(ctx);
        await sendOrEditStep(ctx, 6);
        return;
      }

      if (s.step === 6 && parsed.key === "web") {
        s.requireWebsite = String(parsed.val) === "1";
        await computeResults(ctx);
        return;
      }

      await safeAnswerCb(ctx);
      await rePromptCurrentStep(ctx);
    } catch (e) {
      console.warn("[wizard] callback handler error", { userId: uid, err: safeErr(e) });
      await safeAnswerCb(ctx);
      await rePromptCurrentStep(ctx);
    }
  });

  // Minimal fallback so the bot doesn't look dead if routing breaks.
  bot.on("message", async (ctx, next) => {
    const txt = ctx.message?.text;
    if (typeof txt === "string" && txt.startsWith("/")) return next();

    if (typeof txt === "string" && txt.trim()) {
      await ctx.reply("Use /start to begin.");
      return;
    }

    return next();
  });

  console.log("[bot] profile", { length: botProfile.length });

  return bot;
}
