const sessions = new Map();

export function newSession() {
  return {
    step: 1,
    flowId: "",
    selectedChain: "",
    selectedAgeRange: "",
    selectedMarketCapRange: "",
    requireTelegram: false,
    requireDiscord: false,
    requireWebsite: false,
    results: [],
    pageIndex: 0,
    fetching: false,
    lastWizardMessageId: null,
    updatedAtMs: Date.now(),
  };
}

export function clearSession(userId) {
  sessions.delete(String(userId));
}

export function getSession(userId) {
  const k = String(userId);
  const s = sessions.get(k);
  if (!s) return null;
  return s;
}

export function getOrCreateSession(userId) {
  const k = String(userId);
  let s = sessions.get(k);
  if (!s) {
    s = newSession();
    sessions.set(k, s);
    return s;
  }

  // Harden existing sessions so missing fields never crash handlers.
  if (!Number.isFinite(Number(s.step))) s.step = 1;
  if (typeof s.flowId !== "string") s.flowId = "";
  if (!Array.isArray(s.results)) s.results = [];
  if (!Number.isFinite(Number(s.pageIndex))) s.pageIndex = 0;
  if (typeof s.fetching !== "boolean") s.fetching = false;
  if (!Number.isFinite(Number(s.updatedAtMs))) s.updatedAtMs = Date.now();

  return s;
}

export function touchSession(userId) {
  const s = getSession(userId);
  if (s) s.updatedAtMs = Date.now();
}

export function cleanupSessions({ maxAgeMs = 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  for (const [k, s] of sessions.entries()) {
    const ts = Number(s?.updatedAtMs || 0);
    if (!ts || now - ts > maxAgeMs) {
      sessions.delete(k);
    }
  }
}
