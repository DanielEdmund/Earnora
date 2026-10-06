'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';

/**
 * Customer chat launcher (app screens only — never the cinematic auth flow).
 *
 * The button runs a continuous pop → shake → settle loop (see the
 * `chat-pop-shake` keyframes in globals.css), stops while the panel is open,
 * and switches itself off entirely under prefers-reduced-motion.
 *
 * Conversation is client-side: quick replies plus keyword-matched answers.
 * When the bot has NO answer (or the user asks for a human) the message is
 * escalated to the support inbox (POST /support/messages) — the owner replies
 * from the admin dashboard and the answer is pulled back into this thread
 * (GET /support/messages, on open and every 25s while open). Nothing is ever
 * promised to the user that the inbox cannot deliver.
 * Messages are kept in localStorage so the thread survives navigation.
 */

interface Msg {
  id: number;
  from: 'bot' | 'me';
  text: string;
}

interface SupportThread {
  id: number;
  message: string;
  status: 'open' | 'replied';
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

const STORE_KEY = 'earnora.chat.v1';
const SEEN_KEY = 'earnora.chat.replies'; // support message ids whose reply we already showed

const GREETING: Msg = {
  id: 1,
  from: 'bot',
  text: 'Hi there 👋 Welcome to Earnora support. What can we help you with today?',
};

const QUICK: { label: string; reply: string }[] = [
  {
    label: 'How do I earn?',
    reply:
      'Open the Tasks tab — every task shows its reward before you start, and new ones drop daily. Claims you complete are credited to your wallet as soon as they are approved.',
  },
  {
    label: 'Withdrawals',
    reply:
      'Withdrawals run daily between 5:00 PM and 7:00 PM (Africa/Lagos). Head to Wallet → Withdraw once your balance is at or above the minimum — payouts land in your bank account the same window.',
  },
  {
    label: 'Referrals',
    reply:
      'Your referral code lives in the Referrals tab. You earn a share of what your invites earn across multiple tiers — no cap on how many people you invite.',
  },
  {
    label: 'Activation fee',
    reply:
      'Tasks and withdrawals unlock with a one-time activation fee. The exact amount is shown on the Tasks screen before you commit — there are no monthly charges after that.',
  },
];

const RULES: { test: RegExp; reply?: string; escalate?: boolean }[] = [
  {
    test: /\b(earn|earning|task|tasks|work|income|money|how do i|start)\b/i,
    reply: QUICK[0].reply,
  },
  {
    test: /\b(withdraw|withdrawal|payout|cash ?out|wallet|bank|settle|get paid)\b/i,
    reply: QUICK[1].reply,
  },
  {
    test: /\b(referral|referrals|refer|invite|invites|bonus|team)\b/i,
    reply: QUICK[2].reply,
  },
  {
    test: /\b(activation|activate|upgrade|fee|unlock|price|pricing|pay|payment|charge)\b/i,
    reply: QUICK[3].reply,
  },
  {
    test: /\b(password|login|log in|signin|sign in|reset|otp|code|account|email|blocked)\b/i,
    reply:
      'For password trouble use “Forgot password?” on the login screen — a 6-digit code goes to your email and expires in 10 minutes. If it is not in your inbox, check Spam or Promotions.',
  },
  // wants a real person → escalate instead of answering
  { test: /\b(human|agent|person|real|call|phone|complaint|scam|report|urgent)\b/i, escalate: true },
];

type Answer = { escalate: true } | { escalate: false; reply: string };

/** Escalate on an explicit human request — and on anything with no rule. */
function replyFor(text: string): Answer {
  for (const rule of RULES) {
    if (rule.test.test(text)) {
      return rule.escalate ? { escalate: true } : { escalate: false, reply: rule.reply ?? '' };
    }
  }
  return { escalate: true };
}

const ESCALATED_MSG =
  '✅ Passed it to our support team — a human will reply right here in this chat, usually within a few hours.';

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');

  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(2);

  // `hydrated` stays false through the first effect pass, so the save effect
  // can never write the default [GREETING] over a stored thread before the
  // load effect's state has committed (StrictMode runs effects twice).
  const [hydrated, setHydrated] = useState(false);

