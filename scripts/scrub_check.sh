#!/usr/bin/env bash
# scrub_check.sh - audit secrets avant publication du repo (historique git + working tree)
#
# Usage : scripts/scrub_check.sh [--no-history] [--quiet]
#   --no-history   ne scanne que le working tree (rapide, utile en pre-commit)
#   --quiet        n'affiche que le resume et les constats
#
# Sortie : 0 = rien de sensible, 1 = au moins un constat FAIL, 2 = erreur d'usage.
# Dependances : git, grep (BSD ou GNU), awk, xargs. Pas d'install, bash 3.2 OK (macOS).
#
# Deux niveaux :
#   FAIL = secret ou fichier interdit (bloque la publication, exit 1)
#   WARN = a verifier a l'oeil (adresse inconnue, email inconnu, IP, chemin local), exit 0
# Les valeurs synthetiques connues du projet sont dans ALLOW_* ci-dessous.

set -u
LC_ALL=C; export LC_ALL

SCAN_HISTORY=1
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --no-history) SCAN_HISTORY=0 ;;
    --quiet|-q) QUIET=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "argument inconnu: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "pas un depot git" >&2; exit 2; }
cd "$ROOT" || exit 2

TMP="$(mktemp -d "${TMPDIR:-/tmp}/scrub_check.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

N_FAIL=0
N_WARN=0

log()  { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
# masque une valeur sensible : 4 premiers caracteres + longueur
mask() {
  local s="$1"
  if [ "${#s}" -le 8 ]; then printf '%s' "$s"; else printf '%s...(%d chars)' "${s:0:4}" "${#s}"; fi
}
report() { # level category where match
  local lvl="$1" cat="$2" where="$3" m="$4"
  if [ "$lvl" = FAIL ]; then
    N_FAIL=$((N_FAIL+1))
    case "$cat" in fichier_*|env_suivi) ;; *) m="$(mask "$m")" ;; esac   # on ne masque que les valeurs
  else
    N_WARN=$((N_WARN+1))
  fi
  printf '[%s] %-22s %s  ->  %s\n' "$lvl" "$cat" "$where" "$m"
}

# ---------------------------------------------------------------------------
# Allowlist : valeurs synthetiques / publiques connues (regex ERE, insensible a la casse)
# ---------------------------------------------------------------------------
# adresses EVM de test (prefixes parlants) + adresses PUBLIQUES deployees (pas des secrets)
ALLOW_ADDR='0x(a11ce|bad0|badc0ffee|dead|5e11e4|5e12e4|fac[19]|095ea7b3|0{10})'
ALLOW_ADDR="$ALLOW_ADDR|0xaF11630142CF1f829B87c586C0a6C980B61A855d"  # admin/genesis SentinelL1 (adresse publique)
ALLOW_ADDR="$ALLOW_ADDR|0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6"  # AuthorityRegistry deploye
ALLOW_ADDR="$ALLOW_ADDR|0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0"  # GuardedVault deploye
# 64 hex : hashes (pas des cles) + valeurs de test
ALLOW_HEX64='(instruction_id|tx_hash|txhash|transactionhash|block_hash|blockhash|"hash"|sha256|digest|parenthash|mixhash|stateroot)'
ALLOW_HEX64="$ALLOW_HEX64|8f0ab1a4e5b5e6d1b1a1c0ff1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d"  # hash outil MCP fictif
ALLOW_HEX64="$ALLOW_HEX64|0x095ea7b3|0{64}|beefff+"                                       # calldata approve() de test, zero, 0xdead..beef
# emails synthetiques des fixtures / red-team
ALLOW_EMAIL='(team2-labs-corp\.com|team2labs\.io|walmart-deals-shop\.online|acme-saas\.io|secure-wellsfargo-login\.com|example\.(com|org|net)|laura\.bennett\.ceo@protonmail\.com|alerts@protonmail\.com|noreply@anthropic\.com|users\.noreply\.github\.com)'
# IP / hotes d'infra hackathon (EC2 ephemere, compte efface a la fin) + loopback
ALLOW_IP='(127\.0\.0\.1|0\.0\.0\.0|54\.70\.187\.95)'
# faux numeros de carte (Stripe test) et IBAN de test
ALLOW_CARD='(4242[ -]?4242[ -]?4242[ -]?4242|4000[ -]?0000[ -]?0000[ -]?[0-9]{4}|0000[ -]?0000[ -]?0000)'
ALLOW_IBAN='[A-Z]{2}[0-9]{2}0{8,}'
# litteraux generiques acceptables
ALLOW_GENERIC='(canary|FLAG\{|example|placeholder|changeme|your_|dummy|<[a-z_ ]+>|\$\{|os\.environ|getenv|\.\.\.|xxx|AKIAIOSFODNN7EXAMPLE|wJalrXUtnFEMI)'

