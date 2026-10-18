import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, ActivityIndicator, Alert, BackHandler, FlatList, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';
import Svg, { Path, Circle, Rect, Line, Text as SvgText } from 'react-native-svg';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ApiFailure, friendly, nowIso, pkr, request, today, uid } from './src/api';
import { getJson, removeKey, savePdf, secure, setJson } from './src/storage';

// ---------- types ----------
type Net = 'online' | 'offline' | 'syncing';
type User = { user_id: string; email: string; role: string; tenant_id: string | null; league_ids: string[]; club_id: string | null; player_id: string | null };
type QueuedAction = { action: any; label: string };
type SyncLine = { label: string; status: string; message: string };
type Route =
  | { name: 'tabs' } | { name: 'match'; id: string } | { name: 'product'; id: string } | { name: 'cart' }
  | { name: 'receipt'; order: any } | { name: 'club'; id: string } | { name: 'move'; playerId: string } | { name: 'settings' }
  | { name: 'player'; id: string } | { name: 'orders' };
type Tab = 'calendar' | 'fixtures' | 'standings' | 'store' | 'club' | 'sync' | 'control';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Platform Super-Admin', league_organizer: 'League Organizer', club_manager: 'Club Manager', player: 'Player', viewer: 'Viewer',
};
/** Icon per discipline, chosen from the sport's name. Presentation only: scoring still comes from the sport config. */
const sportIcon = (name: string, id: string) => {
  const n = `${name ?? ''} ${id ?? ''}`.toLowerCase();
  if (n.includes('basket')) return 'basket';
  if (n.includes('cricket')) return 'cricket';
  if (n.includes('tennis') || n.includes('badminton') || n.includes('squash')) return 'tennis';
  if (n.includes('esport') || n.includes('gaming') || n.includes('valorant') || n.includes('fifa')) return 'esports';
  if (n.includes('hockey')) return 'hockey';
  return 'ball';
};
const DEMO = ['organizer', 'manager', 'player', 'viewer', 'admin'];
/** Stable automation ids (Appium resource-id / Selenium data-testid). Derived from the label so they never drift. */
const tid = (...parts: (string | number | null | undefined)[]) =>
  parts.filter((x) => x !== null && x !== undefined && x !== '').join('-')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Navigation per role: each tier only sees destinations it can actually act on. */
function tabsForRole(role: string): [string, string, string][] {
  const home: [string, string, string] = ['fixtures', 'Home', 'home'];
  const cal: [string, string, string] = ['calendar', 'Calendar', 'calendar'];
  const table: [string, string, string] = ['standings', 'Table', 'trophy'];
  const shop: [string, string, string] = ['store', 'Shop', 'shop'];
  const third: [string, string, string] =
    role === 'league_organizer' || role === 'super_admin' ? ['control', 'Control', 'flag']
      : role === 'club_manager' ? ['club', 'Squad', 'people']
        : role === 'player' ? ['club', 'My Club', 'people']
          : ['club', 'Clubs', 'people'];
  return [home, cal, third, table, shop];
}

// ---------- small UI kit (consistent spacing, 48dp targets, labels) ----------
// Presentation only. The app's requests, routes, permissions and offline queue are unchanged.
const PALETTES = {
 dark: {bg:'#151515',card:'#222221',text:'#f7f5ee',muted:'#b3b0a9',border:'#3a3834',ok:'#9ed2ae',bad:'#ff9485',warn:'#f5d668',accent:'#f4d35c',onAccent:'#282416',soft:'#2c2a25',hot:'#ed5a49',input:'#20201f',hero:'#f4d35c',heroText:'#282416'},
 light: {bg:'#ffffff',card:'#ffffff',text:'#292a28',muted:'#6b6f68',border:'#eeefeb',ok:'#36794b',bad:'#bc392c',warn:'#806516',accent:'#efcf55',onAccent:'#332a11',soft:'#f6f5f1',hot:'#d93d30',input:'#ffffff',hero:'#f5d662',heroText:'#292519'},
};
type Palette = typeof PALETTES.dark;
const C = PALETTES.dark;
const VisualContext = createContext<{ C: Palette; s: ReturnType<typeof createStyles>; dark: boolean; toggle: () => void; wide: boolean } | null>(null);
function useVisual() {
  const value = useContext(VisualContext);
  if (!value) throw new Error('Visual theme is missing.');
  return value;
}

