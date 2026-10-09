create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'pilatia-followups';

select cron.schedule(
  'pilatia-followups',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-DOMINIO.example/api/followups?secret=SEU_WEBHOOK_SECRET',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'pilatia-reminders';

select cron.schedule(
  'pilatia-reminders',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-DOMINIO.example/api/reminders?secret=SEU_WEBHOOK_SECRET',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
