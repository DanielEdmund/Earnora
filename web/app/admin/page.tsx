'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { CategoryRow, GroupedBars, HBars, Legend } from '@/components/admin/Charts';
import type { ChartSeries } from '@/components/admin/Charts';
import { API_BASE, api, naira, shortDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/* ── tabs ──────────────────────────────────────────────────────────────── */
type Tab = 'overview' | 'live' | 'users' | 'tasks' | 'payments' | 'review' | 'payouts' | 'risk' | 'support' | 'publish';

/* ── read models from /admin/* ─────────────────────────────────────────── */
interface Kpis {
  users_total: number;
  users_today: number;
  users_7d: number;
  users_active: number;
  plans_active: number;
  dau: number;
  via_referral: number;
  claims_today: number;
  review_pending: number;
  approvals_total: number;
  approvals_today: number;
  rewards_today_kobo: number;
  rewards_total_kobo: number;
  wd_pending: number;
  wd_pending_kobo: number;
  wd_paid_today: number;
  paid_out_kobo: number;
  held_kobo: number;
  earned_kobo: number;
  flags_open: number;
  flags_today: number;
  support_open: number;
  low_trust: number;
  suspended: number;
  tasks_open: number;
  tasks_total: number;
}

interface SeriesPoint {
  day: string;
  signups: number;
  submissions: number;
  approvals: number;
  reward_kobo: number;
  payouts: number;
  payout_kobo: number;
  [k: string]: string | number; // ChartPoint-shaped for the shared charts
}

interface TopTask {
  id: string;
  title: string;
  link: string | null;
  category: string;
  /** Which plan's feed the task belongs to; null/undefined = every plan. */
  plan_key?: string | null;
  status: string;
  quota: number;
  claimed_count: number;
  approved_count: number;
  requires_admin: boolean;
  created_at: string;
  spent_kobo: number;
  budget_kobo: number;
  reward_kobo: number;
}

interface Overview {
  days: number;
  kpis: Kpis;
  series: SeriesPoint[];
  categories: CategoryRow[];
  topTasks: TopTask[];
}

interface FeedItem {
  kind: 'signup' | 'submit' | 'reward' | 'referral' | 'withdrawal' | 'payout' | 'flag';
  at: string;
  user_id: string | null;
  email: string | null;
  label: string | null;
  amount_kobo: number;
}

interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  status: string;
  plan: string | null;
  trust_score: number;
  created_at: string;
  last_login_at: string | null;
  referred: boolean;
  available_kobo: number;
  lifetime_kobo: number;
  tasks_done: number;
  in_review: number;
  referrals: number;
  flags: number;
}

interface TaskRow extends TopTask {
  claims: number;
  pending_review: number;
  in_progress: number;
}

