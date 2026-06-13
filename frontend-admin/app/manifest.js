// Next.js App Router metadata route → dihidang sebagai /manifest.webmanifest
// dan <link rel="manifest"> disuntik automatik ke <head>.
export default function manifest() {
  return {
    name: 'Admin Jadual Guru Ganti',
    short_name: 'Admin Relief',
    description: 'SABK Maahad Al-Khair Lil Banat',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f766e',
    lang: 'ms',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
