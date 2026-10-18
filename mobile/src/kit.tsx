// MATCHDAY UI kit — icons and primitives shared by every screen.
// Rules baked in here: 48dp minimum tap targets, status never shown by colour alone,
// stable testID/accessibilityLabel on every interactive element.
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { crestColor, FONT, R, SP, TAP, tid, useTheme } from './theme';

// ---------------------------------------------------------------- icons
const PATHS: Record<string, string> = {
  home: 'M3 11.2 12 3.5l9 7.7M5.5 9.7V20h4.2v-5.6h4.6V20h4.2V9.7',
  calendar: 'M4 6h16v15H4zM8 3v5M16 3v5M4 11h16',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H3.5v2A4 4 0 0 0 7 12M17 6h3.5v2a4 4 0 0 1-3.5 4M12 13.5V18M8 21h8',
  shop: 'M4.2 7.5h15.6L21 21H3zM8.5 7.5V5.6a3.5 3.5 0 0 1 7 0v1.9',
  people: 'M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M4 20.5v-1.2a6.4 6.4 0 0 1 16 0v1.2',
  person: 'M16 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4.5 21v-1.5a7.5 7.5 0 0 1 15 0V21',
  shield: 'M12 3l8 3.2v5.4c0 4.7-3.3 8.3-8 9.9-4.7-1.6-8-5.2-8-9.9V6.2z',
  bell: 'M6.5 9a5.5 5.5 0 0 1 11 0v6l2 2.5h-15L6.5 15zM10 20.5h4',
  settings: 'M9.4 3.5h5.2l.7 3 2.9 1.2 2.7-1.3 2.6-4.5M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4',
  gear: 'M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8M19.6 14.6l1.9 1.4-2 3.4-2.2-.9a7.8 7.8 0 0 1-1.9 1.1l-.3 2.4h-4l-.3-2.4a7.8 7.8 0 0 1-1.9-1.1l-2.2.9-2-3.4 1.9-1.4a7.6 7.6 0 0 1 0-2.2L3.6 9.4l2-3.4 2.2.9a7.8 7.8 0 0 1 1.9-1.1L10 3.4h4l.3 2.4a7.8 7.8 0 0 1 1.9 1.1l2.2-.9 2 3.4-1.9 1.4a7.6 7.6 0 0 1 0 2.2z',
  back: 'M19 12H5M11.5 5.5 5 12l6.5 6.5',
  arrow: 'M5 12h14M12.5 5.5 19 12l-6.5 6.5',
  chevron: 'M9.5 5.5 16 12l-6.5 6.5',
  chevronDown: 'M5.5 9.5 12 16l6.5-6.5',
  close: 'M5.5 5.5l13 13M18.5 5.5l-13 13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  search: 'M15.5 15.5 21 21M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  pin: 'M12 21.5s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12M14.8 9.2a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 0 1 5.6 0',
  clock: 'M12 7v5.3l3.4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  sync: 'M20.2 7.4A9 9 0 0 0 4.7 8.6M3 4.5v4h4M3.8 16.6a9 9 0 0 0 15.5 1.2M21 19.5v-4h-4',
  cloudOff: 'M3 3l18 18M7 18.5h9.5a4 4 0 0 0 1.3-7.8A6 6 0 0 0 8.6 7.7M4.6 10.4A4 4 0 0 0 6 18.3',
  cloud: 'M7 18.5h9.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.3A4 4 0 0 0 7 18.5z',
  moon: 'M20.5 15.2A9 9 0 1 1 8.8 3.5a7 7 0 0 0 11.7 11.7',
  sun: 'M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  cart: 'M3 4h2.2l2.4 11.2h10L20 7.5H6.2M9.5 20a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4M17.5 20a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4',
  receipt: 'M5.5 3h13v18l-2.2-1.6-2.1 1.6-2.2-1.6L9.8 21l-2.1-1.6L5.5 21zM9 8h6M9 12h6',
  download: 'M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15',
  swap: 'M4 8h13M13.5 4.5 17 8l-3.5 3.5M20 16H7M10.5 12.5 7 16l3.5 3.5',
  exit: 'M14 4.5h4.5v15H14M10.5 8 7 12l3.5 4M17 12H7',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z',
  filter: 'M3.5 6h17M6.5 12h11M10 18h4',
  eye: 'M12 5.5c5 0 9 6.5 9 6.5s-4 6.5-9 6.5-9-6.5-9-6.5 4-6.5 9-6.5M14.6 12a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0',
  flame: 'M12 21.2a6.2 6.2 0 0 0 6.2-6.2c0-5-4.4-6.1-3.4-11.4C9.6 5.4 5.8 8.6 5.8 15A6.2 6.2 0 0 0 12 21.2z',
  lock: 'M6.5 10.5h11V21h-11zM8.8 10.5V7.3a3.2 3.2 0 0 1 6.4 0v3.2',
  alert: 'M12 8v5M12 16.5v.6M10.3 3.9 2.6 17.4a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 11v6M12 7.4v.6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  whistle: 'M2.8 12.8a4.7 4.7 0 1 0 9.4 0 4.7 4.7 0 0 0-9.4 0M12.2 11h8.5v3.4h-8.5M17.6 11V7.6M14.5 6.2h6',
  ball: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7.6l4.1 3-1.6 4.9H9.5L7.9 10.6z',
  grid: 'M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z',
  list: 'M4 6.5h16M4 12h16M4 17.5h16',
  server: 'M3.5 4.5h17v6h-17zM3.5 13.5h17v6h-17zM7 7.5h.6M7 16.5h.6',
  bolt: 'M13.5 2.5 4.5 13.8h6L10 21.5l9.5-11.6h-6.3z',
  scoreboard: 'M3.5 4.5h17v12h-17zM12 4.5v12M6.6 8.6h2.8M14.6 8.6h2.8M6.6 12.4h2.8M14.6 12.4h2.8M8 20.5h8M12 16.5v4',
  crown: 'M3.5 7.5 7.5 11l4.5-6.5L16.5 11l4-3.5-2.4 10.5H5.9zM6.5 21.5h11',
  basket: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3v18M5.6 5.6c3.6 3.6 3.6 9.2 0 12.8M18.4 5.6c-3.6 3.6-3.6 9.2 0 12.8',
  cricket: 'M14.8 3.3 20.7 9.2 13.4 16.5 7.5 10.6zM6.6 14.7l2.7 2.7-3.2 3.2a1.9 1.9 0 0 1-2.7-2.7zM20.5 18.2a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0',
  tennis: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M4.4 7.3c4.3 1.2 6.9 4.5 7.4 9.2M19.6 7.3c-4.3 1.2-6.9 4.5-7.4 9.2',
  hockey: 'M4.5 3.5v9.2a6.3 6.3 0 0 0 6.3 6.3h4.7M16.2 16.6h4.3v3.9h-4.3z',
  rugby: 'M5 19c-2-5 1-12 7-13.5C17 4.2 20.4 7 19 13c-1.2 5.2-9.4 8.3-14 6M9.3 14.7l5.4-5.4M10.8 11.2l1.6 1.6M12.3 9.7l1.6 1.6',
};