// Motion is presentation-only and respects the system's reduced-motion setting.
function MotionPanel({ children, transitionKey, style }: { children: React.ReactNode; transitionKey: string; style?: any }) {
  const progress = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  useEffect(() => {
    progress.stopAnimation();
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [transitionKey, reduced, progress]);
  return <Animated.View style={[style, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }), transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>{children}</Animated.View>;
}
function TeamMark({name,large=false}: {name:string;large?:boolean}) {
 const {s}=useVisual();const hash=Array.from(name).reduce((a,c)=>a+c.charCodeAt(0),0);const colors=['#c63e30','#9a661a','#263a34','#98442f'];const color=colors[hash%colors.length];
 const initials=name.split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase();
 return <View style={[s.crest,large&&s.crestLarge]}><Svg width={large?57:39} height={large?62:43} viewBox="0 0 60 66"><Path d="M5 6L30 2l25 4v28c0 15-15 24-25 30C20 58 5 49 5 34Z" fill={color}/><Path d="M10 10l20-3 20 3v24c0 12-12 21-20 25-8-4-20-13-20-25Z" fill="none" stroke="#fff8e8" strokeWidth="1.3"/><Path d="M12 14h36v6H12z" fill="#f4d35c"/><SvgText x="30" y="44" textAnchor="middle" fontFamily="BarlowCondensed-Bold" fontWeight="bold" fontSize="24" fill="#ffffff">{initials}</SvgText><Path d="M23 51h14" stroke="#f4d35c" strokeWidth="2"/></Svg></View>;
}

const STADIUM = require('./assets/stadium.jpg');
const TRAINING = require('./assets/training.jpg');
function SportsPhoto({ training = false, style }: { training?: boolean; style?: any }) {
  const asset = training ? TRAINING : STADIUM;
  return <Image accessibilityIgnoresInvertColors source={typeof asset === 'string' ? { uri: asset } : asset} resizeMode="cover" style={style} />;
}
function PageHeading({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  const { s } = useVisual();
  return <View style={s.sectionHeading}><View style={{ flex: 1 }}><Text style={s.pageTitle}>{title}</Text><Text style={s.muted}>{detail}</Text></View>{action}</View>;
}
function LeagueGlance({ boot, teamName, setTab, push }: any) {
  const { s, C } = useVisual();
  const league = boot?.standings?.[0];
  return <View style={s.glance}>
    <View style={s.rowBetween}><Text style={s.sectionTitle}>The standings</Text><Icon name="trophy" size={23}/></View>
    <Text style={s.muted}>{league?.name ?? 'League table'}</Text>
    <View style={s.miniTableHeading}><Text style={s.muted}>CLUB</Text><Text style={s.muted}>PTS</Text></View>
    {(league?.table ?? []).slice(0,4).map((r: any) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${teamName(r.team_id)}`} key={r.team_id} onPress={() => push({name:'club',id:r.team_id})} style={s.miniTableRow}><Text style={s.miniRank}>{r.rank}</Text><TeamMark name={teamName(r.team_id)} /><Text style={s.miniTeam} numberOfLines={1}>{teamName(r.team_id)}</Text><Text style={s.miniPoints}>{r.points}</Text></Pressable>)}
    <Pressable accessibilityRole="button" onPress={() => setTab('standings')} style={s.tableLink}><Text style={s.tableLinkText}>Full league table</Text><Text style={{color:C.accent,fontSize:20}}>↗</Text></Pressable>
  </View>;
}
function Navigation({tab,onSelect,queue,cart,user}:any){
 const {s,C,wide}=useVisual();
 const tabs=tabsForRole(user?.role??'viewer');
 return <View style={s.tabs}>{tabs.map(([key,label,icon])=>{
  const on=tab===key;
  const badge=key==='store'?cart.length:0;
  return <Pressable key={key}
    testID={tid('nav',key)}
    accessibilityRole="tab"
    accessibilityLabel={badge?`${label}, ${badge} in cart`:label}
    accessibilityState={{selected:on}}
    onPress={()=>onSelect(key)}
    style={({pressed})=>[s.tab,on&&s.tabSelected,pressed&&{opacity:.65}]}>
    <Icon name={icon} size={wide?21:22} color={on?C.hot:C.muted}/>
    {wide?<Text numberOfLines={1} style={[s.tabText,on&&s.tabTextSelected]}>{label}</Text>:null}
    {badge?<View style={s.tabBadge}><Text style={s.tabBadgeText}>{badge}</Text></View>:null}
  </Pressable>;
 })}</View>;
}
function Icon({name='arrow',size=20,color,style}: {name?:string;size?:number;color?:string;style?:any}) {
 const {C}=useVisual();
 const paths:Record<string,string>={
  home:'M3 11l9-8 9 8 M5 10v11h5v-7h4v7h5V10',bell:'M6 8a6 6 0 0 1 12 0v7l3 3H3l3-3z M9 21h6',plus:'M12 4v16 M4 12h16',image:'M3 3h18v18H3z M3 17l6-7 5 5 3-3 4 5 M17 7h.01',people:'M15 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0 M5 21v-2a7 7 0 0 1 14 0v2 M4 5a3 3 0 0 0 0 6 M20 5a3 3 0 0 1 0 6',crown:'M3 7l4 4 5-7 5 7 4-4-3 12H6z M7 22h10',close:'M5 5l14 14 M19 5L5 19',chevron:'M9 5l7 7-7 7',
  overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  calendar:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h1 M15 14h1 M8 18h1',
  trophy:'M8 3h8v6a4 4 0 0 1-8 0z M8 5H4v3a4 4 0 0 0 4 4 M16 5h4v3a4 4 0 0 1-4 4 M12 13v6 M8 21h8',
  shop:'M4 7h16l1 14H3z M8 7V5a4 4 0 0 1 8 0v2',
  club:'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z',
  sync:'M20 7a9 9 0 0 0-15-2L2 8 M2 3v5h5 M4 17a9 9 0 0 0 15 2l3-3 M22 21v-5h-5',
  sun:'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2 M16 12a4 4 0 1 0-8 0 4 4 0 0 0 8 0',
  moon:'M20 15a9 9 0 1 1-11-11 7 7 0 0 0 11 11',
  settings:'M9 3h6l1 4 4 1v7l-4 1-1 5H9l-1-5-4-1V8l4-1z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  arrow:'M5 12h14 M13 6l6 6-6 6',back:'M19 12H5 M11 6l-6 6 6 6',
  pin:'M12 22s7-8 7-13a7 7 0 1 0-14 0c0 5 7 13 7 13 M15 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  check:'M4 12l5 5L20 6',search:'M16 16l5 5 M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0',
  user:'M16 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  flag:'M5 22V3h15l-3 5 3 5H5',ball:'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0 M12 7l5 4-2 6H9l-2-6z',
  basket:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3v18M5.6 5.6c3.6 3.6 3.6 9.2 0 12.8M18.4 5.6c-3.6 3.6-3.6 9.2 0 12.8',
  cricket:'M14.8 3.3 20.7 9.2 13.4 16.5 7.5 10.6zM6.6 14.7l2.7 2.7-3.2 3.2a1.9 1.9 0 0 1-2.7-2.7zM20.5 18.2a2.4 2.4 0 1 1-4.8 0 2.4 2.4 0 0 1 4.8 0',
  tennis:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M4.4 7.3c4.3 1.2 6.9 4.5 7.4 9.2M19.6 7.3c-4.3 1.2-6.9 4.5-7.4 9.2',
  esports:'M7.5 9.5h9a4.5 4.5 0 0 1 4.3 5.8l-.6 2a2.4 2.4 0 0 1-4.3.6L14.4 15H9.6l-1.5 2.9a2.4 2.4 0 0 1-4.3-.6l-.6-2A4.5 4.5 0 0 1 7.5 9.5zM7 12v2.4M5.8 13.2h2.4M15.6 12.4h.1M17.4 14h.1',
  hockey:'M4.5 3.5v9.2a6.3 6.3 0 0 0 6.3 6.3h4.7M16.2 16.6h4.3v3.9h-4.3z',
 };
 return <Svg width={size} height={size} viewBox="0 0 24 24" style={style} fill="none" stroke={color??C.text} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><Path d={paths[name]??paths.arrow}/></Svg>;
}
function KitVisual(){
 const {s}=useVisual();return <View style={s.productVisual}><Svg width={240} height={230} viewBox="0 0 240 230"><Path d="M80 30L38 50 12 102l43 22 17-26v107h96V98l17 26 43-22-26-52-42-20-40 16z" fill="#254f82"/><Path d="M80 30l40 16 40-16-16 35h-48z" fill="#17314f"/><Path d="M72 110h96v12H72z" fill="#f1f2ed"/><Path d="M72 122h96v5H72z" fill="#e85837"/><SvgText x="120" y="96" fontSize="14" fontWeight="bold" fill="white" textAnchor="middle">ALPHA</SvgText><SvgText x="120" y="174" fontSize="37" fontWeight="bold" fill="white" textAnchor="middle">26</SvgText></Svg><Text style={s.kitCaption}>Illustrative club kit</Text></View>;
}

function ThemeToggle() {
  const { s, dark, toggle } = useVisual();
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: dark }} accessibilityLabel="Dark mode" onPress={toggle} style={({ pressed }) => [s.themeToggle, pressed && { opacity: 0.65 }]}>
    <Icon name={dark?'sun':'moon'} size={20}/><Text style={s.themeLabel}>{dark ? 'Light' : 'Dark'}</Text>
  </Pressable>;
}

function Btn({ label, onPress, color, kind = 'solid', disabled, small, testID, accessibilityLabel }: { label: string; onPress: () => void; color: string; kind?: 'solid' | 'outline'; disabled?: boolean; small?: boolean; testID?: string; accessibilityLabel?: string }) {
  const { s, C } = useVisual();
  const danger = color === C.bad || color === PALETTES.dark.bad || color === PALETTES.light.bad;
  const tint = danger ? C.bad : C.accent;
  return (
    <Pressable testID={testID ?? tid('btn', label)} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, small && s.btnSmall, kind === 'solid' ? { backgroundColor: tint } : { borderColor: C.border, borderWidth: 1, backgroundColor: C.card },
        pressed && { transform: [{ scale: 0.97 }] }, (pressed || disabled) && { opacity: 0.7 }]}>
      <Text style={[s.btnText, { color: kind === 'solid' ? (danger ? C.bg : C.onAccent) : danger ? C.bad : C.text }]}>{label}</Text>
    </Pressable>
  );
}
function Card({ children, onPress, label, testID }: { children: React.ReactNode; onPress?: () => void; label?: string; testID?: string }) {
  const { s } = useVisual();
  return onPress ? <Pressable testID={testID ?? tid('card', label)} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}>{children}</Pressable>
    : <View style={s.card}>{children}</View>;
}
function H({ children }: { children: React.ReactNode }) { const { s } = useVisual(); return <Text accessibilityRole="header" style={s.h}>{children}</Text>; }
function Muted({ children }: { children: React.ReactNode }) { const { s } = useVisual(); return <Text style={s.muted}>{children}</Text>; }
function Empty({ text }: { text: string }) { const { s, C } = useVisual(); return <View style={s.empty}><Icon name="calendar" size={40} color={C.muted}/><Text style={s.emptyTitle}>Nothing here just yet.</Text><Text style={[s.muted, { textAlign: 'center' }]}>{text}</Text></View>; }
function Badge({ text, color }: { text: string; color: string }) { const { s } = useVisual(); return <View style={[s.badge, { borderColor: color }]}><Text style={[s.badgeText, { color }]}>{text}</Text></View>; }

const STATUS: Record<string, [string, string]> = {
  upcoming: ['Upcoming', C.muted], in_progress: ['● Live', C.bad], completed: ['Full time', C.ok],
  clinched: [' Qualified', C.ok], eliminated: [' Out', C.bad], still_possible: ['In contention', C.warn],
};

export default function App() {
  const [dark, setDark] = useState(false);
  const { width } = useWindowDimensions();
  // Preference persistence is separate from domain storage and never blocks startup.
  useEffect(() => { getJson<boolean>('ui_dark_mode', false).then(setDark); }, []);
  const toggle = useCallback(() => setDark((value) => { void setJson('ui_dark_mode', !value); return !value; }), []);
  const visual = useMemo(() => {
    const colors = dark ? PALETTES.dark : PALETTES.light;
    return { C: colors, s: createStyles(colors, width), dark, toggle, wide: width >= 840 };
  }, [dark, width, toggle]);
  return (
    <VisualContext.Provider value={visual}>
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
    </VisualContext.Provider>
  );
}

function Root() {
  const { s, C, dark, wide } = useVisual();
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState('http://10.0.2.2:8080');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [boot, setBoot] = useState<any>(null);
  const [net, setNet] = useState<Net>('offline');
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [lastSync, setLastSync] = useState<SyncLine[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);
  const [tab, setTab] = useState<Tab>('fixtures');
  const [cart, setCart] = useState<{ variant_id: string; quantity: number; name: string; price: number }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const syncing = useRef(false);

  const primary = boot?.tenant?.colors?.primary ?? '#1d4ed8';
  const push = (r: Route) => setStack((x) => [...x, r]);
  const pop = useCallback(() => setStack((x) => (x.length > 1 ? x.slice(0, -1) : x)), []);
  const say = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // restore persisted state (works fully offline)
  useEffect(() => {
    (async () => {
      setServer(await getJson('server', 'http://10.0.2.2:8080'));
      const t = await secure.get('token');
      setToken(t);
      setUser(await getJson<User | null>('user', null));
      setBoot(await getJson('bootstrap', null));
      setQueue(await getJson<QueuedAction[]>('queue', []));
      setLastSync(await getJson<SyncLine[]>('lastSync', []));
      setOrders(await getJson<any[]>('orders', []));
      let d = await getJson<string>('device_id', '');
      if (!d) { d = uid('dev'); await setJson('device_id', d); }
      setDeviceId(d);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) { pop(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack, pop]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const data = await request<any>(server, '/api/v1/bootstrap', { token });
      setBoot(data);
      await setJson('bootstrap', data);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { setToken(null); await secure.remove('token'); }
    }
  }, [server, token]);

  const runSync = useCallback(async (q: QueuedAction[]) => {
    if (!q.length || syncing.current) return;
    syncing.current = true;
    setNet('syncing');
    try {
      const res = await request<any>(server, '/audit/v1/offline-sync', { method: 'POST', body: { device_id: deviceId, actions: q.map((x) => x.action) }, timeoutMs: 15000 });
      const lines: SyncLine[] = res.results.map((r: any, i: number) => ({
        label: q[i].label,
        status: r.status,
        message: r.status === 'applied' ? (r.resolution === 'rebased_append' ? 'Saved (merged with newer changes on the server).' : 'Saved.')
          : r.status === 'duplicate' ? 'Already saved earlier. Nothing changed.' : `Not saved: ${friendly(r.error_code)}`,
      }));
      setLastSync(lines);
      await setJson('lastSync', lines);
      setQueue([]);
      await setJson('queue', []);
      const bad = lines.filter((l) => l.status === 'rejected').length;
      say(bad ? `Synced. ${bad} change(s) were rejected, see Sync.` : 'All offline changes synced.');
      setNet('online');
      await refresh();
    } catch {
      setNet('offline');
    } finally {
      syncing.current = false;
    }
  }, [server, deviceId, refresh]);

  // connectivity probe; auto-sync the queue as soon as the server is reachable
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const probe = async () => {
      try {
        await request(server, '/health', { timeoutMs: 2500 });
        if (!alive) return;
        if (!syncing.current) setNet('online');
        const q = await getJson<QueuedAction[]>('queue', []);
        if (q.length && token) runSync(q);
      } catch {
        if (alive && !syncing.current) setNet('offline');
      }
    };
    probe();
    const t = setInterval(probe, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [ready, server, token, runSync]);

  useEffect(() => { if (token && net === 'online') refresh(); }, [token, net === 'online']); // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = async (action: any, label: string) => {
    const q = [...(await getJson<QueuedAction[]>('queue', [])), { action, label }];
    setQueue(q);
    await setJson('queue', q);
    if (net === 'online') runSync(q);
    else say('Saved offline. It will sync when you are back online.');
  };

  if (!ready) return <View style={s.center}><ActivityIndicator size="large" /></View>;

  if (!token || !user)
    return (
      <Login server={server} onServer={async (v) => { setServer(v); await setJson('server', v); }}
        onDone={async (t, u) => { await secure.set('token', t); await setJson('user', u); setToken(t); setUser(u); setStack([{ name: 'tabs' }]); }} />
    );

  const route = stack[stack.length - 1];
  const teamName = (id: string) => boot?.clubs?.find((c: any) => c.club_id === id)?.name ?? id;
  const saveOrder = async (o: any) => { const next = [o, ...orders].slice(0, 30); setOrders(next); await setJson('orders', next); };
  const ctx = { server, token, user, boot, net, primary, push, pop, teamName, enqueue, say, cart, setCart, queue, lastSync, runSync, refresh, deviceId, setTab, orders, saveOrder };

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.appFrame}>
      <View style={s.appMain}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={s.header}>
        {stack.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={pop} style={s.headerBtn}><Icon name="back" size={22}/></Pressable>
        ) : (
          <View style={s.brandLockup}><View style={s.brandMark}><Svg width={28} height={28} viewBox="0 0 28 28"><Path d="M6 7h16v5H11v10H6z M15 15h5v7h-5z" fill="#fff"/></Svg></View><Text style={s.brandName} numberOfLines={1}>CLUB|HOUSE</Text></View>
        )}
        <View style={{ flex: 1, marginHorizontal: 16, display:wide||stack.length>1?'flex':'none' }}>
          <Text style={s.headerTitle} numberOfLines={1}>{wide ? (boot?.tenant?.name ?? 'Club House') : route.name === 'club' ? 'Club' : route.name === 'match' ? 'Match' : route.name === 'settings' ? 'Settings' : 'Club House'}</Text>
          <Text style={[s.headerSub, !wide && {display:'none'}]} numberOfLines={1}>{ROLE_LABEL[user.role]} · {user.email}</Text>
        </View>
        {!wide&&stack.length===1&&<View style={{flex:1}}/>}<ThemeToggle />
        <Pressable accessibilityRole="button" accessibilityLabel="Activity and sync" onPress={() => {setStack([{name:'tabs'}]);setTab('sync');}} style={s.headerBtn}><Icon name="bell" size={22}/>{queue.length>0&&<View style={s.notificationDot}/>}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => push({ name: 'settings' })} style={s.headerBtn}><View style={s.profileAvatar}><Text style={s.profileInitial}>{user.email[0].toUpperCase()}</Text></View></Pressable>
      </View>
      {wide && <Navigation tab={tab} onSelect={(t: Tab) => { setStack([{name:'tabs'}]); setTab(t); }} queue={queue} cart={cart} user={user} />}
      <NetBar net={net} pending={queue.length} onPress={() => { setStack([{ name: 'tabs' }]); setTab('sync'); }} />
      <View style={s.workspace}>
      <MotionPanel style={s.screen} transitionKey={`${route.name}-${tab}-${stack.length}`}>
        {route.name === 'tabs' && tab === 'fixtures' && <Fixtures {...ctx} />}
        {route.name === 'tabs' && tab === 'calendar' && <CalendarScreen {...ctx} />}
        {route.name === 'tabs' && tab === 'standings' && <Standings {...ctx} />}
        {route.name === 'tabs' && tab === 'store' && <Store {...ctx} />}
        {route.name === 'tabs' && tab === 'club' && <ClubTab {...ctx} />}
        {route.name === 'tabs' && tab === 'control' && <ControlTab {...ctx} />}
        {route.name === 'tabs' && tab === 'sync' && <SyncScreen {...ctx} />}
        {route.name === 'match' && <MatchDetail {...ctx} id={route.id} />}
        {route.name === 'product' && <ProductScreen {...ctx} id={route.id} />}
        {route.name === 'cart' && <CartScreen {...ctx} />}
        {route.name === 'receipt' && <Receipt {...ctx} order={route.order} />}
        {route.name === 'club' && <ClubProfile {...ctx} id={route.id} />}
        {route.name === 'move' && <MovePlayer {...ctx} playerId={route.playerId} />}
        {route.name === 'player' && <PlayerScreen {...ctx} id={route.id} />}
        {route.name === 'orders' && <OrdersScreen {...ctx} />}
        {route.name === 'settings' && (
          <Settings {...ctx} onServer={async (v: string) => { setServer(v); await setJson('server', v); say('Server address saved.'); }}
            onLogout={async () => { await secure.remove('token'); await removeKey('user'); setToken(null); setUser(null); }} />
        )}
      </MotionPanel>
      {toast && <View style={s.toast} accessibilityLiveRegion="polite"><Text style={s.toastText}>{toast}</Text></View>}
      {route.name === 'tabs' && !wide && <Navigation tab={tab} onSelect={setTab} queue={queue} cart={cart} user={user} onSettings={() => push({name:'settings'})} />}
      </View></View></View>
    </SafeAreaView>
  );
}

function NetBar({ net, pending, onPress }: { net: Net; pending: number; onPress: () => void }) {
  const { s, C } = useVisual();
  const [label, color] = net === 'online' ? ['● Online', C.ok] : net === 'syncing' ? ['⟳ Syncing…', C.warn] : ['○ Offline: showing saved data', C.bad];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${pending} pending changes. Open sync status.`} onPress={onPress} style={[s.netbar, { borderColor: color }]}>
      <Text style={[s.netText, { color }]}>{label}</Text>
      <Text style={s.netText}>{pending ? `${pending} changes to sync` : 'Your club, connected'}</Text>
    </Pressable>
  );
}

// ---------- Login ----------
function Login({ server, onServer, onDone }: { server: string; onServer: (v: string) => void; onDone: (t: string, u: User) => void }) {
  const { s, C } = useVisual();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState(server);
  useEffect(() => setAddr(server), [server]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      onServer(addr.trim());
      const r = await request<any>(addr.trim(), '/api/v1/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      onDone(r.token, r.user);
    } catch (e: any) {
      setErr(e?.message ?? 'Sign-in failed.');
    } finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={s.loginContent} keyboardShouldPersistTaps="handled"><View style={s.loginLayout}><View style={s.loginCover}><SportsPhoto style={s.featurePhoto}/><View style={s.featureShade}/><Text style={s.loginCoverBrand}>MATCHDAY</Text><View><Text style={s.loginCoverTitle}>EVERY MATCH.{'\n'}ONE HOME.</Text><Text style={s.loginCoverDetail}>The people, the passion, the whole season.</Text></View><Text style={s.loginCoverFooter}>LEAGUES · CLUBS · PEOPLE</Text></View><View style={s.loginFormPanel}>
        <View style={s.loginBrand}><Text style={s.loginWordmark}>Welcome back.</Text><ThemeToggle /></View>
        <Text style={s.loginHeadline}>Let’s get{'\n'}you in the game.</Text>
        <Muted>From the first whistle to the final table. Your leagues, live scores and club, together.</Muted>
        <Text style={s.label}>Email</Text>
        <TextInput placeholderTextColor={C.muted} selectionColor={C.accent} style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" testID="login-email" accessibilityLabel="Email" placeholder="you@nascon.test" />
        <Text style={s.label}>Password</Text>
        <TextInput placeholderTextColor={C.muted} selectionColor={C.accent} style={s.input} value={password} onChangeText={setPassword} secureTextEntry testID="login-password" accessibilityLabel="Password" placeholder="Password" />
        {err && <Text style={s.error} accessibilityLiveRegion="assertive">{err}</Text>}
        {busy ? <ActivityIndicator style={{ margin: 16 }} /> : <Btn label="Sign in →" color={C.accent} onPress={submit} disabled={!email || !password} />}
        <Text style={s.label}>Choose a demo account</Text>
        <Muted>Tap a role to fill the login · Password: Nascon@26</Muted>
        <View style={s.row}>
          {DEMO.map((d) => (
            <Btn key={d} small kind="outline" color={C.accent} label={d[0].toUpperCase() + d.slice(1)} onPress={() => { setEmail(`${d}@nascon.test`); setPassword('Nascon@26'); }} />
          ))}
        </View>
        <Text style={s.label}>Server address</Text>
        <TextInput placeholderTextColor={C.muted} selectionColor={C.accent} style={s.input} value={addr} onChangeText={setAddr} autoCapitalize="none" testID="server-address" accessibilityLabel="Server address" />
        <Muted>Emulator: http://10.0.2.2:8080 · Phone: http://LAPTOP-LAN-IP:8080</Muted></View></View>
      </ScrollView>
    </SafeAreaView>
  );
}


const PHOTO_SET: {source:any; label:string}[] = [
 {source:require('./assets/photos/ball-practice.jpg'),label:'Practice makes progress'},
 {source:require('./assets/photos/youth-coaching.jpg'),label:'Learning the game together'},
 {source:require('./assets/photos/match-ball.jpg'),label:'Ready for the next match'},
 {source:TRAINING,label:'Together on the training ground'}
];
function AssetPhoto({source,style}:any){return <Image source={typeof source==='string'?{uri:source}:source} style={style} resizeMode="cover"/>;}
function PhotoGallery({compact=false}: {compact?:boolean}){
 const {s,C}=useVisual();const [active,setActive]=useState<number|null>(null);
 return <><View style={s.photoMasonry}>{[0,1].map(col=><View key={col} style={s.photoColumn}>{PHOTO_SET.map((photo,i)=>i%2===col?<Pressable key={i} accessibilityRole="button" accessibilityLabel={`View ${photo.label}`} onPress={()=>setActive(i)} style={[s.photoTile,{height:compact?(i===0||i===3?230:150):(i===0||i===3?320:220)}]}><AssetPhoto source={photo.source} style={s.photoImage}/><View style={s.photoExpand}><Icon name="image" size={15} color="#fff"/></View></Pressable>:null)}</View>)}</View><Text style={s.photoCredit}>A little inspiration from around the game. Curated sports photography.</Text>
 <Modal visible={active!==null} transparent animationType="fade" onRequestClose={()=>setActive(null)}><View style={s.lightbox}>{active!==null&&<><View style={s.lightboxHead}><Text style={s.lightboxTitle}>{PHOTO_SET[active].label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={()=>setActive(null)} style={s.roundButton}><Icon name="close" color="#fff"/></Pressable></View><Image source={typeof PHOTO_SET[active].source==='string'?{uri:PHOTO_SET[active].source}:PHOTO_SET[active].source} style={s.lightboxImage} resizeMode="contain"/><View style={s.lightboxControls}><Pressable accessibilityRole="button" accessibilityLabel="Previous photo" style={s.roundButton} onPress={()=>setActive((active+PHOTO_SET.length-1)%PHOTO_SET.length)}><Icon name="back" color="#fff"/></Pressable><Text style={s.lightboxTitle}>{active+1} / {PHOTO_SET.length}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next photo" style={s.roundButton} onPress={()=>setActive((active+1)%PHOTO_SET.length)}><Icon name="arrow" color="#fff"/></Pressable></View></>}</View></Modal></>;
}
function AvatarStack({roster=[]}:any){const {s}=useVisual();return <View style={s.avatarStack}>{roster.slice(0,3).map((p:any,i:number)=><View key={p.player_id??i} style={[s.smallAvatar,{backgroundColor:['#f6d895','#f0baad','#ddd8b5'][i],marginLeft:i?-9:0}]}><Text style={s.smallAvatarText}>{p.name?.split(' ').map((v:string)=>v[0]).join('').slice(0,2)}</Text></View>)}{roster.length>3&&<View style={[s.smallAvatar,{backgroundColor:'#ffffff40',marginLeft:-9}]}><Text style={s.smallAvatarText}>+{roster.length-3}</Text></View>}</View>;}
function GroupCard({club,index,onPress}:any){const {s}=useVisual();const warm=index%2===1;const ink=warm?'#423615':'#ffffff';return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${club.name}`} onPress={onPress} style={({pressed})=>[s.groupCard,{backgroundColor:warm?'#f5d76c':'#d93d30'},pressed&&{transform:[{scale:.985}]}]}><View pointerEvents="none" style={s.groupRingOne}/><View pointerEvents="none" style={s.groupRingTwo}/><View style={s.rowBetween}><TeamMark name={club.name} large/><View style={s.groupCalendar}><Icon name="calendar" color={ink} size={22}/></View></View><Text style={[s.groupName,{color:ink}]}>{club.name}</Text><View style={s.rowBetween}><View style={s.iconLabel}><Icon name="crown" size={20} color={ink}/><Text style={[s.groupRole,{color:ink}]}>League club</Text></View><AvatarStack roster={club.roster}/></View><View style={s.groupBottom}><View style={s.iconLabel}><Icon name="people" size={20} color={ink}/><Text style={[s.groupSmall,{color:ink}]}>{club.roster?.length??0} players</Text></View><View style={s.groupOpen}><Icon name="arrow" size={22} color="#c2372b"/></View></View></Pressable>;}
function CalendarCards({fixtures,teamName,push,compact=false}:any){
 const {s,dark}=useVisual();const [month,setMonth]=useState(new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const rows=(fixtures??[]).filter((f:any)=>f?.kickoff&&new Date(f.kickoff).getMonth()===month.getMonth()&&new Date(f.kickoff).getFullYear()===month.getFullYear()).sort((a:any,b:any)=>a.kickoff.localeCompare(b.kickoff));
 const move=(n:number)=>setMonth(new Date(month.getFullYear(),month.getMonth()+n,1));
 return <><View style={s.monthPicker}><Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={()=>move(-1)} style={s.roundButton}><Icon name="back" size={19}/></Pressable><Text style={s.monthName}>{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={()=>move(1)} style={s.roundButton}><Icon name="arrow" size={19}/></Pressable></View>
 {!rows.length&&<Empty text="No fixtures this month. Try another month."/>}{rows.slice(0,compact?3:undefined).map((f:any,i:number)=>{const date=new Date(f.kickoff);const bg=dark?['#403b27','#422e2b','#373b2a'][i%3]:['#f8e9a9','#f8d7cd','#eef1cf'][i%3];const ink=dark?'#f4f1e4':'#3c3827';return <Pressable key={f.match_id} accessibilityRole="button" accessibilityLabel={`${teamName(f.home)} versus ${teamName(f.away)}, ${date.toLocaleDateString()}`} onPress={()=>push({name:'match',id:f.match_id})} style={({pressed})=>[s.calendarCard,{backgroundColor:bg},pressed&&{opacity:.82}]}><View style={s.rowBetween}><Text style={[s.calendarWeekday,{color:ink}]}>{date.toLocaleDateString(undefined,{weekday:'long'})}</Text><View style={s.calendarArrow}><Icon name="chevron" size={19} color={ink}/></View></View><View style={s.calendarCardBody}><View style={s.calendarDate}><Text style={[s.calendarDay,{color:ink}]}>{String(date.getDate()).padStart(2,'0')}</Text><Text style={[s.calendarMonth,{color:ink}]}>{date.toLocaleDateString(undefined,{month:'short'})}</Text></View><View style={s.calendarInfo}><Text style={[s.calendarTime,{color:ink}]}>{date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text><View style={[s.calendarStatus,{backgroundColor:dark?'#ebe8da':'#413b28'}]}><Text style={[s.calendarStatusText,{color:dark?'#332e20':'#fff'}]}>{f.status==='in_progress'?'Live match':f.status==='completed'?`${f.home_score} – ${f.away_score} · Full time`:'Upcoming'}</Text></View><Text style={[s.calendarTeams,{color:ink}]} numberOfLines={2}>{teamName(f.home).replace('Alpha ','')} vs {teamName(f.away).replace('Alpha ','')}</Text><View style={s.iconLabel}><Icon name="pin" color={ink} size={14}/><Text style={[s.calendarVenue,{color:ink}]} numberOfLines={1}>{f.venue??'Venue TBC'}</Text></View></View></View></Pressable>;})}</>;
}
function CalendarScreen(props:any){const {s}=useVisual();const [q,setQ]=useState('');const rows=(props.boot?.fixtures??[]).filter((f:any)=>!q||`${props.teamName(f.home)} ${props.teamName(f.away)}`.toLowerCase().includes(q.toLowerCase()));return <ScrollView contentContainerStyle={[s.list,s.calendarPage]}><PageHeading title="Club calendar" detail="A little planning. A lot to look forward to."/><View style={s.searchWrap}><Icon name="search" size={19}/><TextInput style={s.searchInput} placeholder="Search teams" testID="calendar-search" accessibilityLabel="Search calendar" value={q} onChangeText={setQ}/></View><CalendarCards {...props} fixtures={rows}/></ScrollView>;}

// ---------- Fixtures (FotMob-style: role "Today" card, filter chips, search, day groups, pull-to-refresh) ----------
const dayLabel = (iso: string | null) => {
  if (!iso) return 'Date to be confirmed';
  const d = new Date(iso);
  const t = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(t.toDateString()).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};

function TodayCard({ boot, user, teamName, push, setTab, primary }: any) {
  const { s, C } = useVisual();
  const fixtures = (boot?.fixtures ?? []).filter(Boolean);
  const live = fixtures.filter((f: any) => f.status === 'in_progress');
  const club = boot?.clubs?.find((c: any) => c.club_id === user.club_id);
  let title = `${live.length} match${live.length === 1 ? '' : 'es'} live now`;
  let action: { label: string; go: () => void } | null = live[0] ? { label: 'Watch live match', go: () => push({ name: 'match', id: live[0].match_id }) } : null;
  if (user.role === 'league_organizer') {
    const mine = live.filter((f: any) => user.league_ids.includes(f.league_id));
    title = mine.length ? `${mine.length} live match${mine.length === 1 ? '' : 'es'} to score in your league` : 'No live matches in your league right now';
    action = mine[0] ? { label: 'Score live match', go: () => push({ name: 'match', id: mine[0].match_id }) } : null;
  } else if (user.role === 'club_manager' && club) {
    title = `${club.name}: ${club.roster?.length ?? 0} players registered`;
    action = { label: 'Manage roster', go: () => setTab('club') };
  } else if (user.role === 'player' && club) {
    const next = fixtures.find((f: any) => f.status !== 'completed' && (f.home === club.club_id || f.away === club.club_id));
    title = next ? `Your next match: ${teamName(next.home)} vs ${teamName(next.away)}, ${dayLabel(next.kickoff)}` : 'No upcoming matches for your club';
    action = next ? { label: 'Open match', go: () => push({ name: 'match', id: next.match_id }) } : null;
  }
  const featured = live[0] ?? fixtures.find((f:any)=>f.status==='upcoming');
  const league = boot?.leagues?.find((l:any)=>l.league_id===featured?.league_id);
  return <View style={s.editorialCover}><SportsPhoto style={s.featurePhoto}/><View style={s.editorialShade}/><View style={s.coverEditorial}><Text style={s.coverLeague}>{(league?.name??'YOUR LEAGUE').replace(' ', '\n').toUpperCase()}</Text><Text style={s.coverSeason}>SEASON {league?.season??new Date().getFullYear()}</Text><Pressable accessibilityRole="button" onPress={()=>setTab('standings')} style={s.coverLink}><Text style={s.coverLinkText}>EXPLORE THE LEAGUE</Text><Icon name="arrow" color="#fff" size={22}/></Pressable></View>
  {featured&&<View style={s.scoreTicket}><View style={s.rowBetween}><View style={s.ticketLive}><View style={s.liveDot}/><Text style={s.ticketLiveText}>{featured.status==='in_progress'?'LIVE MATCH':'NEXT MATCH'}</Text></View><Icon name="ball" color="#59636a" size={19}/></View><View style={s.ticketScoreboard}><View style={s.ticketTeam}><TeamMark name={teamName(featured.home)} large/><Text style={s.ticketTeamName}>{teamName(featured.home)}</Text></View><MotionPanel transitionKey={`${featured.home_score}-${featured.away_score}`} style={s.ticketScoreWrap}><Text style={s.ticketScore}>{featured.status==='upcoming'?'VS':`${featured.home_score} – ${featured.away_score}`}</Text><Text style={s.ticketStatus}>{featured.status==='in_progress'?'IN PROGRESS':dayLabel(featured.kickoff)}</Text></MotionPanel><View style={s.ticketTeam}><TeamMark name={teamName(featured.away)} large/><Text style={s.ticketTeamName}>{teamName(featured.away)}</Text></View></View><View style={s.ticketVenue}><Icon name="pin" color="#5e666e" size={15}/><Text style={s.ticketVenueText}>{featured.venue??'Venue TBC'}</Text></View><Pressable accessibilityRole="button" onPress={action?.go??(()=>push({name:'match',id:featured.match_id}))} style={({pressed})=>[s.ticketButton,pressed&&{opacity:.8}]}><Text style={s.ticketButtonText}>{action?.label??'Open match centre'}</Text><Icon name="arrow" color="#fff" size={20}/></Pressable></View>}
  </View>;
}

function SportsScoreboard({fixture,boot,teamName,push,featured=false,offline=false}:any) {
 const {s,C}=useVisual(); const f=fixture;const live=f.status==='in_progress';const upcoming=f.status==='upcoming';
 const league=boot?.leagues?.find((l:any)=>l.league_id===f.league_id);
 const date=f.kickoff?new Date(f.kickoff):null;
 const status=live?'LIVE':upcoming?'SCHEDULED':'FULL TIME';
 const home=teamName(f.home),away=teamName(f.away);
 const ink=featured?'#292519':C.text;const dim=featured?'#65541e':C.muted;
 return <Pressable testID={featured?'featured-scoreboard':`scoreboard-${f.match_id}`} accessibilityRole="button" accessibilityLabel={`Open match: ${home} versus ${away}, ${upcoming?'scheduled':`${f.home_score ?? '–'} to ${f.away_score ?? '–'}`}`} onPress={()=>push({name:'match',id:f.match_id})} style={({pressed})=>[s.sportScoreCard,featured?s.sportScoreFeatured:s.sportScoreCompact,pressed&&{opacity:.9,transform:[{scale:.992}]}]}>
  <View style={s.sportScoreTop}><View style={[s.iconLabel,{flex:1,minWidth:0}]}><Icon name="trophy" size={featured?20:16} color={ink}/><Text numberOfLines={1} style={[s.sportLeague,{color:ink}]}>{league?.name??'League match'}</Text></View><View style={[s.sportStatus,{backgroundColor:live?'#b42c24':featured?'#ffffff70':C.card}]}>{live&&<View style={s.sportLiveDot}/>}<Text style={[s.sportStatusText,{color:live?'#fff':ink}]}>{offline?'SAVED · ':''}{status}</Text></View></View>
  <View style={[s.sportScoreRow,!featured&&{marginVertical:16}]}>
   <View style={s.sportTeam}><TeamMark name={home} large={featured}/><Text numberOfLines={2} style={[s.sportTeamName,{color:ink},!featured&&{fontSize:19,lineHeight:22}]}>{home}</Text></View>
   <MotionPanel transitionKey={`${f.home_score}-${f.away_score}-${f.status}`} style={s.sportScoreCentre}><Text style={[s.sportMatchNote,{color:dim}]}>{upcoming?'KICKOFF':live?'IN PROGRESS':'FINAL SCORE'}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.45} style={[s.sportScore,{color:ink},!featured&&{fontSize:49,lineHeight:56},!upcoming&&(String(f.home_score).length+String(f.away_score).length)>2&&{fontSize:Math.max(24,52-(String(f.home_score).length+String(f.away_score).length-2)*8),lineHeight:58}]}>{upcoming?'VS':`${f.home_score ?? '–'} : ${f.away_score ?? '–'}`}</Text><Text style={[s.sportMatchNote,{color:dim}]}>{date?date.toLocaleDateString(undefined,{day:'numeric',month:'short'}).toUpperCase():'DATE TBC'}{upcoming&&date?` · ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:''}</Text></MotionPanel>
   <View style={s.sportTeam}><TeamMark name={away} large={featured}/><Text numberOfLines={2} style={[s.sportTeamName,{color:ink},!featured&&{fontSize:19,lineHeight:22}]}>{away}</Text></View>
  </View>
  <View style={[s.sportScoreFooter,{borderColor:featured?'#6c591b33':C.border}]}><View style={[s.iconLabel,{flex:1}]}><Icon name="pin" size={15} color={dim}/><Text numberOfLines={1} style={[s.sportVenue,{color:dim}]}>{f.venue||'Venue to be confirmed'}</Text></View>{featured?<View style={s.sportMatchLink}><Text style={s.sportMatchLinkText}>MATCH CENTRE</Text><Icon name="arrow" color="#fff" size={18}/></View>:<Icon name="arrow" size={20} color={ink}/>}</View>
 </Pressable>;
}

function Fixtures(props:any){
 const {s,C,wide}=useVisual();const {boot,push,setTab,teamName,net,refresh}=props;
 const [query,setQuery]=useState('');const [sport,setSport]=useState('all');const [filter,setFilter]=useState('all');const [refreshing,setRefreshing]=useState(false);
 const clubs=(boot?.clubs??[]).filter((c:any)=>c.name.toLowerCase().includes(query.toLowerCase()));
 const fixtures=(boot?.fixtures??[]).filter(Boolean).filter((f:any)=>sport==='all'||boot?.leagues?.find((l:any)=>l.league_id===f.league_id)?.sport_id===sport);
 const ordered=[...fixtures].sort((a:any,b:any)=>{const rank=(f:any)=>f.status==='in_progress'?0:f.status==='upcoming'&&f.kickoff&&new Date(f.kickoff).getTime()>=Date.now()?1:f.status==='completed'?2:3;const delta=rank(a)-rank(b);if(delta)return delta;const ta=a.kickoff?new Date(a.kickoff).getTime():Infinity,tb=b.kickoff?new Date(b.kickoff).getTime():Infinity;return a.status==='completed'?tb-ta:ta-tb;});
 const rows=ordered.filter((f:any)=>filter==='all'||f.status===filter);const featured=filter==='all'?(ordered.find((f:any)=>f.status==='in_progress')??ordered.find((f:any)=>f.status==='completed')??ordered[0]):rows[0];const liveCount=fixtures.filter((f:any)=>f.status==='in_progress').length;
 useEffect(()=>{if(net!=='online')return;const timer=setInterval(()=>{void refresh();},10000);return()=>clearInterval(timer);},[net,refresh]);
 const doRefresh=async()=>{setRefreshing(true);try{await refresh();}finally{setRefreshing(false);}};
 return <ScrollView contentContainerStyle={s.homePage} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={C.hot}/>}>
  <View style={s.sportPageHead}><View><Text accessibilityRole="header" style={s.sportPageTitle}>IT’S GAME TIME.</Text><Text style={s.sportIntro}>Your teams. Your league. Every score.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Refresh match scores" disabled={refreshing} onPress={doRefresh} style={s.sportRefresh}><Icon name="sync" size={19}/>{wide&&<Text style={s.sportRefreshText}>{refreshing?'Refreshing…':'Refresh scores'}</Text>}</Pressable></View>
  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.sportFilters}>{[{sport_id:'all',name:'All sports'},...(boot?.sports??[])].map((item:any)=><Pressable key={item.sport_id} accessibilityRole="button" testID={tid('sport',item.sport_id)} accessibilityLabel={`Filter ${item.name}`} accessibilityState={{selected:sport===item.sport_id}} onPress={()=>{setSport(item.sport_id);setFilter('all');}} style={[s.sportFilter,sport===item.sport_id&&{backgroundColor:C.hot,borderColor:C.hot}]}><Icon name={item.sport_id==='all'?'trophy':sportIcon(item.name,item.sport_id)} size={17} color={sport===item.sport_id?(C===PALETTES.dark?C.bg:'#fff'):C.text}/><Text style={[s.sportFilterText,sport===item.sport_id&&{color:C===PALETTES.dark?C.bg:'#fff'}]}>{item.name}</Text></Pressable>)}</ScrollView>
  <View style={s.sportHeroRow}><View style={s.sportHeroMain}>{featured?<SportsScoreboard {...props} fixture={featured} featured offline={net!=='online'}/>:<Empty text={fixtures.length?`No ${filter==='in_progress'?'live':filter==='upcoming'?'upcoming':filter==='completed'?'completed':''} matches right now. This sport has ${fixtures.length} other fixture${fixtures.length===1?'':'s'} — switch the filter above to see them.`:'No fixtures for this sport yet. Choose another sport or check the calendar.'}/>}</View>{wide&&<Pressable accessibilityRole="button" accessibilityLabel="Explore league standings" onPress={()=>setTab('standings')} style={s.sportPhotoFeature}><SportsPhoto style={s.featurePhoto}/><View style={s.sportPhotoShade}/><View style={s.sportPhotoTop}><Icon name="trophy" color="#f4d35c" size={23}/><Text style={s.sportPhotoLabel}>THE SEASON IS YOURS</Text></View><View><Text style={s.sportPhotoTitle}>EVERY POINT.{'\n'}EVERYTHING.</Text><View style={s.rowBetween}><Text style={s.sportPhotoLink}>Explore the league table</Text><View style={s.sportPhotoArrow}><Icon name="arrow" color="#292519" size={21}/></View></View></View></Pressable>}</View>
  <View style={s.sportSectionHead}><Text accessibilityRole="header" style={s.sportSectionTitle}>MATCH CENTRE</Text><Pressable accessibilityRole="button" accessibilityLabel="View full match calendar" onPress={()=>setTab('calendar')} style={s.textAction}><View style={s.iconLabel}><Text style={s.textActionLabel}>Full calendar</Text><Icon name="arrow" size={17} color={C.muted}/></View></Pressable></View>
  <View style={s.sportMatchTabs}>{[['all','All matches'],['in_progress',`Live${liveCount?` (${liveCount})`:''}`],['upcoming','Upcoming'],['completed','Results']].map(([key,label])=><Pressable key={key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{selected:filter===key}} onPress={()=>setFilter(key)} style={[s.sportMatchTab,filter===key&&s.sportMatchTabActive]}><Text style={[s.sportMatchTabText,filter===key&&{color:C.hot}]}>{label}</Text></Pressable>)}</View>
  {net!=='online'&&<Text style={[s.muted,{marginBottom:12}]}>Offline · showing your last saved scores.</Text>}
  <View style={s.sportMatches}>{rows.slice(0,wide?3:4).map((f:any)=><View key={f.match_id} style={s.sportMatchItem}><SportsScoreboard {...props} fixture={f} offline={net!=='online'}/></View>)}{!rows.length&&<Empty text={filter==='in_progress'?'No matches live right now. Upcoming fixtures are one tap away.':'No matches in this view. Try another filter.'}/>}</View>
  <View style={s.sportSectionHead}><Text accessibilityRole="header" style={s.sportSectionTitle}>YOUR LEAGUE. YOUR PEOPLE.</Text><Pressable accessibilityRole="button" onPress={()=>setTab('club')} style={s.textAction}><Text style={s.textActionLabel}>All clubs</Text></Pressable></View>
  <View style={s.homeColumns}><View style={s.homeMain}><View style={s.homeSearch}><View style={[s.searchWrap,{flex:1}]}><Icon name="search" size={18} color={C.muted}/><TextInput style={s.searchInput} placeholder="Find your club" placeholderTextColor={C.muted} testID="club-search" accessibilityLabel="Find your club" value={query} onChangeText={setQuery}/></View></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.groupStrip}>{clubs.map((c:any,i:number)=><GroupCard key={c.club_id} club={c} index={i} onPress={()=>push({name:'club',id:c.club_id})}/>)}</ScrollView>{!clubs.length&&<Empty text="No matching club. Try another name."/>}</View>{wide&&<View style={s.homeGalleryPanel}><View style={s.homeSectionHead}><Text style={s.homeSectionTitle}>AROUND THE GAME</Text><Icon name="image" size={20} color={C.muted}/></View><PhotoGallery compact/></View>}{wide&&<View style={s.homeCalendarPanel}><LeagueGlance {...props}/></View>}</View>
 </ScrollView>;
}

