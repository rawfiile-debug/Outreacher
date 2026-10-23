import { CallSheetView, type CallSheetData } from '@/components/callsheet/CallSheetView';
import { PrintButton } from '@/components/PrintButton';
import { createSupabaseAnonClient } from '@/lib/supabase/server';
import { sha256HexServer } from '@/lib/share-server';
import { validToken } from '@/lib/share';

export const metadata = { title: 'Call sheet', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Public, read-only call sheet. The secret link is the only key; it reveals one call sheet and nothing private.
export default async function SharedCallSheet({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data: CallSheetData | null = null;
  if (validToken(token)) {
    const { data: d } = await createSupabaseAnonClient().rpc('studio_public_call_sheet', { p_token_hash: sha256HexServer(token) });
    data = (d as CallSheetData | null) ?? null;
  }
  if (!data) {
    return <div className="auth-wrap"><div className="auth-card"><h2>Call sheet not available</h2><p className="sub">This link is not valid or has been switched off.</p><p className="small">Ask whoever sent it for the latest link.</p></div></div>;
  }
  return (
    <div className="shared-page">
      <div className="shared-actions no-print"><PrintButton /></div>
      <CallSheetView d={data} />
    </div>
  );
}
