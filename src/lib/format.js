export function formatTokenBlock(t) {
  const name = String(t?.tokenName || "Unknown").trim() || "Unknown";
  const ca = String(t?.contractAddress || "").trim();
  const dex = String(t?.dexscreenerUrl || "").trim();

  const lines = [];
  lines.push(`Token Name: ${name}`);
  lines.push(`CA: ${ca || "(unknown)"}`);
  if (dex) lines.push(`Dexscreener: ${dex}`);

  const tg = String(t?.telegramUrl || "").trim();
  const disc = String(t?.discordUrl || "").trim();
  const web = String(t?.websiteUrl || "").trim();

  if (tg) lines.push(`Telegram: ${tg}`);
  if (disc) lines.push(`Discord: ${disc}`);
  if (web) lines.push(`Website: ${web}`);

  return lines.join("\n");
}

export function formatTokensPage(tokens) {
  return tokens.map(formatTokenBlock).join("\n\n");
}