// ---------- Match detail (live score, timeline, pinned product, organizer scoring) ----------
function MatchDetail({ id, server, token, net, boot, teamName, primary, user, enqueue, push, queue }: any) {
  const { s, C } = useVisual();
  const STATUS = { upcoming: ['Upcoming', C.muted], in_progress: [' Live', C.bad], completed: ['Full time', C.ok], clinched: [' Qualified', C.ok], eliminated: ['Out', C.bad], still_possible: ['In contention', C.warn] } as Record<string, [string, string]>;
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'timeline' | 'h2h' | 'table'>('timeline');
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => setM(await getJson(`match:${id}`, null)))();
    const load = async () => {
      try {
        const d = await request<any>(server, `/api/v1/matches/${id}`, { token, timeoutMs: 4000 });
        if (alive) { setM(d); setErr(null); setFetchedAt(Date.now()); await setJson(`match:${id}`, d); }
      } catch (e: any) { if (alive) setErr(e?.message); }
    };
    if (net !== 'offline') load();
    const t = setInterval(() => net !== 'offline' && load(), 3000); // live updates
    return () => { alive = false; clearInterval(t); };
  }, [id, server, token, net, reload]);
  // re-render the freshness label without re-fetching
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 5000); return () => clearInterval(t); }, []);

  const summary = boot?.fixtures?.find((f: any) => f?.match_id === id);
  const leagueSport = boot?.leagues?.find((l: any) => l.league_id === (m?.league_id ?? summary?.league_id))?.sport_id;
  const sport = boot?.sports?.find((x: any) => x.sport_id === (m?.sport_id ?? leagueSport));
  const canScore = user.role === 'super_admin' || (user.role === 'league_organizer' && user.league_ids.includes(m?.league_id ?? summary?.league_id));
  const status = m?.status ?? summary?.status ?? 'upcoming';
  const pendingHere = queue.filter((q: any) => q.action.payload?.match_id === id);
  const version = (m?.version ?? summary?.version ?? 0) + pendingHere.length;
  const home = m?.home?.team_id ?? summary?.home;
  const away = m?.away?.team_id ?? summary?.away;

  const send = (type: string, payload: any, label: string) =>
    Alert.alert('Confirm', `${label}?`, [{ text: 'Cancel', style: 'cancel' }, {
      text: 'Confirm', onPress: () => enqueue({
        action_id: uid('act'), type: 'score_event', queued_at: nowIso(), base_version: version,
        payload: { event_id: uid('evt'), match_id: id, type, payload },
      }, `${label} (${teamName(home)} v ${teamName(away)})`),
    }]);

  const kickoffIso = m?.kickoff ?? summary?.kickoff ?? null;
  const kickoffLabel = kickoffIso
    ? `${new Date(kickoffIso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${new Date(kickoffIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Kick-off to be confirmed';
  const ageMs = fetchedAt ? Date.now() - fetchedAt : null;
  const stale = ageMs !== null && ageMs > 15000;
  const freshness = ageMs === null ? '' : ageMs < 10000 ? 'just now' : `${Math.round(ageMs / 1000)}s ago`;
  void tick;

  if (!m && !summary) {
    return (
      <View style={s.list}>
        <Empty text={err ?? 'Loading match…'} />
        {err ? <Btn label="Try again" color={primary} testID="match-retry-empty" onPress={() => { setErr(null); setReload((v) => v + 1); }} /> : null}
      </View>
    );
  }
  const [st, col] = STATUS[status] ?? [status, C.muted];
  const product = m?.pinned_product ?? boot?.products?.[0];
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <View style={s.rowBetween}><Badge text={st} color={col} /><Muted>{m?.venue ?? summary?.venue ?? ''}</Muted></View>
        <View style={[s.rowBetween, { marginTop: 8 }]}>
          <View style={s.matchDetailTeam}><TeamMark name={teamName(home)} large/><Text style={s.bigTeam} numberOfLines={2}>{teamName(home)}</Text></View>
          {status === 'upcoming' ? (
            <View style={{ alignItems: 'center' }} accessibilityLabel={`Not started. Kick-off ${kickoffLabel}`}>
              <Text style={[s.bigScore, { color: C.muted }]}>vs</Text>
              <Text style={[s.muted, { textAlign: 'center' }]}>{kickoffLabel}</Text>
            </View>
          ) : (
            <Text style={[s.bigScore, { color: C.accent }]} accessibilityLabel={`Score ${m?.home?.score ?? summary?.home_score} to ${m?.away?.score ?? summary?.away_score}`}>
              {m?.home?.score ?? summary?.home_score ?? 0} – {m?.away?.score ?? summary?.away_score ?? 0}
            </Text>
          )}
          <View style={s.matchDetailTeam}><TeamMark name={teamName(away)} large/><Text style={s.bigTeam} numberOfLines={2}>{teamName(away)}</Text></View>
        </View>
        {net === 'offline' && <Muted>Offline: showing the last score saved on this device.</Muted>}
        {pendingHere.length > 0 && <Text style={{ color: C.warn, marginTop: 4 }}>{pendingHere.length} score change(s) waiting to sync</Text>}
        <View style={[s.rowBetween, { marginTop: 6 }]} accessibilityLiveRegion="polite">
          <Text style={{ color: stale ? C.warn : C.muted, fontSize: 13 }} testID="match-freshness">
            {net === 'offline' ? 'Not updating while offline'
              : err ? `Could not refresh${freshness ? ` · last updated ${freshness}` : ''}`
              : freshness ? `Updated ${freshness}` : 'Updating…'}
          </Text>
          {(err || stale) && net !== 'offline'
            ? <Btn small kind="outline" color={primary} label="Retry" testID="match-retry" onPress={() => { setErr(null); setReload((v) => v + 1); }} />
            : null}
        </View>
      </Card>

      {canScore && (
        <Card>
          <H>Scoring</H>
          {status === 'upcoming' && <Btn label="Start match" color={primary} onPress={() => send('match_start', {}, 'Start match')} />}
          {status === 'in_progress' && (
            <>
              {[home, away].map((team: string) => (
                <View key={team} style={{ marginBottom: 8 }}>
                  <Text style={s.label}>{teamName(team)}</Text>
                  <View style={s.row}>
                    {Object.keys(sport?.scoring_events ?? {}).map((ev) => (
                      <Btn key={ev} small color={primary} label={`+ ${ev.replace(/_/g, ' ')}`} onPress={() => send('score', { team_id: team, event_type: ev }, `Add ${ev.replace(/_/g, ' ')} for ${teamName(team)}`)} />
                    ))}
                  </View>
                </View>
              ))}
              <Btn kind="outline" label="End match" color={C.bad} onPress={() => send('match_end', {}, 'End match')} />
            </>
          )}
          {status === 'completed' && <Muted>Match finished. You can still correct an event below.</Muted>}
        </Card>
      )}

      <View style={[s.row, { marginBottom: 4 }]} accessibilityRole="tablist">
        {([['timeline', 'Timeline'], ['h2h', 'Head-to-head'], ['table', 'Table']] as const).map(([k, l]) => (
          <Btn key={k} small kind={view === k ? 'solid' : 'outline'} color={primary} label={l} onPress={() => setView(k)} />
        ))}
      </View>
      {view === 'timeline' && (
        <Card>
          <H>Timeline</H>
          {(m?.events ?? []).length === 0 && <Muted>{m ? 'No events yet.' : 'Timeline available when online.'}</Muted>}
          {(m?.events ?? []).slice().reverse().map((e: any) => (
            <View key={e.event_id} style={s.timelineRow}>
              {e.payload?.team_id ? <TeamMark name={teamName(e.payload.team_id)}/> : <Icon name={e.type === 'compensation' ? 'sync' : 'flag'} size={20} color={C.muted}/>}
              <View style={{ flex: 1 }}>
                <Text style={[s.timelineText, e.compensated && s.struck]}>
                  {e.type === 'score' ? `${e.payload.event_type.replace(/_/g, ' ')} · ${teamName(e.payload.team_id)}`
                    : e.type === 'compensation' ? `Correction: ${e.payload.reason ?? ''}`
                    : e.type === 'discipline' ? `Discipline · ${teamName(e.payload.team_id)} (${e.payload.points})`
                    : e.type.replace(/_/g, ' ')}
                </Text>
                <Muted>
                  {e.at || e.created_at ? new Date(e.at ?? e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : `Event ${e.sequence ?? ''}`}
                  {e.compensated ? ' · corrected, no longer counts' : ''}
                </Muted>
              </View>
              {canScore && ['score', 'discipline', 'tiebreak_winner'].includes(e.type) && !e.compensated && (
                <Btn small kind="outline" color={C.bad} label="Undo" onPress={() => send('compensation', { compensates: e.event_id, reason: 'Corrected by organizer' }, 'Undo this event')} />
              )}
            </View>
          ))}
        </Card>
      )}
      {view === 'h2h' && (() => {
        const st = boot?.standings?.find((x: any) => x.league_id === (m?.league_id ?? summary?.league_id));
        const h = st?.h2h?.[home]?.[away];
        const meetings = (boot?.fixtures ?? []).filter((f: any) => f && f.status === 'completed' && [f.home, f.away].includes(home) && [f.home, f.away].includes(away));
        return (
          <Card>
            <H>Head-to-head this season</H>
            {!h || h.played === 0 ? <Muted>These teams have not met yet this season.</Muted> : (
              <Text style={s.body}>{teamName(home)}: {h.points} pts from {h.played} game(s), scored {h.scored}, conceded {h.conceded}</Text>
            )}
            {meetings.map((f: any) => <Muted key={f.match_id}>{teamName(f.home)} {f.home_score} – {f.away_score} {teamName(f.away)}</Muted>)}
          </Card>
        );
      })()}
      {view === 'table' && (() => {
        const st = boot?.standings?.find((x: any) => x.league_id === (m?.league_id ?? summary?.league_id));
        if (!st) return <Card><Muted>No league table for this match.</Muted></Card>;
        return (
          <Card>
            <H>{st.name ?? 'League table'}</H>
            {st.table.map((r: any) => {
              const playing = r.team_id === home || r.team_id === away;
              return (
                <View key={r.team_id} style={[s.rowBetween, { minHeight: 48 }, playing && { backgroundColor: C.soft }]}>
                  <Text style={[s.body, playing && { fontWeight: '800' }]}>{r.rank}. {teamName(r.team_id)}</Text>
                  <Text style={[s.body, { fontWeight: '700' }]}>{r.points} pts</Text>
                </View>
              );
            })}
          </Card>
        );
      })()}

      {product && (
        <Card onPress={() => push({ name: 'product', id: product.product_id })} label={`Featured product ${product.name}`}>
          <Muted>Featured in the club store</Muted>
          <View style={s.rowBetween}>
            <Text style={s.team}>{product.name}</Text>
            <Text style={[s.price, { color: C.accent }]}>{pkr(product.variants[0].price_minor)}</Text>
          </View>
          <Text style={{ color: C.accent, fontWeight: '700' }}>Shop now ›</Text>
        </Card>
      )}
    </ScrollView>
  );
}

// ---------- Standings (Sofascore-style: form guide, qualification legend, your club highlighted) ----------
const FORM: Record<string, [string, string]> = { W: ['W', C.ok], D: ['D', C.muted], L: ['L', C.bad] };
function formOf(fixtures: any[], team: string): string[] {
  return fixtures.filter((f: any) => f && f.status === 'completed' && (f.home === team || f.away === team))
    .sort((a: any, b: any) => (b.kickoff ?? '').localeCompare(a.kickoff ?? '')).slice(0, 5)
    .map((f: any) => {
      const mine = f.home === team ? f.home_score : f.away_score;
      const theirs = f.home === team ? f.away_score : f.home_score;
      return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
    });
}
function FormGuide({ form }: { form: string[] }) {
  const { s, C } = useVisual();
  const FORM: Record<string, [string, string]> = { W: ['W', C.ok], D: ['D', C.muted], L: ['L', C.bad] };
  if (!form.length) return <Muted>No results yet</Muted>;
  return (
    <View style={s.row} accessibilityLabel={`Form, most recent first: ${form.map((x) => ({ W: 'win', D: 'draw', L: 'loss' } as any)[x]).join(', ')}`}>
      {form.map((r, i) => <View key={i} style={[s.formChip, { backgroundColor: FORM[r][1] }]}><Text style={s.formText}>{FORM[r][0]}</Text></View>)}
    </View>
  );
}

function Standings({ boot, teamName, user, push, primary }: any) {
  const { s, C } = useVisual();
  const STATUS = { upcoming: ['Upcoming', C.muted], in_progress: [' Live', C.bad], completed: ['Full time', C.ok], clinched: [' Qualified', C.ok], eliminated: ['Out', C.bad], still_possible: ['In contention', C.warn] } as Record<string, [string, string]>;
  const leagues = boot?.standings ?? [];
  const [i, setI] = useState(0);
  const st = leagues[i];
  if (!st) return <Empty text="No league tables yet." />;
  return (
    <ScrollView contentContainerStyle={s.list}>
      <PageHeading title="League standings" detail={`${st.name ?? st.league_id} · Season ${st.season ?? ''}`} /><View style={s.standingsBanner}><Icon name="trophy" size={56} color="#16191b"/><View style={{flex:1}}><Text style={s.standingsTitle}>Every point counts.</Text><Text style={s.standingsDetail}>Top {st.qualification_spots} clubs qualify for the playoffs.</Text></View></View>
      <Muted>Season {st.season ?? ''} · Top {st.qualification_spots} qualify for the playoffs · tap a team to open its club</Muted>
      {leagues.length > 1 && <View style={s.row}>{leagues.map((l: any, k: number) => <Btn key={l.league_id} small kind={k === i ? 'solid' : 'outline'} color={primary} label={l.name ?? l.league_id} onPress={() => setI(k)} />)}</View>}
      <View style={[s.tr, s.th]}>
        <Text style={[s.td, { flex: 0.5 }]}>#</Text><Text style={[s.td, { flex: 3, textAlign: 'left' }]}>Team</Text>
        <Text style={s.td}>P</Text><Text style={s.td}>GD</Text><Text style={[s.td, { fontWeight: '800' }]}>Pts</Text>
      </View>
      {st.table.map((r: any) => {
        const [label, col] = STATUS[r.status] ?? [r.status, C.muted];
        const mine = r.team_id === user.club_id;
        const inZone = r.rank <= st.qualification_spots;
        return (
          <Pressable key={r.team_id} accessibilityRole="button" onPress={() => push({ name: 'club', id: r.team_id })}
            accessibilityLabel={`Rank ${r.rank}, ${teamName(r.team_id)}${mine ? ', your club' : ''}, ${r.points} points, ${label}`}
            style={({ pressed }) => [s.tr, { borderLeftWidth: 5, borderLeftColor: inZone ? C.ok : 'transparent' }, mine && { backgroundColor: C.soft }, pressed && { opacity: 0.7 }]}>
            <Text style={[s.td, { flex: 0.5, fontWeight: '700' }]}>{r.rank}</Text>
            <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center', gap: 10 }}><TeamMark name={teamName(r.team_id)}/><View style={{flex:1}}>
              <Text style={[s.tdTeam, mine && { color: C.accent }]} numberOfLines={1}>{teamName(r.team_id)}{mine ? ' · Your club' : ''}</Text>
              <Text style={{ color: col, fontSize: 13, fontWeight: '600' }}>{label}</Text>
              <FormGuide form={formOf(boot.fixtures ?? [], r.team_id)} />
            </View></View>
            <Text style={s.td}>{r.played}</Text><Text style={s.td}>{r.diff > 0 ? `+${r.diff}` : r.diff}</Text>
            <Text style={[s.td, { fontWeight: '800', fontSize: 17 }]}>{r.points}</Text>
          </Pressable>
        );
      })}
      <Card>
        <Text style={s.label}>Key</Text>
        <Muted>Green bar on the left = playoff places (top {st.qualification_spots}).</Muted>
        <Muted> Qualified: guaranteed a playoff place · In contention: still possible ·  Out: can no longer qualify.</Muted>
        <Muted>Form: W win, D draw, L loss (most recent first). Ties on points are broken by head-to-head results.</Muted>
      </Card>
    </ScrollView>
  );
}

// ---------- Store ----------
function Store({ boot, push, primary, cart, orders }: any) {
  const { s, C } = useVisual();
  const products = boot?.products ?? [];
  return (
    <FlatList contentContainerStyle={s.list} data={products} keyExtractor={(p: any) => p.product_id}
      ListHeaderComponent={
        <View>
          <PageHeading title="The club shop" detail="Your club. On and off the pitch."/><View style={s.shopBanner}><SportsPhoto training style={s.featurePhoto}/><View style={s.featureShade}/><Text style={s.shopBannerTitle}>For the love{'\n'}of the game.</Text><Text style={s.shopBannerDetail}>Explore the club collection.</Text></View><View style={s.rowBetween}><H>The club collection</H>{cart.length > 0 && <Btn small color={primary} label={` Cart (${cart.length})`} onPress={() => push({ name: 'cart' })} />}</View>
          <View style={s.row}>
            <Btn small kind="outline" color={primary} label={`My orders (${orders.length})`} onPress={() => push({ name: 'orders' })} />
          </View>
          <Muted>Official club merchandise · tap an item to choose a size</Muted>
        </View>
      }
      ListEmptyComponent={<Empty text="No products in the store yet." />}
      renderItem={({ item: p }: any) => (
        <Card onPress={() => push({ name: 'product', id: p.product_id })} label={`${p.name}, ${pkr(p.variants[0].price_minor)}`}>
          <KitVisual/>
          <Text style={s.team}>{p.name}</Text>
          <Muted>{p.category} · {p.variants.length} sizes</Muted>
          <Text style={[s.price, { color: C.accent }]}>{pkr(p.variants[0].price_minor)}</Text>
        </Card>
      )} />
  );
}

function ProductScreen({ id, boot, primary, setCart, cart, push, say }: any) {
  const { s, C } = useVisual();
  const p = boot?.products?.find((x: any) => x.product_id === id);
  const [variant, setVariant] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  if (!p) return <Empty text="Product not found." />;
  const v = p.variants.find((x: any) => x.variant_id === variant);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <KitVisual/>
        <Text style={s.title}>{p.name}</Text>
        <Text style={[s.price, { color: C.accent }]}>{pkr(p.variants[0].price_minor)}</Text>
        <Text style={s.label}>Choose a size</Text>
        <View style={s.row}>
          {p.variants.map((x: any) => (
            <Btn key={x.variant_id} kind={variant === x.variant_id ? 'solid' : 'outline'} color={primary} disabled={x.stock === 0}
              label={`${x.size}${x.stock === 0 ? ' (sold out)' : ` (${x.stock} left)`}`} onPress={() => setVariant(x.variant_id)} />
          ))}
        </View>
        <Text style={s.label}>Quantity</Text>
        <View style={s.row}>
          <Btn small kind="outline" color={primary} label="−" onPress={() => setQty(Math.max(1, qty - 1))} />
          <Text style={s.qty} accessibilityLabel={`Quantity ${qty}`}>{qty}</Text>
          <Btn small kind="outline" color={primary} label="+" onPress={() => setQty(Math.min(10, qty + 1))} />
        </View>
        <Btn label={v ? `Add to cart · ${pkr(v.price_minor * qty)}` : 'Choose a size first'} color={primary} disabled={!v}
          onPress={() => { setCart([...cart.filter((c: any) => c.variant_id !== v.variant_id), { variant_id: v.variant_id, quantity: qty, name: `${p.name} (${v.size})`, price: v.price_minor }]); say('Added to cart.'); push({ name: 'cart' }); }} />
      </Card>
    </ScrollView>
  );
}

function CartScreen({ cart, setCart, primary, server, token, net, push, refresh, saveOrder }: any) {
  const { s, C } = useVisual();
  const [code, setCode] = useState('');
  const [card, setCard] = useState('tok_success');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const subtotal = cart.reduce((a: number, c: any) => a + c.price * c.quantity, 0);
  const pay = () => Alert.alert('Confirm payment', `Pay ${pkr(subtotal)}${code ? ' before discount' : ''} with the test card?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Pay', onPress: async () => {
      setBusy(true); setErr(null);
      try {
        const order = await request<any>(server, '/api/v1/checkout', { method: 'POST', token, timeoutMs: 15000, body: {
          order_id: uid('ord'), customer_id: 'app-user', items: cart.map((c: any) => ({ variant_id: c.variant_id, quantity: c.quantity })),
          discount_code: code.trim() || null, payment: { token: card } } });
        setCart([]);
        await saveOrder(order);
        refresh();
        push({ name: 'receipt', order });
      } catch (e: any) { setErr(e?.message ?? 'Payment failed.'); } finally { setBusy(false); }
    } },
  ]);
  if (!cart.length) return <Empty text="Your cart is empty. Add an item from the Store." />;
  return (
    <ScrollView contentContainerStyle={s.list}>
      <PageHeading title="Your bag" detail="Review your bag before checkout."/>
      {cart.map((c: any) => (
        <Card key={c.variant_id}>
          <View style={s.rowBetween}>
            <View style={{ flex: 1 }}><Text style={s.team}>{c.name}</Text><Muted>{c.quantity} × {pkr(c.price)}</Muted></View>
            <Btn small kind="outline" color={C.bad} label="Remove" onPress={() => setCart(cart.filter((x: any) => x !== c))} />
          </View>
        </Card>
      ))}
      <Card>
        <Text style={s.label}>Discount code</Text>
        <TextInput placeholderTextColor={C.muted} selectionColor={C.accent} style={s.input} value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. WELCOME10" testID="discount-code" accessibilityLabel="Discount code" />
        <Text style={s.label}>Test card (mock payment gateway)</Text>
        <View style={s.row}>
          {[['tok_success', 'Approves'], ['tok_declined', 'Declines'], ['tok_capture_fail', 'Capture fails']].map(([t, l]) => (
            <Btn key={t} small kind={card === t ? 'solid' : 'outline'} color={primary} label={l} onPress={() => setCard(t)} />
          ))}
        </View>
        <Text style={[s.price, { color: C.accent, marginVertical: 8 }]}>Subtotal {pkr(subtotal)}</Text>
        {err && <Text style={s.error} accessibilityLiveRegion="assertive">{err}</Text>}
        {net === 'offline' ? <Text style={s.error}>Checkout needs a connection. Your cart is kept.</Text>
          : busy ? <ActivityIndicator /> : <Btn label={`Pay ${pkr(subtotal)}`} color={primary} onPress={pay} />}
      </Card>
    </ScrollView>
  );
}

