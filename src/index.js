import "dotenv/config";

import { run } from "@grammyjs/runner";

import { cfg } from "./lib/config.js";
import { safeErr } from "./lib/safeErr.js";
import { createBot } from "./bot.js";

process.on("unhandledRejection", (r) => {
  console.error("[process] UnhandledRejection", { err: safeErr(r) });
  process.exit(1);
});
process.on("uncaughtException", (e) => {
  console.error("[process] UncaughtException", { err: safeErr(e) });
  process.exit(1);
});

async function boot() {
  console.log("[boot] start", {
    TELEGRAM_BOT_TOKEN_set: !!cfg.TELEGRAM_BOT_TOKEN,
  });

  if (!cfg.TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is required. Add it to your environment and redeploy.");
    process.exit(1);
  }

  const bot = createBot(cfg.TELEGRAM_BOT_TOKEN);

  bot.catch((err) => {
    console.error("[bot] error", {
      err: safeErr(err?.error || err),
      updateId: err?.ctx?.update?.update_id,
    });
  });

  try {
    await bot.init();
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

  // Restart loop to tolerate deploy overlaps (409 Conflict)
  // Ensures only one runner is active.
  while (true) {
    try {
      console.log("[polling] starting", { backoffMs });
      await bot.api.deleteWebhook({ drop_pending_updates: true });

      runner = run(bot, {
        runner: {
          // Keep low to avoid memory growth from slow operations.
          // This bot is mostly network-bound; 1 is safest.
          concurrency: 1,
        },
      });

      await runner;
      console.warn("[polling] runner ended unexpectedly");
    } catch (e) {
      const msg = safeErr(e);
      const is409 = String(msg || "").includes("409") || String(e?.message || "").includes("409");
      console.warn("[polling] failure", { err: msg, is409 });

      try {
        if (runner?.isRunning?.()) runner.stop?.();
      } catch {}

      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(20000, Math.round(backoffMs * 1.7));
      continue;
    }

    // runner ended without throwing: backoff and restart
    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(20000, Math.round(backoffMs * 1.7));
  }
}

boot().catch((e) => {
  console.error("[boot] fatal", { err: safeErr(e) });
  process.exit(1);
});
