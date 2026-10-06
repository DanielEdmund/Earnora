'use client';

import { useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import Link from 'next/link';
import { API_BASE, api, naira, shortDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface ReferralSummary {
  referralCode: string;
  myPlan: string | null;
  myPlanName: string | null;
  yourRateKobo: number;
  planRates: { key: string; name: string; priceKobo: number; bonusKobo: number }[];
  directReferrals: { id: string; email: string; status: string; plan: string | null; created_at: string; downstream_count: number }[];
  totalEarnedKobo: number | string;
  creditCount: number;
}

export default function ReferralsPage() {
  const { me, loading, logout } = useAuth();
  const [ref, setRef] = useState<ReferralSummary | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!me) return;
    api<ReferralSummary>('/referrals')
      .then(setRef)
      .catch((e) => setMsg((e as Error).message));
  }, [me]);

  function copy(text: string, what: 'code' | 'link') {
    void navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading || !me || !ref) {
    return (
      <div className="auth-wrap">
        <div className="auth-card center">
          <span className="spinner" style={{ color: 'var(--accent)' }} />
        </div>
      </div>
    );
  }

  const link = `${window.location.origin}/login?ref=${ref.referralCode}`;
  const hasPlan = Boolean(me.user.plan);

  return (
    <Shell active="referrals" balanceKobo={me.wallet?.available_kobo} email={me.user.email} role={me.user.role} onLogout={logout}>
      <div className="page-title">Referrals</div>
      <div className="page-sub">
        Earn a flat bonus the moment someone you invited buys a plan — the rate comes from the plan YOU are on.
      </div>

      {msg && <div className="alert error">{msg}</div>}

      <div className="grid cols-3 mb">
        <div className="stat">
          <div className="label">Total earned</div>
          <div className="value green">{naira(ref.totalEarnedKobo)}</div>
        </div>
        <div className="stat">
          <div className="label">Direct referrals</div>
          <div className="value blue">{ref.directReferrals.length}</div>
        </div>
        <div className="stat">
          <div className="label">Your rate per join</div>
          <div className="value">{hasPlan ? naira(ref.yourRateKobo) : '—'}</div>
        </div>
      </div>

      {!hasPlan && (
        <div className="banner">
          <div className="txt">
            <b>You need a plan to earn referral bonuses.</b>
            <div className="small muted">
              Your bonus rate is set by your own plan — from ₦200 up to ₦600 per invitee who joins. Invitees can buy
              before you; once your plan is active your next referral pays at your plan's rate.
            </div>
          </div>
          <Link href="/dashboard#plans" className="btn">
            Choose a plan
          </Link>
        </div>
      )}

      <div className="card">
        <h2>Your referral link</h2>
        <div className="account-box">
          <div className="kv">
            <span>Referral code</span>
            <b className="mono">{ref.referralCode}</b>
          </div>
          <div className="kv">
            <span>Invite link</span>
            <b className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
              {link}
            </b>
          </div>
        </div>
        <div className="row mt">
          <button className="btn secondary" onClick={() => copy(ref.referralCode, 'code')}>
            {copied === 'code' ? 'Copied!' : 'Copy code'}
          </button>
          <button className="btn" onClick={() => copy(link, 'link')}>
            {copied === 'link' ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <p className="muted small mt">
          Bonus is paid from their plan fee, instantly, when they complete a plan purchase — no waiting period.
        </p>
      </div>

      <div className="card">
        <h2>Plan referral rates</h2>
        <p className="muted small mb">You earn the rate of the plan YOU are on, for every person you invite.</p>
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Price</th>
              <th className="num">You earn per join</th>
              <th>Your rate</th>
            </tr>
          </thead>
          <tbody>
            {ref.planRates.map((p) => (
              <tr key={p.key} style={ref.myPlan === p.key ? { background: 'rgba(47, 111, 239, 0.06)' } : undefined}>
                <td>
                  <b>{p.name}</b>
                </td>
                <td className="num">{naira(p.priceKobo)}</td>
                <td className="num green">
                  <b>+{naira(p.bonusKobo)}</b>
                </td>
                <td>{ref.myPlan === p.key ? <span className="badge green">your rate</span> : <span className="muted small">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Your referrals ({ref.directReferrals.length})</h2>
        {ref.directReferrals.length === 0 ? (
          <p className="muted">
            No referrals yet — share your invite link. You earn {hasPlan ? naira(ref.yourRateKobo) : 'up to ₦600'} for
            everyone who joins with it and buys a plan.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {ref.directReferrals.map((r) => (
                <tr key={r.id}>
                  <td>{r.email}</td>
                  <td>{r.plan ? <span className="badge blue">{r.plan}</span> : <span className="muted small">no plan</span>}</td>
                  <td>
                    <span className={`badge ${r.status === 'active' ? 'green' : r.status === 'banned' ? 'red' : 'amber'}`}>{r.status}</span>
                  </td>
                  <td className="muted small">{shortDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ref.creditCount > 0 && (
        <div className="card">
          <h2>Referral earnings</h2>
          <p className="muted small mb">
            {ref.creditCount} bonus{ref.creditCount === 1 ? '' : 'es'} paid · total {naira(ref.totalEarnedKobo)}
          </p>
          <p className="muted small">
            Every bonus is a ledger entry — see it in your <Link href="/wallet">wallet statement</Link>. Data via{' '}
            <code>{API_BASE}/referrals</code>.
          </p>
        </div>
      )}
    </Shell>
  );
}
