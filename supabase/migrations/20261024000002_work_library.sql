-- "My work to mention": Michael's own projects that Autopilot may reference in first emails. Editable on the
-- Autopilot page. Additive only.
alter table public.studio_autopilot add column if not exists work_library text not null default '' check (length(work_library) <= 4000);
