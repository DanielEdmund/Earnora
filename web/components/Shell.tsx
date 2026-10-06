'use client';

import Link from 'next/link';
import { naira } from '@/lib/api';
import ChatWidget from '@/components/ChatWidget';

export interface ShellProps {
  active: 'dashboard' | 'tasks' | 'wallet' | 'referrals' | 'admin';
  /** Ops screens (admin) open up to a wide shell on PC; phones stay full-bleed. */
  wide?: boolean;
  balanceKobo?: number | null;
  email?: string;
  role?: string;
  onLogout: () => void;
  children: React.ReactNode;
}

export default function Shell({ active, wide, balanceKobo, email, role, onLogout, children }: ShellProps) {
  return (
    <div className={wide ? 'shell wide' : 'shell'}>
      {/* Top app bar */}
      <header className="appbar">
        <Link href="/dashboard" className="brand">
          <span className="brand-mark">E</span>
          Earnora
        </Link>
        <div className="appbar-actions">
          <span className="balance">
            <em>Balance</em>
            {naira(balanceKobo ?? 0)}
          </span>
          <button className="icon-btn" onClick={onLogout} title={email ? `Log out (${email})` : 'Log out'}>
            <i className="fa-solid fa-power-off" />
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="page">{children}</main>

      {/* Bottom tab navigation */}
      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          <Link href="/dashboard" className={`tab ${active === 'dashboard' ? 'active' : ''}`}>
            <i className="fa-solid fa-house" />
            Dashboard
          </Link>
          <Link href="/tasks" className={`tab ${active === 'tasks' ? 'active' : ''}`}>
            <i className="fa-solid fa-list-check" />
            Tasks
          </Link>
          <Link href="/wallet" className={`tab ${active === 'wallet' ? 'active' : ''}`}>
            <i className="fa-solid fa-wallet" />
            Wallet
          </Link>
          <Link href="/referrals" className={`tab ${active === 'referrals' ? 'active' : ''}`}>
            <i className="fa-solid fa-user-plus" />
            Referrals
          </Link>
          {role === 'admin' && (
            <Link href="/admin" className={`tab ${active === 'admin' ? 'active' : ''}`}>
              <i className="fa-solid fa-shield-halved" />
              Admin
            </Link>
          )}
        </div>
      </nav>

      {/* Customer chat launcher — app screens only (never the auth flow) */}
      <ChatWidget />
    </div>
  );
}
