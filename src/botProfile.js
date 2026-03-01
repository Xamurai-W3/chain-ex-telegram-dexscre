export function buildBotProfile() {
  return [
    "Purpose: Chain EX helps users discover newly launched tokens using a guided filter wizard and Dexscreener results.",
    "Commands: /start (start wizard), /help (usage), /restart (reset and start over), /next (next 10 results).",
    "Rules: The wizard uses inline buttons only and has 6 steps. Results are paginated 10 per page via /next.",
  ].join("\n");
}
