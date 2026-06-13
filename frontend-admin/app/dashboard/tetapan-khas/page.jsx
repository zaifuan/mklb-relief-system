'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Tetapan Khas Jadual kini berada DALAM page Jadual Relief.
// Halaman lama ini hanya redirect supaya pautan/bookmark lama tidak rosak.
export default function TetapanKhasRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/relief');
  }, [router]);
  return null;
}
