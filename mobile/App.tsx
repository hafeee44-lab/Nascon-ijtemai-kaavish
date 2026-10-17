import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, FlatList, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
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
type Tab = 'fixtures' | 'standings' | 'store' | 'club' | 'sync';

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Platform Super-Admin', league_organizer: 'League Organizer', club_manager: 'Club Manager', player: 'Player', viewer: 'Viewer',
};
const DEMO = ['organizer', 'manager', 'player', 'viewer', 'admin'];

// ---------- small UI kit (consistent spacing, 48dp targets, labels) ----------
const C = { bg: '#f5f6f8', card: '#ffffff', text: '#111827', muted: '#4b5563', border: '#d1d5db', ok: '#047857', bad: '#b91c1c', warn: '#b45309' };

function Btn({ label, onPress, color, kind = 'solid', disabled, small }: { label: string; onPress: () => void; color: string; kind?: 'solid' | 'outline'; disabled?: boolean; small?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, small && s.btnSmall, kind === 'solid' ? { backgroundColor: color } : { borderColor: color, borderWidth: 2, backgroundColor: '#fff' },
        (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[s.btnText, { color: kind === 'solid' ? '#fff' : color }]}>{label}</Text>
    </Pressable>
  );
}
const Card = ({ children, onPress, label }: { children: React.ReactNode; onPress?: () => void; label?: string }) =>
  onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.card, pressed && { opacity: 0.8 }]}>{children}</Pressable>
    : <View style={s.card}>{children}</View>;
const H = ({ children }: { children: React.ReactNode }) => <Text style={s.h}>{children}</Text>;
const Muted = ({ children }: { children: React.ReactNode }) => <Text style={s.muted}>{children}</Text>;
const Empty = ({ text }: { text: string }) => <View style={s.empty}><Text style={s.muted}>{text}</Text></View>;
const Badge = ({ text, color }: { text: string; color: string }) => <View style={[s.badge, { borderColor: color }]}><Text style={[s.badgeText, { color }]}>{text}</Text></View>;

