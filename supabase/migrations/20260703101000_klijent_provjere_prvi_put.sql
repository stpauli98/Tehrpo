-- "Prvi put" tok (2026-07-03): novi klijent dodaje provjeru koju nikad nije radio.
-- Takva stavka profila nema zadnji datum — prvi rok se zadaje direktno i upisuje
-- u termini.rok_dospijeca (termini.datum_zadnjeg ostaje NULL, pa tg_termini_compute_rok
-- ne dira rok). NOT NULL na zadnji_datum zato pada; NULL = "još nije rađeno".
alter table klijent_provjere alter column zadnji_datum drop not null;
