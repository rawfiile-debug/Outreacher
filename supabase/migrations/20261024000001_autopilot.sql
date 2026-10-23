-- Outreacher autopilot: finds prospects, writes and sends first emails, sends one follow-up, notices replies and
-- opt-outs. Additive only; depends on 20261023100001_studio.sql.
--
-- * The scheduler runs as the server (service role), one small step every ten minutes, so sending is spread through
--   the working day. Everything a person does in the app still goes through row level security.
-- * The outreach mailbox's Google tokens are stored encrypted, in a table nobody signed in can read.
-- * Opt-outs and bounces go on a suppression list that is checked before every send, forever.

-- Contacts learn where they came from ----------------------------------------------------------------------------------
alter table public.studio_contacts add column if not exists source text not null default 'manual'
  check (source in ('manual','notion','autopilot'));
alter table public.studio_contacts add column if not exists source_url text not null default '' check (length(source_url) <= 1000);
alter table public.studio_contacts add column if not exists domain text not null default '' check (length(domain) <= 253);
alter table public.studio_contacts add column if not exists research text not null default '' check (length(research) <= 2000);
alter table public.studio_contacts add column if not exists fit_score smallint check (fit_score is null or fit_score between 0 and 10);
alter table public.studio_contacts add column if not exists company_number text not null default '' check (length(company_number) <= 16);
create index if not exists studio_contacts_domain_idx on public.studio_contacts(owner_id, domain) where domain <> '';

-- Settings, one row per account ------------------------------------------------------------------------------------------
create table if not exists public.studio_autopilot (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'approve' check (mode in ('approve','auto')),
  daily_new_limit smallint not null default 10 check (daily_new_limit between 1 and 40),
  send_days smallint[] not null default '{1,2,3,4,5}' check (send_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  window_start time not null default '09:30',
  window_end time not null default '16:30',
  follow_up_days smallint not null default 14 check (follow_up_days between 3 and 60),
  min_fit smallint not null default 6 check (min_fit between 0 and 10),
  targets text[] not null default '{"events and nightlife promoters in London","boutique hotels and restaurant groups in London","independent fashion and lifestyle brands in London","creative and social media agencies in London"}'
    check (cardinality(targets) between 1 and 20),
  sender_name text not null default 'Michael Clavier' check (length(sender_name) between 1 and 100),
  portfolio_url text not null default 'https://www.rawfiile.co.uk' check (portfolio_url ~* '^https://'),
  require_companies_house boolean not null default false,
  approve_mode_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_autopilot_window check (window_end > window_start)
);
-- Kept by the scheduler.
alter table public.studio_autopilot add column if not exists inbox_checked_at timestamptz;
alter table public.studio_autopilot add column if not exists last_send_at timestamptz;
alter table public.studio_autopilot add column if not exists last_tick_at timestamptz;
alter table public.studio_autopilot add column if not exists last_error text not null default '';
drop trigger if exists t_studio_autopilot_touch on public.studio_autopilot;
create trigger t_studio_autopilot_touch before update on public.studio_autopilot for each row execute function public.studio_touch();

-- The outreach mailbox (Gmail or Google Workspace). Tokens are encrypted by the app; only the server can read them.
create table if not exists public.studio_mailboxes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  email text not null check (length(email) <= 320),
  refresh_token_enc text not null,
  access_token_enc text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_error text not null default '' check (length(last_error) <= 500)
);
-- What the app may show: which address is connected and since when.
create or replace view public.studio_mailbox_status with (security_invoker = false) as
  select owner_id, email, connected_at, scopes, last_error from public.studio_mailboxes where owner_id = auth.uid();

-- Emails: queued for approval, waiting for their send slot, sent, or stopped ------------------------------------------
create table if not exists public.studio_emails (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null,
  kind text not null check (kind in ('first','follow_up')),
  status text not null default 'pending' check (status in ('pending','approved','sent','failed','skipped','cancelled')),
  to_email text not null check (length(to_email) between 3 and 320),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 5000),
  gmail_message_id text,
  gmail_thread_id text,
  rfc_message_id text,
  approved_at timestamptz,
  sent_at timestamptz,
  error text not null default '' check (length(error) <= 500),
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_emails_contact_same_owner_fkey foreign key (contact_id, owner_id) references public.studio_contacts(id, owner_id) on delete cascade
);
create index if not exists studio_emails_owner_status_idx on public.studio_emails(owner_id, status, created_at);
create index if not exists studio_emails_contact_idx on public.studio_emails(contact_id);
-- At most one first email and one follow-up per contact, ever (unless skipped or cancelled).
create unique index if not exists studio_emails_one_per_kind on public.studio_emails(contact_id, kind) where status not in ('skipped','cancelled');
drop trigger if exists t_studio_emails_touch on public.studio_emails;
create trigger t_studio_emails_touch before update on public.studio_emails for each row execute function public.studio_touch();

-- Never email again: opt-outs, bounces, and anyone added by hand. Matched on the full address or the whole domain.
create table if not exists public.studio_suppressions (
  id bigserial primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  value text not null check (length(value) between 3 and 320 and value = lower(value)),
  kind text not null check (kind in ('email','domain')),
  reason text not null default 'manual' check (reason in ('manual','opt_out','bounce','replied_no')),
  created_at timestamptz not null default now(),
  unique (owner_id, kind, value)
);

