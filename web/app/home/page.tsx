'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken, naira } from '@/lib/api';

interface Stats {
  active_users: number;
  paid_out_kobo: number | string;
  tasks_completed: number;
}

const FEATURES = [
  {
    icon: 'fa-solid fa-bolt',
    title: 'Instant Task Rewards',
    text: 'Approved tasks credit your wallet immediately — watch the balance move in real time.',
  },
  {
    icon: 'fa-solid fa-user-group',
    title: 'Flat Referral Bonuses',
    text: 'Earn ₦200, ₦400 or ₦600 per invitee — the rate of your own plan — paid the moment they buy a plan.',
  },
  {
    icon: 'fa-solid fa-shield-halved',
    title: 'Bot-Proof Task Claims',
    text: 'Proof-of-work challenges, dwell-time and duplicate-proof checks keep farms out.',
  },
  {
    icon: 'fa-solid fa-clock',
    title: 'Controlled Withdrawal Windows',
    text: 'Request any time — payouts run in the daily 17:00–19:00 WAT window, safely reserved.',
  },
  {
    icon: 'fa-solid fa-vault',
    title: 'Ledger-Secured Wallet',
    text: 'Every kobo sits in an append-only double-entry ledger with idempotency guarantees.',
  },
  {
    icon: 'fa-solid fa-building-columns',
    title: 'Verified Bank Payments',
    text: 'Cash out to your Nigerian bank account with automatic retry and reversal on failure.',
  },
];

const FAQ = [
  {
    q: 'Which plan should I start with?',
    a: 'Beginner is ₦3,000 for 3 tasks a day at ₦200 each, Intermediate is ₦6,500 for 6 tasks a day at ₦300 each, and Extreme is ₦10,500 for 10 tasks a day at ₦400 each. Plans are one-time payments with no expiry — your daily task quota still resets every day at midnight.',
  },
  {
    q: 'How fast are withdrawals?',
    a: 'You can request a withdrawal any time once you own a plan. The minimum is ₦15,000; requests are reserved instantly and paid during the daily 17:00–19:00 WAT window — failed transfers auto-retry, then reverse back to your balance.',
  },
  {
    q: 'How do referrals pay?',
    a: 'When someone registers with your code and buys a plan, you are credited instantly from their plan fee: ₦200 on the Beginner plan, ₦400 on Intermediate and ₦600 on Extreme. The rate comes from the plan YOU are on — so upgrade once and every future join pays more.',
  },
  {
    q: 'Do I need KYC?',
    a: 'No KYC is required to sign up and start completing tasks. You only need a valid Nigerian bank account to withdraw.',
  },
];

const STEPS = [
  { n: '1', title: 'Sign Up', text: 'Register with your email and phone — no KYC required.' },
  { n: '2', title: 'Choose a Plan', text: 'Pay once by bank transfer — from ₦3,000. No expiry, no monthly fees.' },
  { n: '3', title: 'Earn', text: 'Complete daily tasks, refer friends and cash out to your bank.' },
];

export default function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const loggedIn = typeof window !== 'undefined' ? !!getToken() : false;

  useEffect(() => {
    api<Stats>('/public/stats', { auth: false })
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <div className="landing">
      <header>
        <Link href="/home" className="brand">
          <span className="brand-mark">E</span>
          Earnora
        </Link>
        <div className="actions">
          <Link href="/login" className="btn secondary sm">
            Login
          </Link>
          <Link href={loggedIn ? '/dashboard' : '/login?mode=register'} className="btn sm">
            {loggedIn ? 'Dashboard' : 'Get Started'}
          </Link>
        </div>
      </header>

      <section className="hero-sec">
        <h1>
          Earn every day — tasks, referrals <span style={{ color: 'var(--c-vivid)' }}>&amp; ads.</span>
        </h1>
        <p className="lead">
          Earn from simple micro-tasks, flat referral bonuses and engagement campaigns — validated fast and paid to
          your wallet in real time.
        </p>
        <div className="cta-row">
          <Link href="/login?mode=register" className="btn">
            Create Account <i className="fa-solid fa-arrow-right" style={{ fontSize: 13 }} />
          </Link>
          <Link href="/login" className="btn secondary">
            I already have one
          </Link>
        </div>
        <p className="helper">Free to sign up — pick a plan (from ₦3,000, one-time) to unlock tasks &amp; withdrawals.</p>
      </section>

      <section className="band">
        <h2>How it works</h2>
        <p className="band-sub">Three steps between you and your first payout.</p>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <span className="num">{s.n}</span>
              <h4>{s.title}</h4>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="note-card">
        <b>Why plans instead of free access?</b>
        A one-time plan payment keeps bots and fake accounts out, funds your task rewards and referral bonuses, and
        means no ads or hidden deductions from your earnings. Plan fees are <strong>not</strong> credited to your wallet
        balance.
      </div>

      <section className="band">
        <h2>Features</h2>
        <p className="band-sub">Everything you need to earn and cash out with confidence.</p>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <span className="icon-badge">
                <i className={f.icon} />
              </span>
              <h4>{f.title}</h4>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="stats-row">
        <div className="stat">
          <div className="label">Active earners</div>
          <div className="value blue">{stats ? `${Number(stats.active_users).toLocaleString()}+` : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Total paid out</div>
          <div className="value green">{stats ? naira(stats.paid_out_kobo) : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Tasks completed</div>
          <div className="value">{stats ? Number(stats.tasks_completed).toLocaleString() : '—'}</div>
        </div>
      </div>

      <section className="band faq">
        <h2>Questions</h2>
        <p className="band-sub">The things people ask before they join.</p>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section className="cta-band">
        <h2>Ready to start earning?</h2>
        <p>Create your account and choose your plan in minutes.</p>
        <Link href="/login?mode=register" className="btn">
          Create Account <i className="fa-solid fa-arrow-right" style={{ fontSize: 13 }} />
        </Link>
        <p className="helper" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 14 }}>
          Takes under a minute — no KYC.
        </p>
      </section>

      <footer>© 2026 Earnora. All rights reserved.</footer>
    </div>
  );
}
