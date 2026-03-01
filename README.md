

Troubleshooting: bot not responding
1) Missing token
Check logs for: TELEGRAM_BOT_TOKEN_set: false
Fix by setting TELEGRAM_BOT_TOKEN in your environment and redeploying.

2) Webhook or polling conflict (409)
Check logs for: 409 Conflict terminated by other getUpdates request
This usually means two bot instances are running briefly (deploy overlap) or webhook/polling conflict.
The bot now attempts deleteWebhook on startup and will backoff and retry automatically.

3) Network or upstream issues
If you see repeated [dex] fetch failure lines, Dexscreener may be slow or rate limiting.
The bot uses timeouts and retries, and will respond with a short failure message instead of hanging.

4) Crashes without logs
Unhandled promise rejections are now logged. If you see [process] uncaughtException, the process will exit and restart (on most platforms).
