// Contract error (spec 5.2): every non-2xx body is { error: { code, message, details } }.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// Nested fields are reported both qualified and bare (e.g. "payload.team_id" and "team_id"),
// so either naming convention finds the offending field.
export const validationError = (fields: string[], message = 'Validation failed.') =>
  new ApiError(400, 'VALIDATION_ERROR', message, {
    fields: [...new Set(fields.flatMap((f) => (f.includes('.') ? [f, f.slice(f.lastIndexOf('.') + 1)] : [f])))],
  });

export const notFound = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new ApiError(404, code, message, details);

export const conflict = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new ApiError(409, code, message, details);
