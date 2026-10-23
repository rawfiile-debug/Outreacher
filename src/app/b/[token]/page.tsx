import { BriefView, type BriefData } from '@/components/brief/BriefView';
import { BriefConversation } from './BriefConversation';
import { createSupabaseAnonClient } from '@/lib/supabase/server';
import { sha256HexServer } from '@/lib/share-server';
import { validToken } from '@/lib/share';

export const metadata = { title: 'Creative brief', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Shared = BriefData & { comments: { author_name: string; body: string; from_client: boolean; created_at: string }[] };
const imageUrl = (p: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/studio-moodboard/${p.split('/').map(encodeURIComponent).join('/')}`;

// Public brief: the client can read it, look through the moodboard, comment and sign it off.
export default async function SharedBrief({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data: Shared | null = null;
  if (validToken(token)) {
    const { data: d } = await createSupabaseAnonClient().rpc('studio_public_brief', { p_token_hash: sha256HexServer(token) });
    data = (d as Shared | null) ?? null;
  }
  if (!data) {
    return <div className="auth-wrap"><div className="auth-card"><h2>Brief not available</h2><p className="sub">This link is not valid or has been switched off.</p><p className="small">Ask whoever sent it for the latest link.</p></div></div>;
  }
  return (
    <div className="shared-page">
      <BriefView d={data} imageUrl={imageUrl} />
      <BriefConversation token={token} from={data.from} approvedAt={data.approved_at} approvedBy={data.approved_by} comments={data.comments} />
    </div>
  );
}