  // ── thread persistence ─────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter(
          (m): m is Msg =>
            !!m && typeof m === 'object' && typeof (m as Msg).text === 'string' &&
            ((m as Msg).from === 'bot' || (m as Msg).from === 'me'),
        );
        if (valid.length > 0) {
          setMsgs(valid);
          nextId.current = valid.reduce((max, m) => Math.max(max, m.id), 1) + 1;
        }
      }
    } catch {
      /* storage blocked — the in-memory thread still works */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-40)));
    } catch {
      /* ignore quota / private-mode failures */
    }
  }, [msgs, hydrated]);

  // ── open / close behaviour ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    const focus = window.setTimeout(() => inputRef.current?.focus(), 180);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(focus);
    };
  }, [open]);

  // keep the newest message in view
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [msgs, typing, open]);

  // clear any pending reply if the widget unmounts (route change)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ── sending ────────────────────────────────────────────────────
  function push(from: Msg['from'], text: string) {
    setMsgs((prev) => [...prev, { id: nextId.current++, from, text }]);
  }

  function ask(question: string, answer: string) {
    if (typing) return;
    push('me', question);
    setTyping(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTyping(false);
      push('bot', answer);
    }, 850);
  }

  /** No canned answer: hand the message to the support inbox, then say so
   *  truthfully — success and failure are reported exactly as they happened. */
  async function escalate(text: string) {
    push('me', text);
    setTyping(true);
    const started = Date.now();
    try {
      await api('/support/messages', { method: 'POST', body: { message: text } });
      const wait = Math.max(0, 850 - (Date.now() - started));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      setTyping(false);
      push('bot', ESCALATED_MSG);
    } catch (e) {
      setTyping(false);
      const why = e instanceof Error && e.message ? e.message : 'Please try again in a moment.';
      push('bot', `⚠️ I couldn't pass that to our support team — ${why}`);
    }
  }

  function send(text: string) {
    const value = text.trim();
    if (!value || typing) return;
    setDraft('');
    const answer = replyFor(value);
    if (answer.escalate) void escalate(value);
    else ask(value, answer.reply);
  }

  /** Pull admin replies we have not shown on this device yet. Reads the
   *  persisted thread to decide whether the question needs quoting. */
  const pullReplies = useCallback(async () => {
    let rows: SupportThread[];
    try {
      rows = await api<SupportThread[]>('/support/messages');
    } catch {
      return; // offline / signed out — retried on the next open or tick
    }

    let seen: number[] = [];
    let thread: Msg[] = [];
    try {
      const rawSeen = window.localStorage.getItem(SEEN_KEY);
      const parsedSeen: unknown = rawSeen ? JSON.parse(rawSeen) : null;
      if (Array.isArray(parsedSeen)) seen = parsedSeen.filter((n): n is number => typeof n === 'number');
      const rawThread = window.localStorage.getItem(STORE_KEY);
      const parsedThread: unknown = rawThread ? JSON.parse(rawThread) : null;
      if (Array.isArray(parsedThread)) thread = parsedThread as Msg[];
    } catch {
      /* storage blocked — we still show fresh replies, just without dedupe */
    }

    const fresh = rows.filter((r) => r.status === 'replied' && r.reply && !seen.includes(r.id));
    if (fresh.length === 0) return;

    const lastMine = [...thread].reverse().find((m) => m && m.from === 'me');
    const bubbles = fresh.map((r) => {
      const answer = String(r.reply);
      const needsQuote = !lastMine || lastMine.text !== r.message;
      const q = r.message.length > 60 ? `${r.message.slice(0, 60)}…` : r.message;
      return { id: nextId.current++, from: 'bot' as const, text: needsQuote ? `Re “${q}” — ${answer}` : answer };
    });

    seen.push(...fresh.map((r) => r.id));
    try {
      window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-200)));
    } catch {
      /* ignore quota / private-mode failures */
    }
    setMsgs((prev) => [...prev, ...bubbles]);
  }, []);

  // fetch answers when the panel opens, then keep polling while it is visible
  useEffect(() => {
    if (!open || !hydrated) return;
    void pullReplies();
    const t = setInterval(() => {
      if (!document.hidden) void pullReplies();
    }, 25000);
    return () => clearInterval(t);
  }, [open, hydrated, pullReplies]);

  return (
    <div className="chat" ref={rootRef}>
      {open && (
        <div className="chat-panel" id="earnora-chat-panel" role="dialog" aria-label="Customer support chat">
          <div className="chat-head">
            <span className="chat-avatar" aria-hidden="true">
              <i className="fa-solid fa-headset" />
            </span>
            <span className="chat-title">
              <strong>Earnora Support</strong>
              <em>
                <i className="chat-dot" /> Online — usually replies in minutes
              </em>
            </span>
            <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
              <i className="fa-solid fa-xmark" />
            </button>
          </div>

          <div className="chat-body" ref={bodyRef}>
            {msgs.map((m) => (
              <p key={m.id} className={`chat-msg${m.from === 'me' ? ' chat-msg--mine' : ''}`}>
                {m.text}
              </p>
            ))}
            {typing && (
              <div className="chat-typing" role="status" aria-label="Support is typing">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>

          <div className="chat-quick">
            {QUICK.map((q) => (
              <button type="button" key={q.label} onClick={() => ask(q.label, q.reply)} disabled={typing}>
                {q.label}
              </button>
            ))}
          </div>

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              aria-label="Type a message"
              maxLength={400}
            />
            <button type="submit" aria-label="Send message" disabled={!draft.trim()}>
              <i className="fa-solid fa-paper-plane" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className={`chat-launcher${open ? ' is-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="earnora-chat-panel"
        aria-label={open ? 'Close customer chat' : 'Open customer chat'}
        title="Customer chat"
      >
        <span className="chat-ring" aria-hidden="true" />
        <i className="fa-solid fa-comment-dots" aria-hidden="true" />
      </button>
    </div>
  );
}
