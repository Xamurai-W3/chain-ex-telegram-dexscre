Chain EX is a Telegram bot that helps you discover newly launched tokens by walking you through a guided filter wizard (inline buttons), then showing results in pages of 10.

Commands and usage
/start
Starts a new search. It clears your previous filters and results, sends the welcome message, then begins Step 1 of 6.

/help
Shows a quick description of what the bot does and how to use /start or /restart, then /next to page results.

/restart
Clears your current search state and starts the wizard again from Step 1.

/next
Shows the next 10 results from your last completed search.

Troubleshooting DexScreener fetch failures
If the bot says DexScreener is slow or unavailable, it’s usually one of these cases:

1) TIMEOUT or NETWORK
DexScreener didn’t respond in time or the network request failed. Wait a moment and try again.

2) RATE_LIMIT
DexScreener rate limited the bot. If the bot shows a wait time, wait that long and try again.

3) UPSTREAM_5XX
DexScreener returned a server error. Try again shortly.

4) INVALID_RESPONSE
DexScreener returned unexpected data (or invalid JSON). Try again later.

Note on /next
If you already fetched results successfully, /next will keep paginating your cached results even if a new fetch fails.

Environment variables
TELEGRAM_BOT_TOKEN
Required. Your Telegram bot token from BotFather.

ADMIN_TELEGRAM_IDS
Optional. Comma-separated Telegram user IDs allowed to use admin-only diagnostics like /dexhealth.
If unset, admin features are disabled.

DEXSCREENER_BASE_URL
Optional. Defaults to https://api.dexscreener.com

DEXSCREENER_TIMEOUT_MS
Optional. Defaults to 10000

DEXSCREENER_RETRY_MAX
Optional. Defaults to 2

DEXSCREENER_RETRY_BASE_DELAY_MS
Optional. Defaults to 500
