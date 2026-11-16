import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '@/components/content/ContentShell';

export const metadata: Metadata = {
  title: 'Referral Programme — Earnora',
  description:
    'Earn ₦200, ₦400 or ₦600 per referral on Earnora — paid instantly from their plan fee at your own plan rate, on direct invites only.',
};

const RATES = [
  ['Beginner', '₦200', '3 tasks / day'],
  ['Intermediate', '₦400', '6 tasks / day'],
  ['Extreme', '₦600', '10 tasks / day'],
];

export default function ReferralProgramPage() {
  return (
    <ContentShell>
      <section className="hero-sec">
        <h1>Referral programme</h1>
        <p className="lead">
          Share your code. When someone joins with it and buys a plan, you are paid instantly — at the rate of{' '}
          <em>your own</em> plan, deducted from their plan fee, credited straight to your wallet as a ledger entry.
        </p>
      </section>

      <section className="band">
        <h2>What you earn</h2>
        <p className="band-sub">
          The rate comes from the plan <strong>you</strong> hold — it is the same flat amount whichever plan the person
          you invited decides to buy.
        </p>
        <div className="table-wrap">
          <table className="ctable">
            <thead>
              <tr>
                <th>Your plan</th>
                <th>Paid per referral who buys a plan</th>
                <th>Your own daily quota</th>
              </tr>
            </thead>
            <tbody>
              {RATES.map((r) => (
                <tr key={r[0]}>
                  <td>{r[0]}</td>
                  <td>{r[1]}</td>
                  <td>{r[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="prose">
          <p>
            No plan on your account means no referral income — the rate is read from your plan at the moment the bonus
            is paid, so upgrading first is what makes sharing worthwhile.
          </p>
        </div>
      </section>

      <section className="band">
        <h2>How it works</h2>
        <div className="prose">
          <ol>
            <li>
              <strong>Copy your link or code</strong> from the <Link href="/login?mode=register">registration form</Link>{' '}
              once your account exists — the Referrals page in your dashboard shows the shareable link and your network.
            </li>
            <li>
              <strong>They register with your code.</strong> It is prefilled automatically when they open a{' '}
              <code>?ref=</code> link, and they can enter it by hand otherwise.
            </li>
            <li>
              <strong>They buy a plan.</strong> The bonus is triggered by a plan purchase — not by registration, not by
              task completion — because that is the payment that funds it.
            </li>
            <li>
              <strong>You are credited instantly.</strong> The transfer happens in the same database transaction as
              their plan assignment: either both land or neither does, and your bonus appears as its own ledger entry
              you can reconcile in your wallet statement.
            </li>
          </ol>
        </div>
      </section>

      <section className="band">
        <h2>A worked example</h2>
        <div className="prose">
          <p>
            Amara is on <strong>Intermediate</strong> and invites five friends in a month. They buy whichever plan they
            like — Beginner, Intermediate or Extreme — because the payout to Amara does not depend on their choice:
          </p>
          <ul>
            <li>
              Five friends buy plans → Amara earns <strong>₦400 × 5 = ₦2,000</strong> (her plan&apos;s rate).
            </li>
            <li>
              Had she stayed on <strong>Beginner</strong>, the same five invites would have paid{' '}
              <strong>₦200 × 5 = ₦1,000</strong>.
            </li>
            <li>
              Had she upgraded to <strong>Extreme</strong> first, they would have paid{' '}
              <strong>₦600 × 5 = ₦3,000</strong>.
            </li>
          </ul>
          <p>
            That is the whole strategy: <strong>upgrade, then invite</strong> — the plan you hold decides what every
            future invite is worth.
          </p>
        </div>
      </section>

      <section className="band">
        <h2>Rules that keep it fair</h2>
        <div className="prose">
          <ul>
            <li>
              <strong>Direct invites only.</strong> The bonus pays to the person who referred the buyer — there is no
              second or third tier, so the numbers above are the whole picture.
            </li>
            <li>
              <strong>One bonus per buyer.</strong> A plan purchase pays the referrer once; a customer who later
              upgrades does not re-trigger it.
            </li>
            <li>
              <strong>Self-referrals and duplicate accounts are rejected.</strong> Device fingerprints, IP ranges and
              proof-of-work checks exist to keep referral farming out — bonuses earned that way are reversed.
            </li>
            <li>
              <strong>Bonuses are withdrawals like any other.</strong> They sit in your wallet and leave through the
              same window described in <Link href="/payouts">Payouts</Link>.
            </li>
          </ul>
        </div>
      </section>

      <section className="band faq">
        <h2>Referral questions</h2>
        <details>
          <summary>When exactly is the bonus paid?</summary>
          <p>
            The moment the referred user&apos;s plan purchase is approved by the owner — not when they register, and not
            when they finish a task.
          </p>
        </details>
        <details>
          <summary>Can I refer myself?</summary>
          <p>
            No. Multiple accounts from the same device or IP range are flagged, and bonuses they produced are reversed
            when the fraud checks catch them.
          </p>
        </details>
        <details>
          <summary>Does an upgrade trigger a second bonus?</summary>
          <p>
            No — one bonus per referred buyer, on their first plan purchase. Future upgrades simply raise what{' '}
            <em>their</em> future invites pay them, not you.
          </p>
        </details>
        <details>
          <summary>What if my friend buys without my code?</summary>
          <p>
            The code has to be present at registration for the link to be attributed. If they registered before you
            shared it, support cannot attach it afterwards.
          </p>
        </details>
      </section>

      <section className="cta-band">
        <h2>Invite friends, get paid on their first plan</h2>
        <p>Open an account, take a plan, and start sharing your link.</p>
        <Link href="/login?mode=register" className="btn">
          Create your account
        </Link>
      </section>
    </ContentShell>
  );
}
