-- N08: uklanjanje NEKORIŠĆENIH write politika na storage.objects
-- (storage_dok_ins / storage_dok_upd), koje su dozvoljavale prepisivanje tuđeg zapisnika.
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- 20260703100000 je ostavio INSERT i UPDATE otvorenim za korisnički JWT pod uslovom
-- `ima_pristup_dokumentu(name) and not je_pregled()`. „Pristup dokumentu" nije isto što i
-- „vlasništvo nad dokumentom": operater sa pristupom klijentu smije PREPISATI sadržaj
-- zapisnika koji je napisao neko drugi (Storage `x-upsert: true` = INSERT ili UPDATE nad
-- storage.objects), iako mu je BRISANJE istog fajla zabranjeno (storage_dok_del = je_admin()).
-- Gore: `ima_pristup_dokumentu` gleda `dokumenti.storage_path`, a `dokumenti_ins` ne veže
-- putanju za klijenta, pa operater sam sebi „otključa" bilo koji fajl iz bucketa tako što
-- upiše `dokumenti` red sa tuđim `storage_path` i svojim `klijent_id` (repro n08b).
-- Nad `storage.objects` nema audit trigera, pa o prepisivanju ne ostaje NIKAKAV trag —
-- `dokumenti` red (naziv, velicina_bajt, uploaded_at) ostaje netaknut i laže o sadržaju.
-- Bucket drži zakonski obavezne zapisnike ZNR/ZOP — netragom izmijenjen zapisnik je
-- ozbiljniji problem od obrisanog.
--
-- ── ZAŠTO JE UKLANJANJE SIGURNO (provjereno grep-om, ne pretpostavkom) ───────
-- Svaki storage poziv u repozitoriju ide service-role klijentom (`createAdminSupabaseClient`,
-- BYPASSRLS), pa ga RLS politike ne dodiruju:
--   lib/supabase/storage.ts        upload/download/createSignedUrl/remove  → createAdminSupabaseClient
--     ↳ pozivaoci: app/(dashboard)/dokumenti/actions.ts, lib/zapisnik/snimi.ts,
--                  app/api/dokumenti/[id]/route.ts, app/api/dokumenti/[id]/pregled/route.ts,
--                  app/(dashboard)/zapisnici/page.tsx
--   lib/dokumenti/popis.ts         .list()                                 → tip Sb = createAdminSupabaseClient
--   app/api/cron/ciscenje-storagea .remove()                               → createAdminSupabaseClient
--   scripts/gc-orphan-dokumenti.ts .remove()                               → createAdminSupabaseClient
--   tests/e2e/27-uloge-ovlastenja  .upload()/.remove()                     → tests/e2e/db.ts (SERVICE_ROLE)
-- Browser klijent (`lib/supabase/client.ts`) nema nijednog pozivaoca, a nigdje u kodu nema
-- direktnog `/storage/v1/...` fetch-a, `createSignedUploadUrl` ni `uploadToSignedUrl`.
-- Preuzimanje/pregled u UI-ju ide potpisanim URL-om koji izdaje service-role — potpis, ne RLS.
-- Dakle: NIJEDAN legitiman tok ne piše u storage korisničkim JWT-om → politike su čista
-- napadačka površina i brišu se (bez politike = deny za `authenticated`/`anon`).
--
-- ŠTA OSTAJE: `storage_dok_sel` (čitanje, već suženo na `ima_pristup_dokumentu`) i
-- `storage_dok_del` (već admin-only). Njih ova migracija ne dira.
--
-- Idempotentno / re-run-safe.

-- integracija-dozvoli: zastita-uklonjena — uklanjanje ovih politika JESTE popravka; nijedan
-- legitiman tok ne piše u storage korisničkim JWT-om (sav I/O ide service-role klijentom, v. popis
-- iznad), pa su bile čista napadačka površina. Čitanje (storage_dok_sel) i brisanje (storage_dok_del,
-- admin-only) ostaju na snazi, tako da tabela NIJE bez zaštite — bez politike za INSERT/UPDATE
-- Postgres podrazumijevano odbija upis, što je i cilj.
drop policy if exists storage_dok_ins on storage.objects;
drop policy if exists storage_dok_upd on storage.objects;
-- zaostatak iz ranijih revizija (20260627110000 / 20260701120000): "for all" politika koja bi,
-- ako je negdje preživjela, ponovo otvorila INSERT/UPDATE korisničkom JWT-u.
drop policy if exists storage_dok_wr on storage.objects;

do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'ALL');
  if n > 0 then
    raise exception 'storage.objects i dalje ima % INSERT/UPDATE/ALL politika — korisnički JWT bi mogao pisati u bucket', n;
  end if;
end
$$;
