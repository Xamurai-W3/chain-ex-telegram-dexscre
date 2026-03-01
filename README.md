Chain EX

What it does
A Telegram bot that guides users through an inline-button filter wizard to discover newly launched tokens using Dexscreener data, then paginates results with /next.

Features
1) Guided wizard (6 steps) using inline keyboards only
2) Filters by chain, token age, market cap, and required social links
3) Dedupes by contract address and keeps a deterministic best pair
4) Shows 10 results per page with /next

Architecture
1) src/index.js boots config and starts long polling via @grammyjs/runner
2) src/bot.js wires commands first, then callback handlers
3) src/services/dexscreener.js fetches and normalizes/filter results
4) src/lib/session.js stores per-user in-memory state

Setup
1) Install
npm install

2) Configure
Create a .env file with:
TELEGRAM_BOT_TOKEN=...

3) Run
npm run dev

Commands
/start
Starts a new wizard and clears previous state.

/help
Explains usage.

/restart
Clears state and starts wizard again.

/next
Shows next page of results (10 per page).

Dexscreener integration
The bot calls Dexscreener public API endpoints under https://api.dexscreener.com.
If the API is unavailable or returns unexpected data, the bot shows:
Unable to fetch data from Dexscreener. Please try again later.

Deployment
This is a single Node.js service. Set TELEGRAM_BOT_TOKEN in your environment and run:
npm run build
npm start

Troubleshooting
1) If the bot does not start: confirm TELEGRAM_BOT_TOKEN is set.
2) If you see no results: widen age or market cap range, then /restart.
3) If callbacks stop working: /restart to refresh the wizard.

Extending
Add new commands in src/commands/*.js and register them in src/bot.js (before the callback handlers).
Add new filtering logic in src/services/dexscreener.js.
