-- OUTREACHER: a "Check for gigs now" button queues a check_gigs job. Rerunnable.
alter table public.outreach_jobs drop constraint if exists outreach_jobs_kind_check;
alter table public.outreach_jobs add constraint outreach_jobs_kind_check check (kind in ('build_profile','draft_grant','find_grants','check_gigs'));