function Receipt({ order, primary, say }: any) {
  const { s, C } = useVisual();
  const p = order.receipt.payload;
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <Text style={[s.title, { color: C.ok }]}> Payment successful</Text>
        <Muted>Order {p.order_id}</Muted>
        <Muted>Paid {new Date(p.paid_at).toLocaleString()}</Muted>
        {p.items.map((i: any) => <Text key={i.variant_id} style={s.body}>{i.variant_id} × {i.quantity} · {pkr(i.unit_price_minor * i.quantity)}</Text>)}
        <Text style={s.body}>Subtotal {pkr(p.subtotal_minor)}</Text>
        <Text style={s.body}>Discount −{pkr(p.discount_minor)}</Text>
        <Text style={[s.price, { color: C.accent }]}>Total {pkr(p.total_minor)}</Text>
        <Text style={s.label}>Order progress</Text>
        <View style={s.row} accessibilityLabel="Order progress: paid. Next: packed, shipped, delivered.">
          {['Paid', 'Packed', 'Shipped', 'Delivered'].map((step, i) => (
            <View key={step} style={[s.step, i === 0 && { backgroundColor: C.ok, borderColor: C.ok }]}>
              <Text style={[s.stepText, i === 0 && { color: C.bg }]}>{i === 0 ? ' ' : `${i + 1}. `}{step}</Text>
            </View>
          ))}
        </View>
        <Muted>Signature {order.receipt.signature.slice(0, 16)}…</Muted>
        <Btn label="Download PDF receipt" color={primary} onPress={async () => {
          try { say(`Saved to ${await savePdf(`receipt-${p.order_id}.pdf`, order.receipt.pdf_base64)}`); } catch { say('Could not save the PDF.'); }
        }} />
      </Card>
    </ScrollView>
  );
}

