import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  return <AppShell email={data.user.email ?? ''}>{children}</AppShell>;
}
