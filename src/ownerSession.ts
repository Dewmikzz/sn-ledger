const key = (scope: string) => `si-ledger:unlocked:v1:${scope}`;

export function ownerSessionRemaining(scope: string, minutes: number, now = Date.now()): number {
  try {
    const last = Number(sessionStorage.getItem(key(scope)));
    if (!Number.isFinite(last) || last <= 0 || last > now) return 0;
    return Math.max(0, last + minutes * 60_000 - now);
  } catch { return 0; }
}

export function touchOwnerSession(scope: string): void {
  try { sessionStorage.setItem(key(scope), String(Date.now())); } catch { /* The in-memory timer still protects the session. */ }
}

export function clearOwnerSession(scope: string): void {
  try { sessionStorage.removeItem(key(scope)); } catch { /* Storage is optional. */ }
}
