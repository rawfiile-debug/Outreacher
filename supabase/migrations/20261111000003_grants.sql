-- OUTREACHER: Grants. The hourly task searches for grants matching the preferences below (daily until at least 5
-- open grants are marked eligible, then weekly), judges eligibility from the profile, and drafts application answers
-- when a draft_grant job is queued. Application forms are read in the browser (text stored in form_text).
-- Additive, rerunnable.

alter table public.outreach_settings add column if not exists grant_types text[] not null default '{project,commission,residency,equipment,business,training}';
alter table public.outreach_settings add column if not exists grant_focus text[] not null default '{photography,film,cross_arts,community}';
alter table public.outreach_settings add column if not exists grant_locations text[] not null default '{london,uk}';
alter table public.outreach_settings add column if not exists grant_stages text[] not null default '{emerging,any}';
alter table public.outreach_settings add column if not exists grant_min_amount integer not null default 0 check (grant_min_amount between 0 and 1000000);
alter table public.outreach_settings add column if not exists grants_searched_at timestamptz;

create table if not exists public.outreach_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  funder text not null default '' check (length(funder) <= 200),
  url text not null check (url ~* '^https?://' and length(url) <= 1000),
  grant_type text not null default '' check (length(grant_type) <= 40),
  amount text not null default '' check (length(amount) <= 200),
  amount_max integer check (amount_max is null or amount_max >= 0),
  deadline date,
  deadline_note text not null default '' check (length(deadline_note) <= 200),
  location text not null default '' check (length(location) <= 200),
  what_it_funds text not null default '' check (length(what_it_funds) <= 3000),
  who_can_apply text not null default '' check (length(who_can_apply) <= 3000),
  eligibility text not null default 'check' check (eligibility in ('eligible','check','not_eligible')),
  eligibility_reason text not null default '' check (length(eligibility_reason) <= 2000),
  fit_score smallint check (fit_score is null or fit_score between 0 and 10),
  status text not null default 'new' check (status in ('new','applying','submitted','won','rejected','dismissed')),
  notes text not null default '' check (length(notes) <= 4000),
  form_name text not null default '' check (length(form_name) <= 200),
  form_text text not null default '' check (length(form_text) <= 40000),
  extra_info text not null default '' check (length(extra_info) <= 8000),
  draft text not null default '' check (length(draft) <= 60000),
  drafted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, url)
);
create index if not exists outreach_grants_list_idx on public.outreach_grants(owner_id, status, deadline);
drop trigger if exists t_outreach_grants_touch on public.outreach_grants;
create trigger t_outreach_grants_touch before update on public.outreach_grants for each row execute function public.outreach_touch();

alter table public.outreach_grants enable row level security;
drop policy if exists own on public.outreach_grants;
create policy own on public.outreach_grants for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.outreach_grants from anon, authenticated;
grant select, insert, update, delete on public.outreach_grants to authenticated;

-- Jobs can now point at a grant.
alter table public.outreach_jobs drop constraint if exists outreach_jobs_kind_check;
alter table public.outreach_jobs add constraint outreach_jobs_kind_check check (kind in ('build_profile','draft_grant','find_grants'));
