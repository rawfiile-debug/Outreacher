-- RAWFIILE Studio: outreach tracker, call sheets, creative briefs and moodboards.
--
-- Lives in the same Supabase project as FRAME (same sign-in) but only in its own studio_* tables, functions and the
-- studio-moodboard storage bucket. Nothing here reads or changes FRAME's tables, except reading the owner's trading
-- name from business_settings so shared pages can say who they are from.
--
-- Shared links (call sheets and briefs) work like FRAME's quote links: 32 random bytes in the URL, only the SHA-256
-- hash stored, read through narrowly scoped security-definer functions that return one record and no internal ids.
-- Additive only.

-- Helpers ------------------------------------------------------------------------------------------------------------
create or replace function public.studio_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.studio_today()
returns date language sql stable set search_path = public as $$ select (now() at time zone 'Europe/London')::date $$;

-- Who a shared page is from: the trading name in FRAME's settings, if there is one.
create or replace function public.studio_owner_name(p_owner uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(coalesce(nullif(s.trading_name, ''), s.legal_name)), '')
                     from public.business_settings s where s.owner_id = p_owner), 'RAWFIILE')
$$;
revoke execute on function public.studio_owner_name(uuid) from public, anon, authenticated;

-- Outreach contacts ---------------------------------------------------------------------------------------------------
create table if not exists public.studio_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '' check (length(name) <= 200),
  company text not null default '' check (length(company) <= 200),
  role text not null default '' check (length(role) <= 200),
  email text not null default '' check (length(email) <= 320),
  phone text not null default '' check (length(phone) <= 60),
  instagram text not null default '' check (length(instagram) <= 100),
  website text not null default '' check (length(website) <= 500),
  category text not null default 'Agency' check (category in ('Agency','Brand','Hospitality','Events','Media','Other')),
  stage text not null default 'To contact' check (stage in ('To contact','Emailed','Followed up','Replied','Meeting','Won','Not now')),
  first_emailed_on date,
  followed_up_on date,
  replied_on date,
  remind_on date,
  notes text not null default '' check (length(notes) <= 4000),
  notion_page_id text check (notion_page_id is null or notion_page_id ~ '^[0-9a-f-]{32,36}$'),
  notion_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_contacts_has_name check (length(trim(name)) > 0 or length(trim(company)) > 0 or length(trim(email)) > 0),
  constraint studio_contacts_id_owner_key unique (id, owner_id),
  constraint studio_contacts_notion_unique unique (owner_id, notion_page_id)
);
create index if not exists studio_contacts_owner_idx on public.studio_contacts(owner_id, stage);
create unique index if not exists studio_contacts_owner_email_unique on public.studio_contacts(owner_id, lower(email)) where email <> '';

-- Moving a contact along the pipeline stamps the matching date (today, UK time) if it is not set yet.
create or replace function public.studio_contacts_stage()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if new.stage in ('Emailed','Followed up','Replied','Meeting','Won') and new.first_emailed_on is null and new.stage <> 'To contact' then
      new.first_emailed_on := public.studio_today();
    end if;
    if new.stage = 'Followed up' and new.followed_up_on is null then new.followed_up_on := public.studio_today(); end if;
    if new.stage in ('Replied','Meeting','Won') and new.replied_on is null then new.replied_on := public.studio_today(); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists t_studio_contacts_stage on public.studio_contacts;
create trigger t_studio_contacts_stage before insert or update on public.studio_contacts for each row execute function public.studio_contacts_stage();

-- One follow-up, a week after the first email, and only while no reply has come in.
create or replace view public.studio_contact_list with (security_invoker = true) as
select c.*,
       case when c.stage = 'Emailed' and c.first_emailed_on is not null then c.first_emailed_on + 7 end as follow_up_on,
       (c.stage = 'Emailed' and c.first_emailed_on is not null and c.first_emailed_on + 7 <= public.studio_today()) as follow_up_due,
       (c.remind_on is not null and c.remind_on <= public.studio_today() and c.stage not in ('Won','Not now')) as reminder_due
  from public.studio_contacts c;

