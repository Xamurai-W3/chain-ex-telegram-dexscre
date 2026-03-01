import { Bot } from "grammy";

import { safeErr } from "./lib/safeErr.js";
import {
  clearSession,
  getOrCreateSession,
  getSession,
  cleanupSessions,
} from "./lib/session.js";
import { keyboardForStep, parseCallback, promptText, AGE_RANGES, MCAP_RANGES } from "./lib/wizard.js";
import { findTokensWithFilters } from "./services/dexscreener.js";
import { formatTokensPage } from "./lib/format.js";
import { buildBotProfile } from "./botProfile.js";

const WELCOME_TEXT =
  "Welcome to Chain EX 🔍\nFind early tokens filtered by chain, age, market cap, and social presence.";

const NO_TOKENS_TEXT =
  "No tokens found with selected filters. Try widening age or market cap range.";

const API_FAIL_TEXT =
  "Unable to fetch data from Dexscreener. Please try again later.";

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

async function sendOrEditStep(ctx, step) {
  const uid = userIdOf(ctx);
  if (!uid) return;
  const s = getOrCreateSession(uid);
  s.step = step;
  s.updatedAtMs = Date.now();

  const flowId = String(s.flowId || "");
  const text = promptText(step);
  const kb = keyboardForStep(step, flowId);

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

async function startWizard(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;

  clearSession(uid);
  const s = getOrCreateSession(uid);

  // flowId invalidates old callback buttons
  s.flowId = String(Date.now()) + ":" + String(Math.floor(Math.random() * 100000));
  s.step = 1;

  console.log("[cmd] /start", { userId: uid });
  await ctx.reply(WELCOME_TEXT);

  await sendOrEditStep(ctx, 1);
}

async function restartWizard(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;
  console.log("[cmd] /restart", { userId: uid });
  clearSession(uid);
  const s = getOrCreateSession(uid);
  s.flowId = String(Date.now()) + ":" + String(Math.floor(Math.random() * 100000));
  s.step = 1;
  await sendOrEditStep(ctx, 1);
}

async function showNextPage(ctx) {
  const uid = userIdOf(ctx);
  if (!uid) return;
  console.log("[cmd] /next", { userId: uid });

  const s = getSession(uid);
  if (!s || !Array.isArray(s.results) || s.results.length === 0) {
    // No explicit copy required by spec here; keep it short.
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

  // simple in-flight guard per user
  if (s.fetching) {
    await ctx.answerCallbackQuery({ text: "Working on your search…" }).catch(() => {});
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
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply("Fetching tokens…");

    const results = await findTokensWithFilters(s);

    s.results = results;
    s.pageIndex = 0;

    if (!results || results.length === 0) {
      console.log("[wizard] fetch done (empty)", { userId: uid });
      await ctx.reply(NO_TOKENS_TEXT);
      return;
    }

    console.log("[wizard] fetch done", { userId: uid, results: results.length });

    // First page
    const first = results.slice(0, PAGE_SIZE);
    await ctx.reply(formatTokensPage(first));

    s.pageIndex = 1;

    if (results.length > PAGE_SIZE) {
      await ctx.reply("Type /next to see more results.");
    }
  } catch (e) {
    console.warn("[wizard] fetch error", { userId: uid, err: safeErr(e) });
    await ctx.reply(API_FAIL_TEXT);
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

  // Memory log (lightweight) and session cleanup
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

  // Callback handler for wizard
  bot.on("callback_query:data", async (ctx) => {
    const uid = userIdOf(ctx);
    const data = ctx.callbackQuery?.data;

    if (!uid) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const parsed = parseCallback(data);
    if (!parsed) {
      console.log("[wizard] unknown callback", { userId: uid });
      await ctx.answerCallbackQuery().catch(() => {});
      await rePromptCurrentStep(ctx);
      return;
    }

    const s = ensureSession(ctx);
    if (!s) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

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
      await ctx.answerCallbackQuery({ text: "That menu is outdated. Use /restart." }).catch(() => {});
      await rePromptCurrentStep(ctx);
      return;
    }

    // out-of-order presses: recover by re-sending current prompt
    if (Number(parsed.step) !== Number(s.step)) {
      await ctx.answerCallbackQuery().catch(() => {});
      await rePromptCurrentStep(ctx);
      return;
    }

    // Apply selection for current step
    try {
      if (s.step === 1 && parsed.key === "chain") {
        s.selectedChain = String(parsed.val || "");
        s.step = 2;
        await ctx.answerCallbackQuery().catch(() => {});
        await sendOrEditStep(ctx, 2);
        return;
      }

      if (s.step === 2 && parsed.key === "age") {
        const idx = Number(parsed.val);
        const label = AGE_RANGES[idx];
        if (!label) {
          await ctx.answerCallbackQuery().catch(() => {});
          await rePromptCurrentStep(ctx);
          return;
        }
        s.selectedAgeRange = label;
        s.step = 3;
        await ctx.answerCallbackQuery().catch(() => {});
        await sendOrEditStep(ctx, 3);
        return;
      }

      if (s.step === 3 && parsed.key === "mcap") {
        const idx = Number(parsed.val);
        const label = MCAP_RANGES[idx];
        if (!label) {
          await ctx.answerCallbackQuery().catch(() => {});
          await rePromptCurrentStep(ctx);
          return;
        }
        s.selectedMarketCapRange = label;
        s.step = 4;
        await ctx.answerCallbackQuery().catch(() => {});
        await sendOrEditStep(ctx, 4);
        return;
      }

      if (s.step === 4 && parsed.key === "tel") {
        s.requireTelegram = String(parsed.val) === "1";
        s.step = 5;
        await ctx.answerCallbackQuery().catch(() => {});
        await sendOrEditStep(ctx, 5);
        return;
      }

      if (s.step === 5 && parsed.key === "disc") {
        s.requireDiscord = String(parsed.val) === "1";
        s.step = 6;
        await ctx.answerCallbackQuery().catch(() => {});
        await sendOrEditStep(ctx, 6);
        return;
      }

      if (s.step === 6 && parsed.key === "web") {
        s.requireWebsite = String(parsed.val) === "1";
        await computeResults(ctx);
        return;
      }

      await ctx.answerCallbackQuery().catch(() => {});
      await rePromptCurrentStep(ctx);
    } catch (e) {
      console.warn("[wizard] callback handler error", { userId: uid, err: safeErr(e) });
      await ctx.answerCallbackQuery().catch(() => {});
      await rePromptCurrentStep(ctx);
    }
  });

  // No AI, no catch-all text handler by design.
  // Keep profile constructed at runtime for future AI feature additions.
  console.log("[bot] profile", { length: botProfile.length });

  return bot;
}
