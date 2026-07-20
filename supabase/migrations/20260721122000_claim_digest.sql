-- Atomski claim, isti obrazac kao claim_post_due iz PR-a 1: PostgREST ne može izraziti
-- "on conflict do update ... where ... returning", pa claim mora biti SQL funkcija.
-- Prazan rezultat = claim drži neko drugi ili je posao završen → pozivalac preskače.
create or replace function claim_digest(p_email text, p_datum date)
returns uuid
language sql
volatile
security invoker
set search_path = public
as $$
  insert into digest_slanja (primalac_email, datum, stanje, claimed_at)
  values (p_email, p_datum, 'u_toku', now())
  on conflict (primalac_email, datum) do update
    set claimed_at = now()
    where digest_slanja.stanje = 'u_toku'
      and digest_slanja.claimed_at < now() - interval '15 minutes'
  returning id;
$$;

revoke execute on function claim_digest(text, date) from public, anon, authenticated;
grant  execute on function claim_digest(text, date) to service_role;
