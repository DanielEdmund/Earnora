import type { Metadata } from 'next';
import Link from 'next/link';
import ContentShell from '@/components/content/ContentShell';

export const metadata: Metadata = {
  title: 'Payouts & Withdrawals — Earnora',
  description:
    'How Earnora withdrawals work: ₦15,000 minimum, the daily 17:00–19:00 WAT payout window, bank transfer retries, automatic reversals and ledger statements.',
};

export default function PayoutsPage() {
  return (
    <ContentShell>
      <section className="hero-sec">
        <h1>Payouts &amp; withdrawals</h1>
        <p className="lead">
          Every naira you earn lands in an append-only ledger first, then moves to your bank account inside a controlled
          daily window — reserved instantly, transferred in one batch, and reversed to you if the bank refuses it.
        </p>
      </section>

      <section className="band">
        <h2>The rules at a glance</h2>
        <div className="table-wrap">
          <table className="ctable">
            <tbody>
              <tr>
                <td>Minimum</td>
                <td>₦15,000 per request</td>
              </tr>
              <tr>
                <td>Payout window</td>
                <td>Daily, 17:00 – 19:00 West Africa Time</td>
              </tr>
              <tr>
                <td>Eligibility</td>
                <td>Any active plan (see <Link href="/plans">Plans</Link>) and a valid Nigerian bank account</td>
              </tr>
              <tr>
                <td>When you can request</td>
                <td>Any time — the request is queued and paid in the next window</td>
              </tr>
              <tr>
                <td>Cost</td>
                <td>No platform fee on withdrawals</td>
              </tr>
              <tr>
                <td>KYC</td>
                <td>No documents to sign up; the bank account itself is the identity check</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="band">
        <h2>What happens to your request</h2>
        <div className="prose">
          <ol>
            <li>
              <strong>Reserved instantly.</strong> The amount is moved out of your available balance the moment you
              submit, so a queued request can never be double-spent on tasks or a second withdrawal.
            </li>
            <li>
              <strong>Batched in the 17:00–19:00 window.</strong> A background payout worker picks up reserved
              requests in order and initiates the bank transfer. Requests submitted at 16:59 and 18:59 are both paid
              the same day; anything after the window closes rolls into the next day&apos;s run.
            </li>
            <li>
              <strong>Retried on failure.</strong> A transfer that the bank rejects is attempted again up to the
              configured limit.
            </li>
            <li>
              <strong>Reversed to you if it still fails.</strong> After the final attempt the request is cancelled and
              the money is credited back to your balance with its own ledger entry — it never disappears.
            </li>
            <li>
              <strong>Visible in your statement.</strong> Request, transfer and reversal all appear in the wallet
              statement with timestamps, so the full history of any payment can be traced line by line.
            </li>
          </ol>
          <p>
            Balances are enforced by the database itself: an account can never go negative, which is why a failed
            transfer always ends as a visible reversal rather than a silent discrepancy.
          </p>
        </div>
      </section>

      <section className="band">
        <h2>Getting the transfer right first time</h2>
        <div className="prose">
          <ul>
            <li>
              <strong>Match the bank details.</strong> The name on the account you withdraw to should match the account
              you pay plan fees from; a mismatch is the most common cause of a rejected transfer.
            </li>
            <li>
              <strong>Use a real, active account.</strong> Closed or dormant accounts bounce, costing you a day while
              the request retries and reverses.
            </li>
            <li>
              <strong>Check the window before you count on same-day cash.</strong> Requests after 19:00 WAT are paid
              the next evening.
            </li>
            <li>
              <strong>Watch your wallet.</strong> Reversals show up as their own entry with a memo — the balance returns
              automatically, no support ticket needed.
            </li>
          </ul>
        </div>
      </section>

      <section className="band faq">
        <h2>Payout questions</h2>
        <details>
          <summary>Why is there a ₦15,000 minimum?</summary>
          <p>
            Bank transfers carry a fixed cost per instruction. Batching requests above ₦15,000 keeps the daily window
            small enough to settle every account in one run instead of leaving small balances queued.
          </p>
        </details>
        <details>
          <summary>Can I withdraw without buying a plan?</summary>
          <p>
            No. Withdrawals are a plan feature — the plan is what funds task rewards and referral bonuses in the first
            place. See <Link href="/plans">Plans &amp; pricing</Link>.
          </p>
        </details>
        <details>
          <summary>My transfer failed. Where did my money go?</summary>
          <p>
            Nowhere — after the final retry the request auto-reverses and the amount is credited straight back to your
            available balance with a <code>withdrawal_reversal</code> entry in your statement. Fix the account details
            and request again.
          </p>
        </details>
        <details>
          <summary>How do I prove a payment was made?</summary>
          <p>
            Your wallet statement is the record: it shows the reservation, the settlement and any reversal with
            timestamps. Export or screenshot it if you ever need to show support a specific request.
          </p>
        </details>
        <details>
          <summary>Do you pay outside Nigeria?</summary>
          <p>
            Payouts go to Nigerian bank accounts only. Registration is open to anyone, but the withdrawal rail is a
            local Naira transfer.
          </p>
        </details>
      </section>

      <section className="cta-band">
        <h2>Earn first, cash out daily</h2>
        <p>Open a plan, complete tasks, and request your payout before 19:00 WAT.</p>
        <Link href="/login?mode=register" className="btn">
          Create your account
        </Link>
      </section>
    </ContentShell>
  );
}
