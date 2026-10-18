// MATCHDAY design system — tokens, palettes, theme provider.
// Presentation only: no API contract, permission or offline-queue behaviour lives here.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useWindowDimensions } from 'react-native';

// Font families match the .ttf filenames shipped in android/app/src/main/assets/fonts,
// and the @font-face names declared in web/index.html, so one name works on both targets.
// One geometric family, three weights: the voice stays consistent and weight does the work.
export const FONT = {
  body: 'TitilliumWeb-Regular',
  semi: 'TitilliumWeb-SemiBold',
  display: 'TitilliumWeb-Bold',
  /** Numerals: scores, ranks, points, prices. */
  num: 'TitilliumWeb-Bold',
} as const;

export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 30, xxxl: 44 } as const;
export const R = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
/** Every interactive element is at least this tall/wide (accessibility requirement). */
export const TAP = 48;



const LIGHT = {
  mode: 'light' as const,
  bg: '#FFFFFF',
  bgTop: '#FFFFFF',
  bgBottom: '#FAFAF7',
  bgSoft: '#F7F7F3',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F6F2',
  surfaceHi: '#EDEDE7',
  border: '#E4E4DE',
  borderHi: '#C9C9C1',
  text: '#0C0C0C',
  dim: '#55554F',
  faint: '#8A8A82',
  accent: '#E01B22',
  accentInk: '#FFFFFF',
  accentSoft: '#FDE7E8',
  live: '#E01B22',
  liveSoft: '#FDE7E8',
  ok: '#121212',
  okSoft: '#EFEFEA',
  warn: '#8A6A00',
  warnSoft: '#FFF3C4',
  bad: '#C8102E',
  badSoft: '#FBE3E6',
  /** The third voice: used for emphasis blocks and the qualification marker. */
  gold: '#FFD100',
  goldSoft: '#FFF6D1',
  goldInk: '#141004',
  /** High-contrast black surface for stat bands. */
  ink: '#141414',
  inkText: '#FFFFFF',
  inkDim: '#9B9B96',
  /** Warm tint for alternating surfaces. */
  tintRed: '#FFF1F0',
  /** White-label identity colour for the signed-in tenant (set at runtime). */
  tenant: '#E01B22',
  overlay: 'rgba(12,12,12,0.45)',
  shadow: '#B9B9B1',
};

// The product ships light-only; DARK is kept as an alias so palette lookups stay total.
const DARK = LIGHT;

export type Palette = typeof LIGHT;

/** Readable ink for an arbitrary tenant colour (white-label safety). */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return '#FFFFFF';
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.42 ? '#06100C' : '#FFFFFF';
}

/** Deterministic identity colour for a club/team name — stable across renders and devices. */
export function crestColor(name: string, dark: boolean): string {
  // Deliberately excludes the lime accent: a crest must never be mistaken for an action.
  const hues = dark
    ? ['#0F6E8C', '#8A5A00', '#0E7A52', '#2F4FB8', '#6A3BC4', '#0B6E6E', '#7A5A00', '#A02F86']
    : ['#0F6E8C', '#9A6100', '#0E7A52', '#2F4FB8', '#6A3BC4', '#0B6E6E', '#A0522D', '#A02F86'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return hues[h % hues.length];
}

type ThemeValue = {
  C: Palette;
  dark: boolean;
  toggle: () => void;
  /** Tablet / desktop width. */
  wide: boolean;
  /** Very narrow phones. */
  compact: boolean;
  width: number;
  reduceMotion: boolean;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ accent, children }: { accent?: string | null; children: React.ReactNode }) {
  const dark = false;
  const [reduceMotion, setReduceMotion] = useState(false);
  const { width } = useWindowDimensions();


  useEffect(() => {
    let alive = true;
    (AccessibilityInfo as any)?.isReduceMotionEnabled?.()
      .then((v: boolean) => alive && setReduceMotion(!!v))
      .catch(() => {});
    const sub = (AccessibilityInfo as any)?.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduceMotion(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  const toggle = useCallback(() => {}, []); // light-only product

  const value = useMemo<ThemeValue>(() => {
    const base = dark ? DARK : LIGHT;
    // The tenant's colour marks identity (badges, hero, club chrome) while the action accent
    // stays constant, so an affordance always looks the same whichever organisation you sign in to.
    const C: Palette = accent ? { ...base, tenant: accent } : base;
    return { C, dark, toggle, wide: width >= 900, compact: width < 360, width, reduceMotion };
  }, [dark, accent, width, toggle, reduceMotion]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}

/** Stable, human-readable automation ids (Appium accessibility-id / Selenium data-testid). */
export const tid = (...parts: (string | number | null | undefined)[]) =>
  parts.filter((p) => p !== null && p !== undefined && p !== '').join('-')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
