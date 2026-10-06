'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import Link from 'next/link';
import { api, naira, shortDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface WindowStatus {
  open: boolean;
  window: string;
  timezone: string;
  now: string;
  opensAt: string | null;
  minutesUntilOpen: number | null;
}

interface LedgerEntry {
  id: number;
  direction: 'credit' | 'debit';
  amount_kobo: number;
  balance_after: number;
  entry_type: string;
  memo: string | null;
  created_at: string;
}

interface Withdrawal {
  id: string;
  amount_kobo: number;
  status: string;
  requested_at: string;
  window_date: string;
  account_name: string | null;
  bank_code: string;
  account_number: string;
  attempts: number;
  last_error: string | null;
}

const BANKS = [
  { code: '999999', name: 'Opay (Paycom)' },
  { code: '50193', name: 'Kuda MFB' },
  { code: '058', name: 'GTBank' },
  { code: '044', name: 'Access Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '033', name: 'UBA' },
  { code: '011', name: 'First Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '215', name: 'Wema Bank' },
];

const STATUS_BADGE: Record<string, string> = {
  queued: 'amber',
  disbursing: 'blue',
  paid: 'green',
  reversed: 'red',
  failed: 'red',
};

export default function WalletPage() {
  const { me, loading, refresh, logout } = useAuth();
  const [win, setWin] = useState<WindowStatus | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);

  // withdraw modal
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [amountNaira, setAmountNaira] = useState('');
  const [bank, setBank] = useState('999999');
  const [account, setAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [w, t, d] = await Promise.all([
        api<WindowStatus>('/withdrawals/window', { auth: false }),
        api<LedgerEntry[]>('/wallet/transactions?limit=50'),
        api<Withdrawal[]>('/withdrawals'),
      ]);
      setWin(w);
      setEntries(t);
      setWithdrawals(d);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    if (me) {
      void load();
      const iv = setInterval(() => void load(), 20_000);
      return () => clearInterval(iv);
    }
  }, [me, load]);

  /** User requests a withdrawal → reserved instantly, paid in the window. */
  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const kobo = Math.round(parseFloat(amountNaira || '0') * 100);
      if (!Number.isFinite(kobo) || kobo <= 0) throw new Error('Enter a valid amount');
      await api('/withdrawals', {
        method: 'POST',
        body: { amountKobo: kobo, bankCode: bank, accountNumber: account },
      });
      setMsg({
        kind: 'success',
        text: win?.open
          ? 'Withdrawal queued — the payout worker will disburse it shortly.'
          : 'Withdrawal queued — it will be paid automatically when the window opens (17:00–19:00 WAT).',
      });
      setAmountNaira('');
      setAccount('');
      setAccountName('');
      setShowWithdraw(false);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setMsg({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loading || !me) {
    return (
      <div className="auth-wrap">
        <div className="auth-card center">
          <span className="spinner" style={{ color: 'var(--accent)' }} />
        </div>
      </div>
    );
  }

  const noPlan = !me.user.plan;
  const minNaira = Math.round((me.settings?.minWithdrawalKobo ?? 1_500_000) / 100);

  return (
    <Shell active="wallet" balanceKobo={me.wallet?.available_kobo} email={me.user.email} role={me.user.role} onLogout={logout}>
      <div className="page-title">Wallet</div>
      <div className="page-sub">Real-time balance with an append-only statement — every kobo is traceable.</div>

      {msg && !showWithdraw && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      <div className="grid cols-3 mb">
        <div className="stat">
          <div className="label">Available</div>
          <div className="value green">{naira(me.wallet?.available_kobo)}</div>
        </div>
        <div className="stat">
          <div className="label">Reserved (pending withdrawal)</div>
          <div className="value amber">{naira(me.wallet?.reserved_kobo)}</div>
        </div>
        <div className="stat">
          <div className="label">Lifetime earnings</div>
          <div className="value blue">{naira(me.wallet?.lifetime_kobo)}</div>
        </div>
      </div>

      {noPlan && (
        <div className="banner">
          <div className="txt">
            <b>No plan yet — tasks & withdrawals are locked.</b>
            <div className="small muted">
              Choose a plan (from ₦3,000, one-time) to unlock your daily tasks and withdrawals. Referral bonuses of
              ₦200–₦600 start with your own plan.
            </div>
          </div>
          <Link href="/dashboard#plans" className="btn">
            Choose a plan
          </Link>
        </div>
      )}

      <div className="card">
        <h2>Withdrawal window</h2>
        <div className="window-box">
          <span className={`dot ${win?.open ? 'open' : ''}`} />
          <b>{win?.open ? 'OPEN — withdrawals paying now' : 'CLOSED'}</b>
          <span className="muted small">
            Daily {win?.window} ({win?.timezone})
            {!win?.open && win?.minutesUntilOpen != null && (
              <>
                {' '}
                · opens in{' '}
                {win.minutesUntilOpen >= 60
                  ? `${Math.floor(win.minutesUntilOpen / 60)}h ${win.minutesUntilOpen % 60}m`
                  : `${win.minutesUntilOpen}m`}
              </>
            )}
          </span>
        </div>
        <p className="muted small mt">
          Requests made while closed are queued safely — funds are reserved immediately and paid when the window opens.
        </p>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Withdraw</h2>
          <p className="muted small mb">
            Minimum ₦{minNaira.toLocaleString()}, one withdrawal per window. Enter your bank details in the form that
            pops up — failed transfers auto-retry, then reverse to your balance.
          </p>
          <button className="btn block" onClick={() => { setMsg(null); setShowWithdraw(true); }}>
            Request withdrawal
          </button>
        </div>

        <div className="card">
          <h2>Withdrawal history</h2>
          {withdrawals.length === 0 ? (
            <p className="muted">No withdrawals yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td>{naira(w.amount_kobo)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[w.status] ?? ''}`}>{w.status}</span>
                      {w.last_error && w.status !== 'paid' && <div className="muted small">{w.last_error}</div>}
                    </td>
                    <td className="muted small">{shortDate(w.requested_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Statement</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Memo</th>
              <th className="num">Amount</th>
              <th className="num">Balance</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No transactions yet.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className={`badge ${e.direction === 'credit' ? 'green' : 'red'}`}>{e.entry_type.replace(/_/g, ' ')}</span>
                </td>
                <td className="muted small">{e.memo ?? '—'}</td>
                <td className="num" style={{ color: e.direction === 'credit' ? 'var(--accent)' : 'var(--danger)' }}>
                  {e.direction === 'credit' ? '+' : '−'}
                  {naira(e.amount_kobo)}
                </td>
                <td className="num">{naira(e.balance_after)}</td>
                <td className="muted small">{shortDate(e.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Withdraw popup: bank details + amount form ────────────────── */}
      {showWithdraw && (
        <div className="modal-overlay" onClick={() => !busy && setShowWithdraw(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Request withdrawal</h2>
              <button className="modal-x" onClick={() => setShowWithdraw(false)} aria-label="Close">
                ×
              </button>
            </div>
            {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}
            <div className="window-box mb">
              <span className={`dot ${win?.open ? 'open' : ''}`} />
              <span className="muted small">
                {win?.open ? 'Window open — paying now' : 'Window closed — queues until 17:00–19:00 WAT'}
              </span>
            </div>
            <form onSubmit={withdraw}>
              <label className="field">
                <span>Amount (₦, minimum ₦{minNaira.toLocaleString()})</span>
                <input
                  type="number"
                  min={minNaira}
                  step="0.01"
                  required
                  value={amountNaira}
                  onChange={(e) => setAmountNaira(e.target.value)}
                  placeholder="10000"
                />
              </label>
              <label className="field">
                <span>Account Number (10 digits)</span>
                <input
                  pattern="\d{10}"
                  maxLength={10}
                  required
                  value={account}
                  onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))}
                  placeholder="0123456789"
                />
              </label>
              <label className="field">
                <span>Account Name</span>
                <input
                  required
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Daniel Edmund"
                />
              </label>
              <label className="field">
                <span>Bank Name</span>
                <select value={bank} onChange={(e) => setBank(e.target.value)}>
                  {BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn block" disabled={busy} type="submit">
                {busy ? <span className="spinner" /> : null} Request withdrawal
              </button>
              <p className="muted small mt">
                One withdrawal per window per user. Funds are reserved instantly and paid when the window opens.
              </p>
            </form>
          </div>
        </div>
      )}
    </Shell>
  );
}
