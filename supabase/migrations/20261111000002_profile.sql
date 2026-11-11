-- OUTREACHER: My Profile (the text of the CV and Instagram screenshots is read in the browser and stored here,
-- because Claude's scheduled runs cannot download files from storage), and a small job queue for things the app asks Claude to do (build the profile summary
-- now; draft grant answers later). The hourly "Outreacher hourly" scheduled task picks jobs up. Additive, rerunnable.

create table if not exists public.outreach_profile (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  website text not null default 'https://www.rawfiile.co.uk' check (length(website) <= 500),
  cv_path text check (cv_path is null or length(cv_path) <= 500),
  cv_name text not null default '' check (length(cv_name) <= 200),
  instagram_paths text[] not null default '{}' check (cardinality(instagram_paths) <= 12),
  cv_text text not null default '' check (length(cv_text) <= 20000),
  instagram_text text not null default '' check (length(instagram_text) <= 30000),
  bio text not null default '' check (length(bio) <= 4000),
  clients text not null default '' check (length(clients) <= 2000),
  projects text not null default '' check (length(projects) <= 4000),
  awards text not null default '' check (length(awards) <= 2000),
  equipment text not null default '' check (length(equipment) <= 2000),
  apply_as text[] not null default '{individual}' check (apply_as <@ '{individual,sole_trader,ycuk}'::text[]),
  extra text not null default '' check (length(extra) <= 4000),
  summary text not null default '' check (length(summary) <= 8000),
  summary_built_at timestamptz,
  summary_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists t_outreach_profile_touch on public.outreach_profile;
create trigger t_outreach_profile_touch before update on public.outreach_profile for each row execute function public.outreach_touch();

create table if not exists public.outreach_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('build_profile','draft_grant')),
  ref_id uuid,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  error text not null default '' check (length(error) <= 500),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists outreach_jobs_queue_idx on public.outreach_jobs(status, created_at);
-- One waiting job of each kind per item, so pressing the button twice does not queue two.
create unique index if not exists outreach_jobs_one_waiting on public.outreach_jobs(owner_id, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('queued','running');

alter table public.outreach_profile enable row level security;
alter table public.outreach_jobs enable row level security;
drop policy if exists own on public.outreach_profile;
create policy own on public.outreach_profile for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists own_read on public.outreach_jobs;
create policy own_read on public.outreach_jobs for select to authenticated using (owner_id = auth.uid());
drop policy if exists own_queue on public.outreach_jobs;
create policy own_queue on public.outreach_jobs for insert to authenticated with check (owner_id = auth.uid() and status = 'queued');

revoke all on public.outreach_profile, public.outreach_jobs from anon, authenticated;
grant select, insert, update on public.outreach_profile to authenticated;
grant select, insert on public.outreach_jobs to authenticated;

-- Private files: CV and Instagram screenshots, stored under <owner id>/... Only the owner can read or change them.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('outreach-files', 'outreach-files', false, 15728640,
      array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain','image/jpeg','image/png','image/webp','image/heic'])
    on conflict (id) do nothing;
    execute 'drop policy if exists outreach_files_select on storage.objects';
    execute $p$create policy outreach_files_select on storage.objects for select to authenticated
      using (bucket_id = 'outreach-files' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists outreach_files_insert on storage.objects';
    execute $p$create policy outreach_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'outreach-files' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists outreach_files_delete on storage.objects';
    execute $p$create policy outreach_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'outreach-files' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
