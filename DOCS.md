Chain EX is a Telegram bot that helps you discover newly launched tokens by walking you through a guided filter wizard (inline buttons), then showing results in pages of 10.

Setup
1) Install dependencies
npm install

2) Configure environment
Copy .env.sample to .env and set TELEGRAM_BOT_TOKEN.

3) Run locally
npm run dev

Commands and usage
/start
Starts a new search. It clears your previous filters and results, sends the welcome message, then begins Step 1 of 6.

/help
Shows a quick description of what the bot does and how to use /start or /restart, then /next to page results.

/restart
Clears your current search state and starts the wizard again from Step 1.

/next
Shows the next 10 results from your last completed search. If there are no more, the bot says:
No more tokens match your filters. Try adjusting your criteria.

Wizard flow
1) Select Chain
2) Select Token Age Range
3) Select Market Cap Range
4) Require Telegram?
5) Require Discord?
6) Require Website?

After Step 6, the bot fetches candidates from Dexscreener and filters them to match your selections.

Environment variables
TELEGRAM_BOT_TOKEN
Your Telegram bot token from BotFather.
