// HTTP client with timeouts and plain-language errors (HCI: never show raw codes).
export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  UNAUTHENTICATED: 'Your email or password is incorrect, or your session expired. Please sign in again.',
  FORBIDDEN: 'Your account is not allowed to do that.',
  OUT_OF_STOCK: 'Sorry, that item just sold out.',
  PAYMENT_DECLINED: 'Your card was declined. No money was taken. Try another card.',
  PAYMENT_CAPTURE_FAILED: 'The payment could not be completed. No money was taken. Please try again.',
  INVALID_DISCOUNT_CODE: 'That discount code is not valid.',
  VALIDATION_ERROR: 'Some details are missing or invalid. Please check and try again.',
  RATE_LIMITED: 'Too many requests. Please wait a few seconds.',
  MATCH_NOT_IN_PROGRESS: 'Scores can only be added while the match is in progress.',
  INVALID_COMPENSATION: 'That event was already corrected or cannot be corrected.',
  TRANSFER_WINDOW_CLOSED: 'The transfer window is closed for that date.',
  SQUAD_FULL: 'The destination squad is already full.',
  MIN_POSITION_VIOLATION: 'Your squad would be left without enough players in that position.',
  PLAYER_ON_LOAN: 'This player is on loan and cannot be moved right now.',
  NOT_IN_SQUAD: 'This player is no longer in your squad (the server has a newer roster).',
  CROSS_TENANT_TRANSFER: 'Players can only move between clubs of the same organisation.',
  INVALID_BASE_VERSION: 'This change was based on data the server does not recognise.',
  DUPLICATE_EVENT_ID: 'This score was already recorded differently on the server.',
  MATCH_NOT_FOUND: 'That match no longer exists.',
  PLAYER_NOT_FOUND: 'That player no longer exists.',
  INNINGS_COMPLETE: 'This team has finished its innings.',
  SERIES_ALREADY_DECIDED: 'The series is already decided.',
  TIE_NOT_ALLOWED: 'The scores are level and this sport needs a winner.',
  ILLEGAL_TRANSITION: 'That change is not allowed for the match in its current state.',
};

export const friendly = (code: string | null | undefined, fallback = 'Something went wrong. Please try again.') =>
  (code && FRIENDLY[code]) || fallback;

export async function request<T>(base: string, path: string, opts: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await fetch(base.replace(/\/$/, '') + path, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiFailure(0, 'NETWORK', 'Cannot reach the server. Check your connection or the server address in Settings.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const code = data?.error?.code ?? 'ERROR';
    throw new ApiFailure(res.status, code, friendly(code));
  }
  return data as T;
}

export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const today = () => new Date().toISOString().slice(0, 10);
export const pkr = (minor: number) => `PKR ${(minor / 100).toFixed(2)}`;