function OrdersScreen({ orders, push, primary }: any) {
  const { s, C } = useVisual();
  return (
    <FlatList contentContainerStyle={s.list} data={orders} keyExtractor={(o: any) => o.order_id}
      ListHeaderComponent={<PageHeading title="Your orders" detail="Purchases, receipts and order details."/>} ListEmptyComponent={<Empty text="No orders yet. Your receipts will appear here after you buy something." />}
      renderItem={({ item: o }: any) => (
        <Card onPress={() => push({ name: 'receipt', order: o })} label={`Order ${o.order_id}, ${pkr(o.total_minor)}, open receipt`}>
          <View style={s.rowBetween}><Text style={s.body}>{new Date(o.receipt.payload.paid_at).toLocaleString()}</Text><Badge text=" Paid" color={C.ok} /></View>
          <Muted>{o.items.length} item(s) · {o.order_id}</Muted>
          <Text style={[s.price, { color: C.accent }]}>{pkr(o.total_minor)}</Text>
        </Card>
      )} />
  );
}

// ---------- Control (League Organizer / Super-Admin) ----------
function ControlTab({boot,user,teamName,push,queue,primary}:any){
 const {s,C}=useVisual();
 const all=(boot?.fixtures??[]).filter(Boolean);
 const mine=all.filter((f:any)=>user.role==='super_admin'||user.league_ids.includes(f.league_id));
 const live=mine.filter((f:any)=>f.status==='in_progress');
 const next=mine.filter((f:any)=>f.status==='upcoming');
 const done=mine.filter((f:any)=>f.status==='completed');
 const pendingFor=(id:string)=>queue.filter((q:any)=>q.action.payload?.match_id===id).length;
 const row=(f:any,cta:string)=>(
  <Card key={f.match_id} testID={tid('control',f.match_id)} label={`${teamName(f.home)} versus ${teamName(f.away)}`} onPress={()=>push({name:'match',id:f.match_id})}>
    <View style={s.rowBetween}>
      <Badge text={f.status==='in_progress'?'● Live':f.status==='completed'?'Full time':'Upcoming'} color={f.status==='in_progress'?C.bad:f.status==='completed'?C.ok:C.muted}/>
      {pendingFor(f.match_id)?<Badge text={`${pendingFor(f.match_id)} queued`} color={C.warn}/>:null}
    </View>
    <View style={[s.rowBetween,{marginTop:6}]}>
      <View style={{flex:1,flexDirection:'row',alignItems:'center',gap:10}}><TeamMark name={teamName(f.home)}/><Text style={s.body} numberOfLines={1}>{teamName(f.home)}</Text></View>
      <Text style={[s.price,{color:C.accent}]}>{f.status==='upcoming'?'vs':`${f.home_score??0} – ${f.away_score??0}`}</Text>
      <View style={{flex:1,flexDirection:'row',alignItems:'center',gap:10,justifyContent:'flex-end'}}><Text style={s.body} numberOfLines={1}>{teamName(f.away)}</Text><TeamMark name={teamName(f.away)}/></View>
    </View>
    <Muted>{f.venue??'Venue TBC'}</Muted>
    <Btn testID={tid('score',f.match_id)} label={cta} color={primary} onPress={()=>push({name:'match',id:f.match_id})}/>
  </Card>);
 return <ScrollView contentContainerStyle={s.list}>
   <PageHeading title="Match control" detail="Score live matches and manage your competitions."/>
   <View style={s.row}>
     <Card testID="control-stat-live"><Text style={s.title}>{live.length}</Text><Muted>Live now</Muted></Card>
     <Card testID="control-stat-next"><Text style={s.title}>{next.length}</Text><Muted>Scheduled</Muted></Card>
     <Card testID="control-stat-done"><Text style={s.title}>{done.length}</Text><Muted>Completed</Muted></Card>
   </View>
   <H>Live now</H>
   {live.length===0?<Empty text="No match is in progress. Start a scheduled match below to open its scoring console."/>:live.map((f:any)=>row(f,'Open scoring console'))}
   <H>Scheduled</H>
   {next.length===0?<Muted>No upcoming fixtures in your competitions.</Muted>:next.map((f:any)=>row(f,'Open match to start'))}
   {done.length>0&&<><H>Completed</H>{done.slice(0,5).map((f:any)=>row(f,'Review and correct'))}</>}
 </ScrollView>;
}

// ---------- Club ----------
function ClubTab(props:any){const {s}=useVisual();const {boot,push,user}=props;
 // A manager or player has exactly one relevant club: go straight there.
 const own=boot?.clubs?.find((c:any)=>c.club_id===user?.club_id);
 if(own&&(user.role==='club_manager'||user.role==='player'))return <ClubProfile {...props} id={own.club_id}/>;return <ScrollView contentContainerStyle={s.list}><PageHeading title="Find your people." detail="Every club has a story. Start with yours."/><View style={s.clubGrid}>{(boot?.clubs??[]).map((c:any,i:number)=><GroupCard key={c.club_id} club={c} index={i} onPress={()=>push({name:'club',id:c.club_id})}/>)}</View></ScrollView>;}

