-- Add UNIQUE constraint to klijenti.naziv
-- Required for seed idempotency (upsert onConflict: "naziv")
-- Spec assumption was CHECK only; seed script needs UNIQUE.

alter table klijenti
  add constraint klijenti_naziv_unique unique (naziv);
