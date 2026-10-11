"""Build deliverables/compliance.html (branded, self-contained) then print it to compliance.pdf with headless Chrome.
Design system: DESIGN.md (ink #171717 / canvas #fafafa, hairlines, Geist, mono for technical, dark hero band). No em dashes.

Usage: python deliverables/build_compliance_pdf.py
"""
import base64
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_HTML = ROOT / "deliverables" / "compliance.html"
OUT_PDF = ROOT / "deliverables" / "compliance.pdf"
LOGO_WHITE = ROOT / "explorer" / "frontend" / "static" / "sentinel-logo-white.png"
LOGO_DARK = ROOT / "explorer" / "frontend" / "static" / "sentinel-logo.png"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def b64(p: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()


logo_white = b64(LOGO_WHITE)
logo_dark = b64(LOGO_DARK)

FRAMEWORKS = [
    ("DORA", "Digital Operational Resilience Act", [
        "Journal d'incidents inviolable : chaque block ou flag est un événement on-chain daté, une piste d'audit non répudiable (journalisation et détection des incidents TIC).",
        "Détection et réponse : le garde détecte (7 couches + IA) et répond (block / flag / escalade) en environ 1,4 ms (heuristiques) ou environ 3 s (fusion IA) ; un incident DORA est ouvert automatiquement au refus.",
        "Résilience : repli local si la chaîne est injoignable (le verdict tient), et le paiement ne passe jamais sans visa valide (fail-closed via GuardedVault).",
        "Reporting : métriques exportables (taux de détection, faux positifs, temps de détection et de réponse, nombre d'incidents) pour le registre d'incidents.",
    ]),
    ("MiCA", "Markets in Crypto-Assets", [
        "Traçabilité des transferts : émetteur, bénéficiaire, montant, verdict et motif inscrits on-chain.",
        "Contrôle du bénéficiaire : registre de menaces on-chain et allowlist des contreparties, refus des adresses signalées (address poisoning, marchand fantôme).",
        "Gouvernance : décision par smart contract (AuthorityRegistry), autorités révocables, flags contestables (clearThreat, le droit de recours).",
    ]),
    ("AI Act", "Règlement IA de l'Union européenne", [
        "Transparence et explicabilité : chaque décision est explicable (signaux cités, poids, formule OU bruité, seuils affichés).",
        "Surveillance humaine : la zone de doute (30 à 70) est escaladée à un humain avant tout paiement ; sa décision est tracée.",
        "Robustesse : banc de tests honnête (détection 100 %, évasion 814 essais, faux positifs 0 %) et un adversaire adaptatif réel (0 bypass).",
        "Journalisation : enregistrement automatique des décisions (logs + on-chain) sur toute la durée de vie.",
        "Gestion du risque : pas d'allow deviné sans preuve, plancher humain quand l'IA est indisponible.",
    ]),
]

AML_BULLETS = [
    "Qui paie qui, combien, pourquoi : attaché à chaque transaction (éléments Travel Rule).",
    "Détection de schémas : structuring (montant juste sous le plafond), vélocité, bénéficiaire récemment modifié, honeypot ou contrat non vérifié.",
    "Registre des adresses à risque : partagé on-chain, la deuxième tentative vers une adresse flaguée est refusée d'office.",
]

KYB = ("KYB souverain", "know your beneficiary",
       "Couche opt-in (GUARD_KYB=on) qui vérifie le bénéficiaire contre le registre officiel des entreprises de l'État "
       "(API Recherche d'entreprises, data.gouv.fr / DINUM). Entreprise active et correspondante : preuve officielle "
       "attachée à la décision (SIREN + état). Bénéficiaire radié, introuvable ou nom non concordant : signal de risque et "
       "escalade humaine. Vérification par une source tierce officielle, loggée et rejouable (exigence DORA sur les tiers), "
       "jamais déclarative. Si le registre est indisponible, aucun paiement n'est débloqué pour autant (fail-closed via les "
       "autres couches).")


def card(label, sub, bullets):
    lis = "".join(f"<li>{b}</li>" for b in bullets)
    return f"""
      <section class="card">
        <div class="card__head"><span class="eyebrow">{label}</span><span class="card__sub">{sub}</span></div>
        <ul>{lis}</ul>
      </section>"""


cards_html = card("DORA", FRAMEWORKS[0][1], FRAMEWORKS[0][2])
cards_html += card("MiCA", FRAMEWORKS[1][1], FRAMEWORKS[1][2])
# AML card with the sovereign KYB highlight nested inside
aml_lis = "".join(f"<li>{b}</li>" for b in AML_BULLETS)
cards_html += f"""
      <section class="card">
        <div class="card__head"><span class="eyebrow">AML / CFT</span><span class="card__sub">Travel Rule</span></div>
        <ul>{aml_lis}</ul>
        <div class="kyb">
          <div class="kyb__head"><span class="eyebrow eyebrow--link">{KYB[0]}</span><span class="pill">souverain</span><span class="card__sub">{KYB[1]}</span></div>
          <p>{KYB[2]}</p>
        </div>
      </section>"""
cards_html += card("AI Act", FRAMEWORKS[2][1], FRAMEWORKS[2][2])

HTML = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>Sentinel - Conformite</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {{
    --ink:#171717; --body:#4d4d4d; --mute:#888; --canvas:#fafafa; --card:#fff;
    --soft:#f5f5f5; --hair:#ebebeb; --link:#0070f3; --error:#ee0000; --warn:#f5a623;
  }}
  * {{ box-sizing:border-box; }}
  @page {{ size:A4; margin:14mm 13mm; }}
  html,body {{ margin:0; padding:0; }}
  body {{ font-family:"Geist","Inter",system-ui,sans-serif; color:var(--ink); background:#fff; font-size:10.5px; line-height:1.5; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
  .mono {{ font-family:"Geist Mono",ui-monospace,Menlo,monospace; }}
  .eyebrow {{ font-family:"Geist Mono",ui-monospace,monospace; font-size:10px; font-weight:500; letter-spacing:.08em; text-transform:uppercase; color:var(--ink); }}
  .eyebrow--link {{ color:var(--link); }}

  /* HERO dark band */
  .hero {{ background:var(--ink); color:#fff; border-radius:14px; padding:30px 30px 26px; position:relative; overflow:hidden; }}
  .hero .brandmesh {{ position:absolute; inset:0; opacity:.26; background:
      radial-gradient(60% 120% at 12% 0%, #007cf0 0%, transparent 45%),
      radial-gradient(60% 120% at 92% 10%, #7928ca 0%, transparent 45%),
      radial-gradient(70% 120% at 70% 110%, #ff0080 0%, transparent 50%),
      radial-gradient(50% 120% at 30% 120%, #f9cb28 0%, transparent 45%); }}
  .hero > * {{ position:relative; }}
  .hero__top {{ display:flex; align-items:center; gap:10px; }}
  .hero__top img {{ height:26px; width:26px; object-fit:contain; }}
  .hero__top .eyebrow {{ color:rgba(255,255,255,.72); }}
  .hero h1 {{ font-size:38px; font-weight:600; letter-spacing:-1.9px; margin:16px 0 8px; }}
  .hero p.thesis {{ color:rgba(255,255,255,.82); font-size:12px; max-width:62ch; margin:0 0 16px; }}
  .badges {{ display:flex; gap:8px; flex-wrap:wrap; }}
  .badge {{ font-family:"Geist Mono",monospace; font-size:9.5px; letter-spacing:.04em; color:#fff; border:1px solid rgba(255,255,255,.28); border-radius:100px; padding:3px 10px; }}
  .badge--live::before {{ content:""; display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--link); margin-right:6px; vertical-align:middle; }}

  /* legend row */
  .legend {{ display:flex; gap:18px; flex-wrap:wrap; margin:14px 2px 2px; font-size:10px; color:var(--body); }}
  .legend b {{ color:var(--ink); font-weight:600; }}
  .legend .mono {{ color:var(--ink); }}

  /* cards grid */
  .grid {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }}
  .card {{ background:var(--card); border:1px solid var(--hair); border-radius:10px; padding:16px 18px; box-shadow:0 1px 1px #00000005,0 2px 2px #0000000a; break-inside:avoid; }}
  .card__head {{ display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }}
  .card__sub {{ color:var(--mute); font-size:10px; }}
  .card ul {{ margin:0; padding:0; list-style:none; }}
  .card li {{ color:var(--body); padding:4px 0 4px 14px; position:relative; }}
  .card li::before {{ content:""; position:absolute; left:0; top:9px; width:5px; height:5px; border-radius:50%; background:var(--ink); }}
  .card li + li {{ border-top:1px solid var(--hair); }}

  /* KYB highlight nested */
  .kyb {{ margin-top:10px; background:var(--soft); border:1px solid var(--hair); border-left:3px solid var(--link); border-radius:8px; padding:11px 13px; }}
  .kyb__head {{ display:flex; align-items:center; gap:8px; margin-bottom:5px; }}
  .pill {{ font-family:"Geist Mono",monospace; font-size:8.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--link); border:1px solid var(--link); border-radius:100px; padding:1px 8px; }}
  .kyb p {{ margin:0; color:var(--body); }}

  /* thresholds callout */
  .thresholds {{ margin-top:12px; background:var(--ink); color:#fff; border-radius:10px; padding:16px 18px; break-inside:avoid; }}
  .thresholds .eyebrow {{ color:rgba(255,255,255,.7); }}
  .trow {{ display:flex; gap:12px; margin-top:10px; flex-wrap:wrap; }}
  .tcell {{ flex:1; min-width:160px; border:1px solid rgba(255,255,255,.16); border-radius:8px; padding:10px 12px; }}
  .tcell .dot {{ display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:7px; vertical-align:middle; }}
  .tcell .t {{ font-weight:600; font-size:12px; }}
  .tcell .d {{ color:rgba(255,255,255,.7); font-size:10px; margin-top:3px; }}
  .thresholds .note {{ color:rgba(255,255,255,.6); font-size:9.5px; margin-top:10px; }}

  /* proofs footer */
  .proofs {{ margin-top:12px; border:1px solid var(--hair); border-radius:10px; padding:13px 16px; break-inside:avoid; }}
  .proofs .eyebrow {{ color:var(--mute); }}
  .proofs .row {{ display:flex; gap:8px 20px; flex-wrap:wrap; margin-top:7px; }}
  .proofs .kv {{ font-size:10px; color:var(--body); }}
  .proofs .kv b {{ color:var(--ink); font-weight:600; }}
  .proofs .mono {{ color:var(--ink); }}
  .foot {{ margin-top:10px; display:flex; justify-content:space-between; color:var(--mute); font-size:9px; }}
</style></head>
<body>
  <div class="hero">
    <div class="brandmesh"></div>
    <div class="hero__top"><img src="{logo_white}" alt="Sentinel"><span class="eyebrow">Sentinel &middot; ESSECKATHON Track 01 &middot; Fintech Security</span></div>
    <h1>Conformité</h1>
    <p class="thesis">Chaque décision de paiement d'agent devient une preuve inviolable, horodatée et rejouable sur Avalanche. L'audit n'est plus déclaratif, il est vérifiable on-chain.</p>
    <div class="badges">
      <span class="badge badge--live">SentinelL1 Live</span>
      <span class="badge">chainId 99999</span>
      <span class="badge">token SEC</span>
      <span class="badge">2026-10-11</span>
    </div>
  </div>

  <div class="legend">
    <span><b>Un contrôle</b> = <span class="mono">DecisionRecorded</span></span>
    <span><b>Un refus</b> = <span class="mono">ThreatFlagged</span></span>
    <span><b>Une autorisation</b> = <span class="mono">VisaGranted</span> (visa à usage unique)</span>
  </div>

  <div class="grid">
    {cards_html}
  </div>

  <div class="thresholds">
    <span class="eyebrow">Seuils de décision &middot; recommandation KPMG</span>
    <div class="trow">
      <div class="tcell"><div class="t"><span class="dot" style="background:#0070f3"></span>Confiance &ge; 70</div><div class="d">Visa délivré, le paiement passe</div></div>
      <div class="tcell"><div class="t"><span class="dot" style="background:#f5a623"></span>30 à 70</div><div class="d">Escalade à un humain avant tout paiement</div></div>
      <div class="tcell"><div class="t"><span class="dot" style="background:#ee0000"></span>Confiance &lt; 30</div><div class="d">Refus et flag de l'adresse au registre</div></div>
    </div>
    <div class="note">Seuils resserrés automatiquement quand le montant approche le plafond du mandat.</div>
  </div>

  <div class="proofs">
    <span class="eyebrow">Preuves on-chain &middot; vérifiables par le jury</span>
    <div class="row">
      <span class="kv"><b>Chaîne</b> <span class="mono">SentinelL1 (chainId 99999)</span></span>
      <span class="kv"><b>AuthorityRegistry</b> <span class="mono">0x7A7e&hellip;bcb6</span></span>
      <span class="kv"><b>GuardedVault</b> <span class="mono">0xc7de&hellip;C7c0</span></span>
      <span class="kv"><b>Explorer</b> <span class="mono">https://explorer.petroi.fr</span></span>
    </div>
  </div>

  <div class="foot">
    <span>Sentinel &middot; le garde des paiements d'agents IA</span>
    <span>Chaque voiture de la ville 3D = un DecisionRecorded réel &middot; city.petroi.fr</span>
  </div>
</body></html>"""

OUT_HTML.write_text(HTML, encoding="utf-8")
print("wrote", OUT_HTML)

url = OUT_HTML.resolve().as_uri()
cmd = [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
       "--run-all-compositor-stages-before-draw", "--virtual-time-budget=4000",
       f"--print-to-pdf={OUT_PDF}", url]
r = subprocess.run(cmd, capture_output=True, text=True)
print("chrome rc", r.returncode)
if r.returncode != 0:
    print(r.stderr[-800:])
print("pdf exists:", OUT_PDF.exists(), OUT_PDF.stat().st_size if OUT_PDF.exists() else "-", "bytes")
