-- OUTREACHER fresh start (Nov 2026): outreach only.
--
-- Removes everything the old version made (call sheets, briefs, moodboards, share links, Notion sync, the old
-- tracker and autopilot tables) and creates a small outreach_* schema. Michael's settings (targets, work to
-- mention, limits) are carried over; contacts, emails and history are wiped on purpose.
--
-- Same Supabase project as FRAME. Nothing here touches FRAME's tables.
-- The work is done by the "Outreacher autopilot" Claude scheduled task (Gmail + Supabase connectors, no API keys).

begin;

-- 1. Helpers --------------------------------------------------------------------------------------------------------
create or replace function public.outreach_touch()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;

-- 2. Settings (copied across from the old version): one row per account -----------------------------------------------------------------------------------
create table if not exists public.outreach_settings (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'approve' check (mode in ('approve','auto')),
  approve_mode_since timestamptz default now(),
  daily_new_limit smallint not null default 5 check (daily_new_limit between 1 and 7),
  follow_up_days smallint not null default 14 check (follow_up_days between 3 and 60),
  min_fit smallint not null default 6 check (min_fit between 0 and 10),
  targets text[] not null default '{"independent fashion and streetwear brands in London","beauty and fragrance brands in London","creative and social agencies in London"}'
    check (cardinality(targets) between 1 and 20),
  work_library text not null default '' check (length(work_library) <= 4000),
  sender_name text not null default 'Michael Clavier' check (length(sender_name) between 1 and 100),
  last_run_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists t_outreach_settings_touch on public.outreach_settings;
create trigger t_outreach_settings_touch before update on public.outreach_settings for each row execute function public.outreach_touch();

do $$ begin
  if to_regclass('public.studio_autopilot') is not null then
    execute $q$insert into public.outreach_settings (owner_id, daily_new_limit, follow_up_days, min_fit, targets, work_library, sender_name)
      select owner_id, daily_new_limit, follow_up_days, min_fit, targets, coalesce(work_library, ''), sender_name
        from public.studio_autopilot on conflict (owner_id) do nothing$q$;
  end if;
end $$;

-- 3. Remove the old version -----------------------------------------------------------------------------------------
drop view if exists public.studio_contact_list;
drop table if exists public.studio_brief_comments, public.studio_brief_items, public.studio_briefs, public.studio_call_sheets,
  public.studio_emails, public.studio_activity, public.studio_seen_domains, public.studio_search_log, public.studio_suppressions,
  public.studio_autopilot, public.studio_contacts cascade;
drop function if exists public.studio_call_sheet_from_brief(uuid), public.studio_contacts_stage(), public.studio_owner_name(uuid),
  public.studio_public_brief(text), public.studio_public_brief_approve(text, text), public.studio_public_brief_comment(text, text, text),
  public.studio_public_call_sheet(text), public.studio_set_share(text, uuid, text), public.studio_today(), public.studio_touch(),
  public.studio_is_suppressed(uuid, text) cascade;
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists studio_moodboard_insert on storage.objects';
    execute 'drop policy if exists studio_moodboard_delete on storage.objects';
    execute 'drop policy if exists studio_moodboard_update on storage.objects';
    execute 'drop policy if exists studio_moodboard_select on storage.objects';
  end if;
end $$;

-- 5. Contacts --------------------------------------------------------------------------------------------------------
create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company text not null default '' check (length(company) <= 200),
  name text not null default '' check (length(name) <= 200),
  email text not null check (length(email) between 3 and 320),
  website text not null default '' check (length(website) <= 500),
  domain text not null default '' check (length(domain) <= 253),
  category text not null default 'Brand' check (category in ('Brand','Agency','Other')),
  stage text not null default 'To contact'
    check (stage in ('To contact','Emailed','Followed up','Replied','Meeting','Won','Not now')),
  source text not null default 'autopilot' check (source in ('autopilot','manual')),
  research text not null default '' check (length(research) <= 2000),
  fit_score smallint check (fit_score is null or fit_score between 0 and 10),
  notes text not null default '' check (length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create unique index if not exists outreach_contacts_email_unique on public.outreach_contacts(owner_id, lower(email));
create index if not exists outreach_contacts_stage_idx on public.outreach_contacts(owner_id, stage);
create index if not exists outreach_contacts_domain_idx on public.outreach_contacts(owner_id, domain) where domain <> '';
drop trigger if exists t_outreach_contacts_touch on public.outreach_contacts;
create trigger t_outreach_contacts_touch before update on public.outreach_contacts for each row execute function public.outreach_touch();

-- 6. Emails: waiting for approval (pending), queued (approved), sent, or stopped ------------------------------------
create table if not exists public.outreach_emails (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null,
  kind text not null check (kind in ('first','follow_up')),
  status text not null default 'pending' check (status in ('pending','approved','sending','sent','failed','skipped','cancelled')),
  to_email text not null check (length(to_email) between 3 and 320),
  subject text not null check (length(subject) between 1 and 200),
  body text not null check (length(body) between 1 and 5000),
  gmail_thread_id text,
  approved_at timestamptz,
  sent_at timestamptz,
  error text not null default '' check (length(error) <= 500),
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (contact_id, owner_id) references public.outreach_contacts(id, owner_id) on delete cascade
);
create index if not exists outreach_emails_status_idx on public.outreach_emails(owner_id, status, created_at);
create unique index if not exists outreach_emails_one_per_kind on public.outreach_emails(contact_id, kind) where status not in ('skipped','cancelled');
drop trigger if exists t_outreach_emails_touch on public.outreach_emails;
create trigger t_outreach_emails_touch before update on public.outreach_emails for each row execute function public.outreach_touch();

-- 7. Do not contact: opt-outs, bounces, and anyone added by hand (an address or a whole domain) ----------------------
create table if not exists public.outreach_suppressions (
  id bigserial primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  value text not null check (length(value) between 3 and 320 and value = lower(value)),
  kind text not null check (kind in ('email','domain')),
  reason text not null default 'manual' check (reason in ('manual','opt_out','bounce')),
  created_at timestamptz not null default now(),
  unique (owner_id, kind, value)
);

-- 8. Domains the finder has already judged, so it never looks twice ------------------------------------------------
create table if not exists public.outreach_seen_domains (
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain text not null check (length(domain) between 3 and 253),
  outcome text not null check (outcome in ('added','no_email','low_fit','skipped','duplicate','suppressed')),
  note text not null default '' check (length(note) <= 300),
  seen_at timestamptz not null default now(),
  primary key (owner_id, domain)
);

-- 9. Plain-English activity feed -------------------------------------------------------------------------------------
create table if not exists public.outreach_activity (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('found','sent','follow_up','replied','opt_out','bounce','error','info')),
  message text not null check (length(message) <= 500),
  contact_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists outreach_activity_idx on public.outreach_activity(owner_id, created_at desc);

-- 10. Row level security: each account sees only its own rows -------------------------------------------------------
alter table public.outreach_settings enable row level security;
alter table public.outreach_contacts enable row level security;
alter table public.outreach_emails enable row level security;
alter table public.outreach_suppressions enable row level security;
alter table public.outreach_seen_domains enable row level security;
alter table public.outreach_activity enable row level security;

drop policy if exists own on public.outreach_settings;
create policy own on public.outreach_settings for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists own on public.outreach_contacts;
create policy own on public.outreach_contacts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists own on public.outreach_suppressions;
create policy own on public.outreach_suppressions for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists own_read on public.outreach_activity;
create policy own_read on public.outreach_activity for select to authenticated using (owner_id = auth.uid());
drop policy if exists own_read on public.outreach_seen_domains;
create policy own_read on public.outreach_seen_domains for select to authenticated using (owner_id = auth.uid());
drop policy if exists own_read on public.outreach_emails;
create policy own_read on public.outreach_emails for select to authenticated using (owner_id = auth.uid());
-- In the app, only emails not yet sent can be edited, approved, sent back or skipped. Sending is the task's job.
drop policy if exists own_edit_unsent on public.outreach_emails;
create policy own_edit_unsent on public.outreach_emails for update to authenticated
  using (owner_id = auth.uid() and status in ('pending','approved'))
  with check (owner_id = auth.uid() and status in ('pending','approved','skipped'));

revoke all on public.outreach_settings, public.outreach_contacts, public.outreach_emails, public.outreach_suppressions,
  public.outreach_seen_domains, public.outreach_activity from anon, authenticated;
grant select, insert, update on public.outreach_settings to authenticated;
grant select, insert, update, delete on public.outreach_contacts to authenticated;
grant select on public.outreach_emails, public.outreach_activity, public.outreach_seen_domains to authenticated;
grant update (subject, body, status, approved_at) on public.outreach_emails to authenticated;
grant select, insert, delete on public.outreach_suppressions to authenticated;
grant usage on sequence public.outreach_suppressions_id_seq to authenticated;

-- 11. For the scheduled task: is this address (or its domain) on the do-not-contact list? -------------------------
create or replace function public.outreach_is_suppressed(p_owner uuid, p_email text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.outreach_suppressions s where s.owner_id = p_owner and (
    (s.kind = 'email' and s.value = lower(trim(p_email))) or
    (s.kind = 'domain' and s.value = lower(split_part(trim(p_email), '@', 2)))))
$$;
revoke execute on function public.outreach_is_suppressed(uuid, text) from public, anon, authenticated;

commit;