export function Icon({ name, size = 20, color, strokeWidth = 1.7 }: { name: string; size?: number; color?: string; strokeWidth?: number }) {
  const { C } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color ?? C.text} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d={PATHS[name] ?? PATHS.info} />
    </Svg>
  );
}

// ---------------------------------------------------------------- crests
// Heraldic club marks drawn as vectors. The mark is chosen from the club's name so a
// "Lions" side really wears a lion, the way a crest on a real shirt would.
type Mark = { lead: string[]; detail: string[]; top?: string[] };

const MARKS: Record<string, Mark> = {
  lion: {
    // Shallow 10-point mane ring around a large face, so it reads as a lion and not a cog.
    lead: ['M22.6 12 20.9 15.3 21.9 18.9 18.4 19.8 16.6 23 13.2 21.8 10 23.4 7.9 20.4 4.3 19.9 4.5 16.2 1.9 13.7 4 10.6 3.4 7 6.9 6 8.4 2.6 12 3.3 15.1 1.3 17.4 4.1 21 4.6 20.7 8.2Z'],
    detail: ['M19.1 12a7.1 7.1 0 1 1-14.2 0 7.1 7.1 0 0 1 14.2 0Z'],
    top: [
      'M10.3 10.7a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0ZM16 10.7a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z',
      'M12 13.1l2.9 2.5a3.8 3.8 0 0 1-5.8 0Z',
      'M6.4 7.6 8.9 9.4 5.6 10ZM17.6 7.6 15.1 9.4l3.3.6Z',
    ],
  },
  tiger: {
    lead: ['M5.9 9.6 4.1 4.3l4.8 2.3a7.8 7.8 0 0 1 6.2 0l4.8-2.3-1.8 5.3c.6 1 .9 2.1.9 3.3 0 3.8-3.1 6.9-6.9 6.9s-7-3.1-7-6.9c0-1.2.3-2.3.9-3.3Z'],
    detail: ['M8.3 10.3h1.5v2.6H8.3zM14.2 10.3h1.5v2.6h-1.5zM10.4 14.6h3.2l-1.6 2.2z'],
  },
  wolf: {
    lead: ['M12 21.2 5.3 15.1 3.8 4.8l5 3.4h6.4l5-3.4-1.5 10.3Z'],
    detail: ['M9 11.3l1.9 1.4-1.9 1.4-1.4-1.4zM15 11.3l1.4 1.4-1.4 1.4-1.9-1.4zM10.6 16.3h2.8L12 18.2z'],
  },
  falcon: {
    lead: ['M4.2 11.4c0-3.8 3.1-6.9 7-6.9 2.7 0 5.1 1.6 6.3 3.9l3.9 1.6-3.6 1.3c-.2 3.1-2.2 5.7-5 6.6l1.3 2.6H7.4l1.6-3.2a6.9 6.9 0 0 1-4.8-5.9Z'],
    detail: ['M10.6 10.2a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0Z'],
  },
  bear: {
    lead: ['M7.1 9.4a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6ZM16.9 9.4a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6ZM18.4 13.6a6.4 6.4 0 1 1-12.8 0 6.4 6.4 0 0 1 12.8 0Z'],
    detail: ['M14.6 15.4a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0Z'],
  },
  bull: {
    lead: ['M2.9 6.1c3.3-1.4 6.3-.5 7.6 1.9l-1.8 1.3C7.8 7.6 5.9 7.1 3.7 7.9ZM21.1 6.1c-3.3-1.4-6.3-.5-7.6 1.9l1.8 1.3c.9-1.7 2.8-2.2 5-1.4ZM12 20.8c-3.6 0-6.4-2.7-6.4-6.2V9.2h12.8v5.4c0 3.5-2.8 6.2-6.4 6.2Z'],
    detail: ['M10.2 12.1a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0ZM16.4 12.1a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0ZM9.8 16.1h4.4v2.1H9.8z'],
  },
  shark: {
    lead: ['M12 2.6c3.1 3.6 4.6 7.3 4.6 11.1L21.6 18l-5.6-.6c-1 1.6-2.4 2.9-4 3.9-1.6-1-3-2.3-4-3.9L2.4 18l5-4.3c0-3.8 1.5-7.5 4.6-11.1Z'],
    detail: ['M10.6 10.4a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0ZM15.8 10.4a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0Z'],
  },
  eagle: {
    lead: ['M12 3.4 14.6 8l6.9 1.4-4.6 3.4 1.3 6.6L12 16.2l-6.2 3.2 1.3-6.6L2.5 9.4 9.4 8Z'],
    detail: ['M13.6 11.4a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0Z'],
  },
};

