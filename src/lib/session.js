const sessions = new Map();

export function newSession() {
  return {
    step: 1,
    selectedChain: "",
    selectedAgeRange: "",
    selectedMarketCapRange: "",
    requireTelegram: false,
    requireDiscord: false,
    requireWebsite: false,
    results: [],
    pageIndex: 0,
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
  }
  return s;
}

export function touchSession(userId) {
  const s = getSession(userId);
  if (s) s.updatedAtMs = Date.now();
}

export function cleanupSessions({ maxAgeMs = 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  for (const [k, s] of sessions.entries()) {
    if (!s?.updatedAtMs || now - s.updatedAtMs > maxAgeMs) {
      sessions.delete(k);
    }
  }
}
