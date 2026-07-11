-- chat_poruke: uvedi vlasnika (korisnik_id) i scope-uj RLS po vlasniku.
-- RANIJE (20260626211000): jedina politika chat_all = FOR ALL USING (auth.uid() is not null)
--   → (1) svaki prijavljeni je čitao/brisao/mijenjao TUĐE AI razgovore (cross-user leak; poruke
--       mogu sadržavati podatke o klijentima), i (2) 'pregled' (read-only rola) je mogao pisati
--       jer je nedostajao 'not je_pregled()'. Potvrđeno živom introspekcijom (PROD i DEMO) 2026-07-11.
-- SADA: konverzacija je vlasništvo korisnika; svako vidi/piše SAMO svoje; 'pregled' ne piše (asistent
--   mu je i UI-om sakriven — vidi Sidebar/asistent guard). Nema izmjene app upisa: default auth.uid()
--   popunjava vlasnika automatski (app/api/chat/route.ts upisuje preko SSR/authenticated klijenta).
-- Postojeći redovi nemaju vlasnika (ne mogu se pouzdano pripisati) → brišu se (odluka korisnika).
-- Re-run-safe: 'delete where korisnik_id is null' na re-run pogađa 0 redova (svi noviji imaju vlasnika).

-- 1) Kolona vlasnika (prvo nullable da postojeći redovi dobiju NULL).
alter table chat_poruke add column if not exists korisnik_id uuid;

-- 2) Obriši stare redove bez vlasnika (jednokratno; re-run-safe jer noviji redovi imaju vlasnika).
delete from chat_poruke where korisnik_id is null;

-- 3) Default + NOT NULL + FK (poslije brisanja, kad nema NULL-ova).
alter table chat_poruke alter column korisnik_id set default auth.uid();
alter table chat_poruke alter column korisnik_id set not null;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'chat_poruke_korisnik_id_fkey'
  ) then
    alter table chat_poruke
      add constraint chat_poruke_korisnik_id_fkey
      foreign key (korisnik_id) references korisnici(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_chat_korisnik on chat_poruke (korisnik_id, konverzacija_id, created_at);

-- 4) Zamijeni pločastu politiku scope-ovanim po vlasniku.
--    App radi samo SELECT + INSERT nad chat_poruke → namjerno bez UPDATE/DELETE politike
--    (append-only per korisnik; tamper preko JWT-a default-deny). 'pregled' ne može INSERT.
drop policy if exists chat_all on chat_poruke;
drop policy if exists chat_sel on chat_poruke;
drop policy if exists chat_ins on chat_poruke;

create policy chat_sel on chat_poruke for select
  using ( korisnik_id = auth.uid() );

create policy chat_ins on chat_poruke for insert
  with check ( korisnik_id = auth.uid() and not je_pregled() );
