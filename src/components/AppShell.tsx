'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ToastProvider } from './Toast';

const NAV = [
  { href: '/', label: 'Overview', ico: '▦' },
  { href: '/outreach', label: 'Outreach', ico: '✉' },
  { href: '/call-sheets', label: 'Call sheets', short: 'Call sheets', ico: '☰' },
  { href: '/briefs', label: 'Briefs & moodboards', short: 'Briefs', ico: '◧' },
];
const isActive = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

export function AppShell({ email, frameUrl, children }: { email: string; frameUrl: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }
  return (
    <ToastProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">OUTREACHER<small>BY RAWFIILE</small></div>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={isActive(path, n.href) ? 'active' : ''} aria-current={isActive(path, n.href) ? 'page' : undefined}>{n.label}</Link>
            ))}
          </nav>
          <a className="btn side-new" href={frameUrl} target="_blank" rel="noopener">Open FRAME ↗</a>
          <div className="side-note">
            <strong>SIGNED IN</strong>{email}
            <div><button type="button" onClick={signOut}>Sign out</button></div>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={isActive(path, n.href) ? 'active' : ''}><span aria-hidden>{n.ico}</span>{n.short ?? n.label}</Link>
        ))}
      </nav>
    </ToastProvider>
  );
}

export function PageHeader({ crumb, title, sub, actions }: { crumb: string; title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="topbar">
      <div>
        <div className="eyebrow">{crumb}</div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="top-actions">{actions}</div> : null}
    </div>
  );
}