const MARK_KEYS: [string, string][] = [
  ['lion', 'lion'], ['tiger', 'tiger'], ['panther', 'tiger'], ['puma', 'tiger'], ['jaguar', 'tiger'], ['cat', 'tiger'],
  ['wolf', 'wolf'], ['wolves', 'wolf'], ['fox', 'wolf'], ['husky', 'wolf'],
  ['falcon', 'falcon'], ['hawk', 'falcon'], ['kite', 'falcon'],
  ['eagle', 'eagle'], ['star', 'eagle'],
  ['bear', 'bear'], ['panda', 'bear'],
  ['bull', 'bull'], ['ox', 'bull'], ['ram', 'bull'], ['buffalo', 'bull'],
  ['shark', 'shark'], ['dolphin', 'shark'],
];

function markFor(name: string): Mark | null {
  const n = (name ?? '').toLowerCase();
  for (const [needle, key] of MARK_KEYS) if (n.includes(needle)) return MARKS[key];
  return null;
}

export function Crest({ name, size = 36 }: { name: string; size?: number }) {
  const { dark } = useTheme();
  const color = crestColor(name ?? '?', dark);
  const disc = dark ? '#0D1108' : '#FFFFFF';
  const mark = markFor(name);
  const initials = (name ?? '?').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={`${name} crest`}>
      <Circle cx={12} cy={12} r={11.1} fill={disc} stroke={color} strokeWidth={1.5} />
      <Circle cx={12} cy={12} r={9.1} fill="none" stroke={color} strokeWidth={0.5} opacity={0.45} />
      {mark ? (
        <G transform="translate(12,12) scale(0.63) translate(-12,-12)">
          {mark.lead.map((d, i) => <Path key={`l${i}`} d={d} fill={color} />)}
          {mark.detail.map((d, i) => <Path key={`d${i}`} d={d} fill={disc} />)}
          {(mark.top ?? []).map((d, i) => <Path key={`t${i}`} d={d} fill={color} />)}
        </G>
      ) : (
        <SvgText x={12} y={15.9} textAnchor="middle" fill={color} fontSize={9.4} fontFamily={FONT.num}>{initials}</SvgText>
      )}
    </Svg>
  );
}

/** Full-bleed background wash: olive field lit from the top. */
export function GradientBg() {
  const { C } = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill as any}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="matchdayBg" x1="0.1" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor={C.bgTop} />
            <Stop offset="0.22" stopColor={C.bgTop} stopOpacity={0.55} />
            <Stop offset="0.46" stopColor={C.bg} />
            <Stop offset="1" stopColor={C.bgBottom} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#matchdayBg)" />
      </Svg>
    </View>
  );
}