-- Call sheets ---------------------------------------------------------------------------------------------------------
create table if not exists public.studio_call_sheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brief_id uuid,
  title text not null default '' check (length(title) <= 200),
  client_name text not null default '' check (length(client_name) <= 200),
  shoot_date date,
  call_time time,
  wrap_time time,
  location_name text not null default '' check (length(location_name) <= 200),
  address text not null default '' check (length(address) <= 500),
  map_url text not null default '' check (length(map_url) <= 1000 and (map_url = '' or map_url ~* '^https://')),
  parking text not null default '' check (length(parking) <= 1000),
  transport text not null default '' check (length(transport) <= 1000),
  nearest_hospital text not null default '' check (length(nearest_hospital) <= 500),
  weather text not null default '' check (length(weather) <= 300),
  crew jsonb not null default '[]'::jsonb check (jsonb_typeof(crew) = 'array' and jsonb_array_length(crew) <= 60),
  schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule) = 'array' and jsonb_array_length(schedule) <= 80),
  kit text not null default '' check (length(kit) <= 4000),
  wardrobe text not null default '' check (length(wardrobe) <= 4000),
  notes text not null default '' check (length(notes) <= 4000),
  private_notes text not null default '' check (length(private_notes) <= 4000),
  share_token_hash text unique check (share_token_hash is null or share_token_hash ~ '^[0-9a-f]{64}$'),
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_call_sheets_id_owner_key unique (id, owner_id)
);
create index if not exists studio_call_sheets_owner_idx on public.studio_call_sheets(owner_id, shoot_date);
drop trigger if exists t_studio_call_sheets_touch on public.studio_call_sheets;
create trigger t_studio_call_sheets_touch before update on public.studio_call_sheets for each row execute function public.studio_touch();

-- Creative briefs and moodboards ---------------------------------------------------------------------------------------
create table if not exists public.studio_briefs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (length(title) <= 200),
  client_name text not null default '' check (length(client_name) <= 200),
  client_email text not null default '' check (length(client_email) <= 320),
  shoot_date date,
  deadline date,
  objective text not null default '' check (length(objective) <= 4000),
  audience text not null default '' check (length(audience) <= 2000),
  deliverables text not null default '' check (length(deliverables) <= 4000),
  mood text not null default '' check (length(mood) <= 2000),
  palette text[] not null default '{}' check (cardinality(palette) <= 12 and array_to_string(palette, ',') ~ '^(#[0-9A-Fa-f]{6}(,#[0-9A-Fa-f]{6})*)?$'),
  styling text not null default '' check (length(styling) <= 4000),
  locations text not null default '' check (length(locations) <= 4000),
  references_text text not null default '' check (length(references_text) <= 4000),
  dos text not null default '' check (length(dos) <= 2000),
  donts text not null default '' check (length(donts) <= 2000),
  private_notes text not null default '' check (length(private_notes) <= 4000),
  approved_at timestamptz,
  approved_by text not null default '' check (length(approved_by) <= 200),
  share_token_hash text unique check (share_token_hash is null or share_token_hash ~ '^[0-9a-f]{64}$'),
  shared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_briefs_id_owner_key unique (id, owner_id)
);
create index if not exists studio_briefs_owner_idx on public.studio_briefs(owner_id, created_at desc);
drop trigger if exists t_studio_briefs_touch on public.studio_briefs;
create trigger t_studio_briefs_touch before update on public.studio_briefs for each row execute function public.studio_touch();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'studio_call_sheets_brief_same_owner_fkey') then
    alter table public.studio_call_sheets add constraint studio_call_sheets_brief_same_owner_fkey
      foreign key (brief_id, owner_id) references public.studio_briefs(id, owner_id) on delete set null (brief_id);
  end if;
end $$;

