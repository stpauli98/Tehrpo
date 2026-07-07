-- Prekidač automatskog dnevnog slanja podsjetnika (per-instanca; default uključeno
-- jer je Vercel cron već aktivan — isključivanje je svjesna radnja admina u Postavkama).
alter table postavke add column podsjetnici_aktivni boolean not null default true;
