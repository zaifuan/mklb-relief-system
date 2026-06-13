import SwRegister from './sw-register.jsx';

export const metadata = {
  title: 'Admin Jadual Guru Ganti — SABK Maahad Al-Khair Lil Banat',
  description: 'Admin Jadual Guru Ganti — SABK Maahad Al-Khair Lil Banat',
  applicationName: 'Admin Relief',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Admin Jadual Guru Ganti',
    statusBarStyle: 'default',
  },
};

export const viewport = {
  themeColor: '#0f766e',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ms">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0 }}>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
