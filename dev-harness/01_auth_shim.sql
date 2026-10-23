-- LOCAL TEST HARNESS ONLY. Minimal stand-in for the parts of Supabase Auth the database tests need
-- (auth.users and auth.uid()) when Supabase's own Auth server is not running. Never run against a real project.
create table if not exists auth.users (
  id uuid primary key, email text, aud text, role text, instance_id uuid,
  email_confirmed_at timestamptz, created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