# fichiers d'audit eux-memes (contiennent les regex et des exemples)
SELF_FILES='^(scripts/scrub_check\.sh|docs/scrub-report\.md)$'

# ---------------------------------------------------------------------------
# Patterns (ERE grep). Chaque entree : ID|LEVEL|REGEX|ALLOW
# ---------------------------------------------------------------------------
RE_AWS_KEY='(AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}'
RE_AWS_SECRET='([Aa][Ww][Ss]_?[Ss][Ee][Cc][Rr][Ee][Tt]_?[Aa][Cc][Cc][Ee][Ss][Ss]_?[Kk][Ee][Yy]|secret_key|SecretAccessKey)[^A-Za-z0-9]{1,6}[A-Za-z0-9/+]{40}([^A-Za-z0-9/+]|$)'
RE_AWS_SESSION='(IQoJb3JpZ2luX2Vj|FwoGZXIvYXdz|AgoJb3JpZ2luX2Vj|(AWS_SESSION_TOKEN|aws_session_token|SessionToken)[^A-Za-z0-9]{1,6}[A-Za-z0-9/+=]{100,})'
RE_PEM='BEGIN [A-Z ]*PRIVATE KEY'
RE_HEX64='(^|[^0-9a-zA-Z_])(0x)?[0-9a-fA-F]{64}([^0-9a-zA-Z_]|$)'
RE_ADDR40='0x[0-9a-fA-F]{40}([^0-9a-fA-F]|$)'
RE_MNEMONIC='(mnemonic|seed[_ -]?phrase|MNEMONIC|SEED)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?([a-z]{3,8} ){11,23}[a-z]{3,8}|["'"'"']([a-z]{3,8} ){11,23}[a-z]{3,8}["'"'"']'
RE_TOKENS='(Bearer[[:space:]]+[A-Za-z0-9._~+/=-]{20,}|sk-(ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{36}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})'
RE_RPC_KEY='https?://[^/[:space:]"'"'"']*(infura\.io|alchemy(api)?\.com|quiknode\.pro|ankr\.com|moralis\.io|getblock\.io|chainstack\.com|nodereal\.io)/[^[:space:]"'"'"']*[A-Za-z0-9_-]{20,}'
RE_GENERIC='(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorizer_key|deployer_key|owner_key)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{12,}["'"'"']'
RE_EMAIL='[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
RE_IP='(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)'
RE_IBAN='(^|[^0-9A-Za-z])(FR|DE|GB|ES|IT|NL|BE|CH|LU|AT|PT|IE|AD)[0-9]{2}( ?[A-Z0-9]{4}){2,7}( ?[A-Z0-9]{1,4})?([^0-9A-Za-z]|$)'
RE_CARD='(^|[^0-9.])(4[0-9]{3}|5[1-5][0-9]{2}|3[47][0-9]{2}|6011)[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{3,4}([^0-9.]|$)'
RE_LOCALPATH='(/Users/[A-Za-z0-9._-]+|/home/[a-z][a-z0-9_-]+)'
RE_ENVLINE='^\+?(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|PRIVATE_KEY|AUTHORIZER_KEY|DEPLOYER_KEY|MNEMONIC)=[^[:space:]]{8,}'

# fichiers qui ne doivent jamais etre suivis (ni maintenant, ni dans l'historique)
RE_FORBIDDEN_FILES='((^|/)\.env$|(^|/)\.env\.[^/]+$|\.pem$|\.key$|\.keystore$|(^|/)credentials$|(^|/)secrets\.json$|\.log$|^data/decisions\.jsonl$|^data/pending\.json$|^data/nonces\.json$|^data/threats\.mock\.json$|^agents/out/|^demo/out/data/|(^|/)\.aws/)'
ALLOW_FORBIDDEN_FILES='(^|/)\.env\.example$'

# ---------------------------------------------------------------------------
# 1. Fichiers interdits : index + historique complet (toutes branches)
# ---------------------------------------------------------------------------
log "== 1/4 fichiers interdits (index git + historique toutes branches)"
git ls-files | grep -E "$RE_FORBIDDEN_FILES" | grep -vE "$ALLOW_FORBIDDEN_FILES" | while IFS= read -r f; do
  report FAIL fichier_suivi "index:$f" "fichier sensible suivi par git"
