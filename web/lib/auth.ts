'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, getToken } from './api';

export interface MeResponse {
  user: {
    id: string;
    email: string;
    phone: string | null;
    role: string;
    status: string;
    plan: string | null;
    plan_purchased_at: string | null;
    referral_code: string;
    kyc_tier: number;
    trust_score: number;
    created_at: string;
    last_login_at: string | null;
  };
  wallet: {
    available_kobo: number;
    reserved_kobo: number;
    lifetime_kobo: number;
    task_kobo: number;
    affiliate_kobo: number;
    currency: string;
  } | null;
  stats: {
    direct_referrals: number;
    referral_earned_kobo: string;
    tasks_approved: number;
    tasks_total: number;
    tasks_today: number;
  };
  settings: {
    minWithdrawalKobo: number;
    withdrawalWindow: string;
    timezone: string;
  };
}

/** Guards a page: redirects to /login when unauthenticated, exposes profile + refresher. */
export function useAuth() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<MeResponse>('/me');
      setMe(data);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void load();
  }, [router, load]);

  const logout = useCallback(() => {
    clearSession();
    router.replace('/login');
  }, [router]);

  return { me, loading, error, refresh: load, logout };
}