interface SupportRow {
  id: number;
  email: string;
  message: string;
  status: 'open' | 'replied';
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

/* ── existing queue models ─────────────────────────────────────────────── */
interface Submission {
  id: number;
  task_id: string;
  user_id: string;
  status: string;
  submitted_at: string | null;
  proof_payload: Record<string, unknown> | string | null;
  proof_hash: string | null;
  rejection_reason: string | null;
  reward_kobo: number;
  title: string;
  category: string;
  email: string;
  trust_score: number;
}

/* screenshot proof (proof_payload = { screenshot: '/uploads/proofs/<sha256>.png', fileName }) */
const PROOF_URL_RE = /^\/uploads\/proofs\/[a-f0-9]{64}\.(png|jpe?g|webp|gif)$/;
function proofShot(payload: Submission['proof_payload']): string | null {
  if (!payload) return null;
  let p: Record<string, unknown> | null = null;
  if (typeof payload === 'string') {
    try {
      p = JSON.parse(payload);
    } catch {
      return null;
    }
  } else p = payload;
  const s = p?.screenshot;
  return typeof s === 'string' && PROOF_URL_RE.test(s) ? s : null;
}

interface WdRow {
  id: string;
  user_id: string;
  amount_kobo: number;
  status: string;
  requested_at: string;
  window_date: string;
  attempts: number;
  last_error: string | null;
  email: string;
}

interface Flag {
  id: number;
  user_id: string | null;
  reason: string;
  severity: string;
  details: Record<string, unknown> | string;
  created_at: string;
  email: string | null;
  trust_score: number | null;
  status: string | null;
  flag_status?: string | null;
  resolved_at?: string | null;
}

interface PayRow {
  psp_reference: string;
  plan_key: string | null;
  amount_kobo: number;
  psp: string;
  status: string;      // pending | success | failed | refunded (PSP side)
  approval: string;    // pending | approved | rejected (owner decision)
  reject_reason: string | null;
  created_at: string;
  confirmed_at: string | null;
  approved_at: string | null;
  email: string;
}

/* ── presentation helpers ──────────────────────────────────────────────── */
const ACT_SERIES: ChartSeries[] = [
  { key: 'signups', label: 'Signups', color: '#2f6fef' },
  { key: 'submissions', label: 'Submissions', color: '#38bdf8' },
  { key: 'approvals', label: 'Approved & paid', color: '#16a34a' },
];

const FEED_META: Record<FeedItem['kind'], { icon: string; tone: string }> = {
  signup: { icon: 'fa-user-plus', tone: '' },
  submit: { icon: 'fa-file-arrow-up', tone: 'amber' },
  reward: { icon: 'fa-coins', tone: 'green' },
  referral: { icon: 'fa-link', tone: 'sky' },
  withdrawal: { icon: 'fa-money-bill-transfer', tone: 'amber' },
  payout: { icon: 'fa-circle-check', tone: 'green' },
  flag: { icon: 'fa-flag', tone: 'red' },
};

const FEED_FILTERS: Array<{ key: string; label: string; kinds: FeedItem['kind'][] }> = [
  { key: 'all', label: 'Everything', kinds: [] },
  { key: 'signups', label: 'Signups', kinds: ['signup'] },
  { key: 'tasks', label: 'Tasks', kinds: ['submit', 'reward'] },
  { key: 'money', label: 'Money', kinds: ['referral', 'withdrawal', 'payout'] },
  { key: 'risk', label: 'Risk', kinds: ['flag'] },
];

const TASK_CATEGORIES = ['ad_click', 'social_follow', 'youtube_watch', 'instagram_follow', 'telegram_join', 'survey', 'text_validation', 'app_test'];

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function trustTone(v: number): string {
  return v >= 60 ? 'green' : v >= 30 ? 'amber' : 'red';
}

function statusTone(v: string): string {
  return v === 'active' ? 'green' : v === 'suspended' ? 'amber' : v === 'banned' ? 'red' : 'blue';
}

function feedText(item: FeedItem): React.ReactNode {
  const who = item.email ?? 'Unknown user';
  const amt = item.amount_kobo > 0 ? ` ${naira(item.amount_kobo)}` : '';
  switch (item.kind) {
    case 'signup':
      return (<><b>{who}</b> created an account</>);
    case 'submit':
      return (<><b>{who}</b> submitted “{item.label ?? 'a task'}”</>);
    case 'reward':
      return (<><b>{who}</b> earned{amt} — {item.label ?? 'task reward'}</>);
    case 'referral':
      return (<><b>{who}</b> earned{amt} referral commission</>);
    case 'withdrawal':
      return (<><b>{who}</b> requested a withdrawal ({item.label ?? 'queued'}) {naira(item.amount_kobo)}</>);
    case 'payout':
      return (<><b>{who}</b> was paid out {naira(item.amount_kobo)}</>);
    case 'flag':
      return (<><b>{who}</b> tripped fraud risk: {item.label ?? 'flag'}</>);
    default:
      return <>{who}</>;
  }
}

/* ── page ──────────────────────────────────────────────────────────────── */
export default function AdminPage() {
  const { me, loading, logout, refresh } = useAuth();

  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(14);
  const [updatedAt, setUpdatedAt] = useState<number>(0);

  // read models
  const [ov, setOv] = useState<Overview | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedFilter, setFeedFilter] = useState('all');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  // queues (existing behaviour)
  const [queueStatus, setQueueStatus] = useState('queued_review');
  const [subs, setSubs] = useState<Submission[]>([]);
  const [wds, setWds] = useState<WdRow[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [sup, setSup] = useState<SupportRow[]>([]);
  const [supFilter, setSupFilter] = useState<'open' | 'all'>('open');
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  // users toolbar
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // new task form
  const [nt, setNt] = useState({
    title: '',
    description: '',
    link: '',
    category: 'ad_click',
    planKey: '', // '' = every plan; 'beginner' | 'intermediate' | 'extreme'
    rewardNaira: '300',
    budgetNaira: '300000',
    quota: '100',
    requiresAdmin: false,
    rules: '{"proof":"screenshot"}',
  });
  const [ntBusy, setNtBusy] = useState(false);

  const isAdmin = me?.user.role === 'admin';

  /* ── loaders ─────────────────────────────────────────────────────────── */
  const loadCore = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [o, s, w, f, p] = await Promise.all([
        api<Overview>(`/admin/overview?days=${days}`),
        api<Submission[]>(`/admin/submissions?status=${queueStatus}`),
        api<WdRow[]>('/withdrawals/admin/queue'),
        api<Flag[]>('/admin/fraud-flags'),
        api<PayRow[]>('/admin/payments'),
      ]);
      setOv(o);
      setSubs(s);
      setWds(w);
      setFlags(f);
      setPays(p);
      setUpdatedAt(Date.now());
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, [isAdmin, days, queueStatus]);

