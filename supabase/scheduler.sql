-- Outreacher scheduler: calls the autopilot every ten minutes, 06:00 to 21:59 UTC. Run in the Supabase SQL editor
-- after replacing CRON_SECRET_HERE with the CRON_SECRET value set in Vercel (Outreacher > Settings > Environment
-- Variables). Safe to run again: it replaces the existing job.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'outreacher-tick';
select cron.schedule('outreacher-tick', '*/10 6-21 * * *', $job$
  select net.http_get(
    url := 'https://outreacher-flax.vercel.app/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer CRON_SECRET_HERE'),
    timeout_milliseconds := 60000);
$job$);
