'use client';

import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import Link from 'next/link';
import { api, naira } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PLANS, planDef, type PlanDef } from '@/lib/plans';

export default function DashboardPage() {
  const { me, loading, error, refresh, logout } = useAuth();
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);

  // plan purchase popup (deposit to Opay account)
  const [showPlan, setShowPlan] = useState<PlanDef | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // "Waiting For Admin's Approval" popup — locked on screen until the owner decides
  const [waiting, setWaiting] = useState<{
    ref: string;
    planName: string;
    status: 'pending' | 'approved' | 'rejected';
    reason: string | null;
  } | null>(null);

  /** A payment still needs the owner's decision? restore the waiting popup (survives reloads). */
  useEffect(() => {
    if (!me) return;
    let dead = false;
    void (async () => {
      try {
        const st = await api<{
          psp_reference: string;
          approval: string;
          plan_key: string | null;
          reject_reason: string | null;
        } | null>('/payments/mine/pending');
        if (dead || !st) return;
        const planName = planDef(st.plan_key)?.name ?? 'selected';
        if (st.approval === 'pending') {
          setWaiting({ ref: st.psp_reference, planName, status: 'pending', reason: null });
        } else if (st.approval === 'rejected' && !me.user.plan) {
          // show a rejection once per payment, then stay quiet
          if (localStorage.getItem('earnora_rejected_seen') !== st.psp_reference) {
            setWaiting({ ref: st.psp_reference, planName, status: 'rejected', reason: st.reject_reason });
          }
        }
      } catch {
        /* best-effort — the dashboard works without the popup */
      }
    })();
    return () => {
      dead = true;
    };
  }, [me]);

  /** While the popup is up, watch the payment — it flips live when the admin decides. */
  useEffect(() => {
    if (!waiting || waiting.status !== 'pending') return;
    let dead = false;
    const check = async () => {
      if (document.hidden) return;
      try {
        const st = await api<{ approval: string; reject_reason: string | null }>(`/payments/${waiting.ref}`);
        if (dead || st.approval === 'pending') return;
        setWaiting((w) =>
          w && w.ref === waiting.ref
            ? { ...w, status: st.approval === 'approved' ? 'approved' : 'rejected', reason: st.reject_reason }
            : w,
        );
        if (st.approval === 'approved') void refresh(); // plan badge updates underneath
      } catch {
        /* transient hiccup — the next tick retries */
      }
    };
    const t = setInterval(() => void check(), 3000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [waiting, refresh]);

  /** User transferred the plan price → record the payment; the admin then verifies it. */
  async function confirmPlan() {
    if (!showPlan) return;
    setPlanBusy(true);
    setMsg(null);
    try {
      const init = await api<{ reference: string; authorizationUrl: string | null }>('/payments/initialize', {
        method: 'POST',
        body: { planKey: showPlan.key },
      });
      // Manual mode: the payment is already recorded as awaiting approval.
      // (A future real PSP would redirect to init.authorizationUrl instead.)
      const st = await api<{ approval: string }>(`/payments/${init.reference}`);
      setShowPlan(null);
      if (st.approval === 'pending') {
        // owner vets every purchase → lock the screen until they approve
        setWaiting({ ref: init.reference, planName: showPlan.name, status: 'pending', reason: null });
      } else {
        setMsg({ kind: 'success', text: `${showPlan.name} plan activated — tasks and withdrawals are unlocked!` });
        await refresh();
      }
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setPlanBusy(false);
    }
  }

  function copyAccount() {
    void navigator.clipboard.writeText('8066297884');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading || !me) {
    return (
      <div className="auth-wrap">
        <div className="auth-card center">
          <span className="spinner" style={{ color: 'var(--accent)' }} />
          <p className="muted mt">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  const plan = planDef(me.user.plan);
  const noPlan = !plan;
  const referralRate = plan?.referralBonusKobo ?? 0;

  // The two earning sources (see migration 006): task_kobo + affiliate_kobo
  // always equals available_kobo — the balance IS both added together.
  const taskKobo = Number(me.wallet?.task_kobo ?? 0);
  const affiliateKobo = Number(me.wallet?.affiliate_kobo ?? 0);
  const totalKobo = taskKobo + affiliateKobo;

  return (
    <Shell active="dashboard" balanceKobo={totalKobo} email={me.user.email} role={me.user.role} onLogout={logout}>
      <div className="page-title">Dashboard</div>
      <div className="page-sub">
        {noPlan ? 'Choose a plan to unlock daily tasks & withdrawals.' : `${plan!.name} plan — earn every day.`}
      </div>

      {error && <div className="alert error">{error}</div>}
      {msg && !showPlan && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      {/* Hero: gradient balance card + plan status */}
      <div className="hero">
        <div className="hero-left">
          <div className="hero-label">Current balance</div>
          <div className="hero-balance">{naira(totalKobo)}</div>
          <div className="hero-sub">
            Task Balance {naira(taskKobo)} · Affiliate Balance {naira(affiliateKobo)}
          </div>
        </div>
        <div className="hero-right">
          <span className={`badge ${noPlan ? 'amber' : 'green'}`}>{noPlan ? 'no plan yet' : `${plan!.name} plan`}</span>
          <Link href="/wallet" className="btn secondary sm">
            Withdraw
          </Link>
          {noPlan ? (
            <a href="#plans" className="btn">
              Choose a plan
            </a>
          ) : (
            <Link href="/tasks" className="btn">
              Start tasks
            </Link>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="quick-grid">
        <Link href="/tasks" className="quick-tile">
          <span className="icon-badge">
            <i className="fa-solid fa-list-check" />
          </span>
          <span className="lbl">Tasks</span>
          <span className="sub">{noPlan ? 'locked' : `${plan!.dailyTaskLimit} per day`}</span>
        </Link>
        <Link href="/wallet" className="quick-tile">
          <span className="icon-badge">
            <i className="fa-solid fa-wallet" />
          </span>
          <span className="lbl">Wallet</span>
          <span className="sub">{naira(me.wallet?.available_kobo ?? 0)}</span>
        </Link>
        <Link href="/referrals" className="quick-tile">
          <span className="icon-badge">
            <i className="fa-solid fa-user-plus" />
          </span>
          <span className="lbl">Refer</span>
          <span className="sub">{noPlan ? 'buy a plan' : `${naira(referralRate)} each`}</span>
        </Link>
        {noPlan ? (
          <a href="#plans" className="quick-tile">
            <span className="icon-badge">
              <i className="fa-solid fa-bolt" />
            </span>
            <span className="lbl">Get plan</span>
            <span className="sub">from ₦3,000</span>
          </a>
        ) : (
          <Link href="/wallet" className="quick-tile">
            <span className="icon-badge">
              <i className="fa-solid fa-money-bill-transfer" />
            </span>
            <span className="lbl">Withdraw</span>
            <span className="sub">cash out</span>
          </Link>
        )}
      </div>

      {noPlan && (
        <div className="banner">
          <div className="txt">
            <b>Purchase a plan to start earning.</b>
            <div className="small muted">
              Tasks and withdrawals unlock the moment your plan payment lands. One payment, no expiry — and your plan
              also sets your referral rate (₦200 / ₦400 / ₦600 per invitee who joins).
            </div>
          </div>
          <a href="#plans" className="btn">
            View plans
          </a>
        </div>
      )}

      <div className="grid cols-4 mb">
        <div className="stat">
          <div className="label">Available</div>
          <div className="value green">{naira(me.wallet?.available_kobo)}</div>
        </div>
        <div className="stat">
          <div className="label">Tasks approved</div>
          <div className="value blue">
            {me.stats.tasks_approved}
            <span className="muted" style={{ fontSize: 15 }}>
              /{me.stats.tasks_total}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="label">Referral earnings</div>
          <div className="value">{naira(me.stats.referral_earned_kobo)}</div>
        </div>
        <div className="stat">
          <div className="label">Trust score</div>
          <div className={`value ${me.user.trust_score >= 60 ? 'green' : 'amber'}`}>{me.user.trust_score}</div>
        </div>
      </div>

      {/* ── Plans: the only way into tasks ─────────────────────────────── */}
      <div className="card" id="plans">
        <h2>Choose your plan</h2>
        <p className="muted small mb">
          One payment. No expiry. Your plan unlocks the daily task feed and withdrawals — and decides how much you earn
          per task and per referral. One plan per account.
        </p>

        <div className="plan-grid">
          {PLANS.map((p) => {
            const current = me.user.plan === p.key;
            const hasPlan = Boolean(me.user.plan);
            return (
              <div className={`plan-card ${current ? 'current' : ''} ${p.key === 'intermediate' ? 'popular' : ''}`} key={p.key}>
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
                    <i className="fa-solid fa-check" /> {naira(p.taskRewardKobo)} per completed task
                  </li>
                  <li>
                    <i className="fa-solid fa-check" /> {naira(p.referralBonusKobo)} per referral who joins
                  </li>
                  <li>
                    <i className="fa-solid fa-check" /> Unlocks withdrawals (min ₦15,000)
                  </li>
                  <li>
                    <i className="fa-solid fa-check" /> No expiry — daily quota resets at midnight
                  </li>
                </ul>
                {current ? (
                  <Link href="/tasks" className="btn block">
                    Go to tasks
                  </Link>
                ) : hasPlan ? (
                  <button className="btn block secondary" disabled title="One plan per account">
                    Plan already active
                  </button>
                ) : (
                  <button
                    className="btn block"
                    onClick={() => {
                      setMsg(null);
                      setShowPlan(p);
                    }}
                  >
                    Choose {p.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Plan purchase popup: deposit account details ───────────────── */}
      {showPlan && (
        <div className="modal-overlay" onClick={() => !planBusy && setShowPlan(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                Pay for {showPlan.name} plan — {naira(showPlan.priceKobo)}
              </h2>
              <button className="modal-x" onClick={() => setShowPlan(null)} aria-label="Close">
                ×
              </button>
            </div>
            {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
            <p className="muted small">
              Transfer exactly <b>{naira(showPlan.priceKobo)}</b> from any bank app, then tap “I have completed the
              transfer”. The admin approves your payment, then your plan unlocks.
            </p>
            <div className="account-box">
              <div className="kv">
                <span>Bank Name</span>
                <b>Opay</b>
              </div>
              <div className="kv">
                <span>Account Name</span>
                <b>Emmanuel Oscar</b>
              </div>
              <div className="kv">
                <span>Account Number</span>
                <b className="mono">8066297884</b>
              </div>
              <div className="kv">
                <span>Amount</span>
                <b className="green">{naira(showPlan.priceKobo)}</b>
              </div>
            </div>
            <div className="row">
              <button className="btn secondary" onClick={copyAccount}>
                {copied ? 'Copied!' : 'Copy account number'}
              </button>
              <button className="btn" onClick={confirmPlan} disabled={planBusy}>
                {planBusy ? <span className="spinner" /> : null} I have completed the transfer
              </button>
            </div>
            <p className="muted small center mt">
              {showPlan.dailyTaskLimit} tasks/day · {naira(showPlan.taskRewardKobo)} each · no expiry. Every transfer is
              checked by the admin before your plan unlocks.
            </p>
          </div>
        </div>
      )}

      {/* ── Waiting for the owner's approval — stays until they decide ──── */}
      {waiting && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }}>
            {waiting.status === 'pending' && (
              <>
                <div style={{ marginTop: 10 }}>
                  <span className="spinner" style={{ color: 'var(--accent)', width: 26, height: 26 }} />
                </div>
                <h2 style={{ margin: '16px 0 6px' }}>Waiting For Admin's Approval</h2>
                <p className="muted small">
                  We've received your <b>{waiting.planName} plan</b> payment. The admin reviews every payment personally
                  — your tasks unlock the moment it's approved.
                </p>
                <p className="muted small">This window updates automatically, please keep it open.</p>
              </>
            )}
            {waiting.status === 'approved' && (
              <>
                <div style={{ fontSize: 36, marginTop: 8, color: '#16a34a' }}>
                  <i className="fa-solid fa-circle-check" />
                </div>
                <h2 style={{ margin: '10px 0 6px' }}>Payment Approved 🎉</h2>
                <p className="muted small">
                  Your <b>{waiting.planName} plan</b> is now active — tasks and withdrawals are unlocked.
                </p>
                <button className="btn block" style={{ marginTop: 16 }} onClick={() => setWaiting(null)}>
                  Continue to dashboard
                </button>
              </>
            )}
            {waiting.status === 'rejected' && (
              <>
                <div style={{ fontSize: 36, marginTop: 8, color: '#dc2626' }}>
                  <i className="fa-solid fa-circle-xmark" />
                </div>
                <h2 style={{ margin: '10px 0 6px' }}>Payment Rejected</h2>
                <p className="muted small">
                  {waiting.reason ? `Reason: ${waiting.reason}. ` : ''}You can choose a plan and pay again from your
                  dashboard.
                </p>
                <button
                  className="btn block secondary"
                  style={{ marginTop: 16 }}
                  onClick={() => {
                    localStorage.setItem('earnora_rejected_seen', waiting.ref);
                    setWaiting(null);
                  }}
                >
                  Back to dashboard
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