-- Moodboard: uploaded images (in the studio-moodboard bucket), web links, or short notes, in order.
create table if not exists public.studio_brief_items (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image','link','note')),
  storage_path text check (storage_path is null or storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'),
  url text not null default '' check (length(url) <= 1000 and (url = '' or url ~* '^https://')),
  caption text not null default '' check (length(caption) <= 500),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint studio_brief_items_kind_fields check (
    (kind = 'image' and storage_path is not null) or (kind = 'link' and url <> '') or (kind = 'note' and caption <> '')),
  constraint studio_brief_items_image_owner check (storage_path is null or split_part(storage_path, '/', 1) = owner_id::text),
  constraint studio_brief_items_brief_same_owner_fkey foreign key (brief_id, owner_id) references public.studio_briefs(id, owner_id) on delete cascade
);
create index if not exists studio_brief_items_brief_idx on public.studio_brief_items(brief_id, position);

create table if not exists public.studio_brief_comments (
  id bigserial primary key,
  brief_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null check (length(trim(author_name)) between 1 and 100),
  body text not null check (length(trim(body)) between 1 and 2000),
  from_client boolean not null default false,
  created_at timestamptz not null default now(),
  constraint studio_brief_comments_brief_same_owner_fkey foreign key (brief_id, owner_id) references public.studio_briefs(id, owner_id) on delete cascade
);
create index if not exists studio_brief_comments_brief_idx on public.studio_brief_comments(brief_id, created_at);

-- Row level security: each account sees only its own rows ---------------------------------------------------------------
alter table public.studio_contacts enable row level security;
alter table public.studio_call_sheets enable row level security;
alter table public.studio_briefs enable row level security;
alter table public.studio_brief_items enable row level security;
alter table public.studio_brief_comments enable row level security;
do $$
declare t text;
begin
  foreach t in array array['studio_contacts','studio_call_sheets','studio_briefs','studio_brief_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t || '_owner', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists studio_brief_comments_select on public.studio_brief_comments;
create policy studio_brief_comments_select on public.studio_brief_comments for select to authenticated using (owner_id = auth.uid());
drop policy if exists studio_brief_comments_insert on public.studio_brief_comments;
create policy studio_brief_comments_insert on public.studio_brief_comments for insert to authenticated
  with check (owner_id = auth.uid() and from_client = false);
drop policy if exists studio_brief_comments_delete on public.studio_brief_comments;
create policy studio_brief_comments_delete on public.studio_brief_comments for delete to authenticated using (owner_id = auth.uid());
revoke all on public.studio_brief_comments from anon;
grant select, insert, delete on public.studio_brief_comments to authenticated;
grant usage on sequence public.studio_brief_comments_id_seq to authenticated;
grant select on public.studio_contact_list to authenticated;
revoke all on public.studio_contact_list from anon;

-- Share links ----------------------------------------------------------------------------------------------------------
-- p_token_hash null switches the link off.
create or replace function public.studio_set_share(p_kind text, p_id uuid, p_token_hash text)
returns timestamptz language plpgsql set search_path = public as $$
declare n int;
begin
  if p_token_hash is not null and p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid link' using errcode = '22023'; end if;
  if p_kind = 'call_sheet' then
    update public.studio_call_sheets set share_token_hash = p_token_hash, shared_at = case when p_token_hash is null then null else now() end
     where id = p_id and owner_id = auth.uid();
  elsif p_kind = 'brief' then
    update public.studio_briefs set share_token_hash = p_token_hash, shared_at = case when p_token_hash is null then null else now() end
     where id = p_id and owner_id = auth.uid();
  else
    raise exception 'Unknown kind' using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Not found' using errcode = 'P0002'; end if;
  return case when p_token_hash is null then null else now() end;
end $$;

-- Public call sheet: everything the crew needs on the day, nothing private.
create or replace function public.studio_public_call_sheet(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.studio_call_sheets;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into s from public.studio_call_sheets where share_token_hash = p_token_hash;
  if s.id is null then return null; end if;
  return jsonb_build_object('from', public.studio_owner_name(s.owner_id), 'title', s.title, 'client_name', s.client_name,
    'shoot_date', s.shoot_date, 'call_time', to_char(s.call_time, 'HH24:MI'), 'wrap_time', to_char(s.wrap_time, 'HH24:MI'),
    'location_name', s.location_name, 'address', s.address, 'map_url', s.map_url, 'parking', s.parking, 'transport', s.transport,
    'nearest_hospital', s.nearest_hospital, 'weather', s.weather, 'crew', s.crew, 'schedule', s.schedule,
    'kit', s.kit, 'wardrobe', s.wardrobe, 'notes', s.notes, 'updated_at', s.updated_at);
end $$;

-- Public brief: the brief, its moodboard (image paths in the public bucket) and the conversation.
create or replace function public.studio_public_brief(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b public.studio_briefs;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into b from public.studio_briefs where share_token_hash = p_token_hash;
  if b.id is null then return null; end if;
  return jsonb_build_object('from', public.studio_owner_name(b.owner_id), 'title', b.title, 'client_name', b.client_name,
    'shoot_date', b.shoot_date, 'deadline', b.deadline, 'objective', b.objective, 'audience', b.audience,
    'deliverables', b.deliverables, 'mood', b.mood, 'palette', to_jsonb(b.palette), 'styling', b.styling, 'locations', b.locations,
    'references_text', b.references_text, 'dos', b.dos, 'donts', b.donts, 'approved_at', b.approved_at, 'approved_by', b.approved_by,
    'updated_at', b.updated_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'storage_path', i.storage_path, 'url', i.url, 'caption', i.caption)
                         order by i.position, i.created_at) from public.studio_brief_items i where i.brief_id = b.id), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('author_name', c.author_name, 'body', c.body, 'from_client', c.from_client,
                         'created_at', c.created_at) order by c.created_at) from public.studio_brief_comments c where c.brief_id = b.id), '[]'::jsonb));
