import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '@/components/content/ContentShell';

export const metadata: Metadata = {
  title: 'Help Centre — Earnora',
  description:
    'Earnora help centre: registering, choosing a plan, completing daily tasks, proof rules, withdrawal windows, referral bonuses and how to reach support.',
};

export default function HelpPage() {
  return (
    <ContentShell>
      <section className="hero-sec">
        <h1>Help centre</h1>
        <p className="lead">
          How the platform works, from creating an account to money arriving in your bank — and what to check when
          something does not behave the way you expected.
        </p>
      </section>

      <section className="band">
        <h2>Getting started</h2>
        <div className="prose">
          <h3>1. Create the account</h3>
          <p>
            Registration needs an email and a phone number and takes under a minute — there are no documents to upload.
            If you opened a friend&apos;s <code>?ref=</code> link, their code is prefilled for you; check it before
            submitting, because a code cannot be attached afterwards.
          </p>
          <h3>2. Choose a plan</h3>
          <p>
            Plans gate the task feed and withdrawals. You pay once by bank transfer from{' '}
            <Link href="/plans">₦3,000 for Beginner</Link>, submit the reference, and the payment is released after the
            owner confirms the transfer. Until it is released nothing is credited — including referral bonuses.
          </p>
          <h3>3. Work the daily quota</h3>
          <p>
            Open <strong>Tasks</strong>, claim what fits your plan&apos;s quota, complete the proof form before the
            claim expires, and get paid at your plan rate once it validates. Quotas refresh at midnight Africa/Lagos.
          </p>
          <h3>4. Cash out</h3>
          <p>
            Once your balance reaches <strong>₦15,000</strong>, request a withdrawal any time — it is paid in the daily
            17:00–19:00 WAT window. Full detail lives on the <Link href="/payouts">Payouts</Link> page.
          </p>
        </div>
      </section>

      <section className="band">
        <h2>Why a task did not pay</h2>
        <div className="prose">
          <ul>
            <li>
              <strong>The claim expired.</strong> A claim stays open for a limited time; submit the proof before it
              lapses or claim the task again.
            </li>
            <li>
              <strong>You were still inside the minimum read time.</strong> Tasks enforce a short dwell time so answers
              are read rather than skipped — stay on the page before submitting.
            </li>
            <li>
              <strong>The proof looked like a duplicate.</strong> Proof submissions are hashed and compared with the
              ones already received; identical or near-identical proofs are rejected.
            </li>
            <li>
              <strong>The advertiser or reviewer rejected it.</strong> Rejections come with a reason shown on the task,
              so you can see what was wrong instead of guessing.
            </li>
            <li>
              <strong>You had already claimed today.</strong> Your plan sets a daily quota (3, 6 or 10 tasks) and it
              resets at midnight.
            </li>
          </ul>
          <p>
            The claim itself requires a proof-of-work check solved in your browser. It is intentional: it is what stops
            scripts from emptying a campaign before real people get to it.
          </p>
        </div>
      </section>

      <section className="band">
        <h2>Account &amp; security</h2>
        <div className="prose">
          <ul>
            <li>
              <strong>Password reset</strong> runs by email — make sure SMTP is configured for your account&apos;s
              domain, otherwise ask support to trigger it manually.
            </li>
            <li>
              <strong>Sessions refresh silently.</strong> You are signed out only when the refresh token itself expires;
              returning to <Link href="/login">the login screen</Link> and signing in again restores everything.
            </li>
            <li>
              <strong>Fraud checks protect your balance too.</strong> Device fingerprints, IP range flags and duplicate
              proofs keep farm accounts out of the campaigns you earn from — and keep the payout pool solvent.
            </li>
            <li>
              <strong>We never ask for your password.</strong> Support answers inside your chat thread or the admin
              inbox; nobody will ever request your login by email or DM.
            </li>
          </ul>
        </div>
      </section>

      <section className="band faq">
        <h2>Common questions</h2>
        <details>
          <summary>Where do I see my full earning history?</summary>
          <p>
            The <strong>Wallet</strong> page is a statement: every reward, referral bonus, reservation, settlement and
            reversal with timestamps and running balances. It is the record to keep for any dispute.
          </p>
        </details>
        <details>
          <summary>Can I change my plan later?</summary>
          <p>
            An account holds one plan at a time; buying a new one replaces the old terms from that moment on. Compare
            them first on the <Link href="/plans">Plans</Link> page.
          </p>
        </details>
        <details>
          <summary>How do referral bonuses show up?</summary>
          <p>
            As their own ledger entry the moment your invitee&apos;s plan purchase is approved — at your plan&apos;s
            rate. See the <Link href="/referral-program">referral programme</Link>.
          </p>
        </details>
        <details>
          <summary>Something failed — how do I reach a human?</summary>
          <p>
            Open the floating chat at the bottom of any app screen. The bot answers the quick questions instantly and
            escalates anything it cannot solve; the owner replies from the admin inbox and the answer drops back into
            your thread (about ten messages per hour per account while it is open).
          </p>
        </details>
        <details>
          <summary>Is my money safe if a transfer fails?</summary>
          <p>
            Yes. Amounts are reserved before a transfer is attempted, retried, and then auto-reversed to your balance
            with a ledger entry if the bank still refuses it. Balances cannot go negative — the database enforces it.
          </p>
        </details>
      </section>

      <section className="cta-band">
        <h2>Still stuck?</h2>
        <p>Open the chat in your dashboard — a human answers there.</p>
        <Link href="/login" className="btn">
          Sign in to your account
        </Link>
      </section>
    </ContentShell>
  );
}