function ClubProfile(props:any){const {s,C}=useVisual();const {id,boot,user,push}=props;// Whoever manages or plays for this club came here for the squad, not the gallery.
 const manages=user?.role==='super_admin'||((user?.role==='club_manager'||user?.role==='player')&&user?.club_id===id);const [section,setSection]=useState<'photos'|'calendar'|'members'>(manages?'members':'photos');const club=boot?.clubs?.find((c:any)=>c.club_id===id);if(!club)return <Empty text="Club not found."/>;const fixtures=(boot?.fixtures??[]).filter((f:any)=>f&&(f.home===id||f.away===id));return <View style={s.clubHub}><View style={s.clubHubHeader}><View style={s.clubHubIdentity}><TeamMark name={club.name} large/><View style={{flex:1}}><Text style={s.clubHubTitle}>{club.name}</Text><View style={s.clubIdChip}><Text style={s.clubIdText}>{club.club_id}</Text></View></View></View><View style={s.clubFacts}><View style={s.clubFact}><Icon name="crown" size={23}/><Text style={s.clubFactText}>{user.club_id===id?'Your club':'League club'}</Text></View><View style={s.clubFact}><Icon name="people" size={23}/><Text style={s.clubFactText}>{club.roster?.length??0} members</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open club calendar" onPress={()=>setSection('calendar')} style={s.clubFactButton}><Icon name="calendar" size={20}/><Icon name="chevron" color={C.hot}/></Pressable></View></View><View style={s.clubHubBody}><View style={s.segmentRow}>{(['photos','calendar','members'] as const).map(t=><Pressable key={t} accessibilityRole="tab" accessibilityLabel={t[0].toUpperCase()+t.slice(1)} accessibilityState={{selected:section===t}} onPress={()=>setSection(t)} style={[s.segment,section===t&&s.segmentSelected]}><Text style={section===t?s.segmentSelectedText:s.segmentText}>{t[0].toUpperCase()+t.slice(1)}</Text></Pressable>)}</View><MotionPanel transitionKey={section} style={{flex:1}}>{section==='members'?<ClubRoster {...props}/>:<ScrollView contentContainerStyle={s.hubScroll}>{section==='photos'?<PhotoGallery/>:<CalendarCards fixtures={fixtures} teamName={props.teamName} push={push}/>}</ScrollView>}</MotionPanel></View></View>;}

function ClubRoster({ id, boot, user, primary, push, queue }: any) {
  const { s, C } = useVisual();
  const c = boot?.clubs?.find((x: any) => x.club_id === id);
  if (!c) return <Empty text="Club not found." />;
  const manages = user.role === 'super_admin' || (user.role === 'club_manager' && user.club_id === id);
  const pendingFor = (pid: string) => queue.some((q: any) => q.action.payload?.player_id === pid);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <View style={s.clubProfileTop}><TeamMark name={c.name} large/><View style={{flex:1}}><Text style={s.title}>{c.name}</Text><Muted>Your club, at a glance.</Muted></View></View>
        <Muted> {c.venue?.name} ({c.venue?.lat}, {c.venue?.lng})</Muted>
        <Muted>{c.social?.x} · {c.social?.instagram}</Muted>
      </Card>
      <Card>
        <H>Staff</H>
        {(c.staff ?? []).map((st: any) => <Text key={st.role} style={s.body}>{st.role[0].toUpperCase() + st.role.slice(1)}: {st.name}</Text>)}
        {(c.history ?? []).map((h: any) => <Muted key={h.season}>Season {h.season}: finished #{h.position} ({h.points} pts)</Muted>)}
      </Card>
      <Card>
        <H>Squad ({(c.roster ?? []).length}){manages ? ' · tap Move to transfer, loan or release' : ''}</H>
        {(c.roster ?? []).length === 0 && <Muted>No players registered.</Muted>}
        {['gk', 'df', 'mf', 'fw', ...Array.from(new Set((c.roster ?? []).map((p: any) => p.position))).filter((x: any) => !['gk', 'df', 'mf', 'fw'].includes(x))].map((pos: any) => {
          const group = (c.roster ?? []).filter((p: any) => p.position === pos);
          if (!group.length) return null;
          return (
            <View key={pos}>
              <Text style={s.dayHeader}>{({ gk: 'Goalkeepers', df: 'Defenders', mf: 'Midfielders', fw: 'Forwards' } as any)[pos] ?? pos} ({group.length})</Text>
              {group.map((p: any) => (
                <View key={p.player_id} style={s.timelineRow}>
                  <Pressable testID={tid('player', p.player_id)} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => push({ name: 'player', id: p.player_id })}>
                    <Text style={s.body}>{p.name}{p.role === 'captain' ? ' (C)' : p.role === 'vice_captain' ? ' (VC)' : ''} ›</Text>
                    <Muted>{p.role.replace('_', ' ')}{p.on_loan ? ' · on loan' : ''}{pendingFor(p.player_id) ? ' · change pending sync' : ''}</Muted>
                  </Pressable>
                  {manages && <Btn small color={primary} label="Move"
                    testID={tid('move', p.player_id)}
                    accessibilityLabel={`Move ${p.name}: transfer, loan or release`}
                    onPress={() => push({ name: 'move', playerId: p.player_id })} />}
                </View>
              ))}
            </View>
          );
        })}
      </Card>
      <Card>
        <H>Upcoming matches</H>
        {(boot?.fixtures ?? []).filter((f: any) => f && f.status !== 'completed' && (f.home === id || f.away === id)).map((f: any) => (
          <Pressable key={f.match_id} style={{ minHeight: 48, justifyContent: 'center' }} accessibilityRole="button" onPress={() => push({ name: 'match', id: f.match_id })}>
            <Text style={s.body}>{f.status === 'in_progress' ? '● LIVE ' : ''}{boot.clubs.find((x: any) => x.club_id === f.home)?.name} vs {boot.clubs.find((x: any) => x.club_id === f.away)?.name} ›</Text>
          </Pressable>
        ))}
        {!(boot?.fixtures ?? []).some((f: any) => f && f.status !== 'completed' && (f.home === id || f.away === id)) && <Muted>No upcoming matches.</Muted>}
      </Card>
    </ScrollView>
  );
}

// ---------- Player (TeamSnap-style profile + immutable transfer history) ----------
function PlayerScreen({ id, boot, server, token, net, teamName }: any) {
  const { s, C } = useVisual();
  const club = boot?.clubs?.find((c: any) => c.roster?.some((p: any) => p.player_id === id));
  const player = club?.roster?.find((p: any) => p.player_id === id);
  const [hist, setHist] = useState<any>(null);
  useEffect(() => {
    (async () => {
      setHist(await getJson(`player:${id}`, null));
      if (net === 'offline') return;
      try {
        const h = await request<any>(server, `/api/v1/players/${id}/history`, { token });
        setHist(h);
        await setJson(`player:${id}`, h);
      } catch { /* keep cached */ }
    })();
  }, [id, server, token, net]);
  if (!player) return <Empty text="This player is no longer in a squad." />;
  const LABEL: Record<string, string> = { transfer: 'Transferred', loan: 'Loaned', release: 'Released', loan_return: 'Returned from loan' };
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <Text style={s.title}>{player.name}</Text>
        <Muted>{({ gk: 'Goalkeeper', df: 'Defender', mf: 'Midfielder', fw: 'Forward' } as any)[player.position] ?? player.position} · {player.role.replace('_', ' ')}</Muted>
        <Text style={s.body}>Club: {club.name}{player.on_loan ? ' (on loan)' : ''}</Text>
      </Card>
      <Card>
        <H>Transfer history</H>
        {!hist && <Muted>{net === 'offline' ? 'History is available when online.' : 'Loading…'}</Muted>}
        {hist && hist.history.length === 0 && <Muted>No roster changes yet. Every change is recorded here permanently.</Muted>}
        {hist?.history.map((h: any) => (
          <View key={h.audit_id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={s.body}>{LABEL[h.action] ?? h.action}{h.to_squad_id ? ` to ${teamName(h.to_squad_id)}` : ''} · {h.effective_date}</Text>
            <Muted>From {teamName(h.from_squad_id)} · by {h.who} · {h.why}</Muted>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function MovePlayer({ playerId, boot, user, primary, enqueue, pop, teamName }: any) {
  const { s, C } = useVisual();
  const club = boot?.clubs?.find((c: any) => c.roster?.some((p: any) => p.player_id === playerId));
  const player = club?.roster?.find((p: any) => p.player_id === playerId);
  const [type, setType] = useState<'transfer' | 'loan' | 'release'>('transfer');
  const [to, setTo] = useState<string | null>(null);
  if (!player) return <Empty text="Player not found." />;
  const others = boot.clubs.filter((c: any) => c.club_id !== club.club_id);
  const loanEnd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const go = () => Alert.alert('Confirm roster change',
    type === 'release' ? `Release ${player.name} from ${club.name}?` : `${type === 'loan' ? 'Loan' : 'Transfer'} ${player.name} to ${teamName(to)}${type === 'loan' ? ` until ${loanEnd}` : ''}?`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: async () => {
      await enqueue({
        action_id: uid('act'), type: 'roster_transfer', queued_at: nowIso(), base_version: 0,
        payload: { request_id: uid('tr'), league_id: boot.roster_league_id, player_id: playerId, type, from_squad_id: club.club_id,
          to_squad_id: type === 'release' ? null : to, effective_date: today(), loan_end_date: type === 'loan' ? loanEnd : null,
          reason: `${type} via mobile app`, requested_by: user.email },
      }, `${type[0].toUpperCase() + type.slice(1)} ${player.name}${type === 'release' ? '' : ` to ${teamName(to)}`}`);
      pop();
    } }]);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <Text style={s.title}>{player.name}</Text>
        <Muted>{player.position.toUpperCase()} · {club.name}</Muted>
        <Text style={s.label}>Action</Text>
        <View style={s.row}>
          {(['transfer', 'loan', 'release'] as const).map((t) => <Btn key={t} kind={type === t ? 'solid' : 'outline'} color={primary} label={t[0].toUpperCase() + t.slice(1)} onPress={() => setType(t)} />)}
        </View>
        {type !== 'release' && (
          <>
            <Text style={s.label}>Destination club</Text>
            <View style={s.row}>{others.map((c: any) => <Btn key={c.club_id} small kind={to === c.club_id ? 'solid' : 'outline'} color={primary} label={c.name} onPress={() => setTo(c.club_id)} />)}</View>
          </>
        )}
        <Btn label="Review and confirm" color={primary} disabled={type !== 'release' && !to} onPress={go} />
        <Muted>Works offline: the change is queued and synced automatically.</Muted>
      </Card>
    </ScrollView>
  );
}

// ---------- Sync status ----------
function SyncScreen({ queue, lastSync, net, runSync, primary }: any) {
  const { s, C } = useVisual();
  return (
    <ScrollView contentContainerStyle={s.list}>
      <PageHeading title="You’re up to date." detail="Your saved changes travel with you, even offline."/><View style={s.syncHero}><Icon name={queue.length?'sync':'check'} size={44}/><Text style={s.syncTitle}>{queue.length ? `${queue.length} changes waiting` : 'You’re all caught up.'}</Text><Text style={s.syncDetail}>{net === 'offline' ? 'Saved safely on this device. Reconnect to sync.' : 'Connected to your league. Ready for what’s next.'}</Text></View><H>Pending changes ({queue.length})</H>

      {queue.map((q: any) => (
        <Card key={q.action.action_id}>
          <View style={s.rowBetween}><Text style={[s.body, { flex: 1 }]}>{q.label}</Text><Badge text="Pending" color={C.warn} /></View>
          <Muted>Queued {new Date(q.action.queued_at).toLocaleTimeString()}</Muted>
        </Card>
      ))}
      {queue.length > 0 && (net === 'offline' ? <Muted>You are offline. Changes will sync automatically when the connection returns.</Muted>
        : <Btn label="Sync now" color={primary} onPress={() => runSync(queue)} />)}
      <H>Last sync results</H>
      {lastSync.length === 0 && <Muted>Completed syncs will appear here.</Muted>}
      {lastSync.map((l: any, i: number) => (
        <Card key={i}>
          <View style={s.rowBetween}>
            <Text style={[s.body, { flex: 1 }]}>{l.label}</Text>
            <Badge text={l.status === 'applied' ? ' Applied' : l.status === 'duplicate' ? '= Duplicate' : ' Rejected'} color={l.status === 'rejected' ? C.bad : C.ok} />
          </View>
          <Text style={s.body}>{l.message}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

// ---------- Settings ----------
function Settings({ server, onServer, onLogout, primary, deviceId, user }: any) {
  const { s, C } = useVisual();
  const [addr, setAddr] = useState(server);
  const [test, setTest] = useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <PageHeading title="Make it yours." detail="Your account, connection and preferences."/><Card><View style={s.rowBetween}><View><H>Appearance</H><Muted>Choose your matchday mood.</Muted></View><ThemeToggle/></View></Card>
      <Card>
        <H>Server address</H>
        <TextInput placeholderTextColor={C.muted} selectionColor={C.accent} style={s.input} value={addr} onChangeText={setAddr} autoCapitalize="none" testID="server-address" accessibilityLabel="Server address" />
        <Muted>Emulator: http://10.0.2.2:8080 · Phone: http://LAPTOP-LAN-IP:8080</Muted>
        <View style={s.row}>
          <Btn label="Save" color={primary} onPress={() => onServer(addr.trim())} />
          <Btn kind="outline" label="Test connection" color={primary} onPress={async () => {
            try { await request(addr.trim(), '/health', { timeoutMs: 3000 }); setTest(' Connected to the server.'); } catch { setTest(' Cannot reach that address.'); }
          }} />
        </View>
        {test && <Text style={s.body}>{test}</Text>}
      </Card>
      <Card>
        <H>Account</H>
        <Text style={s.body}>{user.email} ({ROLE_LABEL[user.role]})</Text>
        <Muted>Device {deviceId}</Muted>
        <Btn kind="outline" label="Sign out" color={C.bad} onPress={() => Alert.alert('Sign out?', 'Pending offline changes stay on this phone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: onLogout }])} />
      </Card>
<Card><H>Photography</H><Muted>Stadium: Mario Klassen, CC0 / Unsplash. Training: Christopher Lemercier / Unsplash. Photos set the scene and do not represent the demo clubs.</Muted></Card>
    </ScrollView>
  );
}

function createStyles(C: Palette, width: number) {
  const wide = width >= 840;
  const compact = width < 380;
  const display = 'BarlowCondensed-Bold';
  const styles = {
    root: { flex: 1, backgroundColor: C.bg },
    workspace: { flex: 1, flexDirection: 'column' },
    screen: { flex: 1, minWidth: 0 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: wide ? 32 : 16, paddingVertical: 12, minHeight: 86, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
    headerTitle: { color: C.text, fontSize: compact ? 12 : 17, fontWeight: '900', letterSpacing: -0.6 },
    headerSub: { color: C.muted, fontSize: wide ? 11 : 9, marginTop: 4 },
    headerBtn: { minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
    headerBtnText: { color: C.text, fontSize: 24, fontWeight: '600' },
    logo: { width: 44, height: 48, borderRadius: 12, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', transform: [{ skewX: '-6deg' }] },
    logoText: { fontWeight: '900', fontSize: 18 },
    themeToggle: { minHeight: 48, minWidth: 44, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
    themeEmoji: { fontSize: 19 },
    themeLabel: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 2 },
    netbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4, paddingHorizontal: wide ? 32 : 18, paddingVertical: 6, backgroundColor: C.bg, borderBottomWidth: 1, minHeight: 34 },
    netText: { fontSize: compact ? 11 : 12, fontWeight: '600', color: C.muted },
    list: { padding: wide ? 36 : 18, paddingBottom: 40, width: '100%', maxWidth: 1440, alignSelf: 'center' },
    card: { backgroundColor: C.card, borderRadius: 3, padding: wide ? 24 : 18, marginBottom: 12 },
    h: { fontSize: 25, fontWeight: '800', color: C.text, marginTop: 16, marginBottom: 12, letterSpacing: -0.6 },
    title: { fontSize: wide ? 40 : 30, fontWeight: '900', color: C.text, marginBottom: 8, letterSpacing: -0.9, fontFamily: display },
    pageTitle: { fontSize: wide ? 48 : 38, lineHeight: wide ? 54 : 44, fontWeight: '900', color: C.text, letterSpacing: -1.1, marginBottom: 8, fontFamily: display },
    pageIntro: { marginBottom: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
    muted: { color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 3, flexShrink: 1 },
    body: { color: C.text, fontSize: 16, lineHeight: 23, marginVertical: 3, flexShrink: 1 },
    label: { color: C.text, fontSize: 14, fontWeight: '700', marginTop: 20, marginBottom: 9 },
    input: { borderWidth: 1, borderColor: C.border, borderRadius: 3, paddingHorizontal: 16, paddingVertical: 12, minHeight: 52, fontSize: 16, backgroundColor: C.input, color: C.text },
    error: { color: C.bad, fontSize: 15, lineHeight: 22, marginVertical: 10 },
    btn: { minHeight: 50, borderRadius: 3, paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', marginVertical: 6, marginRight: 8, flexShrink: 1 },
    btnSmall: { minHeight: 48, paddingHorizontal: 13 },
    btnText: { fontSize: 14, fontWeight: '800', textAlign: 'center', letterSpacing: 0.1 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 4 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    team: { fontSize: 17, fontWeight: '700', color: C.text, flex: 1 },
    score: { fontSize: compact ? 26 : 32, fontWeight: '900', color: C.accent, marginHorizontal: 6, letterSpacing: -1, fontVariant: ['tabular-nums'] },
    bigTeam: { fontSize: compact ? 16 : 20, lineHeight: 25, fontWeight: '800', color: C.text, flex: 1 },
    bigScore: { fontSize: compact ? 38 : wide ? 72 : 48, fontWeight: '900', marginHorizontal: 8, letterSpacing: -1, fontVariant: ['tabular-nums'] },
    price: { fontSize: 26, fontWeight: '900', marginTop: 10, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
    qty: { fontSize: 24, fontWeight: '800', marginHorizontal: 16, color: C.text },
    badge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start' },
    badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    empty: { paddingVertical: 46, paddingHorizontal: 24, alignItems: 'center', alignSelf: 'center', maxWidth: 500 },
    emptyEmoji: { fontSize: 44, marginBottom: 16 },
    emptyTitle: { fontSize: 21, fontWeight: '800', color: C.text, marginBottom: 8, textAlign: 'center' },
    timelineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 64 },
    timelineText: { fontSize: 15, lineHeight: 22, color: C.text, flex: 1 },
    struck: { textDecorationLine: 'line-through', color: C.muted },
    tr: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, paddingVertical: 16, paddingHorizontal: compact ? 6 : 12, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 76 },
    th: { backgroundColor: C.soft, minHeight: 48, paddingVertical: 12, marginTop: 18, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
    td: { flex: 1, textAlign: 'center', fontSize: 14, color: C.text, fontVariant: ['tabular-nums'] },
    tdTeam: { fontSize: 15, fontWeight: '800', color: C.text },
    dayHeader: { fontSize: 13, fontWeight: '800', color: C.muted, marginTop: 22, marginBottom: 12, letterSpacing: 1.3, textTransform: 'uppercase' },
    formChip: { width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: 4, marginTop: 6 },
    formText: { color: C.bg, fontSize: 11, fontWeight: '900' },
    step: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, marginRight: 6, marginTop: 8 },
    stepText: { fontSize: 12, fontWeight: '700', color: C.muted },
    tabs: {flexDirection:'row',borderBottomWidth:wide?1:0,borderTopWidth:wide?0:1,borderColor:C.border,backgroundColor:C.bg,paddingHorizontal:wide?36:4,gap:wide?28:0},
    tab: {flex:wide?undefined:1,flexDirection:wide?'row':'column',gap:wide?10:5,paddingHorizontal:wide?16:1,minHeight:wide?62:65,alignItems:'center',justifyContent:'center',borderBottomWidth:wide?3:0,borderTopWidth:wide?0:3,borderColor:'transparent'},
    tabSelected: {borderColor:C.hot},
    tabBadge:{position:'absolute',top:4,right:10,minWidth:18,height:18,paddingHorizontal:4,borderRadius:9,backgroundColor:C.hot,alignItems:'center',justifyContent:'center'},
  tabBadgeText:{fontFamily:'BarlowCondensed-Bold',fontSize:11,color:'#fff'},
  tabText: {fontSize:wide?16:10,color:C.muted,fontWeight:'600'},
    tabTextSelected: {color:C.text},
    tabIcon: {fontSize:18},
    railTitle: {color:C.muted,fontSize:12},
    toast: { position: 'absolute', left: wide ? 220 : 16, right: 16, bottom: 84, backgroundColor: C.accent, padding: 16, borderRadius: 12, zIndex: 10 },
    toastText: { color: C.onAccent, fontSize: 14, lineHeight: 21, fontWeight: '700' },
    todayCard: { backgroundColor: '#172017', borderRadius: 18, padding: wide ? 26 : 20, minHeight: wide ? 360 : 340, overflow: 'hidden', justifyContent: 'space-between' },
    todayHeadline: { color: C.heroText, fontSize: wide ? 38 : 27, lineHeight: wide ? 44 : 33, fontWeight: '900', letterSpacing: -0.7, marginVertical: 10, maxWidth: 680, fontFamily: display },
    todayRole: { color: C.heroText, opacity: 0.75, fontSize: 12, fontWeight: '700' },
    heroEmoji: { fontSize: 34, marginBottom: 6 },
    fixtureScoreboard: { paddingVertical: 18, gap: 8, flexDirection: 'row' },
    teamSide: { flex: 1, alignItems: 'center', gap: 9, minWidth: 0, flexDirection: wide ? 'row' : 'column', justifyContent: 'center' },
    crest: { width: 38, height: 40, borderRadius: 0, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    crestText: { fontSize: 26, fontWeight: '900', color: '#24251d' },
    matchTeam: { color: C.text, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    matchFooter: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    matchLink: { color: C.accent, fontSize: 12, fontWeight: '800' },
    productVisual: { backgroundColor: C.soft, borderRadius: 12, minHeight: wide ? 300 : 220, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
    productEmoji: { fontSize: wide ? 150 : 120, transform: [{rotate:'-9deg'}] },
    loginContent: { padding: wide ? 28 : 20, paddingBottom: 40, width: '100%', maxWidth: 1300, alignSelf: 'center', flexGrow: 1 },
    loginBrand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 36 },
    loginWordmark: { color: C.text, fontSize: 23, fontWeight: '900', letterSpacing: -0.8 },
    loginHeadline: { fontSize: wide ? 40 : 33, lineHeight: wide ? 52 : 44, color: C.text, fontWeight: '900', letterSpacing: -1.5, marginBottom: 14, fontFamily: display },
    loginAccent: { color: C.hot },
    loginForm: { marginTop: 12 },
    loginFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.border },

    railBrand: { paddingHorizontal: 12, paddingTop: 22, paddingBottom: 36 },
    railBall: { fontSize: 34, marginBottom: 12 },
    railWordmark: { fontSize: 20, color: C.text, fontWeight: '800', letterSpacing: -1 },
    dateStamp: { width: 58, borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingVertical: 6, alignItems: 'center', display: wide ? 'flex' : 'none' },
    dateNumber: { fontSize: 24, fontWeight: '800', color: C.text },
    dateMonth: { fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 1 },
    featureLeague: { color: '#ffffff', fontSize: wide ? 17 : 12, fontWeight: '700', flex: 1 },
    liveFlag: { backgroundColor: '#e5f47b', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
    liveFlagText: { color: '#1b2113', fontSize: 10, letterSpacing: 1, fontWeight: '800' },
    featureScoreboard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: wide ? 34 : 28, gap: 8 },
    featureTeam: { flex: 1, alignItems: 'center', gap: 8 },
    crestLarge: {width:64,height:72,backgroundColor:'transparent'},
    featureTeamName: { fontSize: wide ? 17 : 13, color: '#ffffff', fontWeight: '800', textAlign: 'center' },
    featureMeta: { color: '#e2e8d8', fontSize: wide ? 10 : 8, fontWeight: '700', letterSpacing: 0.8, textAlign: 'center' },
    featureScoreWrap: { alignItems: 'center', minWidth: wide ? 138 : 92 },
    featureScore: { fontSize: wide ? 64 : 44, lineHeight: wide ? 84 : 64, color: '#ffffff', fontWeight: '900', letterSpacing: -2, fontVariant: ['tabular-nums'] },
    featureBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#697764', paddingTop: 16, gap: 8, flexWrap: 'wrap' },
    featureVenue: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
    featureButton: { minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: '#e5f47b', borderRadius: 10 },
    featureButtonText: { color: '#1b2113', fontSize: 12, fontWeight: '700' },
    pitch: { position: 'absolute', left: '12%', right: '12%', top: 60, bottom: 72, borderWidth: 1, borderColor: '#c8b846', borderRadius: 5, opacity: 0.5 },
    pitchCircle: { position: 'absolute', width: 120, height: 120, borderWidth: 1, borderColor: '#c8b846', borderRadius: 60, left: '50%', top: '50%', marginLeft: -60, marginTop: -60 },
    pitchLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeftWidth: 1, borderLeftColor: '#c8b846' },
    pitchGoalLeft: { position: 'absolute', left: 0, top: '25%', bottom: '25%', width: 38, borderWidth: 1, borderColor: '#c8b846' },
    pitchGoalRight: { position: 'absolute', right: 0, top: '25%', bottom: '25%', width: 38, borderWidth: 1, borderColor: '#c8b846' },

    appFrame: { flex: 1, flexDirection: 'column' },
    appMain: { flex: 1, minWidth: 0 },
    sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, marginBottom: 24, marginTop: 2, flexWrap: 'wrap' },
    sectionTitle: { fontSize: 26, color: C.text, fontWeight: '700', letterSpacing: -0.5 },
    sectionEmoji: { fontSize: 24 },
    dashboardTop: { flexDirection: wide ? 'row' : 'column', gap: 20, marginBottom: 22 },
    dashboardFeature: { flex: wide ? 1 : undefined, minWidth: 0 },
    featurePhoto: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
    featureShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,16,8,0.66)' },
    glance: {backgroundColor:C.card,padding:24,borderTopWidth:3,borderTopColor:C.hot},
    miniTableHeading: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginTop: 8, borderBottomWidth: 1, borderBottomColor: C.border },
    miniTableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, borderBottomWidth: 1, borderBottomColor: C.border },
    miniRank: { width: 12, color: C.muted, fontSize: 11 },
    miniTeam: { flex: 1, color: C.text, fontSize: 11, fontWeight: '600' },
    miniPoints: { color: C.accent, fontSize: 15, fontWeight: '700' },
    tableLink: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
    tableLinkText: { color: C.accent, fontSize: 12, fontWeight: '600' },
    overviewStats: { flexDirection: 'row', marginBottom: 30, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border, paddingVertical: 20 },
    statCell: { flex: 1, flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start', gap: 10, paddingHorizontal: wide ? 18 : 8 },
    statEmoji: { fontSize: 24 },
    statValue: { color: C.text, fontSize: 23, fontWeight: '700' },
    statLabel: { color: C.muted, fontSize: 10 },
    fixtureRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 0, borderBottomWidth:1,borderBottomColor:C.border, paddingHorizontal: wide ? 22 : 12, paddingVertical: 14, marginBottom: 0, gap: wide ? 24 : 12 },
    fixtureStatus: { width: wide ? 100 : 65, gap: 5 },
    fixtureStatusText: { fontSize: 10, fontWeight: '600' },
    fixtureTime: { fontSize: 11, color: C.muted },
    fixtureTeams: { flex: 1, gap: 8 },
    fixtureTeamRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    fixtureTeamName: { color: C.text, fontSize: wide ? 14 : 12, flex: 1, fontWeight: '600' },
    fixtureGoal: { color: C.text, fontSize: 18, fontWeight: '700', width: 25, textAlign: 'center' },
    fixtureVenue: { width: 170, gap: 12, alignItems: 'flex-end' },
    fixtureArrow: { color: C.accent, fontSize: 22 },
    railSubtitle: { color: C.muted, fontSize: 10, lineHeight: 17 },
    railFooter: { marginTop: 'auto', paddingTop: 30 },
    railPhoto: { height: 112, width: '100%', borderRadius: 12 },
    railFooterTitle: { color: C.text, fontSize: 14, fontWeight: '600', marginTop: 12 },
    railAccount: { flexDirection: 'row', gap: 10, alignItems: 'center', borderTopWidth: 1, borderColor: C.border, paddingTop: 20, marginTop: 20, minHeight: 64 },
    accountAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center' },
    accountInitial: { color: C.accent, fontSize: 14, fontWeight: '700' },
    accountName: { color: C.text, fontSize: 11, fontWeight: '600' },
    navArrow: { marginLeft: 'auto', color: C.onAccent, fontSize: 19 },
    standingsBanner: { backgroundColor: C.hero, borderRadius: 16, padding: 24, flexDirection: 'row', alignItems: 'center', gap: 24, marginBottom: 24 },
    standingsTrophy: { fontSize: wide ? 70 : 44 },
    standingsTitle: { color: C.heroText, fontSize: wide ? 30 : 22, fontWeight: '700' },
    standingsDetail: { color: '#4a562f', fontSize: 12, marginTop: 6 },
    shopBanner: { minHeight: wide ? 340 : 260, padding: 28, justifyContent: 'flex-end', overflow: 'hidden', borderRadius: 18, marginBottom: 18 },
    shopBannerTitle: { fontSize: wide ? 60 : 42, color: '#ffffff', lineHeight: wide ? 64 : 48, fontWeight: '700', letterSpacing: -1 },
    shopBannerDetail: { color: '#e5f47b', fontSize: 13, marginTop: 12 },
    productBackdrop: { position: 'absolute', fontSize: wide ? 86 : 49, color: C.border, fontWeight: '900', letterSpacing: -3 },
    clubCover: { minHeight: wide ? 300 : 220, padding: 28, overflow: 'hidden', borderRadius: 18, justifyContent: 'flex-end', marginBottom: 24 },
    clubDirectoryRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
    clubProfileTop: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 20 },
    syncHero: { padding: 32, alignItems: 'center', backgroundColor: C.soft, borderRadius: 18, marginBottom: 28 },
    syncEmoji: { fontSize: 48, marginBottom: 18 },
    syncTitle: { color: C.text, fontSize: 26, fontWeight: '700', textAlign: 'center' },
    syncDetail: { color: C.muted, fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 10 },
    loginLayout: { flexDirection: wide ? 'row' : 'column', flex: 1, gap: wide ? 60 : 0 },
    loginCover: { display: wide ? 'flex' : 'none', flex: 1, minHeight: 760, borderRadius: 24, overflow: 'hidden', padding: 40, justifyContent: 'space-between' },
    loginFormPanel: { flex: 1, paddingVertical: wide ? 30 : 12, maxWidth: 480 },
    loginCoverBrand: { color: '#e5f47b', fontSize: 22, fontWeight: '700' },
    loginCoverTitle: { color: '#fff', fontSize: 54, lineHeight: 66, fontWeight: '700', letterSpacing: -1.5 },
    loginCoverDetail: { color: '#e0e7d8', fontSize: 15, lineHeight: 24, marginTop: 18 },
    loginCoverFooter: { color: '#e5f47b', fontSize: 11, letterSpacing: 2 },

    brandLockup:{flexDirection:'row',alignItems:'center',gap:12},brandMark:{flexDirection:'row',gap:3},brandSlash:{height:26,width:6,backgroundColor:C.hot,transform:[{skewX:'-18deg'}]},brandName:{fontSize:wide?32:22,color:C.text,fontWeight:'800',letterSpacing:-.7},
    currentDate:{flexDirection:'row',gap:10,alignItems:'center'},currentDateText:{fontSize:13,color:C.muted},
    editorialCover:{position:'relative',minHeight:wide?390:540,flexDirection:wide?'row':'column',justifyContent:'space-between',gap:wide?28:24,padding:wide?38:24,overflow:'hidden',backgroundColor:'#17212b',marginBottom:38},
    editorialShade:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(5,14,22,0.50)'},
    coverEditorial:{flex:1,justifyContent:'center',alignItems:'flex-start',minWidth:0},coverLeague:{fontSize:width>=1200?76:wide?58:42,lineHeight:width>=1200?78:wide?62:46,color:'#ffffff',fontWeight:'800',letterSpacing:-1},coverSeason:{color:'#dce4e9',fontSize:12,letterSpacing:2,marginTop:18},coverLink:{flexDirection:'row',gap:16,alignItems:'center',marginTop:24,minHeight:48},coverLinkText:{color:'#fff',fontSize:12,fontWeight:'600',letterSpacing:1.1},
    scoreTicket:{width:wide?390:'100%',backgroundColor:'#f5f5f0',padding:wide?26:20,justifyContent:'space-between'},ticketLive:{flexDirection:'row',alignItems:'center',gap:8},liveDot:{width:7,height:7,borderRadius:4,backgroundColor:'#c74326'},ticketLiveText:{fontSize:11,fontWeight:'600',color:'#a32e17',letterSpacing:1},ticketScoreboard:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:22,gap:8},ticketTeam:{flex:1,alignItems:'center',gap:10},ticketTeamName:{fontSize:13,lineHeight:18,textAlign:'center',color:'#20262b',fontWeight:'600'},ticketScoreWrap:{alignItems:'center',width:100},ticketScore:{fontSize:50,color:'#15191d',fontWeight:'800'},ticketStatus:{fontSize:8,color:'#5e666e',letterSpacing:.7},ticketVenue:{flexDirection:'row',gap:6,alignItems:'center',justifyContent:'center',marginTop:22,marginBottom:20},ticketVenueText:{fontSize:11,color:'#5e666e'},ticketButton:{backgroundColor:'#b9361b',minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},ticketButtonText:{color:'#fff',fontSize:14,fontWeight:'600'},
    scheduleLayout:{flexDirection:wide?'row':'column',gap:36},scheduleMain:{flex:1,minWidth:0},scheduleAside:{width:width>=1200?330:280,gap:26},searchWrap:{flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:C.border,paddingHorizontal:14,backgroundColor:C.input},searchInput:{flex:1,minWidth:0,minHeight:48,color:C.text,fontSize:14,paddingVertical:10},filterTabs:{flexDirection:'row',borderBottomWidth:1,borderColor:C.border,marginTop:14},filterTab:{flex:1,alignItems:'center',justifyContent:'center',minHeight:48,borderBottomWidth:2,borderColor:'transparent'},filterActive:{borderColor:C.hot},filterText:{fontSize:11,color:C.muted,fontWeight:'600'},filterCount:{fontSize:10,color:C.muted},updateStamp:{fontSize:11,color:C.muted,marginTop:24},clubFeature:{minHeight:280,overflow:'hidden',padding:24,justifyContent:'space-between'},clubFeatureTitle:{fontSize:48,lineHeight:48,color:'#fff',fontWeight:'800'},kitCaption:{color:C.muted,fontSize:11,marginTop:8},

    sportPageHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:16,marginBottom:18},sportPageTitle:{fontSize:wide?54:36,lineHeight:wide?58:42,color:C.text,fontWeight:'800',letterSpacing:-.5},sportIntro:{fontSize:12,color:C.muted,marginTop:3},sportRefresh:{minHeight:48,minWidth:46,borderRadius:24,backgroundColor:C.soft,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9,paddingHorizontal:wide?17:0},sportRefreshText:{fontSize:12,color:C.text,fontWeight:'600'},
    sportFilters:{flexDirection:'row',gap:9,paddingBottom:19},sportFilter:{minHeight:48,borderRadius:23,paddingHorizontal:16,borderWidth:1,borderColor:C.border,backgroundColor:C.card,flexDirection:'row',alignItems:'center',gap:8},sportFilterText:{fontSize:12,color:C.text,fontWeight:'600'},
    sportHeroRow:{flexDirection:wide?'row':'column',gap:22,marginBottom:30},sportHeroMain:{flex:wide?1.65:undefined,minWidth:0},sportPhotoFeature:{flex:1,minHeight:310,borderRadius:28,overflow:'hidden',padding:25,justifyContent:'space-between',backgroundColor:'#252a24'},sportPhotoShade:{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'#161b16a6'},sportPhotoTop:{flexDirection:'row',alignItems:'center',gap:10},sportPhotoLabel:{fontSize:11,color:'#f5d662',fontWeight:'600',letterSpacing:.8},sportPhotoTitle:{fontSize:46,lineHeight:47,color:'#fff',fontWeight:'800',marginBottom:18},sportPhotoLink:{fontSize:11,color:'#fff'},sportPhotoArrow:{width:39,height:39,borderRadius:22,backgroundColor:'#f5d662',alignItems:'center',justifyContent:'center'},
    sportScoreCard:{borderRadius:28,overflow:'hidden',padding:wide?26:20},sportScoreFeatured:{backgroundColor:'#f5d662',minHeight:wide?310:284,justifyContent:'space-between'},sportScoreCompact:{backgroundColor:C.soft,minHeight:222,padding:19,borderRadius:24},sportScoreTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},sportLeague:{fontSize:wide?14:12,fontWeight:'600',flexShrink:1,minWidth:0},sportStatus:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:10,paddingVertical:6,borderRadius:15},sportStatusText:{fontSize:9,fontWeight:'600',letterSpacing:.5},sportLiveDot:{width:5,height:5,borderRadius:3,backgroundColor:'#fff'},sportScoreRow:{flexDirection:'row',alignItems:'center',gap:wide?18:6,marginVertical:wide?24:21},sportTeam:{flex:1,minWidth:0,alignItems:'center',gap:10},sportTeamName:{fontSize:wide?28:22,lineHeight:wide?31:25,fontWeight:'800',textAlign:'center',textTransform:'uppercase'},sportScoreCentre:{width:wide?'35%':'39%',alignItems:'center',justifyContent:'center',minWidth:0},sportScore:{fontSize:wide?90:compact?52:64,lineHeight:wide?96:compact?62:74,fontWeight:'800',letterSpacing:-1.2,width:'100%',textAlign:'center',fontVariant:['tabular-nums']},sportMatchNote:{fontSize:8,fontWeight:'600',letterSpacing:.7,textAlign:'center'},sportScoreFooter:{borderTopWidth:1,paddingTop:15,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:9},sportVenue:{fontSize:10,flex:1},sportMatchLink:{flexDirection:'row',gap:8,backgroundColor:'#292519',borderRadius:22,minHeight:48,alignItems:'center',paddingHorizontal:13},sportMatchLinkText:{fontSize:9,color:'#fff',fontWeight:'600',letterSpacing:.2},
    sportSectionHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:9},sportSectionTitle:{fontSize:wide?32:27,lineHeight:wide?36:31,color:C.text,fontWeight:'800',flexShrink:1},sportMatchTabs:{flexDirection:'row',gap:wide?25:0,borderBottomWidth:1,borderBottomColor:C.border,marginBottom:18},sportMatchTab:{minHeight:48,paddingHorizontal:wide?5:0,flex:wide?undefined:1,alignItems:'center',justifyContent:'center',borderBottomWidth:2,borderBottomColor:'transparent'},sportMatchTabActive:{borderBottomColor:C.hot},sportMatchTabText:{fontSize:11,color:C.muted,fontWeight:'600'},sportMatches:{flexDirection:wide?'row':'column',flexWrap:wide?'wrap':'nowrap',gap:16,marginBottom:33},sportMatchItem:{flex:wide?1:undefined,minWidth:wide?280:0,width:wide?undefined:'100%'},
    roundButton:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:26},
    notificationDot:{position:'absolute',top:8,right:10,width:6,height:6,borderRadius:3,backgroundColor:C.hot},profileAvatar:{width:40,height:40,borderRadius:22,backgroundColor:'#f0d5c2',alignItems:'center',justifyContent:'center'},profileInitial:{fontSize:16,color:'#7a4932',fontWeight:'600'},
    homePage:{paddingHorizontal:wide?36:20,paddingTop:wide?22:12,paddingBottom:98,width:'100%',maxWidth:1320,alignSelf:'center'},homeColumns:{flexDirection:wide?'row':'column',gap:wide?28:0,alignItems:'flex-start'},homeMain:{flex:wide?1.05:undefined,width:wide?undefined:'100%',minWidth:0},homeGalleryPanel:{flex:1,minWidth:0,borderLeftWidth:1,borderLeftColor:C.border,paddingLeft:26},homeCalendarPanel:{flex:1,minWidth:0,paddingLeft:width>=1150?4:0,display:width>=1150?'flex':'none'},
    greeting:{fontSize:13,color:C.muted,marginBottom:10},welcomeTitle:{fontSize:wide?29:28,lineHeight:39,color:C.text,fontWeight:'600',letterSpacing:-.9,marginBottom:23},homeSearch:{flexDirection:'row',gap:10,marginBottom:26},searchGo:{width:52,height:52,borderRadius:28,backgroundColor:C.hot,alignItems:'center',justifyContent:'center'},
    homeSectionHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:17,marginTop:9},homeSectionTitle:{fontSize:19,fontWeight:'600',color:C.text,letterSpacing:-.45},textAction:{minHeight:48,minWidth:48,justifyContent:'center',alignItems:'flex-end'},textActionLabel:{fontSize:12,color:C.muted},groupStrip:{gap:15,paddingRight:24,paddingBottom:12},
    groupCard:{width:wide?270:264,minHeight:260,padding:22,borderRadius:30,overflow:'hidden'},groupRingOne:{position:'absolute',right:-70,top:-70,width:240,height:240,borderRadius:120,borderWidth:1,borderColor:'#ffffff25'},groupRingTwo:{position:'absolute',right:-47,top:-47,width:194,height:194,borderRadius:100,borderWidth:1,borderColor:'#ffffff25'},groupCalendar:{width:45,height:45,borderRadius:24,borderWidth:1,borderColor:'#ffffff66',alignItems:'center',justifyContent:'center'},groupName:{fontSize:30,lineHeight:33,fontWeight:'600',letterSpacing:-.6,marginTop:20,marginBottom:18,maxWidth:190},groupRole:{fontSize:12},iconLabel:{flexDirection:'row',alignItems:'center',gap:7},groupBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingTop:17,marginTop:19,borderTopWidth:1,borderTopColor:'#ffffff40'},groupSmall:{fontSize:11},groupOpen:{width:58,height:40,borderRadius:23,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},avatarStack:{flexDirection:'row'},smallAvatar:{width:29,height:29,borderRadius:16,borderWidth:1.5,borderColor:'#fff',alignItems:'center',justifyContent:'center'},smallAvatarText:{fontSize:9,color:'#5f4433',fontWeight:'600'},
    otherClub:{flexDirection:'row',alignItems:'center',gap:13,paddingVertical:13,paddingHorizontal:12,borderWidth:1,borderColor:C.border,borderRadius:24,marginBottom:11},otherClubTitle:{fontSize:14,fontWeight:'600',color:C.text},otherClubDetail:{fontSize:11,color:C.muted,marginTop:3},standingsShortcut:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:18,backgroundColor:C.soft,borderRadius:23,marginTop:10},
    previewGroupHead:{backgroundColor:C.soft,padding:21,borderRadius:28,flexDirection:'row',alignItems:'center',gap:15,marginBottom:16},previewClubTitle:{fontSize:20,fontWeight:'600',color:C.text,letterSpacing:-.6},segmentRow:{flexDirection:'row',gap:8,marginBottom:18},segment:{flex:1,minHeight:48,borderRadius:28,borderWidth:1,borderColor:C.border,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:6},segmentSelected:{backgroundColor:C.hot,borderColor:C.hot},segmentText:{fontSize:12,color:C.muted},segmentSelectedText:{fontSize:12,color:C===PALETTES.dark?C.bg:'#fff',fontWeight:'500'},
    photoMasonry:{flexDirection:'row',gap:12},photoColumn:{flex:1,gap:12,minWidth:0},photoTile:{overflow:'hidden',borderRadius:23,backgroundColor:C.soft},photoImage:{width:'100%',height:'100%'},photoExpand:{position:'absolute',right:10,top:10,width:30,height:30,borderRadius:16,backgroundColor:'#00000035',alignItems:'center',justifyContent:'center'},photoCredit:{fontSize:10,lineHeight:16,color:C.muted,marginTop:13},
    monthPicker:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:16},monthName:{fontSize:14,fontWeight:'500',color:C.text},calendarCard:{padding:19,borderRadius:26,marginBottom:14},calendarWeekday:{fontSize:12,fontWeight:'500'},calendarArrow:{height:32,width:32,borderRadius:17,borderWidth:1,borderColor:'#ffffffaa',alignItems:'center',justifyContent:'center'},calendarCardBody:{flexDirection:'row',gap:18,marginTop:8},calendarDate:{width:76,justifyContent:'center'},calendarDay:{fontSize:42,lineHeight:48,fontWeight:'500',letterSpacing:-1.2},calendarMonth:{fontSize:34,lineHeight:42,fontWeight:'500',letterSpacing:-1},calendarInfo:{flex:1,minWidth:0,borderLeftWidth:1,borderLeftColor:'#ffffffaa',paddingLeft:15,justifyContent:'center',gap:7},calendarTime:{fontSize:10,fontWeight:'500'},calendarStatus:{alignSelf:'flex-start',paddingHorizontal:10,paddingVertical:5,borderRadius:17},calendarStatusText:{fontSize:9,fontWeight:'500'},calendarTeams:{fontSize:11,fontWeight:'500',lineHeight:17},calendarVenue:{fontSize:10,flex:1},calendarPage:{maxWidth:660},
    floatingPlus:{position:'absolute',bottom:wide?26:22,right:wide?38:24,height:58,width:58,borderRadius:31,backgroundColor:C.hot,alignItems:'center',justifyContent:'center',elevation:5,boxShadow:'0 8px 24px rgba(130,40,25,0.18)'},sheetBackdrop:{flex:1,backgroundColor:'#00000045',justifyContent:'flex-end'},quickSheet:{padding:24,paddingBottom:40,borderTopLeftRadius:32,borderTopRightRadius:32,backgroundColor:C.card,width:'100%',maxWidth:540,alignSelf:'center'},quickAction:{minHeight:62,flexDirection:'row',alignItems:'center',gap:14,borderBottomWidth:1,borderBottomColor:C.border},
    lightbox:{flex:1,backgroundColor:'#101010f5',padding:24,justifyContent:'center'},lightboxHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},lightboxTitle:{color:'#fff',fontSize:14},lightboxImage:{flex:1,width:'100%',minHeight:200},lightboxControls:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
    clubGrid:{flexDirection:'row',flexWrap:'wrap',gap:22},clubHub:{flex:1,width:'100%',maxWidth:900,alignSelf:'center'},clubHubHeader:{padding:wide?30:24,backgroundColor:C.soft,borderBottomLeftRadius:34,borderBottomRightRadius:34},clubHubIdentity:{flexDirection:'row',alignItems:'center',gap:18},clubHubTitle:{fontSize:wide?28:23,lineHeight:32,fontWeight:'600',color:C.text,letterSpacing:-.7},clubIdChip:{alignSelf:'flex-start',borderRadius:20,backgroundColor:C.card,paddingHorizontal:13,paddingVertical:5,marginTop:7},clubIdText:{fontSize:11,color:C.muted},clubFacts:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',gap:14,marginTop:25},clubFact:{flex:1,alignItems:'center',gap:7},clubFactText:{fontSize:12,color:C.text},clubFactButton:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:C.card,borderRadius:27,padding:13},clubHubBody:{flex:1,paddingHorizontal:wide?28:22,paddingTop:18},hubScroll:{paddingBottom:32},matchDetailTeam:{flex:1,alignItems:'center',gap:12},
  };
  Object.assign(styles, {
    root:{flex:1,backgroundColor:C.bg}, appFrame:{flex:1,flexDirection:'column'}, appMain:{flex:1,minWidth:0},
    header:{flexDirection:'row',alignItems:'center',paddingHorizontal:wide?36:width<390?14:22,paddingTop:wide?24:20,paddingBottom:wide?18:12,gap:width<390?4:8,backgroundColor:C.bg,minHeight:88},
    brandLockup:{flexDirection:'row',alignItems:'center',gap:width<390?8:11,flexShrink:1,minWidth:0},brandMark:{width:44,height:44,borderRadius:22,backgroundColor:C.hot,alignItems:'center',justifyContent:'center'},brandName:{fontSize:wide?23:width<390?19:21,fontWeight:'700',color:C.text,letterSpacing:-.7,flexShrink:1},
    headerTitle:{fontSize:13,color:C.muted,fontWeight:'500'},headerSub:{fontSize:11,color:C.muted,marginTop:4},headerBtn:{width:46,height:46,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.border,borderRadius:24},
    themeToggle:{width:44,height:44,borderRadius:24,alignItems:'center',justifyContent:'center',backgroundColor:C.soft},themeLabel:{display:'none'},
    netbar:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:wide?38:24,paddingVertical:7,borderBottomWidth:0,backgroundColor:C.bg},netText:{fontSize:10,color:C.muted},
    tabs:{flexDirection:'row',alignItems:'center',justifyContent:wide?'center':'space-around',paddingHorizontal:wide?20:8,paddingVertical:7,gap:wide?14:2,alignSelf:'center',backgroundColor:C.soft,borderRadius:40,marginBottom:wide?4:12,marginTop:wide?0:7,width:wide?620:'90%'},
    tab:{flex:wide?undefined:1,flexDirection:'row',gap:8,paddingHorizontal:wide?20:0,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:27},tabSelected:{backgroundColor:C.card},tabText:{fontSize:12,color:C.muted,fontWeight:'500'},tabTextSelected:{color:C.hot},
    list:{padding:wide?32:22,paddingBottom:42,width:'100%',maxWidth:1180,alignSelf:'center'},
    card:{backgroundColor:C.card,padding:wide?26:20,borderRadius:24,marginBottom:16,borderWidth:1,borderColor:C.border},
    pageTitle:{fontSize:wide?32:28,lineHeight:wide?44:38,color:C.text,fontWeight:'700',letterSpacing:-.9,marginBottom:6},sectionTitle:{fontSize:21,color:C.text,fontWeight:'600',letterSpacing:-.5},
    h:{fontSize:22,color:C.text,fontWeight:'600',letterSpacing:-.5,marginTop:10,marginBottom:14},title:{fontSize:30,color:C.text,fontWeight:'700',letterSpacing:-.8,marginBottom:9},
    body:{fontSize:14,lineHeight:23,color:C.text,flexShrink:1},muted:{fontSize:12,lineHeight:20,color:C.muted,flexShrink:1},label:{fontSize:13,fontWeight:'600',color:C.text,marginTop:19,marginBottom:9},
    input:{minHeight:52,paddingHorizontal:18,paddingVertical:12,borderWidth:1,borderColor:C.border,borderRadius:28,backgroundColor:C.input,color:C.text,fontSize:14},
    btn:{minHeight:48,borderRadius:26,paddingHorizontal:20,paddingVertical:12,marginRight:8,marginVertical:6,alignItems:'center',justifyContent:'center',flexShrink:1},btnText:{fontSize:12,fontWeight:'600',textAlign:'center'},
    searchWrap:{flexDirection:'row',alignItems:'center',gap:10,minHeight:52,borderWidth:1,borderColor:C.border,borderRadius:30,paddingHorizontal:17,backgroundColor:C.input},searchInput:{flex:1,minWidth:0,minHeight:50,paddingVertical:10,fontSize:13,color:C.text},
    crest:{width:48,height:48,alignItems:'center',justifyContent:'center',backgroundColor:C.bg,borderRadius:26},crestLarge:{width:68,height:68,borderRadius:35,backgroundColor:'#fffdf6'},
    roundButton:{width:48,height:48,alignItems:'center',justifyContent:'center',borderRadius:26},
    badge:{borderRadius:16,borderWidth:1,paddingHorizontal:11,paddingVertical:5,alignSelf:'flex-start'},badgeText:{fontSize:10,fontWeight:'600'},
    dayHeader:{fontSize:13,fontWeight:'600',color:C.muted,marginTop:24,marginBottom:12,letterSpacing:0,textTransform:'none'},
    standingsBanner:{backgroundColor:C.hero,padding:24,borderRadius:28,flexDirection:'row',alignItems:'center',gap:18,marginBottom:22},standingsTitle:{fontSize:24,fontWeight:'600',color:C.heroText},
    shopBanner:{minHeight:240,borderRadius:28,padding:28,overflow:'hidden',justifyContent:'flex-end',marginBottom:24},shopBannerTitle:{fontSize:36,lineHeight:44,fontWeight:'600',color:'#fff',letterSpacing:-1},
    tr:{flexDirection:'row',alignItems:'center',backgroundColor:C.card,paddingVertical:18,paddingHorizontal:compact?6:16,borderBottomWidth:1,borderBottomColor:C.border,minHeight:80},
    bigTeam:{fontSize:compact?12:15,fontWeight:'600',color:C.text,textAlign:'center'},bigScore:{fontSize:compact?34:48,fontWeight:'700',marginHorizontal:12},
    toast:{position:'absolute',left:22,right:22,bottom:90,backgroundColor:C.accent,padding:16,borderRadius:22,zIndex:20},
    productVisual:{backgroundColor:C.soft,minHeight:280,borderRadius:26,alignItems:'center',justifyContent:'center',marginBottom:22},
    loginCover:{display:wide?'flex':'none',flex:1,minHeight:720,borderRadius:40,overflow:'hidden',padding:38,justifyContent:'space-between'},loginHeadline:{fontSize:36,lineHeight:46,color:C.text,fontWeight:'600',letterSpacing:-1,marginBottom:18},loginCoverTitle:{fontSize:46,lineHeight:56,fontWeight:'600',color:'#fff',letterSpacing:-1.4}
  });
  // Explicit font files give Android the same Poppins weights as the web preview.
  for (const value of Object.values(styles)) {
    const style = value as any;
    if (style.fontSize !== undefined) {
      const weight = Number(style.fontWeight ?? 400);
      style.fontFamily = weight >= 700 ? 'Poppins-SemiBold' : weight >= 500 ? 'Poppins-SemiBold' : 'Poppins-Regular';
      style.fontWeight = 'normal';
    }
  }

  const displayKeys: (keyof typeof styles)[] = ['sportPageTitle','sportPhotoTitle','sportTeamName','sportScore','sportSectionTitle','brandName','pageTitle','sectionTitle','h','title','homeSectionTitle','groupName','otherClubTitle','previewClubTitle','clubHubTitle','standingsTitle','shopBannerTitle','bigTeam','bigScore','calendarDay','calendarMonth','loginHeadline','loginCoverTitle'];
  for (const key of displayKeys) { const style=styles[key] as any;style.fontFamily='BarlowCondensed-Bold';style.fontWeight='normal'; }
  Object.assign(styles.brandName,{fontSize:wide?31:26,letterSpacing:.2});
  Object.assign(styles.homeSectionTitle,{fontSize:24,letterSpacing:.1});
  Object.assign(styles.otherClubTitle,{fontSize:20,letterSpacing:.1});
  Object.assign(styles.crest,{backgroundColor:'transparent',borderRadius:0});
  Object.assign(styles.crestLarge,{backgroundColor:'transparent',width:68,height:72,borderRadius:0});
  return StyleSheet.create(styles as any) as Record<keyof typeof styles, any>;
}
