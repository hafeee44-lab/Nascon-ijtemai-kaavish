// FR-5.3 moderation engine (pure functions — deterministic, unit-tested).

export const PROFANITY = ['badword', 'porn', 'scam', 'fuck', 'shit', 'bitch', 'asshole', 'idiotspam'];
const ZERO_WIDTH = /[​-‍﻿⁠]/g;
const SEPARATORS = /[_.\-*]/g;

/** Leetspeak-normalised spellings of one token ("!" may stand for "i" or be noise). */
export function normalizedForms(token: string): string[] {
  const base = token.toLowerCase().replace(ZERO_WIDTH, '').replace(SEPARATORS, '')
    .replace(/@/g, 'a').replace(/0/g, 'o').replace(/3/g, 'e').replace(/\$/g, 's').replace(/1/g, 'i');
  const asI = base.replace(/!/g, 'i').replace(/[^a-z]/g, '');
  const dropped = base.replace(/!/g, '').replace(/[^a-z]/g, '');
  return [...new Set([asI, dropped])];
}

export const isProfane = (token: string) => normalizedForms(token).some((f) => PROFANITY.some((w) => f.includes(w)));

/** ≥4 identical consecutive characters (case-insensitive, non-space) or "!!!" / "???". */
export const isFlood = (text: string) => /(\S)\1{3,}/i.test(text) || /!{3,}|\?{3,}/.test(text);

export function mask(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  const out = text.split(/(\s+)/).map((part) => {
    if (!part.trim() || !isProfane(part)) return part;
    flagged = true;
    return '***';
  });
  return { text: out.join(''), flagged };
}

export interface InMsg { message_id: string; sender: string; text: string }
export interface OutMsg extends InMsg { flagged: boolean; reason: string | null }

export function moderate(messages: InMsg[]) {
  const filtered: OutMsg[] = [];
  const kicked: string[] = [];
  const muted: string[] = [];
  for (const m of messages) {
    if (isFlood(m.text)) {
      if (!muted.includes(m.sender)) muted.push(m.sender);
      continue; // never broadcast
    }
    const r = mask(m.text);
    if (r.flagged) {
      if (!kicked.includes(m.sender)) kicked.push(m.sender);
      filtered.push({ ...m, text: r.text, flagged: true, reason: 'profanity_leetspeak' });
    } else filtered.push({ ...m, flagged: false, reason: null });
  }
  return { filtered, kicked, muted };
}

/** Sliding-window sender limiter for the live chat route (3 messages / 2 s). */
export class SenderLimiter {
  private log = new Map<string, number[]>();
  constructor(private readonly limit = 3, private readonly windowMs = 2000, private readonly now = () => Date.now()) {}
  allow(sender: string): boolean {
    const t = this.now();
    const hits = (this.log.get(sender) ?? []).filter((x) => x > t - this.windowMs);
    if (hits.length >= this.limit) {
      this.log.set(sender, hits);
      return false;
    }
    hits.push(t);
    this.log.set(sender, hits);
    return true;
  }
}
