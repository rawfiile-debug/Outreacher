-- OUTREACHER: Gigs. Every hourly run (8am to 8pm) scans job boards and public posts for people looking for a
-- photographer or videographer, saves matches here and push-notifies strong ones. Additive, rerunnable.

alter table public.outreach_settings add column if not exists gig_work_types text[] not null default '{fashion,events,portraits,product,content,video}';
alter table public.outreach_settings add column if not exists gig_pay text[] not null default '{paid}';
alter table public.outreach_settings add column if not exists gig_locations text[] not null default '{london}';
alter table public.outreach_settings add column if not exists gig_sources text[] not null default '{job_boards,linkedin,reddit,x,facebook,instagram}';
alter table public.outreach_settings add column if not exists gig_min_budget integer not null default 0 check (gig_min_budget between 0 and 100000);
alter table public.outreach_settings add column if not exists gig_alert_fit smallint not null default 7 check (gig_alert_fit between 0 and 10);
alter table public.outreach_settings add column if not exists gigs_enabled boolean not null default true;
alter table public.outreach_settings add column if not exists gigs_checked_at timestamptz;

create table if not exists public.outreach_gigs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  source text not null default '' check (length(source) <= 100),
  url text not null check (url ~* '^https?://' and length(url) <= 1000),
  poster text not null default '' check (length(poster) <= 200),
  posted_at date,
  location text not null default '' check (length(location) <= 200),
  work_type text not null default '' check (length(work_type) <= 40),
  pay text not null default '' check (length(pay) <= 200),
  needed text not null default '' check (length(needed) <= 2000),
  how_to_apply text not null default '' check (length(how_to_apply) <= 500),
  fit_score smallint check (fit_score is null or fit_score between 0 and 10),
  fit_reason text not null default '' check (length(fit_reason) <= 1000),
  reply text not null default '' check (length(reply) <= 3000),
  status text not null default 'new' check (status in ('new','replied','booked','dismissed')),
  alerted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, url)
);
create index if not exists outreach_gigs_list_idx on public.outreach_gigs(owner_id, status, created_at desc);
drop trigger if exists t_outreach_gigs_touch on public.outreach_gigs;
create trigger t_outreach_gigs_touch before update on public.outreach_gigs for each row execute function public.outreach_touch();

alter table public.outreach_gigs enable row level security;
drop policy if exists own on public.outreach_gigs;
create policy own on public.outreach_gigs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke all on public.outreach_gigs from anon, authenticated;
grant select, update, delete on public.outreach_gigs to authenticated;