end $$;

-- A client comment through the brief link. Capped so a leaked link cannot be used to flood the brief.
create or replace function public.studio_public_brief_comment(p_token_hash text, p_name text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.studio_briefs; v_name text := left(trim(coalesce(p_name, '')), 100); v_body text := left(trim(coalesce(p_body, '')), 2000);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode = 'P0002'; end if;
  select * into b from public.studio_briefs where share_token_hash = p_token_hash;
  if b.id is null then raise exception 'This link is not valid' using errcode = 'P0002'; end if;
  if length(v_name) < 1 then raise exception 'Add your name' using errcode = '22023'; end if;
  if length(v_body) < 1 then raise exception 'Write a comment first' using errcode = '22023'; end if;
  if (select count(*) from public.studio_brief_comments where brief_id = b.id) >= 300 then
    raise exception 'This brief has reached its comment limit. Please reply by email instead.' using errcode = 'P0001';
  end if;
  insert into public.studio_brief_comments(brief_id, owner_id, author_name, body, from_client) values (b.id, b.owner_id, v_name, v_body, true);
end $$;

-- The client signs off the brief through the link (once; editing the brief afterwards does not undo it, the owner can).
create or replace function public.studio_public_brief_approve(p_token_hash text, p_name text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare b public.studio_briefs; v_name text := left(trim(coalesce(p_name, '')), 200);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'This link is not valid' using errcode = 'P0002'; end if;
  select * into b from public.studio_briefs where share_token_hash = p_token_hash for update;
  if b.id is null then raise exception 'This link is not valid' using errcode = 'P0002'; end if;
  if b.approved_at is not null then raise exception 'This brief has already been signed off' using errcode = 'P0001'; end if;
  if length(v_name) < 2 then raise exception 'Type your name' using errcode = '22023'; end if;
  update public.studio_briefs set approved_at = now(), approved_by = v_name where id = b.id;
  insert into public.studio_brief_comments(brief_id, owner_id, author_name, body, from_client) values (b.id, b.owner_id, v_name, 'Signed off the brief.', true);
  return now();
end $$;

-- A call sheet started from a brief: title, client, date and location ideas carried across.
create or replace function public.studio_call_sheet_from_brief(p_brief uuid)
returns public.studio_call_sheets language plpgsql set search_path = public as $$
declare b public.studio_briefs; s public.studio_call_sheets;
begin
  select * into b from public.studio_briefs where id = p_brief and owner_id = auth.uid();
  if b.id is null then raise exception 'Brief not found' using errcode = 'P0002'; end if;
  insert into public.studio_call_sheets(owner_id, brief_id, title, client_name, shoot_date, wardrobe, notes)
  values (auth.uid(), b.id, b.title, b.client_name, b.shoot_date, left(b.styling, 4000),
          left(case when b.locations <> '' then 'Location ideas from the brief: ' || b.locations else '' end, 4000))
  returning * into s;
  return s;
end $$;

revoke execute on function public.studio_set_share(text, uuid, text), public.studio_public_call_sheet(text), public.studio_public_brief(text),
  public.studio_public_brief_comment(text, text, text), public.studio_public_brief_approve(text, text),
  public.studio_call_sheet_from_brief(uuid), public.studio_contacts_stage(), public.studio_touch() from public, anon;
grant execute on function public.studio_set_share(text, uuid, text), public.studio_call_sheet_from_brief(uuid) to authenticated;
grant execute on function public.studio_public_call_sheet(text), public.studio_public_brief(text),
  public.studio_public_brief_comment(text, text, text), public.studio_public_brief_approve(text, text) to anon, authenticated;
revoke execute on function public.studio_contacts_stage(), public.studio_touch() from authenticated;

-- Moodboard image storage ----------------------------------------------------------------------------------------------
-- A public bucket: images are served by their unguessable path (<owner id>/<brief id>/<random id>.<ext>), so shared
-- briefs can show them without signing every URL. Only the owner can upload to or delete from their own folder.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio-moodboard', 'studio-moodboard', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists studio_moodboard_insert on storage.objects';
    execute $p$create policy studio_moodboard_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'studio-moodboard' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists studio_moodboard_delete on storage.objects';
    execute $p$create policy studio_moodboard_delete on storage.objects for delete to authenticated
      using (bucket_id = 'studio-moodboard' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists studio_moodboard_select on storage.objects';
    execute $p$create policy studio_moodboard_select on storage.objects for select to authenticated
      using (bucket_id = 'studio-moodboard' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;