  const loadFeed = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setFeed(await api<FeedItem[]>('/admin/activity?limit=80'));
    } catch {
      /* transient — the next tick retries */
    }
  }, [isAdmin]);

  const loadTasks = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setTasks(await api<TaskRow[]>('/admin/tasks'));
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, [isAdmin]);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await api<{ rows: UserRow[]; total: number }>(
        `/admin/users?search=${encodeURIComponent(q)}&status=${encodeURIComponent(statusFilter)}&limit=25&offset=${offset}`,
      );
      setUsers(r.rows);
      setUsersTotal(r.total);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, [isAdmin, q, statusFilter, offset]);

  const loadSupport = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setSup(await api<SupportRow[]>('/admin/support?status=all'));
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, [isAdmin]);

  const sendReply = useCallback(async (id: number) => {
    const text = replyDraft.trim();
    if (!text || replyBusy) return;
    setReplyBusy(true);
    try {
      await api(`/admin/support/${id}/reply`, { method: 'POST', body: { reply: text } });
      setMsg({ kind: 'success', text: 'Reply sent — it appears in the user’s chat now.' });
      setReplyingTo(null);
      setReplyDraft('');
      await loadSupport();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setReplyBusy(false);
    }
  }, [replyDraft, replyBusy, loadSupport]);

  // first paint (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    void loadCore();
    void loadFeed();
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // range / queue filter changes re-pull the core snapshot
  useEffect(() => {
    if (isAdmin) void loadCore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCore]);

  // live polling: core every tick, feed too when it is on screen
  useEffect(() => {
    if (!isAdmin) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      void loadCore();
      if (tab === 'overview' || tab === 'live') void loadFeed();
      if (tab === 'support') void loadSupport();
    }, 10000);
    return () => clearInterval(t);
  }, [isAdmin, tab, loadCore, loadFeed, loadSupport]);

  // users toolbar → fetch (debounced search lives below)
  useEffect(() => {
    if (isAdmin && tab === 'users') void loadUsers();
  }, [isAdmin, tab, loadUsers]);

  // support inbox → fetch when the tab opens
  useEffect(() => {
    if (isAdmin && tab === 'support') void loadSupport();
  }, [isAdmin, tab, loadSupport]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  /* ── actions ─────────────────────────────────────────────────────────── */
  async function decide(id: number, action: 'approve' | 'reject', reason?: string) {
    setMsg(null);
    try {
      await api(`/admin/submissions/${id}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? { reason: reason || 'Rejected by reviewer' } : {},
      });
      setMsg({ kind: 'success', text: `Submission #${id} ${action === 'approve' ? 'approved & paid' : 'rejected'}` });
      setRejecting(null);
      setRejectReason('');
      await Promise.all([loadCore(), loadFeed(), refresh()]);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }

  async function setUserStatus(id: string, status: string) {
    setMsg(null);
    try {
      await api(`/admin/users/${id}/status`, { method: 'POST', body: { status } });
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
      setMsg({ kind: 'success', text: `User set to ${status.replace('_', ' ')}` });
      await loadCore();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }

  async function resolveFlag(id: number) {
    setMsg(null);
    try {
      await api(`/admin/fraud-flags/${id}/resolve`, { method: 'POST', body: {} });
      setMsg({ kind: 'success', text: `Flag #${id} resolved` });
      await loadCore();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }

  /** Owner decision: release a confirmed payment (unlocks the plan) or refuse it. */
  async function decidePayment(reference: string, action: 'approve' | 'reject') {
    setMsg(null);
    try {
      await api(`/admin/payments/${reference}/${action}`, { method: 'POST', body: {} });
      setMsg({
        kind: 'success',
        text: action === 'approve' ? `Payment ${reference} approved — plan unlocked` : `Payment ${reference} rejected`,
      });
      await Promise.all([loadCore(), refresh()]);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }

  async function deleteTask(id: string, title: string) {
    if (!window.confirm(`Delete “${title}” permanently?\n\nThe task disappears from the list and nobody can claim it. Its claim history is removed too (rewards already paid out stay in the ledgers).`)) return;
    setMsg(null);
    try {
      await api(`/admin/tasks/${id}`, { method: 'DELETE' });
      setMsg({ kind: 'success', text: `Task “${title}” deleted` });
      await Promise.all([loadTasks(), loadCore()]);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setNtBusy(true);
    setMsg(null);
    try {
      let rules: unknown;
      try {
        rules = JSON.parse(nt.rules);
      } catch {
        throw new Error('validation rules must be valid JSON');
      }
      await api('/admin/tasks', {
        method: 'POST',
        body: {
          title: nt.title,
          description: nt.description,
          link: nt.link,
          category: nt.category || 'ad_click',
          planKey: nt.planKey || undefined, // omit -> visible to every plan
          rewardKobo: Math.round(parseFloat(nt.rewardNaira) * 100),
          budgetKobo: Math.round(parseFloat(nt.budgetNaira) * 100),
          quota: Number(nt.quota),
          requiresAdmin: nt.requiresAdmin,
          validationRules: rules,
        },
      });
      setMsg({ kind: 'success', text: `Task “${nt.title}” published${nt.planKey ? ` to the ${nt.planKey} plan feed` : ''}` });
      setNt({ ...nt, title: '', description: '', link: '', planKey: '' });
      await Promise.all([loadTasks(), loadCore()]);
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setNtBusy(false);
    }
  }

  function refreshAll() {
    void loadCore();
    void loadFeed();
    void loadTasks();
    if (tab === 'users') void loadUsers();
  }

  /* ── guards ──────────────────────────────────────────────────────────── */
  if (loading || !me) {
    return (
      <div className="auth-wrap">
        <div className="auth-card center">
          <span className="spinner" style={{ color: 'var(--accent)' }} />
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Shell active="admin" wide balanceKobo={me.wallet?.available_kobo} email={me.user.email} role={me.user.role} onLogout={logout}>
        <div className="alert error">Admin access required. Log in with an admin account.</div>
      </Shell>
    );
  }

  const k = ov?.kpis;
  const queuedWds = wds.filter((w) => w.status === 'queued' || w.status === 'disbursing');
  const openFlags = flags.filter((f) => (f.flag_status ?? 'open') === 'open');
  const shownFeed = feed.filter((it) => {
    const f = FEED_FILTERS.find((x) => x.key === feedFilter);
    return !f || f.kinds.length === 0 || f.kinds.includes(it.kind);
  });
  const visibleUsers = usersTotal === 0 ? 0 : offset + users.length;
  const todayPayoutKobo = ov ? Number(ov.series[ov.series.length - 1]?.payout_kobo ?? 0) : 0;

  const kpis: Array<{ label: string; value: string; sub: string; icon: string; tone?: string; go?: Tab }> = [
    { label: 'Total users', value: String(k?.users_total ?? '—'), sub: `+${k?.users_today ?? 0} today · ${k?.users_7d ?? 0} this week`, icon: 'fa-users', go: 'users' },
    { label: 'Active plans', value: String(k?.plans_active ?? '—'), sub: `${k?.dau ?? 0} signed in today`, icon: 'fa-bolt', tone: 'good' },
    { label: 'Tasks done today', value: String(k?.approvals_today ?? '—'), sub: `${k?.claims_today ?? 0} claimed · ${k?.approvals_total ?? 0} all time`, icon: 'fa-circle-check', tone: 'good' },
    { label: 'Awaiting review', value: String(k?.review_pending ?? '—'), sub: k?.review_pending ? 'proofs waiting on you' : 'queue is clear', icon: 'fa-hourglass-half', tone: k?.review_pending ? 'warn' : undefined, go: 'review' },
    { label: 'Payout queue', value: naira(k?.wd_pending_kobo ?? 0), sub: `${k?.wd_pending ?? 0} withdrawals pending`, icon: 'fa-money-bill-transfer', tone: k?.wd_pending ? 'warn' : undefined, go: 'payouts' },
    { label: 'Paid out', value: naira(k?.paid_out_kobo ?? 0), sub: `${k?.wd_paid_today ?? 0} settled today`, icon: 'fa-building-columns', go: 'payouts' },
    { label: 'Held in wallets', value: naira(k?.held_kobo ?? 0), sub: `${naira(k?.earned_kobo ?? 0)} earned lifetime`, icon: 'fa-wallet' },
    { label: 'Open risks', value: String(k?.flags_open ?? '—'), sub: `${k?.low_trust ?? 0} low trust · ${k?.suspended ?? 0} suspended`, icon: 'fa-shield-halved', tone: k?.flags_open ? 'danger' : undefined, go: 'risk' },
    { label: 'Open support', value: String(k?.support_open ?? '—'), sub: k?.support_open ? 'chat questions waiting' : 'inbox is clear', icon: 'fa-comments', tone: k?.support_open ? 'warn' : undefined, go: 'support' },
  ];

  const moneyRows = [
    { label: 'Rewards paid today', v: naira(k?.rewards_today_kobo ?? 0), sub: `${k?.approvals_today ?? 0} approvals` },
    { label: 'Payouts settled today', v: naira(todayPayoutKobo), sub: `${k?.wd_paid_today ?? 0} withdrawals` },
    { label: 'Awaiting payout', v: naira(k?.wd_pending_kobo ?? 0), sub: `${k?.wd_pending ?? 0} requests in queue` },
    { label: 'Held in wallets', v: naira(k?.held_kobo ?? 0), sub: 'spendable right now' },
    { label: 'Paid out all time', v: naira(k?.paid_out_kobo ?? 0), sub: 'settled withdrawals' },
  ];

  const rangeTotals = ov
    ? {
        signups: ov.series.reduce((a, d) => a + d.signups, 0),
        submissions: ov.series.reduce((a, d) => a + d.submissions, 0),
        approvals: ov.series.reduce((a, d) => a + d.approvals, 0),
        rewards: ov.series.reduce((a, d) => a + Number(d.reward_kobo), 0),
      }
    : { signups: 0, submissions: 0, approvals: 0, rewards: 0 };

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'live', label: 'Live' },
    { key: 'users', label: 'Users', count: k?.users_total },
    { key: 'tasks', label: 'Tasks', count: k?.tasks_total },
    { key: 'payments', label: 'Payments', count: pays.filter((p) => p.approval === 'pending' && p.status === 'success').length },
    { key: 'review', label: 'Review', count: subs.filter((s) => ['queued_review', 'submitted'].includes(s.status)).length },
    { key: 'payouts', label: 'Payouts', count: queuedWds.length },
    { key: 'risk', label: 'Risk', count: openFlags.length },
    { key: 'support', label: 'Support', count: sup.filter((s) => s.status === 'open').length },
    { key: 'publish', label: 'Publish' },
  ];

  const shownSup = supFilter === 'open' ? sup.filter((s) => s.status === 'open') : sup;

  return (
    <Shell active="admin" wide balanceKobo={me.wallet?.available_kobo} email={me.user.email} role={me.user.role} onLogout={logout}>
      <div className="adm-strip">
        <div>
          <div className="page-title">Operations</div>
          <div className="page-sub">Everything your users are doing, in one place.</div>
        </div>
        <div className="adm-strip-r">
          <span className="adm-live">
            <i /> LIVE
          </span>
          <span className="adm-updated">
            {updatedAt ? `updated ${new Date(updatedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'loading…'}
          </span>
          <button className="btn secondary sm" onClick={refreshAll} title="Refresh now">
            <i className="fa-solid fa-rotate" /> Refresh
          </button>
        </div>
      </div>

      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      <div className="tabs adm-tabs mb">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count !== undefined ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div className="adm-kpis">
            {kpis.map((c) => (
              <div
                key={c.label}
                className={`adm-kpi ${c.tone ?? ''}`}
                onClick={() => c.go && setTab(c.go)}
                role={c.go ? 'button' : undefined}
                tabIndex={c.go ? 0 : undefined}
                onKeyDown={(e) => c.go && (e.key === 'Enter' || e.key === ' ') && setTab(c.go)}
              >
                <div className="lbl">
                  <i className={`fa-solid ${c.icon}`} /> {c.label}
                </div>
                <div className="v">{c.value}</div>
                <div className="sub">{c.sub}</div>
              </div>
            ))}
          </div>

          <div className="adm-split mb">
            <div className="card">
              <div className="adm-cardhead">
                <h2>Activity</h2>
                <div className="adm-range">
                  {[7, 14, 30].map((d) => (
                    <button key={d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <Legend series={ACT_SERIES} />
              {ov ? <GroupedBars data={ov.series} series={ACT_SERIES} /> : <p className="adm-empty">Loading…</p>}
              <p className="adm-foot">
                Last {days} days: <b>{rangeTotals.signups}</b> signups · <b>{rangeTotals.submissions}</b> submissions ·{' '}
                <b>{rangeTotals.approvals}</b> approved · <b>{naira(rangeTotals.rewards)}</b> paid to users
              </p>
            </div>

            <div className="card">
              <h2>Money flow</h2>
              <div className="adm-money">
                {moneyRows.map((r) => (
                  <div className="r" key={r.label}>
                    <span>
                      {r.label}
                      <i className="t">{r.sub}</i>
                    </span>
                    <b>{r.v}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="adm-split adm-half mb">
            <div className="card">
              <h2>Task types</h2>
              <HBars rows={ov?.categories ?? []} />
            </div>

            <div className="card">
              <h2>Top tasks</h2>
              {!ov?.topTasks.length && <p className="adm-empty">No tasks yet.</p>}
              <div className="adm-rank">
                {(ov?.topTasks ?? []).map((t) => {
                  const pct = Math.min(100, Math.round((t.claimed_count / Math.max(1, t.quota)) * 100));
                  return (
                    <div className="r" key={t.id}>
                      <div className="t">
                        <b title={t.title}>{t.title}</b>
                        <span>
                          {t.claimed_count}/{t.quota} claimed · {naira(t.reward_kobo)}
                        </span>
                      </div>
                      <div className={`adm-prog`}>
                        <i className={pct >= 100 ? 'ok' : pct >= 75 ? 'warn' : ''} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="adm-split">
            <div className="card">
              <div className="adm-cardhead">
                <h2>Live activity</h2>
                <button className="btn secondary sm" onClick={() => setTab('live')}>
                  Open feed
                </button>
              </div>
              <FeedList items={feed.slice(0, 8)} />
            </div>

            <div className="card">
              <h2>Needs you</h2>
              <div className="adm-queue">
                <div className="q">
                  <span className="n">{subs.filter((s) => ['queued_review', 'submitted'].includes(s.status)).length}</span>
                  <span className="d">
                    <b>Proofs to review</b>approve or reject submissions
                  </span>
                  <button className="btn sm" onClick={() => setTab('review')}>
                    Open
                  </button>
                </div>
                <div className="q">
                  <span className="n">{queuedWds.length}</span>
                  <span className="d">
                    <b>Payouts queued</b>{naira(queuedWds.reduce((a, w) => a + w.amount_kobo, 0))} waiting
                  </span>
                  <button className="btn sm" onClick={() => setTab('payouts')}>
                    Open
                  </button>
                </div>
                <div className="q">
                  <span className="n">{openFlags.length}</span>
                  <span className="d">
                    <b>Open risk flags</b>{k?.low_trust ?? 0} low-trust accounts
                  </span>
                  <button className="btn sm" onClick={() => setTab('risk')}>
                    Open
                  </button>
                </div>
                <div className="q">
                  <span className="n">{k?.tasks_open ?? 0}</span>
                  <span className="d">
                    <b>Tasks live now</b>of {k?.tasks_total ?? 0} published
                  </span>
                  <button className="btn sm" onClick={() => setTab('tasks')}>
                    Open
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── LIVE FEED ─────────────────────────────────────────────────── */}
      {tab === 'live' && (
        <div className="card">
          <div className="adm-cardhead">
            <h2>Live activity</h2>
            <span className="adm-updated">refreshes every 10s</span>
          </div>
          <div className="adm-chips">
            {FEED_FILTERS.map((f) => (
              <button key={f.key} className={`adm-chip ${feedFilter === f.key ? 'on' : ''}`} onClick={() => setFeedFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <FeedList items={shownFeed.slice(0, 60)} />
        </div>
      )}

      {/* ── USERS ─────────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <div className="card">
          <div className="adm-toolbar">
            <div className="grow">
              <div className="input-icon-group">
                <input
                  placeholder="Search email or phone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search users"
                />
                <i className="fa-solid fa-magnifying-glass" />
              </div>
            </div>
            <label className="field" style={{ marginBottom: 0 }}>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }} aria-label="Status filter">
                <option value="">all statuses</option>
                <option value="active">active</option>
                <option value="pending_activation">pending activation</option>
                <option value="suspended">suspended</option>
                <option value="banned">banned</option>
              </select>
            </label>
            <span className="adm-count">{usersTotal} user{usersTotal === 1 ? '' : 's'}</span>
          </div>

          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th className="num">Trust</th>
                  <th className="num">Balance</th>
                  <th className="num">Earned</th>
                  <th className="num">Tasks</th>
                  <th className="num">Refs</th>
                  <th className="num">Risks</th>
                  <th>Joined</th>
                  <th>Act</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted">
                      No users match this filter.
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="mono small">{u.email}</div>
                      {u.phone && <div className="muted small">{u.phone}</div>}
                    </td>
                    <td>
                      <span className={`badge ${statusTone(u.status)}`}>{u.status.replace('_', ' ')}</span>
                    </td>
                    <td>{u.plan ? <span className="badge blue">{u.plan}</span> : <span className="muted small">free</span>}</td>
                    <td className="num">
                      <span className={`badge ${trustTone(u.trust_score)}`}>{u.trust_score}</span>
                    </td>
                    <td className="num">{naira(u.available_kobo)}</td>
                    <td className="num">{naira(u.lifetime_kobo)}</td>
                    <td className="num">
                      {u.tasks_done}
                      {u.in_review > 0 && <span className="muted"> ({u.in_review})</span>}
                    </td>
                    <td className="num">{u.referrals}</td>
                    <td className="num">{u.flags > 0 ? <span className="badge red">{u.flags}</span> : '—'}</td>
                    <td className="muted small">
                      {shortDate(u.created_at)}
                      <div className="muted">seen {timeAgo(u.last_login_at)}</div>
                    </td>
                    <td>
                      <select
                        className="adm-status"
                        value={u.status}
                        onChange={(e) => setUserStatus(u.id, e.target.value)}
                        aria-label={`Status for ${u.email}`}
                      >
                        <option value="pending_activation">pending</option>
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                        <option value="banned">banned</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="adm-pager">
            <button className="btn secondary sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>
              <i className="fa-solid fa-chevron-left" /> Prev
            </button>
            <span>
              {usersTotal === 0 ? 0 : offset + 1}–{visibleUsers} of {usersTotal}
            </span>
            <button className="btn secondary sm" disabled={offset + 25 >= usersTotal} onClick={() => setOffset(offset + 25)}>
              Next <i className="fa-solid fa-chevron-right" />
            </button>
          </div>
        </div>
      )}

      {/* ── TASKS ─────────────────────────────────────────────────────── */}
      {tab === 'tasks' && (
        <div className="card">
          <div className="adm-cardhead">
            <h2>Task performance</h2>
            <button className="btn sm" onClick={() => setTab('publish')}>
              <i className="fa-solid fa-plus" /> New task
            </button>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th style={{ minWidth: 150 }}>Claims vs quota</th>
                  <th className="num">In review</th>
                  <th className="num">Spend</th>
                  <th className="num">Reward</th>
                  <th>Created</th>
                  <th>Act</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      No tasks published yet.
                    </td>
                  </tr>
                )}
                {tasks.map((t) => {
                  const pct = Math.min(100, Math.round((t.claimed_count / Math.max(1, t.quota)) * 100));
                  return (
                    <tr key={t.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{t.title}</div>
                        <div className="adm-tags">
                          <span className="badge blue">{t.category.replace(/_/g, ' ')}</span>
                          <span className={`badge ${t.plan_key ? 'amber' : 'green'}`}>
                            {t.plan_key ? `${t.plan_key} plan only` : 'all plans'}
                          </span>
                          {t.requires_admin && <span className="badge amber">manual</span>}
                        </div>
                        {t.link && (
                          <a className="adm-link" href={t.link} target="_blank" rel="noopener noreferrer">
                            <i className="fa-solid fa-arrow-up-right-from-square" /> {t.link}
                          </a>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${t.status === 'open' ? 'green' : t.status === 'closed' ? 'red' : 'blue'}`}>{t.status}</span>
                      </td>
                      <td>
                        <div className="mono small">
                          {t.claimed_count}/{t.quota} · {t.approved_count} approved
                        </div>
                        <div className="adm-prog">
                          <i className={pct >= 100 ? 'ok' : pct >= 75 ? 'warn' : ''} style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="num">{t.pending_review > 0 ? <span className="badge amber">{t.pending_review}</span> : '—'}</td>
                      <td className="num">
                        <span className="small">{naira(t.spent_kobo)}</span>
                        <div className="muted small">of {naira(t.budget_kobo)}</div>
                      </td>
                      <td className="num">{naira(t.reward_kobo)}</td>
                      <td className="muted small">{shortDate(t.created_at)}</td>
                      <td>
                        <button className="btn danger sm" onClick={() => deleteTask(t.id, t.title)}>
                          <i className="fa-solid fa-trash" /> Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── REVIEW QUEUE ──────────────────────────────────────────────── */}
      {tab === 'review' && (
        <div className="card">
          <div className="row mb" style={{ alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Review queue</h2>
            <label className="field" style={{ marginBottom: 0 }}>
              <select value={queueStatus} onChange={(e) => setQueueStatus(e.target.value)}>
                <option value="queued_review">needs review</option>
                <option value="submitted">submitted (auto pending)</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </label>
          </div>
          {subs.length === 0 && <p className="adm-empty"><i className="fa-solid fa-check-double" />Nothing with status “{queueStatus.replace('_', ' ')}”.</p>}
          {subs.map((s) => (
            <div className="task" key={s.id} style={{ alignItems: 'flex-start' }}>
              <div className="info">
                <div className="title">
                  {s.title} <span className="muted small">#{s.id}</span>
                </div>
                <div className="meta">
                  <span className="badge blue">{s.category.replace(/_/g, ' ')}</span>
                  <span className={`badge ${s.trust_score >= 60 ? 'green' : 'amber'}`}>trust {s.trust_score}</span>
                  <span className="badge">{s.email}</span>
                  <span className="badge">{shortDate(s.submitted_at)}</span>
                </div>
                {(() => {
                  const shot = proofShot(s.proof_payload);
                  const fileName =
                    typeof s.proof_payload === 'object' && s.proof_payload && typeof s.proof_payload.fileName === 'string'
                      ? s.proof_payload.fileName
                      : null;
                  if (!shot) return <div className="payload mt">{JSON.stringify(s.proof_payload, null, 2)}</div>;
                  return (
                    <div className="mt">
                      <a href={`${API_BASE}${shot}`} target="_blank" rel="noopener noreferrer" className="proof-shot">
                        <img src={`${API_BASE}${shot}`} alt={`Proof for ${s.title}`} />
                      </a>
                      {fileName && (
                        <div className="muted small mt">
                          <i className="fa-solid fa-image" /> {fileName}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {s.proof_hash && <div className="muted small mono mt">proof {s.proof_hash.slice(0, 24)}…</div>}
                {s.rejection_reason && <div className="muted small">reason: {s.rejection_reason}</div>}

                {['queued_review', 'submitted'].includes(s.status) && (
                  <div className="mt">
                    {rejecting === s.id ? (
                      <div className="row">
                        <input placeholder="Rejection reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
                        <button className="btn danger" onClick={() => decide(s.id, 'reject', rejectReason)}>
                          Confirm reject
                        </button>
                        <button className="btn secondary" onClick={() => setRejecting(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="row" style={{ maxWidth: 340 }}>
                        <button className="btn" onClick={() => decide(s.id, 'approve')}>
                          Approve &amp; pay {naira(s.reward_kobo)}
                        </button>
                        <button className="btn danger" onClick={() => setRejecting(s.id)}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PAYOUTS ───────────────────────────────────────────────────── */}
      {tab === 'payouts' && (
        <>
          <div className="adm-kpis">
            <div className="adm-kpi">
              <div className="lbl">
                <i className="fa-solid fa-hourglass-half" /> Queued
              </div>
              <div className="v">{queuedWds.length}</div>
              <div className="sub">{naira(queuedWds.reduce((a, w) => a + w.amount_kobo, 0))} to send</div>
            </div>
            <div className="adm-kpi good">
              <div className="lbl">
                <i className="fa-solid fa-circle-check" /> Paid today
              </div>
              <div className="v">{k?.wd_paid_today ?? 0}</div>
              <div className="sub">{naira(todayPayoutKobo)} settled</div>
            </div>
            <div className="adm-kpi">
              <div className="lbl">
                <i className="fa-solid fa-building-columns" /> Paid all time
              </div>
              <div className="v">{naira(k?.paid_out_kobo ?? 0)}</div>
              <div className="sub">withdrawals marked paid</div>
            </div>
          </div>

          <div className="card">
            <h2>Payout queue</h2>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th className="num">Amount</th>
                    <th>Status</th>
                    <th>Window</th>
                    <th className="num">Attempts</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {wds.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        No withdrawals.
                      </td>
                    </tr>
                  )}
                  {wds.map((w) => (
                    <tr key={w.id}>
                      <td className="mono small">{w.email}</td>
                      <td className="num">{naira(w.amount_kobo)}</td>
                      <td>
                        <span className={`badge ${w.status === 'paid' ? 'green' : w.status === 'reversed' ? 'red' : w.status === 'queued' ? 'amber' : 'blue'}`}>
                          {w.status}
                        </span>
                        {w.last_error && <div className="muted small">{w.last_error}</div>}
                      </td>
                      <td className="muted small">{String(w.window_date).slice(0, 10)}</td>
                      <td className="num">{w.attempts}</td>
                      <td className="muted small">{shortDate(w.requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── PAYMENTS: approve each purchase before it unlocks tasks ───── */}
      {tab === 'payments' && (
        <>
          <div className="adm-kpis">
            <div className="adm-kpi warn">
              <div className="lbl">
                <i className="fa-solid fa-hourglass-half" /> Awaiting approval
              </div>
              <div className="v">{pays.filter((p) => p.approval === 'pending' && p.status === 'success').length}</div>
              <div className="sub">confirm payment → unlock plan</div>
            </div>
            <div className="adm-kpi good">
              <div className="lbl">
                <i className="fa-solid fa-circle-check" /> Approved
              </div>
              <div className="v">{pays.filter((p) => p.approval === 'approved').length}</div>
              <div className="sub">plans unlocked</div>
            </div>
            <div className="adm-kpi">
              <div className="lbl">
                <i className="fa-solid fa-sack-dollar" /> Plan revenue
              </div>
              <div className="v">
                {naira(
                  pays.filter((p) => p.approval === 'approved').reduce((a, p) => a + p.amount_kobo, 0),
                )}
              </div>
              <div className="sub">approved plan fees</div>
            </div>
          </div>

          <div className="card">
            <h2>Plan payments</h2>
            <p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>
              Users only get task access after you approve their payment.
            </p>
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Plan</th>
                    <th className="num">Amount</th>
                    <th>PSP</th>
                    <th>Approval</th>
                    <th>Received</th>
                    <th>Act</th>
                  </tr>
                </thead>
                <tbody>
                  {pays.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No payments yet — a plan purchase will show up here.
                      </td>
                    </tr>
                  )}
                  {pays.map((p) => (
                    <tr key={p.psp_reference}>
                      <td className="mono small">{p.email}</td>
                      <td>
                        <span className="badge blue">{p.plan_key ?? '—'}</span>
                      </td>
                      <td className="num">{naira(p.amount_kobo)}</td>
                      <td className="muted small">
                        {p.psp}
                        <div className="mono" style={{ fontSize: 10.5 }}>
                          {p.psp_reference}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            p.approval === 'approved'
                              ? 'green'
                              : p.approval === 'rejected'
                                ? 'red'
                                : p.status === 'success'
                                  ? 'amber'
                                  : 'blue'
                          }`}
                        >
                          {p.approval === 'approved'
                            ? 'approved'
                            : p.approval === 'rejected'
                              ? 'rejected'
                              : p.status === 'success'
                                ? 'awaiting approval'
                                : 'awaiting payment'}
                        </span>
                        {p.reject_reason && <div className="muted small">{p.reject_reason}</div>}
                      </td>
                      <td className="muted small">{shortDate(p.confirmed_at ?? p.created_at)}</td>
                      <td>
                        {p.approval === 'pending' && p.status === 'success' ? (
                          <div className="row" style={{ gap: 6 }}>
                            <button className="btn sm" onClick={() => void decidePayment(p.psp_reference, 'approve')}>
                              Approve
                            </button>
                            <button className="btn danger sm" onClick={() => void decidePayment(p.psp_reference, 'reject')}>
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="muted small">{p.approved_at ? shortDate(p.approved_at) : '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── RISK ──────────────────────────────────────────────────────── */}
      {tab === 'risk' && (
        <div className="card">
          <div className="adm-cardhead">
            <h2>Fraud flags</h2>
            <span className="adm-count">{openFlags.length} open · {flags.length} total</span>
          </div>
          {flags.length === 0 && <p className="adm-empty"><i className="fa-solid fa-shield-halved" />No flags — the farm is behaving.</p>}
          <div className="tbl-wrap">
            {flags.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Reason</th>
                    <th>Severity</th>
                    <th className="num">Trust</th>
                    <th>Details</th>
                    <th>State</th>
                    <th>When</th>
                    <th>Act</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => {
                    const state = f.flag_status ?? 'open';
                    return (
                      <tr key={f.id}>
                        <td className="mono small">{f.email ?? f.user_id ?? '—'}</td>
                        <td>
                          <span className="badge">{f.reason}</span>
                        </td>
                        <td>
                          <span className={`badge ${f.severity === 'block' ? 'red' : f.severity === 'review' ? 'amber' : 'blue'}`}>{f.severity}</span>
                        </td>
                        <td className="num">{f.trust_score ?? '—'}</td>
                        <td className="muted small mono">{typeof f.details === 'string' ? f.details : JSON.stringify(f.details)}</td>
                        <td>
                          <span className={`badge ${state === 'resolved' ? 'green' : 'amber'}`}>{state}</span>
                        </td>
                        <td className="muted small">{shortDate(f.created_at)}</td>
                        <td>
                          {state === 'open' ? (
                            <button className="btn sm" onClick={() => resolveFlag(f.id)}>
                              Resolve
                            </button>
                          ) : (
                            <span className="muted small">{timeAgo(f.resolved_at)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── SUPPORT ───────────────────────────────────────────────────── */}
      {tab === 'support' && (
        <>
          <div className="adm-kpis">
            <div className="adm-kpi warn">
              <div className="lbl">
                <i className="fa-solid fa-comments" /> Waiting for an answer
              </div>
              <div className="v">{sup.filter((s) => s.status === 'open').length}</div>
              <div className="sub">chat questions the bot couldn&apos;t answer</div>
            </div>
            <div className="adm-kpi good">
              <div className="lbl">
                <i className="fa-solid fa-circle-check" /> Answered
              </div>
              <div className="v">{sup.filter((s) => s.status === 'replied').length}</div>
              <div className="sub">replies delivered into the chat</div>
            </div>
          </div>

          <div className="card">
            <div className="adm-cardhead">
              <h2>Support messages</h2>
              <div className="adm-chips">
                <button
                  className={`adm-chip ${supFilter === 'open' ? 'on' : ''}`}
                  onClick={() => setSupFilter('open')}
                >
                  Open ({sup.filter((s) => s.status === 'open').length})
                </button>
                <button
                  className={`adm-chip ${supFilter === 'all' ? 'on' : ''}`}
                  onClick={() => setSupFilter('all')}
                >
                  All ({sup.length})
                </button>
              </div>
            </div>

            {shownSup.length === 0 ? (
              <p className="muted small" style={{ marginTop: -6 }}>
                {supFilter === 'open'
                  ? 'Inbox clear — every chat question has an answer.'
                  : 'No support messages yet — the bot escalates here whenever it cannot answer.'}
              </p>
            ) : (
              shownSup.map((s) => (
                <div className="sup-item" key={s.id}>
                  <div className="sup-meta">
                    <span className="mono small">{s.email}</span>
                    <span className="muted small">{shortDate(s.created_at)}</span>
                  </div>
                  <p className="sup-q">{s.message}</p>
                  {s.status === 'replied' ? (
                    <div className="sup-a">
                      <b>Your reply</b>
                      {s.reply}
                      <span className="muted small"> · {shortDate(s.replied_at)}</span>
                    </div>
                  ) : replyingTo !== s.id ? (
                    <button
                      className="btn sm"
                      onClick={() => {
                        setReplyingTo(s.id);
                        setReplyDraft('');
                      }}
                    >
                      Reply
                    </button>
                  ) : (
                    <div className="sup-form">
                      <textarea
                        rows={3}
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        placeholder="Type your answer — it shows up in the user's chat right away."
                        maxLength={2000}
                        autoFocus
                      />
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn sm"
                          disabled={replyBusy || !replyDraft.trim()}
                          onClick={() => void sendReply(s.id)}
                        >
                          {replyBusy ? 'Sending…' : 'Send reply'}
                        </button>
                        <button className="btn secondary sm" onClick={() => setReplyingTo(null)} disabled={replyBusy}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── PUBLISH ───────────────────────────────────────────────────── */}
      {tab === 'publish' && (
        <div className="card">
          <h2>Publish a task</h2>
          <form onSubmit={createTask}>
            <label className="field">
              <span>Title</span>
              <input required value={nt.title} onChange={(e) => setNt({ ...nt, title: e.target.value })} placeholder="Follow our Instagram page & confirm" />
            </label>
            <label className="field">
              <span>Task link — the account/page users must open or follow</span>
              <input
                value={nt.link}
                onChange={(e) => setNt({ ...nt, link: e.target.value })}
                placeholder="https://instagram.com/yourpage  ·  https://t.me/yourchannel  ·  referral link"
                inputMode="url"
              />
              <span className="muted small" style={{ fontWeight: 400, marginTop: 5 }}>
                Shown as an <b>“Open link”</b> button on every user&apos;s task card. Leave empty for offline tasks.
              </span>
            </label>
            <label className="field">
              <span>Description / extra instructions</span>
              <textarea rows={2} value={nt.description} onChange={(e) => setNt({ ...nt, description: e.target.value })} placeholder="Like the post, take a screenshot and paste your username as proof." />
            </label>
            <label className="field">
              <span>Plan feed — which plan sees this task</span>
              <select value={nt.planKey} onChange={(e) => setNt({ ...nt, planKey: e.target.value })}>
                <option value="">All plans (Beginner, Intermediate &amp; Extreme)</option>
                <option value="beginner">Beginner plan only</option>
                <option value="intermediate">Intermediate plan only</option>
                <option value="extreme">Extreme plan only</option>
              </select>
              <span className="muted small" style={{ fontWeight: 400, marginTop: 5 }}>
                A task picked for one plan appears <b>only</b> in that plan&apos;s task feed — it can never leak into
                another plan. Pick <b>All plans</b> for universal tasks.
              </span>
            </label>
            <div className="row">
              <label className="field">
                <span>Category</span>
                <input list="adm-cats" value={nt.category} onChange={(e) => setNt({ ...nt, category: e.target.value })} placeholder="social_follow" />
                <datalist id="adm-cats">
                  {TASK_CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Reward (₦)</span>
                <input required type="number" min="1" value={nt.rewardNaira} onChange={(e) => setNt({ ...nt, rewardNaira: e.target.value })} />
              </label>
              <label className="field">
                <span>Budget (₦)</span>
                <input required type="number" min="1" value={nt.budgetNaira} onChange={(e) => setNt({ ...nt, budgetNaira: e.target.value })} />
              </label>
              <label className="field">
                <span>Quota</span>
                <input required type="number" min="1" value={nt.quota} onChange={(e) => setNt({ ...nt, quota: e.target.value })} />
              </label>
            </div>
            <p className="muted small" style={{ marginTop: -4 }}>
              Claimers are paid their plan&apos;s rate (up to ₦400 per approval), so budget must be at least ₦400 ×
              quota — e.g. quota 100 needs a ₦40,000 budget. Categories are free text: try <b>ad_click</b>,{' '}
              <b>social_follow</b>, <b>youtube_watch</b>, <b>telegram_join</b>.
            </p>
            <label className="field">
              <span>Validation rules (JSON)</span>
              <input className="mono" value={nt.rules} onChange={(e) => setNt({ ...nt, rules: e.target.value })} />
            </label>
            <label className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={nt.requiresAdmin} onChange={(e) => setNt({ ...nt, requiresAdmin: e.target.checked })} />
              <span style={{ margin: 0 }}>Requires manual review (skip auto-validation)</span>
            </label>
            <button className="btn" disabled={ntBusy} type="submit">
              {ntBusy ? <span className="spinner" /> : null} Publish task
            </button>
          </form>
        </div>
      )}
    </Shell>
  );
}

/* ── activity feed ─────────────────────────────────────────────────────── */
function FeedList({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="adm-empty">
        <i className="fa-solid fa-satellite-dish" />
        Nothing yet — activity will stream in here.
      </p>
    );
  }
  return (
    <div className="adm-feed">
      {items.map((it, i) => {
        const meta = FEED_META[it.kind] ?? FEED_META.signup;
        return (
          <div className="it" key={`${it.kind}-${it.at}-${i}`}>
            <span className={`adm-ico ${meta.tone}`}>
              <i className={`fa-solid ${meta.icon}`} />
            </span>
            <span className="tx">{feedText(it)}</span>
            {it.amount_kobo > 0 && it.kind !== 'withdrawal' && it.kind !== 'payout' ? (
              <span className="adm-amt">{naira(it.amount_kobo)}</span>
            ) : null}
            <span className="adm-ago">{timeAgo(it.at)}</span>
          </div>
        );
      })}
    </div>
  );
}
