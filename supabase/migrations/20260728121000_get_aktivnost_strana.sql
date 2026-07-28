-- Zamjena za get_aktivnost. Tri promjene, svaka rješava jedan uzrok timeouta:
--
-- 1) plpgsql + dinamički SQL s literalima (%L). Stara funkcija je bila `language sql`,
--    pa je planer njeno tijelo planirao samo po TIPOVIMA parametara. Pet uslova
--    oblika (p_x is null or kolona = p_x) srušili su procjenu na rows=1, planer je
--    izabrao Nested Loop i skenirao korisnici/klijenti 5.440 puta uz ~70.000 poziva
--    ima_pristup_klijentu(). 9.434 ms. S literalima planer vidi stvarne vrijednosti.
--    %L radi ispravno kvotovanje i NULL renderuje kao golo NULL — nema injekcije.
--
-- 2) Keyset umjesto offset + count(*) over (). count(*) over () je prolazio kroz
--    CIJELI filtrirani skup pri svakoj stranici — O(n) zauvijek. Sada se dohvata
--    samo porcija, a join na korisnici/klijenti se radi TEK nad njom.
--
-- 3) SECURITY DEFINER s eksplicitnim je_admin() guardom. Pod RLS-om Postgres mora
--    izvršiti sigurnosni predikat prije korisničkih uslova, a ILIKE (~~*) nije
--    leakproof — pa ga ne smije spustiti u indeksni uslov i GIN trigram indeks se
--    UOPŠTE ne koristi (113 ms Seq Scan vs 0,07 ms Bitmap Index Scan, izmjereno).
--    RLS na audit_log ostaje uključen, policy audit_sel = je_admin() ostaje, pa
--    direktan select iz PostgREST-a i dalje ne prolazi za ne-admina. Garancija se
--    ne uklanja nego premješta: iz predikata koji se izvrši 5.440 puta u jednu
--    provjeru na ulazu. Definer higijena (search_path + revoke) po presedanu
--    get_aktivni_korisnici (20260726122000).

create or replace function get_aktivnost_strana(
  p_od            timestamptz default null,
  p_do            timestamptz default null,
  p_korisnik      uuid        default null,
  p_akcija        text        default null,
  p_entitet       text        default null,
  p_pretraga      text        default null,
  p_prije_vrijeme timestamptz default null,
  p_prije_id      bigint      default null,
  p_limit         int         default 50
)
returns table (
  id             bigint,
  vrijeme        timestamptz,
  korisnik_id    uuid,
  korisnik_ime   text,
  korisnik_email text,
  akcija         text,
  entitet        text,
  entitet_id     text,
  staro          jsonb,
  novo           jsonb,
  detalji        jsonb,
  cilj_ime       text,
  cilj_klijent   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- Gornja granica je zaštita: pozivalac ne smije natjerati funkciju na neograničen skup.
  v_limit  int    := least(greatest(coalesce(p_limit, 50), 1), 200);
  -- Prazna pretraga = nema filtera (UI šalje "" kad korisnik obriše polje).
  v_q      text   := nullif(btrim(coalesce(p_pretraga, '')), '');
  -- Kursor bez id-a bi dao (vrijeme, NULL) → NULL poređenje → nula redova.
  -- Najveći bigint znači „od tog trenutka, svi id-evi".
  v_kursor bigint := coalesce(p_prije_id, 9223372036854775807);
begin
  if not je_admin() then
    raise exception 'nije dozvoljeno' using errcode = '42501';
  end if;

  return query execute format($f$
    with porcija as (
      select a.*
      from audit_log a
      where (%1$L::timestamptz is null or a.vrijeme >= %1$L::timestamptz)
        and (%2$L::timestamptz is null or a.vrijeme <  %2$L::timestamptz)
        and (%3$L::uuid is null or a.korisnik_id = %3$L::uuid)
        and (%4$L::text is null or a.akcija  = %4$L::text)
        and (%5$L::text is null or a.entitet = %5$L::text)
        and (%6$L::text is null or (
                 a.pretraga_tekst ilike '%%' || %6$L::text || '%%'
              or a.korisnik_id in (select k.id from korisnici k
                                   where k.ime   ilike '%%' || %6$L::text || '%%'
                                      or k.email ilike '%%' || %6$L::text || '%%')
              or a.klijent_ref in (select kl.id from klijenti kl
                                   where kl.naziv ilike '%%' || %6$L::text || '%%')))
        and (%7$L::timestamptz is null
             or (a.vrijeme, a.id) < (%7$L::timestamptz, %8$L::bigint))
      order by a.vrijeme desc, a.id desc
      limit %9$s
    )
    select p.id, p.vrijeme, p.korisnik_id, k.ime, k.email,
           p.akcija, p.entitet, p.entitet_id, p.staro, p.novo, p.detalji,
           coalesce(p.novo ->> 'naziv', p.staro ->> 'naziv',
                    p.novo ->> 'ime',   p.staro ->> 'ime') as cilj_ime,
           kl.naziv as cilj_klijent
    from porcija p
    left join korisnici k  on k.id  = p.korisnik_id
    left join klijenti  kl on kl.id = p.klijent_ref
    order by p.vrijeme desc, p.id desc
  $f$, p_od, p_do, p_korisnik, p_akcija, p_entitet, v_q, p_prije_vrijeme, v_kursor, v_limit);
end;
$$;

-- Definer funkcija koja probija RLS → nikad anon; samo prijavljeni korisnici.
revoke execute on function get_aktivnost_strana(
  timestamptz, timestamptz, uuid, text, text, text, timestamptz, bigint, int) from public;
grant execute on function get_aktivnost_strana(
  timestamptz, timestamptz, uuid, text, text, text, timestamptz, bigint, int) to authenticated;

-- aktivnost_view nema pozivaoca nigdje — provjereno u repou (lib/, app/,
-- components/, tests/, scripts/) i dodatno provjereno na samoj DEMO bazi
-- (pg_depend nad pg_rewrite, plus sken pg_get_functiondef za svaku prokind='f'
-- funkciju u public šemi) — oba dolaze prazna.
--
-- get_aktivnost i dalje ima tačno jednog pozivaoca: lib/queries/aktivnost.ts,
-- koji zamjenjuje Task 4 ovog plana. Između primjene ove migracije i
-- deploy-a te app-side izmjene, /aktivnost je pokvarena — zato plan zahtijeva
-- da OBJE migracije (DEMO i PROD) budu primijenjene PRIJE nego se aplikacija
-- deploy-uje, nikad obrnuto. Funkcija ide prva — zavisi od view-a (tijelo
-- joj čita `from aktivnost_view`), pa view mora ostati dok se funkcija ne
-- ukloni.
drop function if exists get_aktivnost(timestamptz, timestamptz, uuid, text, text, text, int, int);
drop view if exists aktivnost_view;