done > "$TMP/r1"
if [ "$SCAN_HISTORY" -eq 1 ]; then
  git log --all --name-only --format= 2>/dev/null | sort -u | grep -E "$RE_FORBIDDEN_FILES" | grep -vE "$ALLOW_FORBIDDEN_FILES" | while IFS= read -r f; do
    c="$(git log --all --format=%h -1 -- "$f" 2>/dev/null)"
    report FAIL fichier_historique "commit $c:$f" "fichier sensible present dans l'historique"
  done >> "$TMP/r1"
fi
cat "$TMP/r1"
N_FAIL=$((N_FAIL + $(grep -c '^\[FAIL\]' "$TMP/r1" || true)))

# .gitignore couvre-t-il bien les fichiers d'etat ?
for p in .env mcp_server.log data/decisions.jsonl data/pending.json data/nonces.json data/threats.mock.json agents/out/x.json demo/out/data/decisions.jsonl; do
  if ! git check-ignore -q "$p" 2>/dev/null; then
    report WARN gitignore_manquant "$p" "pas couvert par .gitignore"
  fi
done

# ---------------------------------------------------------------------------
# Scanner generique : prend un flux "where<TAB>line" et applique regex + allowlist
#   scan_stream LEVEL CATEGORY REGEX ALLOW < flux
# where = "commit abc1234 path" ou "wt path:lineno"
# ---------------------------------------------------------------------------
scan_stream() {
  local lvl="$1" cat="$2" re="$3" allow="${4:-}"
  local where line m
  grep -aE "$re" | { if [ -n "$allow" ]; then grep -aviE "$allow"; else cat; fi; } | \
  while IFS="$(printf '\t')" read -r where line; do
    m="$(printf '%s\n' "$line" | grep -aoE "$re" | head -1)"
    [ -n "$m" ] || m="$(printf '%.80s' "$line")"
    # suppression des bornes non-hex captur ees par les regex de contexte
    m="$(printf '%s' "$m" | sed -E 's/^[^0-9A-Za-z"'"'"'+/]+//; s/[^0-9A-Za-z"'"'"'+/=]+$//')"
    report "$lvl" "$cat" "$where" "$m"
  done
}

run_all_patterns() { # lit le flux depuis un fichier "where<TAB>line" ($1)
  local src="$1"
  scan_stream FAIL aws_access_key_id   "$RE_AWS_KEY"       "$ALLOW_GENERIC"                      < "$src"
  scan_stream FAIL aws_secret_key      "$RE_AWS_SECRET"    "$ALLOW_GENERIC"                      < "$src"
  scan_stream FAIL aws_session_token   "$RE_AWS_SESSION"   ''                                    < "$src"
  scan_stream FAIL env_valeur_en_clair "$RE_ENVLINE"       "$ALLOW_GENERIC"                      < "$src"
  scan_stream FAIL pem_private_key     "$RE_PEM"           ''                                    < "$src"
  scan_stream FAIL cle_privee_hex64    "$RE_HEX64"         "$ALLOW_HEX64"                        < "$src"
  scan_stream FAIL mnemonic            "$RE_MNEMONIC"      "$ALLOW_GENERIC"                      < "$src"
  scan_stream FAIL token_api           "$RE_TOKENS"        "$ALLOW_GENERIC"                      < "$src"
  scan_stream FAIL rpc_url_avec_cle    "$RE_RPC_KEY"       "$ALLOW_GENERIC"                      < "$src"
  scan_stream FAIL secret_litteral     "$RE_GENERIC"       "$ALLOW_GENERIC|$ALLOW_ADDR|$ALLOW_HEX64" < "$src"
  scan_stream FAIL iban                "$RE_IBAN"          "$ALLOW_IBAN|$ALLOW_ADDR"             < "$src"
  scan_stream WARN numero_carte        "$RE_CARD"          "$ALLOW_CARD|0x[0-9a-fA-F]{20,}|[0-9]{17,}" < "$src"
  scan_stream WARN adresse_evm_inconnue "$RE_ADDR40"       "$ALLOW_ADDR|[0-9a-fA-F]{64}"         < "$src"
  scan_stream WARN email_inconnu       "$RE_EMAIL"         "$ALLOW_EMAIL"                        < "$src"
  scan_stream WARN ip_publique         "$RE_IP"            "$ALLOW_IP|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\.[0-9]|version|v[0-9]\.[0-9]" < "$src"
  scan_stream WARN chemin_local        "$RE_LOCALPATH"     '/home/user|/Users/user|/Users/you'   < "$src"
}

