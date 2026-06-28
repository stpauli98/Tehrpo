#!/usr/bin/env bash
# Mjeri TTFB ključnih ruta. Auth preko Supabase REST logina (bez Playwrighta).
# Upotreba: bash scripts/measure-ttfb.sh [BASE_URL]   (default http://localhost:3000)
set -euo pipefail
BASE_URL="${1:-http://localhost:3000}"
getvar() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }
NEXT_PUBLIC_SUPABASE_URL=$(getvar NEXT_PUBLIC_SUPABASE_URL)
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(getvar NEXT_PUBLIC_SUPABASE_ANON_KEY)
E2E_ADMIN_EMAIL=$(getvar E2E_ADMIN_EMAIL)
E2E_ADMIN_LOZINKA=$(getvar E2E_ADMIN_LOZINKA)
: "${NEXT_PUBLIC_SUPABASE_URL:?}"; : "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?}"; : "${E2E_ADMIN_EMAIL:?}"; : "${E2E_ADMIN_LOZINKA:?}"

AUTH=$(curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "Content-Type: application/json" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -d "{\"email\":\"$E2E_ADMIN_EMAIL\",\"password\":\"$E2E_ADMIN_LOZINKA\"}")
REF=$(printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https?://([^.]+)\..*#\1#')
COOKIE="sb-${REF}-auth-token=base64-$(printf '%s' "$AUTH" | jq -c '.' | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')"

measure() { printf '%-46s ' "$2"; curl -s -o /dev/null -H "Cookie: $COOKIE" \
  -w 'TTFB %{time_starttransfer}s | total %{time_total}s\n' "$BASE_URL$1"; }

echo "== Region header =="; curl -s -o /dev/null -D - "$BASE_URL/prijava" | grep -i x-vercel-id || echo "(lokalno — nema x-vercel-id)"
echo "== TTFB =="
measure "/pregled" "Pregled (4 upita)"
measure "/plan-aktivnosti" "Plan aktivnosti (lista, 5 upita)"
measure "/plan-aktivnosti?view=matrica" "Plan aktivnosti (matrica)"
measure "/plan-aktivnosti?view=kalendar" "Plan aktivnosti (kalendar)"
measure "/klijenti" "Klijenti"
measure "/obilasci" "Obilasci"
