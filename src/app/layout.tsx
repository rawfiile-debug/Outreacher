import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/manrope';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'OUTREACHER',
  description: 'Outreach, call sheets and creative briefs for RAWFIILE.',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
  appleWebApp: { capable: true, title: 'OUTREACHER', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0E131C' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
