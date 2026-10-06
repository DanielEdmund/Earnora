'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import CinematicAuth from '@/components/cinematic/CinematicAuth';

/**
 * The cinematic authentication screen. All of the existing auth behaviour
 * (endpoints, validation, token storage, ?ref= prefill) is unchanged — only
 * the presentation moved into CinematicAuth.
 */
function Screen() {
  const params = useSearchParams();
  const ref = params.get('ref');

  return (
    <CinematicAuth
      initialMode={params.get('mode') === 'login' ? 'login' : 'register'}
      initialReferralCode={ref ? ref.toUpperCase() : ''}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
