// Shared by the browser and the server.

export const STAGES = ['To contact', 'Emailed', 'Followed up', 'Replied', 'Meeting', 'Won', 'Not now'] as const;
export type Stage = (typeof STAGES)[number];
export const CATEGORIES = ['Agency', 'Brand', 'Hospitality', 'Events', 'Media', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const STAGE_CLASS: Record<string, string> = {
  'To contact': 'draft', Emailed: 'sent', 'Followed up': 'warn', Replied: 'ok', Meeting: 'ok', Won: 'paid', 'Not now': 'draft',
};

export type Contact = {
  id: string; name: string; company: string; role: string; email: string; phone: string; instagram: string; website: string;
  category: Category; stage: Stage; first_emailed_on: string | null; followed_up_on: string | null; replied_on: string | null;
  remind_on: string | null; notes: string; notion_page_id: string | null; created_at: string; updated_at: string;
  follow_up_on?: string | null; follow_up_due?: boolean; reminder_due?: boolean;
};

export type CrewMember = { name: string; role: string; phone: string; email?: string; call?: string };
export type ScheduleItem = { time: string; item: string; notes?: string };

export type CallSheet = {
  id: string; brief_id: string | null; title: string; client_name: string; shoot_date: string | null; call_time: string | null; wrap_time: string | null;
  location_name: string; address: string; map_url: string; parking: string; transport: string; nearest_hospital: string; weather: string;
  crew: CrewMember[]; schedule: ScheduleItem[]; kit: string; wardrobe: string; notes: string; private_notes: string;
  shared_at: string | null; share_token_hash?: string | null; created_at: string; updated_at: string;
};

export type Brief = {
  id: string; title: string; client_name: string; client_email: string; shoot_date: string | null; deadline: string | null;
  objective: string; audience: string; deliverables: string; mood: string; palette: string[]; styling: string; locations: string;
  references_text: string; dos: string; donts: string; private_notes: string; approved_at: string | null; approved_by: string;
  shared_at: string | null; share_token_hash?: string | null; created_at: string; updated_at: string;
};
export type BriefItem = { id: string; brief_id: string; kind: 'image' | 'link' | 'note'; storage_path: string | null; url: string; caption: string; position: number; created_at: string };
export type BriefComment = { id: number; brief_id: string; author_name: string; body: string; from_client: boolean; created_at: string };
