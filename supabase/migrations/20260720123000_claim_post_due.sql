-- Atomski claim. Mora biti SQL funkcija: cron radi preko supabase-js/PostgREST, a
-- .upsert() ne može izraziti "on conflict do update ... where ... returning" —
-- ignoreDuplicates bi vratio prazno i za zaglavljeni claim, čime bi oporavak nestao.
-- Presedan u repou: 20260710120000_podsjetnik_email_atomic_rpc.sql.
create or replace function claim_post_due(p_termin uuid, p_ciklus date, p_kanal text)
returns uuid
language sql
volatile
security invoker
set search_path = public
as $$
  insert into post_due_obavijesti (termin_id, ciklus_rok, kanal, stanje, claimed_at)
  values (p_termin, p_ciklus, p_kanal, 'u_toku', now())
  on conflict (termin_id, ciklus_rok, kanal) do update
    set claimed_at = now()
    where post_due_obavijesti.stanje = 'u_toku'
      and post_due_obavijesti.claimed_at < now() - interval '15 minutes'
  returning id;
$$;

revoke execute on function claim_post_due(uuid, date, text) from public, anon, authenticated;
grant  execute on function claim_post_due(uuid, date, text) to service_role;
