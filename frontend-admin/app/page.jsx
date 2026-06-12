import { redirect } from 'next/navigation';

// Root → dashboard. Middleware akan halakan ke /login jika belum log masuk.
export default function Page() {
  redirect('/dashboard');
}
