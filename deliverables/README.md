# Livrables jury — Sentinel (Track 01)

Documents destinés au jury et au pitch. Chiffres réels, reproductibles depuis le repo.

- **defense-sheet.md** — la fiche défense 1 page (menace, parade, NIST CSF / OWASP / ATLAS, métriques, limites).
- **compliance.md** — DORA / MiCA / AML / AI Act : comment la trace on-chain + le human-in-the-loop répondent à chaque cadre.
- **compliance.pdf** : la version brandée Sentinel (design DESIGN.md) à remettre au jury. Régénérer avec `python deliverables/build_compliance_pdf.py` (HTML + Chrome headless).
- **response-playbook.md** — ce que fait le système à chaque verdict (allow / block / human) et qui agit.
- **pitch-4min.md** — le script de pitch 4 minutes.
- **golden-path-demo.md** — la démo en 3 actes (agent vidé → sauvé → immunisé), écrans et commandes.
- **dashboard.html** — tableau de bord KPI autonome (ouvrir dans un navigateur).

Reproduire les chiffres : `GUARD_LLM=off .venv/bin/python redteam/run.py` · `… battery100.py` · `… evasion.py` ·
`set -a; source .env; set +a; .venv/bin/python redteam/validate_onchain.py`.
