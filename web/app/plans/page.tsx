import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '@/components/content/ContentShell';

export const metadata: Metadata = {
  title: 'Plans & Pricing — Earnora',
  description:
    'Compare Earnora plans: Beginner ₦3,000, Intermediate ₦6,500 and Extreme ₦10,500 — one-time payment, no expiry, daily task quotas and referral rates explained.',
};

const PLANS = [
  ['Beginner', '₦3,000', '3 tasks / day', '₦200', '₦200'],
  ['Intermediate', '₦6,500', '6 tasks / day', '₦300', '₦400'],
  ['Extreme', '₦10,500', '10 tasks / day', '₦400', '₦600'],
];

export default function PlansPage() {
  return (
    <ContentShell>
      <section className="hero-sec">
        <h1>Plans &amp; pricing</h1>
        <p className="lead">
          One payment, no expiry, no monthly fee. Your plan sets how many tasks you can claim each day, what each
          approved task pays you, and what you earn when someone you refer buys a plan.
        </p>
      </section>

      <section className="band">
        <h2>The three plans</h2>
        <p className="band-sub">Prices are one-time and in Nigerian naira.</p>
        <div className="table-wrap">
          <table className="ctable">
            <thead>
              <tr>
                <th>Plan</th>
                <th>One-time price</th>
                <th>Daily task quota</th>
                <th>Paid per approved task</th>
                <th>Paid per referral who joins</th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map((p) => (
                <tr key={p[0]}>
                  <td>{p[0]}</td>
                  <td>{p[1]}</td>
                  <td>{p[2]}</td>
                  <td>{p[3]}</td>
                  <td>{p[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="prose">
          <p>
            The daily quota resets at midnight (Africa/Lagos). Unused tasks do not roll over — they simply refresh the
            next day, so a plan bought at any hour is worth the same.
          </p>
        </div>
      </section>

      <section className="band">
        <h2>What a plan unlocks</h2>
        <div className="prose">
          <ul>
            <li>
              <strong>The task feed.</strong> Without a plan the feed stays locked — it is how the platform keeps
              bot farms and throwaway accounts out of advertiser campaigns.
            </li>
            <li>
              <strong>Withdrawals.</strong> You can request a payout once you own a plan (minimum ₦15,000 — see{' '}
              <Link href="/payouts">Payouts</Link>).
            </li>
            <li>
              <strong>Referral income.</strong> Referral bonuses are paid at <em>your</em> plan&apos;s rate, so an
              upgrade raises the value of every future invite. Details on the{' '}
              <Link href="/referral-program">referral programme</Link> page.
            </li>
            <li>
              <strong>The plan rate on tasks.</strong> Approved tasks pay your plan rate — not the figure listed on
              the task — and advertiser budgets always cover the highest plan payout.
            </li>
          </ul>
        </div>
      </section>

      <section className="band">
        <h2>How you pay</h2>
        <div className="prose">
          <p>
            Checkout is a <strong>manual bank transfer</strong>, recorded against your account as soon as you send it.
            Nothing is credited automatically: the owner confirms the money actually landed, then releases the payment
            from the admin console, and only then is your plan assigned and any referral bonus funded.
          </p>
          <ul>
            <li>Open your dashboard → <strong>Plans</strong> → pick a plan → copy the account details.</li>
            <li>Transfer the exact amount and submit the reference.</li>
            <li>Approval normally follows shortly after verification; your plan is active the moment it is released.</li>
            <li>
              Your plan fee buys platform access only — it is <strong>not</strong> added to your wallet balance and is
              never treated as earnings.
            </li>
          </ul>
          <p>
            An account holds <strong>one plan at a time</strong>; buying a new one replaces the previous terms from
            that point on. Plan fees are non-refundable once approved, in line with the{' '}
            <Link href="/terms">Terms &amp; Policy</Link>.
          </p>
        </div>
      </section>

      <section className="band faq">
        <h2>Plan questions</h2>
        <p className="band-sub">Short answers to the things people ask before paying.</p>
        <details>
          <summary>Is there a subscription or renewal?</summary>
          <p>
            No. Every plan is a single one-time payment with no expiry and no recurring charge — the daily quota keeps
            refreshing at midnight for as long as the account is in good standing.
          </p>
        </details>
        <details>
          <summary>Which plan should a beginner take?</summary>
          <p>
            Beginner (₦3,000) is the lowest-risk way to learn the task flow and the payout cycle. If you already know
            you will refer people, Intermediate and Extreme pay more per invite as well as more per task.
          </p>
        </details>
        <details>
          <summary>What if I miss a day?</summary>
          <p>
            Nothing is lost but the day&apos;s quota: tasks refresh daily at midnight Africa/Lagos and never carry over.
          </p>
        </details>
        <details>
          <summary>Do I need KYC to buy a plan?</summary>
          <p>
            No documents are required to register or buy a plan. You do need a valid Nigerian bank account to receive a
            withdrawal.
          </p>
        </details>
      </section>

      <section className="cta-band">
        <h2>Pick a plan and start earning</h2>
        <p>Registration is free — the plan is what opens the task feed.</p>
        <Link href="/login?mode=register" className="btn">
          Create your account
        </Link>
      </section>
    </ContentShell>
  );
}
