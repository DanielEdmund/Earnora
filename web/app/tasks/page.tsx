'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import Link from 'next/link';
import { ApiError, API_BASE, api, apiUpload, naira, shortDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { mineNonce } from '@/lib/pow';
import { PLANS, planDef } from '@/lib/plans';

interface Task {
  id: string;
  title: string;
  description: string;
  link: string | null;
  category: string;
  reward_kobo: number;
  quota: number;
  slots_left: number;
  requires_admin: boolean;
  validation_rules: { requiredFields?: string[]; minChars?: number } | string;
}

interface Claim {
  id: number;
  task_id: string;
  status: string;
  claimed_at: string;
  expires_at: string;
  submitted_at: string | null;
  rejection_reason: string | null;
  reward_kobo: number;
  title: string;
  category: string;
  link: string | null;
  validation_rules: { requiredFields?: string[]; minChars?: number; proof?: string } | string;
}

// 4 MB, not 8: Vercel rejects request bodies over 4.5 MB at the edge.
const MAX_PROOF_MB = 4;
const PROOF_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export default function TasksPage() {
  const { me, loading, error, refresh, logout } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [openClaim, setOpenClaim] = useState<Claim | null>(null);
  const [proof, setProof] = useState<{ url: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([api<Task[]>('/tasks'), api<Claim[]>('/tasks/mine')]);
      setTasks(t);
      setClaims(c);
      setLocked(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setLocked(true);
        return;
      }
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    if (me) void loadData();
  }, [me, loadData]);

  async function claim(task: Task) {
    setBusyTask(task.id);
    setMsg(null);
    try {
      // 1) server-issued challenge  2) mine nonce in-browser  3) claim with PoW headers
      const ch = await api<{ challenge: string; bits: number }>('/tasks/challenge');
      const nonce = await mineNonce(ch.challenge, ch.bits);
      await api(`/tasks/${task.id}/claim`, {
        method: 'POST',
        body: {},
        headers: { 'x-pow-challenge': ch.challenge, 'x-pow-nonce': nonce },
      });
      setMsg({ kind: 'success', text: `Claimed “${task.title}” — complete it below before it expires (30 min)` });
      await Promise.all([loadData(), refresh()]);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusyTask(null);
    }
  }

  function openSubmit(claim: Claim) {
    setProof(null);
    setOpenClaim(claim);
  }

  function closeSubmit() {
    setOpenClaim(null);
    setProof(null);
  }

  /** Attach the screenshot: quick client-side checks, then upload it and keep
   *  the server-assigned URL - that URL is what gets submitted as proof. */
  async function attachProof(file: File | undefined) {
    if (!file || !openClaim) return;
    setMsg(null);
    setProof(null);
    if (file.size > MAX_PROOF_MB * 1024 * 1024) {
      setMsg({ kind: 'error', text: `Screenshot is too large (max ${MAX_PROOF_MB} MB)` });
      return;
    }
    setUploading(true);
    try {
      const up = await apiUpload<{ url: string; name: string }>(`/tasks/${openClaim.task_id}/proof`, file);
      setProof({ url: up.url, name: up.name });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function submitProof() {
    if (!openClaim || !proof) return;
    setSubmitting(true);
    setMsg(null);
    try {
      await api(`/tasks/${openClaim.task_id}/submit`, {
        method: 'POST',
        body: { payload: { screenshot: proof.url, fileName: proof.name } },
      });
      setMsg({ kind: 'success', text: 'Screenshot submitted — validation is automatic for most tasks' });
      closeSubmit();
      await Promise.all([loadData(), refresh()]);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !me) {
    return (
      <div className="auth-wrap">
        <div className="auth-card center">
          <span className="spinner" style={{ color: 'var(--accent)' }} />
          <p className="muted mt">Loading tasks…</p>
        </div>
      </div>
    );
  }

  const plan = planDef(me.user.plan);
  const tasksToday = me.stats.tasks_today ?? 0;
  const activeClaims = claims.filter((c) => c.status === 'claimed');

  // ── no plan → tasks locked: show the plan picker ─────────────────────────
  if (locked || !plan) {
    return (
      <Shell active="tasks" balanceKobo={me.wallet?.available_kobo} email={me.user.email} role={me.user.role} onLogout={logout}>
        <div className="page-title">Tasks</div>
        <div className="page-sub">Tasks are unlocked with a plan — pick yours to start earning.</div>

        <div className="banner">
          <div className="txt">
            <b>No plan active on your account.</b>
            <div className="small muted">
              Choose a plan below to unlock your daily task feed and withdrawals. One payment, no expiry.
            </div>
          </div>
          <Link href="/dashboard#plans" className="btn">
            Choose a plan
          </Link>
        </div>

        <div className="card">
          <h2>Plans</h2>
          <div className="plan-grid">
            {PLANS.map((p) => (
              <div className={`plan-card ${p.key === 'intermediate' ? 'popular' : ''}`} key={p.key}>
                {p.key === 'intermediate' && <span className="plan-tag">POPULAR</span>}
                <div className="plan-name">{p.name}</div>
                <div className="plan-price">
                  {naira(p.priceKobo)}
                  <em>one-time</em>
                </div>
                <ul className="plan-fees">
                  <li>
                    <i className="fa-solid fa-check" /> {p.dailyTaskLimit} tasks per day
                  </li>
                  <li>
                    <i className="fa-solid fa-check" /> {naira(p.taskRewardKobo)} per task
                  </li>
                  <li>
                    <i className="fa-solid fa-check" /> {naira(p.referralBonusKobo)} per referral
                  </li>
                  <li>
                    <i className="fa-solid fa-check" /> Unlocks withdrawals
                  </li>
                </ul>
                <Link href="/dashboard#plans" className="btn block">
                  Choose {p.name}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell active="tasks" balanceKobo={me.wallet?.available_kobo} email={me.user.email} role={me.user.role} onLogout={logout}>
      <div className="page-title">Task feed</div>
      <div className="page-sub">Complete micro-tasks, get validated, earn instantly.</div>

      {error && <div className="alert error">{error}</div>}
      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      {/* Daily quota usage */}
      <div className="card plan-usage">
        <div className="usage-head">
          <div>
            <div className="label">Today's progress</div>
            <div className="usage-count">
              {tasksToday}
              <span> / {plan.dailyTaskLimit} tasks</span>
            </div>
          </div>
          <span className="badge blue">
            {plan.name} plan · {naira(plan.taskRewardKobo)} each
          </span>
        </div>
        <div className="meter">
          <i style={{ width: `${Math.min(100, (tasksToday / plan.dailyTaskLimit) * 100)}%` }} />
        </div>
        <p className="muted small mt">
          Quota resets daily at midnight WAT. Done for today?{' '}
          <Link href="/referrals">invite a friend for {naira(plan.referralBonusKobo)} →</Link>
        </p>
      </div>

      <div className="grid cols-4 mb">
        <div className="stat">
          <div className="label">Available</div>
          <div className="value green">{naira(me.wallet?.available_kobo)}</div>
        </div>
        <div className="stat">
          <div className="label">Today</div>
          <div className="value blue">
            {tasksToday}
            <span className="muted" style={{ fontSize: 15 }}>
              /{plan.dailyTaskLimit}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="label">Approved</div>
          <div className="value">{me.stats.tasks_approved}</div>
        </div>
        <div className="stat">
          <div className="label">Trust score</div>
          <div className={`value ${me.user.trust_score >= 60 ? 'green' : 'amber'}`}>{me.user.trust_score}</div>
        </div>
      </div>

      {activeClaims.length > 0 && (
        <div className="card">
          <h2>Your active claims</h2>
          {activeClaims.map((c) => (
            <div className="task" key={c.id}>
              <div className="info">
                <div className="title">{c.title}</div>
                <div className="meta">
                  <span className="badge blue">{c.category.replace('_', ' ')}</span>
                  <span className="badge">expires {shortDate(c.expires_at)}</span>
                </div>
                {c.link && (
                  <div className="mt">
                    <a className="btn secondary sm" href={c.link} target="_blank" rel="noopener noreferrer">
                      <i className="fa-solid fa-arrow-up-right-from-square" /> Open task link
                    </a>
                  </div>
                )}
                {openClaim?.id === c.id && (
                  <div className="claim-form">
                    <div className="hint">
                      Attach one screenshot showing you completed this task. Your own file only — minimum time on
                      task and duplicate detection are enforced. PNG, JPG, WEBP or GIF up to {MAX_PROOF_MB} MB.
                    </div>
                    <label
                      className={`proof-drop${proof ? ' has' : ''}${uploading ? ' busy' : ''}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        void attachProof(e.dataTransfer.files?.[0]);
                      }}
                    >
                      <input
                        type="file"
                        accept={PROOF_ACCEPT}
                        onChange={(e) => {
                          void attachProof(e.target.files?.[0]);
                          e.target.value = ''; // allow re-picking the same file
                        }}
                      />
                      {uploading ? (
                        <span className="proof-idle">
                          <span className="spinner" />
                          <b>Uploading screenshot…</b>
                        </span>
                      ) : proof ? (
                        <span className="proof-shot">
                          <img src={`${API_BASE}${proof.url}`} alt="Your proof screenshot" />
                          <span className="proof-name">
                            <i className="fa-solid fa-circle-check" /> {proof.name}
                          </span>
                          <span className="proof-swap">Tap to choose a different screenshot</span>
                        </span>
                      ) : (
                        <span className="proof-idle">
                          <i className="fa-solid fa-camera" />
                          <b>Tap to attach your screenshot</b>
                          <span className="muted small">or drop an image here — the file is your proof</span>
                        </span>
                      )}
                    </label>
                    <div className="row mt">
                      <button className="btn" onClick={submitProof} disabled={submitting || uploading || !proof}>
                        {submitting ? <span className="spinner" /> : null} Submit proof
                      </button>
                      <button className="btn secondary" onClick={closeSubmit}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="reward">{naira(c.reward_kobo)}</div>
              {openClaim?.id !== c.id && (
                <button className="btn" onClick={() => openSubmit(c)}>
                  Submit proof
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Available tasks ({tasks.length})</h2>
        {tasks.length === 0 && (
          <p className="muted">
            {tasksToday >= plan.dailyTaskLimit
              ? `That's your ${plan.dailyTaskLimit} tasks for today — quota resets at midnight WAT.`
              : 'No open tasks right now — check back soon.'}
          </p>
        )}
        {tasks.map((t) => (
          <div className="task" key={t.id}>
            <div className="info">
              <div className="title">{t.title}</div>
              <div className="desc">{t.description}</div>
              <div className="meta">
                <span className="badge blue">{t.category.replace('_', ' ')}</span>
                <span className="badge">
                  {t.slots_left} / {t.quota} slots
                </span>
                {t.requires_admin ? <span className="badge amber">admin reviewed</span> : <span className="badge green">auto validated</span>}
              </div>
            </div>
            <div className="reward">{naira(t.reward_kobo)}</div>
            {t.link && (
              <a className="btn secondary" href={t.link} target="_blank" rel="noopener noreferrer">
                <i className="fa-solid fa-arrow-up-right-from-square" /> Open link
              </a>
            )}
            <button className="btn" onClick={() => claim(t)} disabled={busyTask === t.id || tasksToday >= plan.dailyTaskLimit}>
              {busyTask === t.id ? <span className="spinner" /> : null} Claim
            </button>
          </div>
        ))}
      </div>

      {claims.length > 0 && (
        <div className="card">
          <h2>Claim history</h2>
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Status</th>
                <th>Reward</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="num">{naira(c.reward_kobo)}</td>
                  <td className="muted small">{shortDate(c.submitted_at ?? c.claimed_at)}</td>
                  <td className="muted small">{c.rejection_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    claimed: 'blue',
    submitted: 'amber',
    queued_review: 'amber',
    approved: 'green',
    rejected: 'red',
    expired: '',
  };
  return <span className={`badge ${map[status] ?? ''}`}>{status.replace('_', ' ')}</span>;
}