# ---------------------------------------------------------------------------
# 2. Historique git complet : toutes branches, tous patches
# ---------------------------------------------------------------------------
if [ "$SCAN_HISTORY" -eq 1 ]; then
  log "== 2/4 historique git (git log -p --all, $(git rev-list --all --count) commits)"
  git log -p --all --no-color --format='@@COMMIT %h' > "$TMP/patch"
  # transforme le patch en flux "commit <h> <file><TAB><contenu>" (seulement lignes +/- du diff)
  awk -F'\t' '
    /^@@COMMIT /{c=$0; sub(/^@@COMMIT /,"",c); next}
    /^diff --git /{f=$0; sub(/^diff --git a\/.* b\//,"",f); next}
    /^(index |--- |\+\+\+ |@@ |Binary files|similarity|rename |new file|deleted file|old mode|new mode)/{next}
    /^[-+]/{ if (f ~ /^(scripts\/scrub_check\.sh|docs\/scrub-report\.md)$/) next; printf "commit %s %s\t%s\n", c, f, substr($0,2) }
  ' "$TMP/patch" > "$TMP/hist_stream"
  run_all_patterns "$TMP/hist_stream" > "$TMP/r2"
  sort -u "$TMP/r2"
  N_FAIL=$((N_FAIL + $(sort -u "$TMP/r2" | grep -c '^\[FAIL\]' || true)))
  N_WARN=$((N_WARN + $(sort -u "$TMP/r2" | grep -c '^\[WARN\]' || true)))
else
  log "== 2/4 historique git : ignore (--no-history)"
fi

# ---------------------------------------------------------------------------
# 3. Working tree : fichiers suivis + non suivis non ignores (texte seulement)
# ---------------------------------------------------------------------------
log "== 3/4 working tree (fichiers suivis + non suivis non ignores)"
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u | grep -vE "$SELF_FILES" > "$TMP/wt_files"
: > "$TMP/wt_stream"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  grep -Iq . "$f" 2>/dev/null || continue   # saute les binaires et fichiers vides
  grep -an '' "$f" | sed -E "s#^([0-9]+):#wt $f:\1$(printf '\t')#"
done < "$TMP/wt_files" >> "$TMP/wt_stream"
run_all_patterns "$TMP/wt_stream" > "$TMP/r3"
sort -u "$TMP/r3"
N_FAIL=$((N_FAIL + $(sort -u "$TMP/r3" | grep -c '^\[FAIL\]' || true)))
N_WARN=$((N_WARN + $(sort -u "$TMP/r3" | grep -c '^\[WARN\]' || true)))

# ---------------------------------------------------------------------------
# 4. .env local : ses valeurs reelles ne doivent apparaitre nulle part ailleurs
# ---------------------------------------------------------------------------
log "== 4/4 valeurs du .env local vs historique + working tree"
if [ -f .env ]; then
  grep -E '^[A-Z_]+=.{16,}' .env | grep -vE '^(AWS_(DEFAULT_)?REGION)=' | while IFS='=' read -r k v; do
    v="${v%\"}"; v="${v#\"}"
    [ "${#v}" -ge 16 ] || continue
    if [ "$SCAN_HISTORY" -eq 1 ] && grep -aqF -- "$v" "$TMP/patch" 2>/dev/null; then
      report FAIL env_fuite_historique "$k" "$v"
    fi
    if grep -aqF -- "$v" "$TMP/wt_stream" 2>/dev/null; then
      report FAIL env_fuite_worktree "$k" "$v"
    fi
  done > "$TMP/r4"
  cat "$TMP/r4"
  N_FAIL=$((N_FAIL + $(grep -c '^\[FAIL\]' "$TMP/r4" || true)))
  git ls-files --error-unmatch .env >/dev/null 2>&1 && { report FAIL env_suivi ".env" "suivi par git"; N_FAIL=$((N_FAIL+1)); }
else
  log "   (pas de .env local)"
fi

# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------
echo
echo "== resume : $N_FAIL FAIL, $N_WARN WARN"
if [ "$N_FAIL" -gt 0 ]; then
  echo "   NE PAS PUBLIER. Voir docs/scrub-report.md (rotation des creds + git filter-repo)."
  exit 1
fi
echo "   OK : rien de sensible detecte. Les WARN sont a relire a l'oeil (adresses/emails/IP publics)."
exit 0
