

Troubleshooting: bot not responding
1) Missing token
If the bot logs show TELEGRAM_BOT_TOKEN_set: false, set TELEGRAM_BOT_TOKEN and redeploy.

2) Webhook or polling conflict (409)
If logs show a 409 Conflict about getUpdates being terminated, another instance may be running or a webhook is set.
On boot the bot tries deleteWebhook and will backoff and retry polling automatically.

3) Network issues
If you see repeated polling failures or Dexscreener failures, it may be a temporary network/API issue. The bot will retry and will not hang.
