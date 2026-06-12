export const metadata = {
  title: 'Borang Ketidakhadiran Guru',
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
