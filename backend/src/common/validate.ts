// Small hand-rolled validators so error codes and details.fields match the contract exactly.
export const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
export const isId = (v: unknown): v is string => isStr(v) && ID_RE.test(v);
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

export function isDate(v: unknown): v is string {
  if (!isStr(v) || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const today = () => new Date().toISOString().slice(0, 10);
