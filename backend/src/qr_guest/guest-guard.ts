import type { NextFunction, Request, Response } from 'express';

// FR-4.3: anonymous guest tokens are read-only, enforced server-side for every write.
// Guests may only obtain a token and stage their own cart; everything else that mutates is 403.
const GUEST_ALLOWED_WRITES = [/^\/api\/v1\/guest\/token$/, /^\/api\/v1\/guest\/cart$/, /^\/audit\/v1\//];
const ALWAYS_GUARDED = [/^\/audit\/v1\/checkout$/, /^\/audit\/v1\/events$/, /^\/audit\/v1\/roster\//, /^\/audit\/v1\/sports$/, /^\/audit\/v1\/leagues$/];
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const guestTokenOf = (authorization: string | undefined): string | null => {
  const m = /^Bearer\s+(guest_\S+)$/i.exec(authorization ?? '');
  return m ? m[1] : null;
};

/** True when this request must be rejected with 403 GUEST_WRITE_FORBIDDEN. */
export function isGuestWrite(method: string, path: string, authorization: string | undefined): string | null {
  const token = guestTokenOf(authorization);
  if (!token || !WRITE.has(method.toUpperCase())) return null;
  if (ALWAYS_GUARDED.some((r) => r.test(path))) return token;
  if (GUEST_ALLOWED_WRITES.some((r) => r.test(path))) return null;
  return token;
}

export const guestWriteError = (token: string) => ({
  error: { code: 'GUEST_WRITE_FORBIDDEN', message: 'Anonymous guest tokens cannot perform write mutations.', details: { guest_token: token } },
});

export function guestGuard(req: Request, res: Response, next: NextFunction) {
  const token = isGuestWrite(req.method, req.path, req.headers.authorization);
  if (token) return res.status(403).json(guestWriteError(token));
  return next();
}
