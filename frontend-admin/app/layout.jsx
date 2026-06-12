export const metadata = {
  title: 'Panel Admin — Jadual Guru Ganti',
  description: 'SABK Maahad Al-Khair Lil Banat',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ms">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