/** Overlapping squad avatars, as used on the reference match cards. */
export function AvatarStack({ names, size = 24, max = 4 }: { names: string[]; size?: number; max?: number }) {
  const { C, dark } = useTheme();
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {shown.map((n, i) => (
        <View key={i} style={{
          width: size, height: size, borderRadius: size, marginLeft: i ? -size * 0.34 : 0,
          backgroundColor: crestColor(n, dark) + (dark ? '2E' : '26'),
          borderWidth: 1.5, borderColor: C.surface, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontFamily: FONT.display, fontSize: size * 0.42, color: crestColor(n, dark) }}>
            {n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </Text>
        </View>
      ))}
      {extra > 0 ? (
        <View style={{
          minWidth: size, height: size, paddingHorizontal: 4, borderRadius: size, marginLeft: -size * 0.34,
          backgroundColor: C.surfaceHi, borderWidth: 1.5, borderColor: C.surface, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontFamily: FONT.display, fontSize: size * 0.4, color: C.dim }}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- motion
export function Fade({ k, children, style }: { k: string | number; children: React.ReactNode; style?: any }) {
  const { reduceMotion } = useTheme();
  const op = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const sl = useRef(new Animated.Value(reduceMotion ? 0 : 8)).current;
  useEffect(() => {
    if (reduceMotion) { op.setValue(1); sl.setValue(0); return; }
    op.setValue(0); sl.setValue(8);
    const a = Animated.parallel([
      Animated.timing(op, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(sl, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
    ]);
    a.start();
    return () => a.stop();
  }, [k, reduceMotion, op, sl]);
  return <Animated.View style={[style, { opacity: op, transform: [{ translateY: sl }] }]}>{children}</Animated.View>;
}

export function LiveDot({ size = 8, color }: { size?: number; color?: string }) {
  const { C, reduceMotion } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return <Animated.View style={{ width: size, height: size, borderRadius: size, backgroundColor: color ?? C.live, opacity: reduceMotion ? 1 : pulse }} />;
}

// ---------------------------------------------------------------- buttons
type BtnKind = 'solid' | 'outline' | 'ghost' | 'danger';
export function Btn({
  label, onPress, kind = 'solid', icon, iconRight, disabled, small, full, testID, accessibilityLabel,
}: {
  label: string; onPress: () => void; kind?: BtnKind; icon?: string; iconRight?: string;
  disabled?: boolean; small?: boolean; full?: boolean; testID?: string; accessibilityLabel?: string;
}) {
  const { C } = useTheme();
  const bg = disabled ? C.surfaceAlt : kind === 'solid' ? C.accent : kind === 'danger' ? C.badSoft : 'transparent';
  const fg = disabled ? C.faint : kind === 'solid' ? C.accentInk : kind === 'danger' ? C.bad : C.text;
  const bd = disabled ? C.border : kind === 'outline' ? C.borderHi : kind === 'danger' ? C.bad + '66' : 'transparent';
  return (
    <Pressable
      testID={testID ?? tid('btn', label)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: small ? 40 : TAP,
        paddingHorizontal: small ? SP.md : SP.xl,
        borderRadius: R.pill,
        backgroundColor: bg,
        borderWidth: disabled || kind === 'outline' || kind === 'danger' ? 1.5 : 0,
        borderColor: bd,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
        alignSelf: full ? 'stretch' : 'flex-start',
        opacity: pressed && !disabled ? 0.82 : 1,
        transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
      }]}>
      {icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} strokeWidth={2} /> : null}
      <Text style={{ fontFamily: FONT.semi, fontSize: small ? 13.5 : 15, color: fg, letterSpacing: 0.2 }}>{label}</Text>
      {iconRight ? <Icon name={iconRight} size={small ? 16 : 18} color={fg} strokeWidth={2} /> : null}
    </Pressable>
  );
}

export function IconBtn({ icon, label, onPress, badge, testID, tone }: { icon: string; label: string; onPress: () => void; badge?: number; testID?: string; tone?: string }) {
  const { C } = useTheme();
  return (
    <Pressable
      testID={testID ?? tid('iconbtn', label)}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} pending` : label}
      onPress={onPress}
      style={({ pressed }) => [{
        width: TAP, height: TAP, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: pressed ? C.surfaceHi : C.surface, borderWidth: 1, borderColor: C.border,
      }]}>
      <Icon name={icon} size={20} color={tone ?? C.text} />
      {badge ? (
        <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: C.live, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.surface }}>
          <Text style={{ fontFamily: FONT.display, fontSize: 11, color: '#fff' }}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------- surfaces
export function Card({ children, onPress, label, testID, style, tone }: { children: React.ReactNode; onPress?: () => void; label?: string; testID?: string; style?: any; tone?: 'plain' | 'raised' }) {
  const { C } = useTheme();
  const base = {
    backgroundColor: tone === 'raised' ? C.surfaceAlt : C.surface,
    borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: SP.lg, gap: SP.sm,
  };
  if (!onPress) return <View testID={testID} style={[base, style]}>{children}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [base, style, pressed && { backgroundColor: C.surfaceHi, transform: [{ scale: 0.995 }] }]}>
      {children}
    </Pressable>
  );
}

export function Divider() {
  const { C } = useTheme();
  return <View style={{ height: 1, backgroundColor: C.border }} />;
}

// ---------------------------------------------------------------- text
export function Title({ children, size = 26 }: { children: React.ReactNode; size?: number }) {
  const { C } = useTheme();
  return <Text accessibilityRole="header" style={{ fontFamily: FONT.display, fontSize: size, lineHeight: size * 1.14, color: C.text, letterSpacing: 0.2 }}>{children}</Text>;
}
export function Label({ children }: { children: React.ReactNode }) {
  const { C } = useTheme();
  return <Text style={{ fontFamily: FONT.semi, fontSize: 11.5, letterSpacing: 1.1, color: C.faint, textTransform: 'uppercase' }}>{children}</Text>;
}
export function Body({ children, dim, size = 14.5, numberOfLines }: { children: React.ReactNode; dim?: boolean; size?: number; numberOfLines?: number }) {
  const { C } = useTheme();
  return <Text numberOfLines={numberOfLines} style={{ fontFamily: FONT.body, fontSize: size, lineHeight: size * 1.5, color: dim ? C.dim : C.text }}>{children}</Text>;
}
export function Num({ children, size = 30, color }: { children: React.ReactNode; size?: number; color?: string }) {
  const { C } = useTheme();
  return <Text style={{ fontFamily: FONT.num, fontSize: size, lineHeight: size * 1.08, color: color ?? C.text, letterSpacing: 0.2 }}>{children}</Text>;
}

export function SectionHead({ title, action, onAction, icon, testID }: { title: string; action?: string; onAction?: () => void; icon?: string; testID?: string }) {
  const { C } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, flex: 1 }}>
        {icon ? <Icon name={icon} size={17} color={C.accent} strokeWidth={2} /> : null}
        <Text accessibilityRole="header" style={{ fontFamily: FONT.display, fontSize: 19, color: C.text, letterSpacing: 0.3 }}>{title}</Text>
      </View>
      {action && onAction ? (
        <Pressable testID={testID ?? tid('see', title)} accessibilityRole="button" accessibilityLabel={`${action}: ${title}`} onPress={onAction}
          style={({ pressed }) => [{ minHeight: 36, paddingHorizontal: SP.md, justifyContent: 'center', borderRadius: R.pill, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={{ fontFamily: FONT.semi, fontSize: 13, color: C.accent }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- status
export type StatusKind = 'live' | 'ok' | 'warn' | 'bad' | 'neutral' | 'accent';
/** Status is always icon + word + colour, never colour on its own. */
export function StatusTag({ kind, label, icon, testID, small }: { kind: StatusKind; label: string; icon?: string; testID?: string; small?: boolean }) {
  const { C } = useTheme();
  const map: Record<StatusKind, [string, string, string]> = {
    live: [C.live, C.liveSoft, 'flame'],
    ok: [C.ok, C.okSoft, 'check'],
    warn: [C.warn, C.warnSoft, 'clock'],
    bad: [C.bad, C.badSoft, 'close'],
    neutral: [C.dim, C.surfaceAlt, 'clock'],
    accent: [C.accent, C.accentSoft, 'bolt'],
  };
  const [fg, bg, defIcon] = map[kind];
  return (
    <View testID={testID} accessibilityLabel={label} style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: small ? 7 : 9, paddingVertical: small ? 3 : 5,
      borderRadius: R.pill, backgroundColor: bg, borderWidth: 1, borderColor: fg + '55',
    }}>
      {kind === 'live' && !icon ? <LiveDot size={6} color={fg} /> : <Icon name={icon ?? defIcon} size={small ? 11 : 12.5} color={fg} strokeWidth={2.4} />}
      <Text style={{ fontFamily: FONT.semi, fontSize: small ? 10.5 : 11.5, color: fg, letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- chips
export function Chip({ label, selected, onPress, icon, count, testID }: { label: string; selected?: boolean; onPress: () => void; icon?: string; count?: number; testID?: string }) {
  const { C } = useTheme();
  return (
    <Pressable
      testID={testID ?? tid('chip', label)}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: 40, paddingHorizontal: SP.lg, borderRadius: R.pill,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: selected ? C.accent : C.surface,
        borderWidth: 1, borderColor: selected ? C.accent : C.border,
        opacity: pressed ? 0.8 : 1,
      }]}>
      {icon ? <Icon name={icon} size={14} color={selected ? C.accentInk : C.dim} strokeWidth={2.2} /> : null}
      <Text style={{ fontFamily: FONT.semi, fontSize: 13, color: selected ? C.accentInk : C.dim, letterSpacing: 0.3 }}>{label}</Text>
      {count !== undefined ? (
        <Text style={{ fontFamily: FONT.display, fontSize: 13, color: selected ? C.accentInk : C.faint }}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: SP.sm, paddingVertical: 2, paddingRight: SP.lg }}>
      {children}
    </ScrollView>
  );
}

export function SegTabs({ tabs, value, onChange, testIDPrefix }: { tabs: [string, string][]; value: string; onChange: (v: any) => void; testIDPrefix?: string }) {
  const { C } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: C.surfaceAlt, borderRadius: R.pill, padding: 4, borderWidth: 1, borderColor: C.border }}>
      {tabs.map(([k, l]) => {
        const on = value === k;
        return (
          <Pressable key={k}
            testID={tid(testIDPrefix ?? 'seg', k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={l}
            onPress={() => onChange(k)}
            style={({ pressed }) => [{
              flex: 1, minHeight: 40, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? C.accent : 'transparent', opacity: pressed ? 0.85 : 1,
            }]}>
            <Text style={{ fontFamily: FONT.semi, fontSize: 13, color: on ? C.accentInk : C.dim }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- input
export function Field({
  label, value, onChangeText, placeholder, secure, keyboard, autoCapitalize, hint, testID, icon,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; secure?: boolean;
  keyboard?: any; autoCapitalize?: any; hint?: string; testID?: string; icon?: string;
}) {
  const { C } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: SP.sm,
        backgroundColor: C.surfaceAlt, borderRadius: R.md, paddingHorizontal: SP.md,
        borderWidth: 1.5, borderColor: focus ? C.accent : C.border, minHeight: TAP,
      }}>
        {icon ? <Icon name={icon} size={17} color={focus ? C.accent : C.faint} /> : null}
        <TextInput
          testID={testID ?? tid('input', label)}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={C.faint}
          secureTextEntry={secure}
          keyboardType={keyboard}
          autoCapitalize={autoCapitalize ?? 'none'}
          autoCorrect={false}
          selectionColor={C.accent}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{ flex: 1, minHeight: TAP, color: C.text, fontFamily: FONT.body, fontSize: 15, outlineStyle: 'none' } as any}
        />
      </View>
      {hint ? <Text style={{ fontFamily: FONT.body, fontSize: 12, color: C.faint }}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------- feedback
export function EmptyState({ icon = 'info', title, text, action }: { icon?: string; title: string; text: string; action?: React.ReactNode }) {
  const { C } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: SP.sm, paddingVertical: SP.xxl, paddingHorizontal: SP.lg }}>
      <View style={{ width: 56, height: 56, borderRadius: R.pill, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border }}>
        <Icon name={icon} size={24} color={C.faint} />
      </View>
      <Text style={{ fontFamily: FONT.display, fontSize: 19, color: C.text }}>{title}</Text>
      <Text style={{ fontFamily: FONT.body, fontSize: 14, color: C.dim, textAlign: 'center', lineHeight: 21 }}>{text}</Text>
      {action}
    </View>
  );
}

export function Banner({ kind, title, text, testID }: { kind: StatusKind; title: string; text?: string; testID?: string }) {
  const { C } = useTheme();
  const map: Record<StatusKind, [string, string, string]> = {
    live: [C.live, C.liveSoft, 'flame'], ok: [C.ok, C.okSoft, 'check'], warn: [C.warn, C.warnSoft, 'alert'],
    bad: [C.bad, C.badSoft, 'alert'], neutral: [C.dim, C.surfaceAlt, 'info'], accent: [C.accent, C.accentSoft, 'info'],
  };
  const [fg, bg, icon] = map[kind];
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: SP.md, backgroundColor: bg, borderRadius: R.md, borderWidth: 1, borderColor: fg + '55', padding: SP.md }}>
      <Icon name={icon} size={18} color={fg} strokeWidth={2.2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: FONT.semi, fontSize: 13.5, color: fg }}>{title}</Text>
        {text ? <Text style={{ fontFamily: FONT.body, fontSize: 13, color: C.text, lineHeight: 19 }}>{text}</Text> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- sheet
export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const { C } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        <View testID={testID} style={{ backgroundColor: C.bgSoft, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderWidth: 1, borderColor: C.border, padding: SP.lg, gap: SP.md, maxHeight: '86%' }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.borderHi }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title size={21}>{title}</Title>
            <IconBtn icon="close" label="Close" onPress={onClose} testID="sheet-close" />
          </View>
          <ScrollView contentContainerStyle={{ gap: SP.md, paddingBottom: SP.lg }}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- misc
export function KeyVal({ k, v, icon }: { k: string; v: string; icon?: string }) {
  const { C } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 34 }}>
      {icon ? <Icon name={icon} size={15} color={C.faint} /> : null}
      <Text style={{ fontFamily: FONT.body, fontSize: 13.5, color: C.dim, flex: 1 }}>{k}</Text>
      <Text style={{ fontFamily: FONT.semi, fontSize: 13.5, color: C.text }}>{v}</Text>
    </View>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  const { C } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2, alignItems: 'center', paddingVertical: SP.sm, backgroundColor: C.surfaceAlt, borderRadius: R.md, borderWidth: 1, borderColor: C.border }}>
      <Num size={24} color={tone}>{value}</Num>
      <Text style={{ fontFamily: FONT.semi, fontSize: 10.5, color: C.faint, letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- reference components
/** Sport selector: coloured disc + label, lime ring when active. Driven by the sport config. */
export function SportChip({ label, icon, color, selected, onPress, testID }: { label: string; icon: string; color: string; selected?: boolean; onPress: () => void; testID?: string }) {
  const { C } = useTheme();
  return (
    <Pressable testID={testID ?? tid('sport', label)} accessibilityRole="tab" accessibilityState={{ selected: !!selected }} accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: 46, paddingLeft: 5, paddingRight: SP.lg, borderRadius: R.pill,
        flexDirection: 'row', alignItems: 'center', gap: SP.sm,
        backgroundColor: C.surface, borderWidth: 1.5,
        borderColor: selected ? C.accent : C.border, opacity: pressed ? 0.84 : 1,
      }]}>
      <View style={{ width: 34, height: 34, borderRadius: R.pill, backgroundColor: color + '2E', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={color} strokeWidth={2.1} />
      </View>
      <Text style={{ fontFamily: FONT.semi, fontSize: 13.5, color: selected ? C.text : C.dim }}>{label}</Text>
    </Pressable>
  );
}

/** Weekday rail — the lime ring marks the active date. */
export function DateStrip({ dates, value, onChange }: { dates: Date[]; value: string; onChange: (iso: string) => void }) {
  const { C } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.xs, paddingRight: SP.lg }}>
      {dates.map((d) => {
        const iso = d.toISOString().slice(0, 10);
        const on = iso === value;
        return (
          <Pressable key={iso} testID={tid('date', iso)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            onPress={() => onChange(iso)}
            style={({ pressed }) => [{ width: 46, minHeight: TAP + 10, alignItems: 'center', justifyContent: 'center', gap: 4, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ fontFamily: FONT.body, fontSize: 11.5, color: on ? C.text : C.faint }}>
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </Text>
            <View style={{
              width: 32, height: 32, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center',
              borderWidth: on ? 1.6 : 0, borderColor: C.accent, backgroundColor: on ? C.accentSoft : 'transparent',
            }}>
              <Text style={{ fontFamily: FONT.display, fontSize: 16, color: on ? C.accent : C.dim }}>{d.getDate()}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** League selector pill carrying the competition crest. */
export function LeaguePill({ name, selected, onPress, testID }: { name: string; selected?: boolean; onPress: () => void; testID?: string }) {
  const { C } = useTheme();
  return (
    <Pressable testID={testID ?? tid('leaguepill', name)} accessibilityRole="tab" accessibilityState={{ selected: !!selected }} accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [{
        minHeight: 44, paddingLeft: 5, paddingRight: SP.lg, borderRadius: R.pill,
        flexDirection: 'row', alignItems: 'center', gap: SP.sm,
        backgroundColor: C.surface, borderWidth: 1.5, borderColor: selected ? C.accent : C.border,
        opacity: pressed ? 0.84 : 1,
      }]}>
      <Crest name={name} size={32} />
      <Text numberOfLines={1} style={{ fontFamily: FONT.semi, fontSize: 13, color: selected ? C.text : C.dim, maxWidth: 150 }}>{name}</Text>
    </Pressable>
  );
}

/** Circular control used for back / overflow, as on the reference headers. */
export function RoundBtn({ icon, label, onPress, testID, filled }: { icon: string; label: string; onPress: () => void; testID?: string; filled?: boolean }) {
  const { C } = useTheme();
  return (
    <Pressable testID={testID ?? tid('round', label)} accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [{
        width: TAP, height: TAP, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: filled ? C.accent : C.surface, borderWidth: 1, borderColor: filled ? C.accent : C.border,
        opacity: pressed ? 0.82 : 1,
      }]}>
      <Icon name={icon} size={20} color={filled ? C.accentInk : C.text} />
    </Pressable>
  );
}

/**
 * The signature card: a fixture rendered as a broadcast tile.
 * `lime` lifts the most important match out of the page the way the reference does.
 */
export function FeatureMatch({
  league, status, statusKind, home, away, homeScore, awayScore, meta, footer, lime, onPress, testID, squad,
}: {
  league: string; status: string; statusKind: StatusKind; home: string; away: string;
  homeScore?: number | null; awayScore?: number | null; meta?: string; footer?: string;
  lime?: boolean; onPress: () => void; testID?: string; squad?: string[];
}) {
  const { C, dark } = useTheme();
  const ink = lime ? C.accentInk : C.text;
  const inkDim = lime ? (dark ? 'rgba(20,28,6,0.62)' : 'rgba(20,28,6,0.6)') : C.dim;
  const chipBg = lime ? 'rgba(18,24,8,0.86)' : C.surfaceAlt;
  const chipInk = lime ? C.accent : statusKind === 'live' ? C.live : C.dim;
  const scored = homeScore !== null && homeScore !== undefined;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${home} versus ${away}, ${status}${scored ? `, ${homeScore} to ${awayScore}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [{
        borderRadius: R.xl, padding: SP.lg, gap: SP.md,
        backgroundColor: lime ? C.accent : C.surface,
        borderWidth: 1, borderColor: lime ? C.accent : C.border,
        transform: [{ scale: pressed ? 0.995 : 1 }],
      }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.semi, fontSize: 13.5, color: ink }}>{league}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: chipBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.pill }}>
          {statusKind === 'live' ? <LiveDot size={6} color={lime ? C.accent : C.live} /> : null}
          <Text style={{ fontFamily: FONT.semi, fontSize: 10.5, letterSpacing: 0.8, color: chipInk, textTransform: 'uppercase' }}>{status}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, alignItems: 'center', gap: 7 }}>
          <Crest name={home} size={46} />
          <Text numberOfLines={1} style={{ fontFamily: FONT.semi, fontSize: 12, color: ink, letterSpacing: 0.4, textTransform: 'uppercase' }}>{home}</Text>
        </View>
        <View style={{ alignItems: 'center', paddingHorizontal: SP.xs, minWidth: 96 }}>
          {meta ? <Text style={{ fontFamily: FONT.body, fontSize: 10.5, color: inkDim }}>{meta}</Text> : null}
          <Text style={{ fontFamily: FONT.num, fontSize: 32, lineHeight: 36, color: ink, letterSpacing: -1 }}>
            {scored ? `${homeScore} : ${awayScore}` : 'VS'}
          </Text>
          {footer ? <Text style={{ fontFamily: FONT.semi, fontSize: 10, color: inkDim, letterSpacing: 0.6, textTransform: 'uppercase' }}>{footer}</Text> : null}
        </View>
        <View style={{ flex: 1, alignItems: 'center', gap: 7 }}>
          <Crest name={away} size={46} />
          <Text numberOfLines={1} style={{ fontFamily: FONT.semi, fontSize: 12, color: ink, letterSpacing: 0.4, textTransform: 'uppercase' }}>{away}</Text>
        </View>
      </View>

      {squad && squad.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderTopWidth: 1, borderTopColor: lime ? 'rgba(20,28,6,0.16)' : C.border, paddingTop: SP.sm }}>
          <AvatarStack names={squad} size={22} />
          <Text style={{ fontFamily: FONT.body, fontSize: 11.5, color: inkDim }}>{squad.length} players listed</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Uppercase section tabs with a violet underline on the active item. */
