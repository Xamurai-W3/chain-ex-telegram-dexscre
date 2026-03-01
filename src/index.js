import "dotenv/config";

import { run } from "@grammyjs/runner";

import { cfg } from "./lib/config.js";
import { safeErr } from "./lib/safeErr.js";
import { createBot } from "./bot.js";

let startedAtMs = Date.now();

process.on("unhandledRejection", (r) => {
  console.error("[process] unhandledRejection", { err: safeErr(r) });
  // Keep process alive; runner loop will continue retrying.
});
process.on("uncaughtException", (e) => {
  console.error("[process] uncaughtException", { err: safeErr(e) });
  process.exit(1);
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isConflict409(e) {
  const msg = safeErr(e);
  return String(msg || "").includes("409") && String(msg || "").toLowerCase().includes("conflict");
}

async function boot() {
  startedAtMs = Date.now();

  console.log("[boot] start", {
    node: process.version,
    env: process.env.NODE_ENV || "(unset)",
    uptimeSec: Math.round(process.uptime()),
    TELEGRAM_BOT_TOKEN_set: !!cfg.TELEGRAM_BOT_TOKEN,
    DEXSCREENER_BASE_URL_set: !!String(process.env.DEXSCREENER_BASE_URL || "").trim(),
    ADMIN_TELEGRAM_IDS_set: !!String(process.env.ADMIN_TELEGRAM_IDS || "").trim(),
  });

  if (!cfg.TELEGRAM_BOT_TOKEN) {
    console.error(
      "TELEGRAM_BOT_TOKEN is required. Set it in your environment (Render: Environment tab) and redeploy."
    );
    process.exit(1);
  }

  const bot = createBot(cfg.TELEGRAM_BOT_TOKEN);

  bot.catch((err) => {
    const ctx = err?.ctx;
    console.error("[bot] error", {
      err: safeErr(err?.error || err),
      updateId: ctx?.update?.update_id,
      updateType: ctx?.update ? Object.keys(ctx.update)[1] || "(unknown)" : "(none)",
    });
  });

  try {
    await bot.init();
    console.log("[boot] bot init ok", {
      username: bot.botInfo?.username || "(unknown)",
      id: bot.botInfo?.id,
    });
  } catch (e) {
    console.warn("[boot] bot.init failed", { err: safeErr(e) });
  }

  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Start the filter wizard" },
      { command: "help", description: "How to use Chain EX" },
      { command: "next", description: "Next 10 results" },
      { command: "restart", description: "Reset and start over" },
    ]);
  } catch (e) {
    console.warn("[boot] setMyCommands failed", { err: safeErr(e) });
  }

  let backoffMs = 2000;
  let runner = null;

  while (true) {
    try {
      console.log("[polling] starting", {
        backoffMs,
        uptimeSec: Math.round(process.uptime()),
      });

      try {
        await bot.api.deleteWebhook({ drop_pending_updates: true });
        console.log("[polling] deleteWebhook ok");
      } catch (e) {
        console.warn("[polling] deleteWebhook failed", { err: safeErr(e) });
      }

      runner = run(bot, {
        runner: {
          concurrency: 1,
        },
      });

      console.log("[polling] runner started", {
        concurrency: 1,
        bot: bot.botInfo?.username || "(unknown)",
      });

      await runner;
      console.warn("[polling] runner ended unexpectedly");
    } catch (e) {
      const errMsg = safeErr(e);
      const is409 = isConflict409(e);

      console.warn("[polling] failure", {
        err: errMsg,
        is409,
        backoffMs,
        sinceBootSec: Math.round((Date.now() - startedAtMs) / 1000),
      });

      try {
        runner?.stop?.();
      } catch (stopErr) {
        console.warn("[polling] runner stop failed", { err: safeErr(stopErr) });
      }

      await sleep(backoffMs);
      backoffMs = Math.min(20000, Math.round(backoffMs * 1.7));
      continue;
    }

    await sleep(backoffMs);
    backoffMs = Math.min(20000, Math.round(backoffMs * 1.7));
  }
}

boot().catch((e) => {
  console.error("[boot] fatal", { err: safeErr(e) });
  process.exit(1);
});
