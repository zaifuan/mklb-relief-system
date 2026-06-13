'use client';

import { useEffect } from 'react';

// Daftar service worker (klien sahaja) untuk membolehkan "Install / Add to Home Screen".
export default function SwRegister() {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
