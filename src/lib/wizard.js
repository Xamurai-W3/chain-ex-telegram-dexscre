import { InlineKeyboard } from "grammy";

export const CHAINS = ["ETH", "SOL", "BSC", "BASE"];

export const AGE_RANGES = [
  "1 Day",
  "2–3 Days",
  "4–7 Days",
  "1–2 Weeks",
  "2–4 Weeks",
  "1–3 Months",
  "3–6 Months",
  "6–12 Months",
];

export const MCAP_RANGES = [
  "10k–25k",
  "25k–50k",
  "50k–100k",
  "100k–250k",
  "250k–500k",
];

export function promptText(step) {
  if (step === 1) return "Step 1 of 6\nSelect Chain:";
  if (step === 2) return "Step 2 of 6\nSelect Token Age Range:";
  if (step === 3) return "Step 3 of 6\nSelect Market Cap Range:";
  if (step === 4) return "Step 4 of 6\nRequire Telegram?";
  if (step === 5) return "Step 5 of 6\nRequire Discord?";
  if (step === 6) return "Step 6 of 6\nRequire Website?";
  return "Select:";
}

export function keyboardForStep(step, flowId) {
  const kb = new InlineKeyboard();
  if (step === 1) {
    kb.text("ETH", cb(flowId, 1, "chain", "ETH"));
    kb.text("SOL", cb(flowId, 1, "chain", "SOL"));
    kb.row();
    kb.text("BSC", cb(flowId, 1, "chain", "BSC"));
    kb.text("BASE", cb(flowId, 1, "chain", "BASE"));
    return kb;
  }

  if (step === 2) {
    for (let i = 0; i < AGE_RANGES.length; i++) {
      kb.text(AGE_RANGES[i], cb(flowId, 2, "age", String(i)));
      if (i % 2 === 1) kb.row();
    }
    return kb;
  }

  if (step === 3) {
    for (let i = 0; i < MCAP_RANGES.length; i++) {
      kb.text(MCAP_RANGES[i], cb(flowId, 3, "mcap", String(i)));
      kb.row();
    }
    return kb;
  }

  if (step === 4) {
    kb.text("Yes", cb(flowId, 4, "tel", "1"));
    kb.text("No", cb(flowId, 4, "tel", "0"));
    return kb;
  }

  if (step === 5) {
    kb.text("Yes", cb(flowId, 5, "disc", "1"));
    kb.text("No", cb(flowId, 5, "disc", "0"));
    return kb;
  }

  if (step === 6) {
    kb.text("Yes", cb(flowId, 6, "web", "1"));
    kb.text("No", cb(flowId, 6, "web", "0"));
    return kb;
  }

  return kb;
}

function cb(flowId, step, key, val) {
  return `w|${String(flowId)}|${String(step)}|${String(key)}|${String(val)}`;
}

export function parseCallback(data) {
  const raw = String(data || "");
  const parts = raw.split("|");
  if (parts.length !== 5) return null;
  if (parts[0] !== "w") return null;
  return {
    flowId: parts[1],
    step: Number(parts[2]),
    key: parts[3],
    val: parts[4],
  };
}
