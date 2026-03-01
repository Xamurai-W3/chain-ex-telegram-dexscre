
## 2026-03-01 15:45:05. UTC
- Request: I'm getting an error message saying Unable to fetch data from dexscreener
- Summary: Implemented a hardened, centralized DexScreener service with env-tunable timeout/retry/backoff (including 429 Retry-After), defensive JSON/schema validation, normalized error results, and detailed per-call logs. Updated…
- Files: .env.sample, CHANGELOG.md, DOCS.md, package.json, src/bot.js, src/index.js, src/services/dexscreener.js

## 2026-03-01 16:00:00. UTC
- Summary: Hardened DexScreener integration with centralized requests, timeouts, retry with backoff + jitter, 429 Retry-After support, defensive response validation, and normalized error types. Improved user-facing error messages, added startup env sanity logs, and introduced an admin-only /dexhealth diagnostic command.
