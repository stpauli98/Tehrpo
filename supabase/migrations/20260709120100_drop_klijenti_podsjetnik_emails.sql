-- CONTRACT korak: primaoci firminih podsjetnika sada žive na kontakt_osobe.podsjetnik_primalac.
-- Pušta se TEK nakon što je novi kod (koji ne referiše ovu kolonu) živ na svim instancama.
alter table klijenti drop column podsjetnik_emails;
