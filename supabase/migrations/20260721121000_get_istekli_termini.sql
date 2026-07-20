-- Svi termini u alarmu, za sedmični digest. Isti uslov alarma kao get_post_due_termine:
-- OBA datuma moraju biti prošla (rok i efektivni), inače bi termin sa rokom u budućnosti
-- i propuštenim datum_zakazan davao lažnu uzbunu.
--
-- p_danas je LOKALNI BEČKI datum (ne current_date, koji je UTC) — isti izvor koji je ključ
-- u digest_slanja.
create or replace function get_istekli_termini(p_danas date)
returns table (
  termin_id       uuid,
  klijent_id      uuid,
  klijent_naziv   text,
  vrsta_naziv     text,
  rok_dospijeca   date,
  datum_zakazan   date,
  ciklus_rok      date,
  dana_do_ciklusa int,
  lokacija_naziv  text
)
language sql
stable
security invoker
set search_path = public
as $$
  with ef as (
    select t.*, coalesce(t.datum_zakazan, t.rok_dospijeca) as ciklus
    from termini t
    where t.status in ('planirano','zakazano')
      and t.rok_dospijeca < current_date
      and coalesce(t.datum_zakazan, t.rok_dospijeca) < current_date
  )
  select ef.id, k.id, k.naziv, vp.naziv, ef.rok_dospijeca, ef.datum_zakazan, ef.ciklus,
         (ef.ciklus - current_date), l.naziv
  from ef
  join klijenti k        on k.id = ef.klijent_id
  join vrste_provjera vp on vp.id = ef.vrsta_provjere_id
  left join lokacije l   on l.id = ef.lokacija_id
  -- Termin koji je DANAS dobio pojedinačnu obavijest ne ulazi u današnji digest.
  -- poslat_at je popunjen samo za stvarno poslate; 'preskoceno' redovi ga nemaju,
  -- pa termin koji je danas preskočen (nema primalaca) i dalje pripada digestu.
  where not exists (
    select 1 from post_due_obavijesti o
    where o.termin_id = ef.id and o.poslat_at::date = p_danas
  )
  order by ef.ciklus, k.naziv;
$$;

revoke execute on function get_istekli_termini(date) from public, anon, authenticated;
grant  execute on function get_istekli_termini(date) to service_role;