export function UnderlineTabs({ tabs, value, onChange, testIDPrefix }: { tabs: [string, string][]; value: string; onChange: (v: any) => void; testIDPrefix?: string }) {
  const { C } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.xl, paddingRight: SP.lg }}>
      {tabs.map(([k, l]) => {
        const on = value === k;
        return (
          <Pressable key={k} testID={tid(testIDPrefix ?? 'tab', k)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={l}
            onPress={() => onChange(k)}
            style={({ pressed }) => [{ minHeight: 44, justifyContent: 'center', gap: 6, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ fontFamily: on ? FONT.display : FONT.semi, fontSize: 13, letterSpacing: 1.3, textTransform: 'uppercase', color: on ? C.text : C.faint }}>{l}</Text>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: on ? C.accent : 'transparent' }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Horizontal rail of competition crests. */
export function LeagueRail({ leagues, value, onChange }: { leagues: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const { C } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.md, paddingRight: SP.lg, paddingVertical: 2 }}>
      {leagues.map((l) => {
        const on = value === l.id;
        return (
          <Pressable key={l.id} testID={tid('leaguerail', l.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={l.name}
            onPress={() => onChange(l.id)}
            style={({ pressed }) => [{
              width: 54, height: 54, borderRadius: R.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: on ? C.accentSoft : C.surface, borderWidth: 1.5, borderColor: on ? C.accent : C.border,
              opacity: pressed ? 0.8 : 1,
            }]}>
            <Crest name={l.name} size={34} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Fixture panel in the broadcast style: competition strip on top, the two sides
 * flanking a large centre readout.
 */
export function MatchPanel({
  league, live, statusWord, home, away, centreTop, centre, centreBottom, onPress, testID, meta,
}: {
  league: string; live?: boolean; statusWord: string; home: string; away: string;
  centreTop?: string; centre: string; centreBottom?: string; meta?: string;
  onPress: () => void; testID?: string;
}) {
  const { C } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button"
      accessibilityLabel={`${home} versus ${away}, ${statusWord}, ${centre}`}
      onPress={onPress}
      style={({ pressed }) => [{
        borderRadius: R.xl, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
        overflow: 'hidden', opacity: pressed ? 0.9 : 1,
      }]}>
      {/* competition strip */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: SP.md, paddingVertical: 7, backgroundColor: C.surfaceAlt }}>
        <Crest name={league} size={16} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.body, fontSize: 10.5, color: C.dim }}>{league}</Text>
        {live ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <LiveDot size={5} />
            <Text style={{ fontFamily: FONT.semi, fontSize: 9.5, letterSpacing: 0.8, color: C.live, textTransform: 'uppercase' }}>Live</Text>
          </View>
        ) : (
          <Text style={{ fontFamily: FONT.semi, fontSize: 9.5, letterSpacing: 0.8, color: C.faint, textTransform: 'uppercase' }}>{statusWord}</Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', padding: SP.md }}>
        <View style={{ flex: 1, alignItems: 'center', gap: 7 }}>
          <Crest name={home} size={42} />
          <Text numberOfLines={2} style={{ fontFamily: FONT.semi, fontSize: 10.5, letterSpacing: 0.5, color: C.text, textAlign: 'center', textTransform: 'uppercase' }}>{home}</Text>
        </View>
        <View style={{ minWidth: 92, alignItems: 'center', gap: 1 }}>
          {centreTop ? <Text style={{ fontFamily: FONT.body, fontSize: 10, color: C.faint }}>{centreTop}</Text> : null}
          <Text style={{ fontFamily: FONT.display, fontSize: 26, letterSpacing: -0.9, color: live ? C.live : C.text }}>{centre}</Text>
          {centreBottom ? <Text style={{ fontFamily: FONT.semi, fontSize: 9.5, letterSpacing: 0.7, color: C.faint, textTransform: 'uppercase' }}>{centreBottom}</Text> : null}
        </View>
        <View style={{ flex: 1, alignItems: 'center', gap: 7 }}>
          <Crest name={away} size={42} />
          <Text numberOfLines={2} style={{ fontFamily: FONT.semi, fontSize: 10.5, letterSpacing: 0.5, color: C.text, textAlign: 'center', textTransform: 'uppercase' }}>{away}</Text>
        </View>
      </View>

      {meta ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SP.md, paddingBottom: SP.md }}>
          <Icon name="pin" size={11} color={C.faint} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT.body, fontSize: 10.5, color: C.faint }}>{meta}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export const sheetStyles = StyleSheet.create({});
