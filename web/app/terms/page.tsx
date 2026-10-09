import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms & Policy — Earnora',
  description:
    'The terms and policy governing your use of Earnora, including plan purchases, task rewards, withdrawals and our no-guarantee-of-payment rules.',
};

/**
 * Public Terms & Policy page (pre-login, linked from the register form's
 * consent checkbox). Server component — pure content, no interactivity beyond
 * the back link. Keep the "payment is not guaranteed" language in sync with
 * the consent checkbox wording in components/cinematic/AuthPanel.tsx.
 */

const h2: React.CSSProperties = {
  fontFamily: 'var(--font-heading)',
  fontSize: 19,
  margin: '28px 0 10px',
  color: 'var(--c-navy)',
};

const p: React.CSSProperties = {
  margin: '0 0 12px',
  lineHeight: 1.75,
  color: '#334155',
};

const li: React.CSSProperties = { lineHeight: 1.7, color: '#334155', marginBottom: 6 };

const section = (id: string, title: string, body: React.ReactNode) => (
  <section key={id} id={id}>
    <h2 style={h2}>{title}</h2>
    {body}
  </section>
);

export default function TermsPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--c-bg)' }}>
      {/* top bar */}
      <header
        style={{
          background: 'var(--gradient-primary)',
          color: '#fff',
          padding: '22px 20px',
          boxShadow: '0 4px 16px rgba(29,63,214,0.18)',
        }}
      >
        <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <a
            href="/login"
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 800,
              border: '1px solid rgba(255,255,255,0.45)',
              borderRadius: 999,
              padding: '7px 14px',
              fontSize: 13,
              whiteSpace: 'nowrap',
            }}
          >
            ← Back to Earnora
          </a>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, lineHeight: 1.2 }}>
              Terms &amp; Policy
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.85 }}>Last updated: 9 October 2026</div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '28px 20px 72px' }}>
        <div
          style={{
            background: 'var(--c-white)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--c-card-shadow)',
            padding: '30px clamp(18px, 4vw, 42px) 40px',
          }}
        >
          {/* ── headline callout ───────────────────────────────────────── */}
          <div
            style={{
              background: '#fef3c7',
              border: '1px solid #fcd34d',
              borderRadius: 'var(--radius-md)',
              padding: '16px 18px',
              marginBottom: 24,
            }}
          >
            <b style={{ color: '#92400e' }}>Important — payment is not guaranteed.</b>{' '}
            <span style={{ color: '#78350f', lineHeight: 1.7 }}>
              Everything you pay in, earn and withdraw on Earnora is <b>discretionary and conditional</b>. Buying a
              plan does not guarantee that you will earn anything, that any task reward will be approved, or that any
              withdrawal will be paid. Read the full details below before you register, deposit or complete any task.
            </span>
          </div>

          <p style={p}>
            Welcome to Earnora (’the Platform’, ’we’, ’us’ or ’our’), a micro-task, gig and affiliate platform
            accessible at earnora and its official domains. These Terms &amp; Policy (’the Terms’) form a binding
            agreement between you (’the User’, ’you’) and Earnora. They govern your access to and use of our website,
            applications, task feed, plan purchases, referral programme, wallet, withdrawal system and any other
            feature we publish (collectively, ’the Service’).
          </p>
          <p style={p}>
            By creating an account, ticking the consent box on the registration screen, or otherwise using the
            Service, you confirm that you have <b>read, understood and agreed</b> to be bound by these Terms in full.
            If you do not agree with any part of these Terms, you must not tick the consent box and must not create
            an account or use the Service — doing so is not permitted.
          </p>

          {section(
            'eligibility',
            '1. Eligibility & Account Registration',
            <>
              <p style={p}>
                You must be at least 18 years old and capable of entering into a legally binding agreement in your
                jurisdiction to use Earnora. By registering you represent that this is true.
              </p>
              <ul style={{ ...p, paddingLeft: 22, margin: '0 0 12px' }}>
                <li style={li}>
                  <b>Consent.</b> Registration requires an explicit consent choice on the Terms &amp; Policy checkbox.
                  If you agree, you tick the box; if you do not agree, you leave it unticked and registration is
                  refused. Your consent decision and its timestamp are recorded as proof of acceptance.
                </li>
                <li style={li}>
                  <b>One account per person.</b> Automated and manual controls detect duplicate accounts sharing
                  devices, fingerprints or network ranges. Multiple accounts may be refused, merged, suspended or
                  banned, and any balances or rewards obtained through them may be voided.
                </li>
                <li style={li}>
                  <b>Accurate information.</b> You must provide a valid email address and keep it current. You are
                  responsible for all activity that occurs under your account and for keeping your password secret.
                </li>
                <li style={li}>
                  <b>Credentials.</b> We never ask for your password outside the login and reset screens. If you
                  believe your account has been compromised, contact us immediately.
                </li>
              </ul>
            </>
          )}

          {section(
            'plans',
            '2. Plan Purchases, Deposits & Payments — payment is not guaranteed',
            <>
              <p style={p}>
                Access to the task feed and to withdrawals is gated behind a paid plan (Beginner, Intermediate or
                Extreme). The prices, daily task quotas and per-task rates are published in the app and may change
                at any time for future purchases.
              </p>
              <p style={p}>
                <b>Payment is not guaranteed — in either direction.</b> Specifically:
              </p>
              <ul style={{ ...p, paddingLeft: 22, margin: '0 0 12px' }}>
                <li style={li}>
                  A deposit or transfer to the account shown in the app <b>does not automatically buy anything</b>.
                  Your payment must be located, matched and manually verified by an administrator before any plan is
                  assigned to your account.
                </li>
                <li style={li}>
                  We make no promise that a plan will be activated within any particular time (or at all) until the
                  funds are verified as received and cleared.
                </li>
                <li style={li}>
                  Where a payment cannot be matched to your account, appears fraudulent, is reversed, was sent in the
                  wrong amount, or was made from a source we reasonably suspect, we may withhold activation, suspend
                  the account, or reverse any access that was granted — <b>payment does not guarantee service</b>.
                </li>
                <li style={li}>
                  Prices quoted in the app are the only valid prices. Beware of third parties claiming to sell you a
                  plan; we are not responsible for money sent anywhere other than the account displayed inside the
                  official app.
                </li>
                <li style={li}>
                  Except where the law requires otherwise, amounts you pay are non-refundable once a plan has been
                  activated, and no refund is promised for an unactivated payment until the transfer can be verified
                  or returned.
                </li>
              </ul>
              <p style={p}>
                Buying a plan is a purchase of <b>access</b> — access to the task feed, to the daily quota and to the
                withdrawal queue. It is not an investment, deposit, savings product or promise of returns.
              </p>
            </>
          )}

          {section(
            'tasks',
            '3. Tasks, Rewards & Verification',
            <>
              <p style={p}>
                Tasks may be shown to every plan or scoped to a single plan. Only tasks published for your plan
                (or universal tasks) will appear in your feed, and only those can be claimed.
              </p>
              <ul style={{ ...p, paddingLeft: 22, margin: '0 0 12px' }}>
                <li style={li}>
                  <b>Reward amount.</b> You are paid the rate of <b>your own plan</b> per approved task, not the
                  figure printed on the task card. Daily quotas reset at midnight (Africa/Lagos).
                </li>
                <li style={li}>
                  <b>Proof.</b> You may be required to submit screenshots, written answers or other evidence within a
                  time limit. Duplicate, stolen, edited or recycled proofs are rejected and may raise a fraud flag.
                </li>
                <li style={li}>
                  <b>Review.</b> Submissions may be auto-validated, manually reviewed, approved, rejected or escalated
                  at our sole discretion. A rejection means no reward for that claim.
                </li>
                <li style={li}>
                  <b>Task budgets.</b> Tasks carry a budget and a quota; when either is exhausted the task may close
                  even if claims are still pending. Closing or deleting a task does not cancel rewards that have
                  already been approved, and does not guarantee that pending work will be paid.
                </li>
                <li style={li}>
                  <b>Rewards are not guaranteed.</b> No task, quota or feed guarantees that a reward will be issued,
                  that a claim will be approved, or that funds will appear in your balance.
                </li>
              </ul>
            </>
          )}

          {section(
            'earnings',
            '4. No Guarantee of Earnings',
            <>
              <p style={p}>
                <b>We do not guarantee payment of any kind.</b> Task rewards, referral bonuses, plan benefits,
                balances, projections, examples or statements made by us or by other users are{' '}
                <b>not a promise of income</b>. Figures shown in the app reflect what <i>could</i> be earned if tasks
                are available, claimed, completed correctly and approved — none of which is guaranteed.
              </p>
              <p style={p}>
                Earnings depend on task availability, quota limits, your plan, your daily limits, review outcomes,
                platform budgets and these Terms. You may earn nothing at all. Never spend money you cannot afford to
                lose based on expected Earnora earnings, and never treat Earnora as a substitute for employment.
              </p>
            </>
          )}

          {section(
            'withdrawals',
            '5. Withdrawals & Payout Windows',
            <>
              <p style={p}>
                Withdrawals open only inside the advertised daily window (default 17:00–19:00 Africa/Lagos), require
                an active plan, and are subject to a minimum amount (default ₦15,000) and a per-window limit.
              </p>
              <ul style={{ ...p, paddingLeft: 22, margin: '0 0 12px' }}>
                <li style={li}>
                  <b>Payment is not guaranteed.</b> A withdrawal you request is only an instruction; it becomes a
                  payment after it passes fraud checks, balance verification and admin review. We may delay, reduce,
                  refuse or reverse a withdrawal where these Terms are breached or where we reasonably suspect fraud
                  or abuse.
                </li>
                <li style={li}>
                  Payouts are batched and sent to the bank account details you provide. You are responsible for the
                  accuracy of those details; funds sent to details you entered incorrectly may be unrecoverable.
                </li>
                <li style={li}>
                  Failed transfers are retried a limited number of times and may be reversed back to your balance,
                  with the reversal recorded in your ledger.
                </li>
                <li style={li}>
                  Suspicious activity, chargebacks, multi-accounting or a pending investigation may freeze
                  withdrawals for as long as reasonably required.
                </li>
              </ul>
            </>
          )}

          {section(
            'referrals',
            '6. Referral Programme',
            <>
              <p style={p}>
                You may invite others with your personal referral code. A flat referral bonus is credited to you when
                a referred user buys a plan and that purchase is approved — at <b>your plan’s rate</b>, and only if
                you hold an active plan yourself. Self-referrals, fake sign-ups, incentivised spam and misrepresentation
                of the programme are prohibited. Referral bonuses, like every other payment on the platform, are not
                guaranteed and may be reversed where the qualifying purchase is later refunded, reversed or found to
                be fraudulent.
              </p>
            </>
          )}

          {section(
            'acceptable-use',
            '7. Acceptable Use & Fraud Prevention',
            <p style={p}>
              You agree not to abuse the Service. Without limitation, you must not: create or operate multiple
              accounts; use emulators, scripts, bots, macros, autofillers or modified clients; bypass the proof-of-work
              challenge, rate limits or any other guardrail; submit false proof; tamper with ledgers or requests;
              probe, scan or reverse-engineer the platform; scrape content; harass staff or other users; introduce
              malware; use Earnora for money laundering, fraud or any unlawful purpose; or assist anyone in doing so.
              We use device fingerprints, IP analysis, velocity checks, proof-of-work challenges, dwell-time checks
              and manual review to enforce these rules. Detected abuse may result in refused payments, voided
              rewards, banned devices, banned accounts and reporting to relevant authorities.
            </p>
          )}

          {section(
            'enforcement',
            '8. Enforcement, Suspension & Termination',
            <p style={p}>
              We may suspend, restrict or terminate any account at any time, with or without notice, for any breach
              of these Terms, suspected fraud, or where we reasonably believe continuation of the account is harmful
              to the Platform or its users. On termination your right to use the Service ends immediately; pending
              rewards and payments may be withheld where the termination is for breach or fraud. You may close your
              account at any time by contacting us. Sections that by their nature should survive (including payment
              disclaimers, liability limits and dispute terms) survive termination. We may also discontinue the
              Platform, or any feature, at any time — we do not guarantee the Service will continue for any period.
            </p>
          )}

          {section(
            'content',
            '9. Intellectual Property & User Content',
            <>
              <p style={p}>
                The Platform — including its source, branding, design, text, graphics and software — belongs to
                Earnora and is protected by intellectual-property law. We grant you a limited, revocable,
                non-exclusive licence to use the Service as intended, for as long as your account is in good
                standing. Task content and advertiser materials may carry their own licence terms.
              </p>
              <p style={p}>
                You retain ownership of content you submit (proofs, answers, profile details) but grant us a
                worldwide, royalty-free licence to store, process, review and display it as needed to operate,
                moderate and secure the Service.
              </p>
            </>
          )}

          {section(
            'privacy',
            '10. Privacy & Data',
            <p style={p}>
              We collect and process account data, device and network identifiers, activity and transaction records
              in order to run the Platform, prevent fraud and meet legal obligations. Wallet and ledger records are
              kept for financial integrity. By registering you consent to this processing. We do not sell your
              personal data. Where third-party processors (hosting, e-mail, payment partners) are used, they receive
              only what they need to provide their service to us. You may request access to or correction of your
              personal data by contacting us.
            </p>
          )}

          {section(
            'liability',
            '11. Disclaimers & Limitation of Liability',
            <>
              <p style={p}>
                <b>The Service is provided ’as is’ and ’as available’.</b> To the fullest extent permitted by law we
                disclaim all warranties, express or implied, including merchantability, fitness for a particular
                purpose and non-infringement. We do not warrant that the Platform will be uninterrupted, secure or
                error-free, or that tasks, rewards or withdrawals will be available.
              </p>
              <p style={p}>
                <b>Payment is not guaranteed.</b> We do not guarantee that any amount you pay in, earn, hold in your
                balance or request for withdrawal will be paid out. Balances shown in the app are records subject to
                verification, correction, reversal and the rules of these Terms.
              </p>
              <p style={p}>
                To the fullest extent permitted by law, Earnora — and its officers, employees and partners — shall not
                be liable for any indirect, incidental, special, consequential or punitive damages, or for lost
                profits, goodwill or data, arising from your use of (or inability to use) the Service, even if advised
                of the possibility. Our total aggregate liability arising out of or relating to the Service shall not
                exceed the greater of the amount you paid to us in the three (3) months before the claim arose or
                ₦10,000. Nothing in these Terms excludes liability that cannot be excluded by law.
              </p>
            </>
          )}

          {section(
            'indemnity',
            '12. Indemnity',
            <p style={p}>
              You agree to indemnify and hold harmless Earnora and its officers, employees and partners from and
              against any claims, damages, losses, liabilities and costs (including reasonable legal fees) arising
              from your misuse of the Service, your violation of these Terms, or your violation of any right of a
              third party.
            </p>
          )}

          {section(
            'changes',
            '13. Changes to these Terms',
            <p style={p}>
              We may update these Terms from time to time. The ’Last updated’ date at the top shows when the current
              version took effect. Material changes will be highlighted in the app or announced through your account
              e-mail. Continued use of the Service after changes take effect constitutes acceptance of the revised
              Terms; if you do not accept them, you must stop using the Service and may request account closure.
              Where we introduce a new consent control (such as the registration checkbox), accounts created before
              it may still be asked to re-consent before certain actions.
            </p>
          )}

          {section(
            'law',
            '14. Governing Law & Disputes',
            <p style={p}>
              These Terms are governed by the laws of the Federal Republic of Nigeria, without regard to conflict-of-
              law rules. Any dispute arising from these Terms or the Service shall first be attempted to be resolved
              informally by contacting us; if unresolved within 30 days, the dispute may be submitted to the courts of
              competent jurisdiction in Lagos State, Nigeria. If any provision of these Terms is found unenforceable,
              the remaining provisions continue in full force, and the unenforceable provision is applied to the
              maximum extent permitted.
            </p>
          )}

          {section(
            'contact',
            '15. Contact',
            <p style={p}>
              Questions about these Terms, your consent record, or your account can be sent through the in-app
              support chat (bottom-right of any signed-in page) or to the e-mail address published on the Platform.
              We aim to respond within two business days.
            </p>
          )}

          <div
            style={{
              marginTop: 34,
              paddingTop: 18,
              borderTop: '1px solid var(--c-border)',
              fontSize: 13,
              color: 'var(--c-muted)',
              lineHeight: 1.7,
            }}
          >
            By ticking <b>I agree</b> on the registration screen you acknowledge that you have read this Terms &amp;
            Policy in full, that <b>payment is not guaranteed</b>, and that you consent to be bound by it. If you do
            not agree, do not create an account.
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 22, fontSize: 14 }}>
          <a href="/login" style={{ color: 'var(--c-vivid)', fontWeight: 700 }}>
            ← Back to sign up / log in
          </a>
        </div>
      </main>
    </div>
  );
}