-- Where the finder has looked, so it does not repeat itself, and every domain it has judged.
create table if not exists public.studio_search_log (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  query text not null check (length(query) <= 300),
  page smallint not null default 0,
  results smallint not null default 0,
  ran_at timestamptz not null default now()
);
create index if not exists studio_search_log_owner_idx on public.studio_search_log(owner_id, query, page);
create table if not exists public.studio_seen_domains (
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check (length(domain) between 3 and 253),
  outcome text not null check (outcome in ('added','no_email','low_fit','not_business','excluded','error','suppressed','duplicate')),
  note text not null default '' check (length(note) <= 300),
  seen_at timestamptz not null default now(),
  primary key (owner_id, domain)
);

-- Plain-English activity feed for the Autopilot page.
create table if not exists public.studio_activity (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('found','sent','follow_up','replied','opt_out','bounce','skipped','error','info')),
  message text not null check (length(message) <= 500),
  contact_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists studio_activity_owner_idx on public.studio_activity(owner_id, created_at desc);

-- Row level security -------------------------------------------------------------------------------------------------
alter table public.studio_autopilot enable row level security;
alter table public.studio_mailboxes enable row level security;
alter table public.studio_emails enable row level security;
alter table public.studio_suppressions enable row level security;
alter table public.studio_search_log enable row level security;
alter table public.studio_seen_domains enable row level security;
alter table public.studio_activity enable row level security;

drop policy if exists studio_autopilot_owner on public.studio_autopilot;
create policy studio_autopilot_owner on public.studio_autopilot for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists studio_suppressions_owner on public.studio_suppressions;
create policy studio_suppressions_owner on public.studio_suppressions for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists studio_emails_select on public.studio_emails;
create policy studio_emails_select on public.studio_emails for select to authenticated using (owner_id = auth.uid());
drop policy if exists studio_emails_update on public.studio_emails;
create policy studio_emails_update on public.studio_emails for update to authenticated using (owner_id = auth.uid() and status in ('pending','approved'))
  with check (owner_id = auth.uid() and status in ('pending','approved','skipped'));
drop policy if exists studio_activity_select on public.studio_activity;
create policy studio_activity_select on public.studio_activity for select to authenticated using (owner_id = auth.uid());
drop policy if exists studio_seen_select on public.studio_seen_domains;
create policy studio_seen_select on public.studio_seen_domains for select to authenticated using (owner_id = auth.uid());
drop policy if exists studio_search_log_select on public.studio_search_log;
create policy studio_search_log_select on public.studio_search_log for select to authenticated using (owner_id = auth.uid());

revoke all on public.studio_autopilot, public.studio_mailboxes, public.studio_emails, public.studio_suppressions,
  public.studio_search_log, public.studio_seen_domains, public.studio_activity, public.studio_mailbox_status from anon;
-- Supabase grants signed-in users everything on new tables by default. Start from nothing, then grant only what is
-- needed. Mailbox tokens: no access at all for signed-in users; they see studio_mailbox_status instead.
revoke all on public.studio_autopilot, public.studio_mailboxes, public.studio_emails, public.studio_suppressions,
  public.studio_search_log, public.studio_seen_domains, public.studio_activity from authenticated;
grant select on public.studio_mailbox_status to authenticated;
grant select, insert, update on public.studio_autopilot to authenticated;
grant select, insert, delete on public.studio_suppressions to authenticated;
grant usage on sequence public.studio_suppressions_id_seq to authenticated;
-- People can read emails and edit, approve or skip ones not yet sent; sending is the server's job. Only the wording,
-- the status and the approval time can change.
grant select on public.studio_emails to authenticated;
grant update (subject, body, status, approved_at) on public.studio_emails to authenticated;
grant select on public.studio_activity, public.studio_seen_domains, public.studio_search_log to authenticated;

-- Switching the mailbox off (disconnect) from the app.
create or replace function public.studio_disconnect_mailbox()
returns void language sql security definer set search_path = public as $$
  delete from public.studio_mailboxes where owner_id = auth.uid();
$$;
revoke execute on function public.studio_disconnect_mailbox() from public, anon;
grant execute on function public.studio_disconnect_mailbox() to authenticated;

-- Is this address (or its domain) on the do-not-contact list?
create or replace function public.studio_is_suppressed(p_owner uuid, p_email text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.studio_suppressions s where s.owner_id = p_owner and (
    (s.kind = 'email' and s.value = lower(trim(p_email))) or
    (s.kind = 'domain' and s.value = lower(split_part(trim(p_email), '@', 2)))))
$$;
-- Server only: a signed-in user must not be able to probe another account's list.
revoke execute on function public.studio_is_suppressed(uuid, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.studio_is_suppressed(uuid, text) to service_role';
  end if;
end $$;

-- Manual follow-up reminders: two weeks now, and not for contacts the autopilot follows up on its own.
drop view if exists public.studio_contact_list;
create view public.studio_contact_list with (security_invoker = true) as
select c.*,
       case when c.stage = 'Emailed' and c.first_emailed_on is not null and c.source <> 'autopilot' then c.first_emailed_on + 14 end as follow_up_on,
       (c.stage = 'Emailed' and c.first_emailed_on is not null and c.source <> 'autopilot' and c.first_emailed_on + 14 <= public.studio_today()) as follow_up_due,
       (c.remind_on is not null and c.remind_on <= public.studio_today() and c.stage not in ('Won','Not now')) as reminder_due
  from public.studio_contacts c;
grant select on public.studio_contact_list to authenticated;
revoke all on public.studio_contact_list from anon;