const STATUS: Record<string, [string, string]> = {
  upcoming: ['Upcoming', C.muted], in_progress: ['● Live', C.bad], completed: ['Full time', C.ok],
  clinched: ['✓ Qualified', C.ok], eliminated: ['✗ Out', C.bad], still_possible: ['In contention', C.warn],
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
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
      <StatusBar barStyle="light-content" />
      <View style={[s.header, { backgroundColor: primary }]}>
        {stack.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={pop} style={s.headerBtn}><Text style={s.headerBtnText}>‹ Back</Text></Pressable>
        ) : (
          <View style={s.logo} accessibilityLabel={`${boot?.tenant?.name ?? 'Club'} logo`}><Text style={[s.logoText, { color: primary }]}>{(boot?.tenant?.name ?? 'NA').split(' ').map((w: string) => w[0]).join('').slice(0, 2)}</Text></View>
        )}
        <View style={{ flex: 1, marginHorizontal: 8 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{boot?.tenant?.name ?? 'NaSCon Sports'}</Text>
          <Text style={s.headerSub} numberOfLines={1}>{ROLE_LABEL[user.role]} · {user.email}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => push({ name: 'settings' })} style={s.headerBtn}><Text style={s.headerBtnText}>⚙ Settings</Text></Pressable>
      </View>
      <NetBar net={net} pending={queue.length} onPress={() => { setStack([{ name: 'tabs' }]); setTab('sync'); }} />
      <View style={{ flex: 1 }}>
        {route.name === 'tabs' && tab === 'fixtures' && <Fixtures {...ctx} />}
        {route.name === 'tabs' && tab === 'standings' && <Standings {...ctx} />}
        {route.name === 'tabs' && tab === 'store' && <Store {...ctx} />}
        {route.name === 'tabs' && tab === 'club' && <ClubTab {...ctx} />}
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
      </View>
      {toast && <View style={s.toast} accessibilityLiveRegion="polite"><Text style={s.toastText}>{toast}</Text></View>}
      {route.name === 'tabs' && (
        <View style={s.tabs}>
          {([['fixtures', 'Fixtures', '📅'], ['standings', 'Standings', '🏆'], ['store', 'Store', '🛒'], ['club', 'Club', '🛡'], ['sync', 'Sync', '⇅']] as [Tab, string, string][]).map(([k, label, icon]) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} style={s.tab}>
              <Text style={[s.tabIcon]}>{icon}</Text>
              <Text style={[s.tabText, tab === k && { color: primary, fontWeight: '700' }]}>{label}{k === 'sync' && queue.length ? ` (${queue.length})` : ''}{k === 'store' && cart.length ? ` (${cart.length})` : ''}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

function NetBar({ net, pending, onPress }: { net: Net; pending: number; onPress: () => void }) {
  const [label, color] = net === 'online' ? ['● Online', C.ok] : net === 'syncing' ? ['⟳ Syncing…', C.warn] : ['○ Offline: showing saved data', C.bad];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}. ${pending} pending changes. Open sync status.`} onPress={onPress} style={[s.netbar, { borderColor: color }]}>
      <Text style={[s.netText, { color }]}>{label}</Text>
      <Text style={s.netText}>{pending ? `${pending} pending change${pending > 1 ? 's' : ''}` : 'All changes saved'}</Text>
    </Pressable>
  );
}

// ---------- Login ----------
function Login({ server, onServer, onDone }: { server: string; onServer: (v: string) => void; onDone: (t: string, u: User) => void }) {
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
    <SafeAreaView style={[s.root, { padding: 20 }]}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={s.title}>NaSCon Sports</Text>
        <Muted>Sign in to see fixtures, standings and your club.</Muted>
        <Text style={s.label}>Email</Text>
        <TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" accessibilityLabel="Email" placeholder="you@nascon.test" />
        <Text style={s.label}>Password</Text>
        <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry accessibilityLabel="Password" placeholder="Password" />
        {err && <Text style={s.error} accessibilityLiveRegion="assertive">{err}</Text>}
        {busy ? <ActivityIndicator style={{ margin: 16 }} /> : <Btn label="Sign in" color="#1d4ed8" onPress={submit} disabled={!email || !password} />}
        <Text style={s.label}>Demo accounts (password Nascon@26)</Text>
        <View style={s.row}>
          {DEMO.map((d) => (
            <Btn key={d} small kind="outline" color="#1d4ed8" label={d} onPress={() => { setEmail(`${d}@nascon.test`); setPassword('Nascon@26'); }} />
          ))}
        </View>
        <Text style={s.label}>Server address</Text>
        <TextInput style={s.input} value={addr} onChangeText={setAddr} autoCapitalize="none" accessibilityLabel="Server address" />
        <Muted>Emulator: http://10.0.2.2:8080 · Phone: http://LAPTOP-LAN-IP:8080</Muted>
      </ScrollView>
    </SafeAreaView>
  );
}

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
  return (
    <View style={[s.card, { borderLeftWidth: 5, borderLeftColor: primary }]}>
      <Muted>{ROLE_LABEL[user.role]} · Today</Muted>
      <Text style={[s.body, { fontWeight: '700' }]}>{title}</Text>
      {action && <Btn small color={primary} label={action.label} onPress={action.go} />}
    </View>
  );
}

function Fixtures(props: any) {
  const { boot, teamName, push, refresh, net, primary } = props;
  const [filter, setFilter] = useState<'all' | 'live' | 'upcoming' | 'results'>('all');
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const all = (boot?.fixtures ?? []).filter(Boolean);
  const want = { all: () => true, live: (f: any) => f.status === 'in_progress', upcoming: (f: any) => f.status === 'upcoming', results: (f: any) => f.status === 'completed' }[filter];
  const query = q.trim().toLowerCase();
  const shown = all.filter(want).filter((f: any) => !query || `${teamName(f.home)} ${teamName(f.away)} ${f.venue ?? ''}`.toLowerCase().includes(query))
    .sort((a: any, b: any) => (filter === 'results' ? (b.kickoff ?? '').localeCompare(a.kickoff ?? '') : (a.kickoff ?? '').localeCompare(b.kickoff ?? '')));
  const rows: any[] = [];
  let last = '';
  for (const f of shown) {
    const d = dayLabel(f.kickoff);
    if (d !== last) { rows.push({ header: d, key: `h-${d}` }); last = d; }
    rows.push({ ...f, key: f.match_id });
  }
  const counts = { all: all.length, live: all.filter((f: any) => f.status === 'in_progress').length, upcoming: all.filter((f: any) => f.status === 'upcoming').length, results: all.filter((f: any) => f.status === 'completed').length };
  return (
    <FlatList
      contentContainerStyle={s.list}
      data={rows}
      keyExtractor={(r: any) => r.key}
      refreshControl={<RefreshControl refreshing={refreshing} enabled={net !== 'offline'} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View>
          <TodayCard {...props} />
          <TextInput style={s.input} value={q} onChangeText={setQ} placeholder="Search teams or venues" accessibilityLabel="Search fixtures by team or venue" />
          <View style={[s.row, { marginTop: 6 }]}>
            {(['all', 'live', 'upcoming', 'results'] as const).map((k) => (
              <Btn key={k} small kind={filter === k ? 'solid' : 'outline'} color={primary} label={`${k === 'live' ? '● Live' : k[0].toUpperCase() + k.slice(1)} (${counts[k]})`} onPress={() => setFilter(k)} />
            ))}
          </View>
          {boot?.fetched_at && <Muted>Updated {new Date(boot.fetched_at).toLocaleTimeString()}{net === 'offline' ? ' (saved copy)' : ' · pull down to refresh'}</Muted>}
        </View>
      }
      ListEmptyComponent={<Empty text={!boot ? 'Connect to the server once to load fixtures.' : query ? `No matches for "${q}".` : filter === 'live' ? 'No matches are live right now.' : 'No matches here yet.'} />}
      renderItem={({ item: f }: any) => {
        if (f.header) return <Text style={s.dayHeader} accessibilityRole="header">{f.header}</Text>;
        const [st, col] = STATUS[f.status] ?? [f.status, C.muted];
        return (
          <Card onPress={() => push({ name: 'match', id: f.match_id })} label={`${teamName(f.home)} versus ${teamName(f.away)}, ${st}`}>
            <View style={s.rowBetween}>
              <Badge text={st} color={col} />
              <Muted>{f.kickoff ? new Date(f.kickoff).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</Muted>
            </View>
            <View style={s.rowBetween}>
              <Text style={s.team} numberOfLines={1}>{teamName(f.home)}</Text>
              <Text style={s.score}>{f.status === 'upcoming' ? 'vs' : `${f.home_score} – ${f.away_score}`}</Text>
              <Text style={[s.team, { textAlign: 'right' }]} numberOfLines={1}>{teamName(f.away)}</Text>
            </View>
            {f.venue && <Muted>📍 {f.venue}</Muted>}
          </Card>
        );
      }}
    />
  );
}

// ---------- Match detail (live score, timeline, pinned product, organizer scoring) ----------
function MatchDetail({ id, server, token, net, boot, teamName, primary, user, enqueue, push, queue }: any) {
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'timeline' | 'h2h' | 'table'>('timeline');
  useEffect(() => {
    let alive = true;
    (async () => setM(await getJson(`match:${id}`, null)))();
    const load = async () => {
      try {
        const d = await request<any>(server, `/api/v1/matches/${id}`, { token, timeoutMs: 4000 });
        if (alive) { setM(d); setErr(null); await setJson(`match:${id}`, d); }
      } catch (e: any) { if (alive) setErr(e?.message); }
    };
    if (net !== 'offline') load();
    const t = setInterval(() => net !== 'offline' && load(), 3000); // live updates
    return () => { alive = false; clearInterval(t); };
  }, [id, server, token, net]);

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

  if (!m && !summary) return <Empty text={err ?? 'Loading match…'} />;
  const [st, col] = STATUS[status] ?? [status, C.muted];
  const product = m?.pinned_product ?? boot?.products?.[0];
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <View style={s.rowBetween}><Badge text={st} color={col} /><Muted>{m?.venue ?? summary?.venue ?? ''}</Muted></View>
        <View style={[s.rowBetween, { marginTop: 8 }]}>
          <Text style={s.bigTeam} numberOfLines={2}>{teamName(home)}</Text>
          <Text style={[s.bigScore, { color: primary }]} accessibilityLabel={`Score ${m?.home?.score ?? summary?.home_score} to ${m?.away?.score ?? summary?.away_score}`}>
            {m?.home?.score ?? summary?.home_score ?? 0} – {m?.away?.score ?? summary?.away_score ?? 0}
          </Text>
          <Text style={[s.bigTeam, { textAlign: 'right' }]} numberOfLines={2}>{teamName(away)}</Text>
        </View>
        {net === 'offline' && <Muted>Offline: last saved score shown.</Muted>}
        {pendingHere.length > 0 && <Text style={{ color: C.warn, marginTop: 4 }}>{pendingHere.length} score change(s) waiting to sync</Text>}
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
              <Text style={[s.timelineText, e.compensated && s.struck]}>
                {e.type === 'score' ? `● ${e.payload.event_type.replace(/_/g, ' ')}: ${teamName(e.payload.team_id)}`
                  : e.type === 'compensation' ? `↩ Correction: ${e.payload.reason ?? ''}`
                  : e.type === 'discipline' ? `🟨 Discipline: ${teamName(e.payload.team_id)} (${e.payload.points})`
                  : e.type.replace(/_/g, ' ')}
                {e.compensated ? ' (corrected)' : ''}
              </Text>
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
                <View key={r.team_id} style={[s.rowBetween, { minHeight: 40 }, playing && { backgroundColor: '#eef2ff' }]}>
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
            <Text style={[s.price, { color: primary }]}>{pkr(product.variants[0].price_minor)}</Text>
          </View>
          <Text style={{ color: primary, fontWeight: '700' }}>Shop now ›</Text>
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
  if (!form.length) return <Muted>No results yet</Muted>;
  return (
    <View style={s.row} accessibilityLabel={`Form, most recent first: ${form.map((x) => ({ W: 'win', D: 'draw', L: 'loss' } as any)[x]).join(', ')}`}>
      {form.map((r, i) => <View key={i} style={[s.formChip, { backgroundColor: FORM[r][1] }]}><Text style={s.formText}>{FORM[r][0]}</Text></View>)}
    </View>
  );
}

function Standings({ boot, teamName, user, push, primary }: any) {
  const leagues = boot?.standings ?? [];
  const [i, setI] = useState(0);
  const st = leagues[i];
  if (!st) return <Empty text="No league tables yet." />;
  return (
    <ScrollView contentContainerStyle={s.list}>
      <H>{st.name ?? st.league_id}</H>
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
            style={({ pressed }) => [s.tr, { borderLeftWidth: 5, borderLeftColor: inZone ? C.ok : 'transparent' }, mine && { backgroundColor: '#eef2ff' }, pressed && { opacity: 0.7 }]}>
            <Text style={[s.td, { flex: 0.5, fontWeight: '700' }]}>{r.rank}</Text>
            <View style={{ flex: 3 }}>
              <Text style={[s.tdTeam, mine && { color: primary }]} numberOfLines={1}>{teamName(r.team_id)}{mine ? ' · Your club' : ''}</Text>
              <Text style={{ color: col, fontSize: 13, fontWeight: '600' }}>{label}</Text>
              <FormGuide form={formOf(boot.fixtures ?? [], r.team_id)} />
            </View>
            <Text style={s.td}>{r.played}</Text><Text style={s.td}>{r.diff > 0 ? `+${r.diff}` : r.diff}</Text>
            <Text style={[s.td, { fontWeight: '800', fontSize: 17 }]}>{r.points}</Text>
          </Pressable>
        );
      })}
      <Card>
        <Text style={s.label}>Key</Text>
        <Muted>Green bar on the left = playoff places (top {st.qualification_spots}).</Muted>
        <Muted>✓ Qualified: guaranteed a playoff place · In contention: still possible · ✗ Out: can no longer qualify.</Muted>
        <Muted>Form: W win, D draw, L loss (most recent first). Ties on points are broken by head-to-head results.</Muted>
      </Card>
    </ScrollView>
  );
}

// ---------- Store ----------
function Store({ boot, push, primary, cart, orders }: any) {
  const products = boot?.products ?? [];
  return (
    <FlatList contentContainerStyle={s.list} data={products} keyExtractor={(p: any) => p.product_id}
      ListHeaderComponent={
        <View>
          <View style={s.rowBetween}><H>Club store</H>{cart.length > 0 && <Btn small color={primary} label={`🛒 Cart (${cart.length})`} onPress={() => push({ name: 'cart' })} />}</View>
          <View style={s.row}>
            <Btn small kind="outline" color={primary} label={`My orders (${orders.length})`} onPress={() => push({ name: 'orders' })} />
          </View>
          <Muted>Official club merchandise · tap an item to choose a size</Muted>
        </View>
      }
      ListEmptyComponent={<Empty text="No products in the store yet." />}
      renderItem={({ item: p }: any) => (
        <Card onPress={() => push({ name: 'product', id: p.product_id })} label={`${p.name}, ${pkr(p.variants[0].price_minor)}`}>
          <Text style={s.team}>{p.name}</Text>
          <Muted>{p.category} · {p.variants.length} sizes</Muted>
          <Text style={[s.price, { color: primary }]}>{pkr(p.variants[0].price_minor)}</Text>
        </Card>
      )} />
  );
}

function ProductScreen({ id, boot, primary, setCart, cart, push, say }: any) {
  const p = boot?.products?.find((x: any) => x.product_id === id);
  const [variant, setVariant] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  if (!p) return <Empty text="Product not found." />;
  const v = p.variants.find((x: any) => x.variant_id === variant);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <Text style={s.title}>{p.name}</Text>
        <Text style={[s.price, { color: primary }]}>{pkr(p.variants[0].price_minor)}</Text>
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
      <H>Your cart</H>
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
        <TextInput style={s.input} value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="e.g. WELCOME10" accessibilityLabel="Discount code" />
        <Text style={s.label}>Test card (mock payment gateway)</Text>
        <View style={s.row}>
          {[['tok_success', 'Approves'], ['tok_declined', 'Declines'], ['tok_capture_fail', 'Capture fails']].map(([t, l]) => (
            <Btn key={t} small kind={card === t ? 'solid' : 'outline'} color={primary} label={l} onPress={() => setCard(t)} />
          ))}
        </View>
        <Text style={[s.price, { color: primary, marginVertical: 8 }]}>Subtotal {pkr(subtotal)}</Text>
        {err && <Text style={s.error} accessibilityLiveRegion="assertive">{err}</Text>}
        {net === 'offline' ? <Text style={s.error}>Checkout needs a connection. Your cart is kept.</Text>
          : busy ? <ActivityIndicator /> : <Btn label={`Pay ${pkr(subtotal)}`} color={primary} onPress={pay} />}
      </Card>
    </ScrollView>
  );
}

function Receipt({ order, primary, say }: any) {
  const p = order.receipt.payload;
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <Text style={[s.title, { color: C.ok }]}>✓ Payment successful</Text>
        <Muted>Order {p.order_id}</Muted>
        <Muted>Paid {new Date(p.paid_at).toLocaleString()}</Muted>
        {p.items.map((i: any) => <Text key={i.variant_id} style={s.body}>{i.variant_id} × {i.quantity} · {pkr(i.unit_price_minor * i.quantity)}</Text>)}
        <Text style={s.body}>Subtotal {pkr(p.subtotal_minor)}</Text>
        <Text style={s.body}>Discount −{pkr(p.discount_minor)}</Text>
        <Text style={[s.price, { color: primary }]}>Total {pkr(p.total_minor)}</Text>
        <Text style={s.label}>Order progress</Text>
        <View style={s.row} accessibilityLabel="Order progress: paid. Next: packed, shipped, delivered.">
          {['Paid', 'Packed', 'Shipped', 'Delivered'].map((step, i) => (
            <View key={step} style={[s.step, i === 0 && { backgroundColor: C.ok, borderColor: C.ok }]}>
              <Text style={[s.stepText, i === 0 && { color: '#fff' }]}>{i === 0 ? '✓ ' : `${i + 1}. `}{step}</Text>
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
  return (
    <FlatList contentContainerStyle={s.list} data={orders} keyExtractor={(o: any) => o.order_id}
      ListHeaderComponent={<H>My orders</H>} ListEmptyComponent={<Empty text="No orders yet. Your receipts will appear here after you buy something." />}
      renderItem={({ item: o }: any) => (
        <Card onPress={() => push({ name: 'receipt', order: o })} label={`Order ${o.order_id}, ${pkr(o.total_minor)}, open receipt`}>
          <View style={s.rowBetween}><Text style={s.body}>{new Date(o.receipt.payload.paid_at).toLocaleString()}</Text><Badge text="✓ Paid" color={C.ok} /></View>
          <Muted>{o.items.length} item(s) · {o.order_id}</Muted>
          <Text style={[s.price, { color: primary }]}>{pkr(o.total_minor)}</Text>
        </Card>
      )} />
  );
}

// ---------- Club ----------
function ClubTab(props: any) {
  const { boot, user, push } = props;
  const own = boot?.clubs?.find((c: any) => c.club_id === user.club_id);
  if (own) return <ClubProfile {...props} id={own.club_id} />;
  return (
    <FlatList contentContainerStyle={s.list} data={boot?.clubs ?? []} keyExtractor={(c: any) => c.club_id}
      ListHeaderComponent={<H>Clubs</H>} ListEmptyComponent={<Empty text="No clubs yet." />}
      renderItem={({ item: c }: any) => (
        <Card onPress={() => push({ name: 'club', id: c.club_id })} label={`Open ${c.name}`}>
          <Text style={s.team}>{c.name}</Text><Muted>📍 {c.venue?.name}</Muted>
        </Card>
      )} />
  );
}

function ClubProfile({ id, boot, user, primary, push, queue }: any) {
  const c = boot?.clubs?.find((x: any) => x.club_id === id);
  if (!c) return <Empty text="Club not found." />;
  const manages = user.role === 'super_admin' || (user.role === 'club_manager' && user.club_id === id);
  const pendingFor = (pid: string) => queue.some((q: any) => q.action.payload?.player_id === pid);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <Text style={s.title}>{c.name}</Text>
        <Muted>📍 {c.venue?.name} ({c.venue?.lat}, {c.venue?.lng})</Muted>
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
                  <Pressable style={{ flex: 1, minHeight: 48, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={`Open ${p.name}`} onPress={() => push({ name: 'player', id: p.player_id })}>
                    <Text style={s.body}>{p.name}{p.role === 'captain' ? ' (C)' : p.role === 'vice_captain' ? ' (VC)' : ''} ›</Text>
                    <Muted>{p.role.replace('_', ' ')}{p.on_loan ? ' · on loan' : ''}{pendingFor(p.player_id) ? ' · change pending sync' : ''}</Muted>
                  </Pressable>
                  {manages && <Btn small color={primary} label="Move" onPress={() => push({ name: 'move', playerId: p.player_id })} />}
                </View>
              ))}
            </View>
          );
        })}
      </Card>
      <Card>
        <H>Upcoming matches</H>
        {(boot?.fixtures ?? []).filter((f: any) => f && f.status !== 'completed' && (f.home === id || f.away === id)).map((f: any) => (
          <Pressable key={f.match_id} style={{ minHeight: 44, justifyContent: 'center' }} accessibilityRole="button" onPress={() => push({ name: 'match', id: f.match_id })}>
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
          <View key={h.audit_id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}>
            <Text style={s.body}>{LABEL[h.action] ?? h.action}{h.to_squad_id ? ` to ${teamName(h.to_squad_id)}` : ''} · {h.effective_date}</Text>
            <Muted>From {teamName(h.from_squad_id)} · by {h.who} · {h.why}</Muted>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function MovePlayer({ playerId, boot, user, primary, enqueue, pop, teamName }: any) {
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
  return (
    <ScrollView contentContainerStyle={s.list}>
      <H>Pending changes ({queue.length})</H>
      {queue.length === 0 && <Empty text="Nothing waiting to sync." />}
      {queue.map((q: any) => (
        <Card key={q.action.action_id}>
          <View style={s.rowBetween}><Text style={[s.body, { flex: 1 }]}>{q.label}</Text><Badge text="Pending" color={C.warn} /></View>
          <Muted>Queued {new Date(q.action.queued_at).toLocaleTimeString()}</Muted>
        </Card>
      ))}
      {queue.length > 0 && (net === 'offline' ? <Muted>You are offline. Changes will sync automatically when the connection returns.</Muted>
        : <Btn label="Sync now" color={primary} onPress={() => runSync(queue)} />)}
      <H>Last sync results</H>
      {lastSync.length === 0 && <Empty text="No sync has run yet." />}
      {lastSync.map((l: any, i: number) => (
        <Card key={i}>
          <View style={s.rowBetween}>
            <Text style={[s.body, { flex: 1 }]}>{l.label}</Text>
            <Badge text={l.status === 'applied' ? '✓ Applied' : l.status === 'duplicate' ? '= Duplicate' : '✗ Rejected'} color={l.status === 'rejected' ? C.bad : C.ok} />
          </View>
          <Text style={s.body}>{l.message}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

// ---------- Settings ----------
function Settings({ server, onServer, onLogout, primary, deviceId, user }: any) {
  const [addr, setAddr] = useState(server);
  const [test, setTest] = useState<string | null>(null);
  return (
    <ScrollView contentContainerStyle={s.list}>
      <Card>
        <H>Server address</H>
        <TextInput style={s.input} value={addr} onChangeText={setAddr} autoCapitalize="none" accessibilityLabel="Server address" />
        <Muted>Emulator: http://10.0.2.2:8080 · Phone: http://LAPTOP-LAN-IP:8080</Muted>
        <View style={s.row}>
          <Btn label="Save" color={primary} onPress={() => onServer(addr.trim())} />
          <Btn kind="outline" label="Test connection" color={primary} onPress={async () => {
            try { await request(addr.trim(), '/health', { timeoutMs: 3000 }); setTest('✓ Connected to the server.'); } catch { setTest('✗ Cannot reach that address.'); }
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
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, minHeight: 60 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSub: { color: '#e5e7eb', fontSize: 13 },
  headerBtn: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 6 },
  headerBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  logo: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  logoText: { fontWeight: '800', fontSize: 16 },
  netbar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 3, minHeight: 44 },
  netText: { fontSize: 14, fontWeight: '600', color: C.text },
  list: { padding: 12, paddingBottom: 32 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb' },
  h: { fontSize: 20, fontWeight: '700', color: C.text, marginVertical: 8 },
  title: { fontSize: 24, fontWeight: '800', color: C.text, marginBottom: 4 },
  muted: { color: C.muted, fontSize: 14, marginTop: 2 },
  body: { color: C.text, fontSize: 16, marginVertical: 2 },
  label: { color: C.text, fontSize: 15, fontWeight: '600', marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 48, fontSize: 16, backgroundColor: '#fff', color: C.text },
  error: { color: C.bad, fontSize: 15, marginVertical: 8 },
  btn: { minHeight: 48, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', marginVertical: 6, marginRight: 8 },
  btnSmall: { minHeight: 44, paddingHorizontal: 12 },
  btnText: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  team: { fontSize: 17, fontWeight: '600', color: C.text, flex: 1 },
  score: { fontSize: 22, fontWeight: '800', color: C.text, marginHorizontal: 10 },
  bigTeam: { fontSize: 18, fontWeight: '700', color: C.text, flex: 1 },
  bigScore: { fontSize: 40, fontWeight: '900', marginHorizontal: 10 },
  price: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  qty: { fontSize: 20, fontWeight: '700', marginHorizontal: 12, color: C.text },
  badge: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginLeft: 8 },
  badgeText: { fontSize: 13, fontWeight: '700' },
  empty: { padding: 32, alignItems: 'center' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', minHeight: 48 },
  timelineText: { fontSize: 15, color: C.text, flex: 1 },
  struck: { textDecorationLine: 'line-through', color: C.muted },
  tr: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#eee', minHeight: 52 },
  th: { backgroundColor: '#e5e7eb' },
  td: { flex: 1, textAlign: 'center', fontSize: 15, color: C.text },
  tdTeam: { fontSize: 15, fontWeight: '600', color: C.text },
  dayHeader: { fontSize: 15, fontWeight: '800', color: C.muted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  formChip: { width: 22, height: 22, borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginRight: 3, marginTop: 3 },
  formText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  step: { borderWidth: 1.5, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginRight: 6, marginTop: 6 },
  stepText: { fontSize: 13, fontWeight: '700', color: C.muted },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#fff' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56, paddingVertical: 4 },
  tabIcon: { fontSize: 18 },
  tabText: { fontSize: 12, color: C.muted },
  toast: { position: 'absolute', left: 16, right: 16, bottom: 72, backgroundColor: '#111827', padding: 14, borderRadius: 10 },
  toastText: { color: '#fff', fontSize: 15 },
});
