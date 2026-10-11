"""Build deliverables/defense-sheet.html (branded, self-contained, ONE A4 page) then print to defense-sheet.pdf
with headless Chrome. Design system: DESIGN.md (ink #171717 / canvas #fafafa, hairlines, Geist, mono technical,
dark hero band). No em dashes.

Structure (as required): threat scenario addressed, NIST CSF functions, ATT&CK / ATLAS techniques & OWASP risks,
metrics achieved (detection, false positives, time to detect and respond), known limitations.

Usage: python deliverables/build_defense_sheet_pdf.py
"""
import base64
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_HTML = ROOT / "deliverables" / "defense-sheet.html"
OUT_PDF = ROOT / "deliverables" / "defense-sheet.pdf"
LOGO_WHITE = ROOT / "explorer" / "frontend" / "static" / "sentinel-logo-white.png"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"


def b64(p: pathlib.Path) -> str:
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()


logo_white = b64(LOGO_WHITE)

NIST = [
    ("Identify", "Mandats et autorites resolus cote serveur, jamais declares par l'agent."),
    ("Protect", "Visa on-chain a usage unique, GuardedVault fail-closed (pas de visa = revert)."),
    ("Detect", "7 couches de signaux + fusion Claude sur l'intention et l'injection."),
    ("Respond", "Block + flag de l'adresse + escalade humaine, incident DORA ouvert au refus."),
    ("Recover", "Trace on-chain rejouable, registre de menaces partage et reutilisable."),
]

TECHNIQUES = [
    ("OWASP ASI03", "Compromission d'autorite : un agent peu privilegie declenche un paiement qu'il ne peut pas ordonner. Pare par la verification de la chaine d'autorite on-chain."),
    ("OWASP ASI07", "Abus d'agent / d'outil : instruction injectee (document, page, autre agent) qui detourne l'outil de paiement. Pare par la detection d'injection."),
    ("MITRE ATLAS", "Prompt injection indirecte, evasion par encodage et obfuscation, manipulation d'agent."),
    ("Vecteurs", "HTML cache, PDF et mail piege, tool poisoning (MCP), confusion d'autorite, address poisoning, tresorerie migree, base64 / hex / url / ROT13, homoglyphes, unicode invisible, depassement de mandat, contrepartie frauduleuse."),
]

METRICS = [
    ("100 %", "Detection", "23 attaques, redteam/run.py"),
    ("0 %", "Faux positifs", "52 controles legitimes"),
    ("&lt; 1 ms", "Temps de detection", "heuristiques ; ~3 s avec Claude"),
    ("20 / 20", "Bout-en-bout on-chain", "verdicts justes et mines"),
]

LIMITS = [
    "Le jugement d'intention fin depend de Claude ; sans LLM, on ne devine jamais allow (plancher humain).",
    "La memoire des menaces est on-chain et durable, mais le jugement reste par transaction (pas encore de correlation multi-tx avancee).",
    "L'execution reelle du paiement exige un wallet agent autorise et approvisionne.",
    "Un adversaire peut inventer une strategie inedite : banc adaptatif teste (0 bypass), recalibrage continu, aucune triche.",
]

nist_rows = "".join(
    f'<div class="nrow"><span class="chip">{f}</span><span class="ntext">{d}</span></div>'
    for f, d in NIST)
tech_rows = "".join(
    f'<li><span class="tlabel">{t}</span> {d}</li>' for t, d in TECHNIQUES)
kpi_cards = "".join(
    f'<div class="kpi"><div class="kpi__n">{n}</div><div class="kpi__l">{l}</div><div class="kpi__s">{s}</div></div>'
    for n, l, s in METRICS)
limit_items = "".join(f"<li>{x}</li>" for x in LIMITS)

HTML = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Sentinel - Defense sheet</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {{ --ink:#171717; --body:#4d4d4d; --mute:#888; --soft:#f5f5f5; --hair:#ebebeb; --link:#0070f3; --error:#ee0000; --warn:#f5a623; }}
  * {{ box-sizing:border-box; }}
  @page {{ size:A4; margin:10mm 11mm; }}
  html,body {{ margin:0; padding:0; }}
  body {{ font-family:"Geist","Inter",system-ui,sans-serif; color:var(--ink); background:#fff; font-size:9px; line-height:1.42; -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
  .mono {{ font-family:"Geist Mono",ui-monospace,Menlo,monospace; }}
  .eyebrow {{ font-family:"Geist Mono",ui-monospace,monospace; font-size:8.5px; font-weight:500; letter-spacing:.09em; text-transform:uppercase; }}
  h2 {{ font-size:12px; font-weight:600; letter-spacing:-0.4px; margin:0 0 6px; }}

  .hero {{ background:var(--ink); color:#fff; border-radius:12px; padding:16px 20px; position:relative; overflow:hidden; }}
  .hero .mesh {{ position:absolute; inset:0; opacity:.24; background:
      radial-gradient(60% 120% at 10% 0%, #007cf0 0%, transparent 46%),
      radial-gradient(55% 120% at 92% 8%, #7928ca 0%, transparent 46%),
      radial-gradient(70% 130% at 72% 115%, #ff0080 0%, transparent 50%),
      radial-gradient(50% 120% at 28% 120%, #f9cb28 0%, transparent 46%); }}
  .hero > * {{ position:relative; }}
  .hero__top {{ display:flex; align-items:center; gap:9px; }}
  .hero__top img {{ height:22px; width:22px; object-fit:contain; }}
  .hero__top .eyebrow {{ color:rgba(255,255,255,.72); }}
  .hero h1 {{ font-size:27px; font-weight:600; letter-spacing:-1.3px; margin:9px 0 5px; }}
  .hero p {{ color:rgba(255,255,255,.82); font-size:10px; margin:0 0 10px; max-width:96ch; }}
  .badges {{ display:flex; gap:7px; flex-wrap:wrap; }}
  .badge {{ font-family:"Geist Mono",monospace; font-size:8px; color:#fff; border:1px solid rgba(255,255,255,.28); border-radius:100px; padding:2px 9px; }}
  .badge--live::before {{ content:""; display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--link); margin-right:5px; vertical-align:middle; }}

  .sec {{ margin-top:10px; }}
  .threat {{ background:#fff; border:1px solid var(--hair); border-left:3px solid var(--error); border-radius:9px; padding:11px 14px; box-shadow:0 1px 1px #00000005,0 2px 2px #0000000a; }}
  .threat .quote {{ font-style:italic; color:var(--body); margin:0 0 6px; }}
  .threat p {{ margin:0; color:var(--body); }}
  .threat .vectors {{ margin-top:6px; color:var(--body); }}
  .threat .vectors b {{ color:var(--ink); font-weight:600; }}

  .two {{ display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; }}
  .card {{ background:#fff; border:1px solid var(--hair); border-radius:9px; padding:12px 14px; box-shadow:0 1px 1px #00000005,0 2px 2px #0000000a; }}
  .nrow {{ display:flex; gap:9px; align-items:baseline; padding:4px 0; }}
  .nrow + .nrow {{ border-top:1px solid var(--hair); }}
  .chip {{ font-family:"Geist Mono",monospace; font-size:8.5px; font-weight:500; color:#fff; background:var(--ink); border-radius:5px; padding:2px 7px; white-space:nowrap; min-width:54px; text-align:center; }}
  .ntext {{ color:var(--body); }}
  .card ul {{ margin:0; padding:0; list-style:none; }}
  .card li {{ color:var(--body); padding:4px 0; }}
  .card li + li {{ border-top:1px solid var(--hair); }}
  .tlabel {{ font-family:"Geist Mono",monospace; font-size:8.5px; font-weight:500; color:var(--link); }}

  .para {{ margin-top:10px; background:var(--soft); border:1px solid var(--hair); border-radius:9px; padding:11px 14px; color:var(--body); }}
  .para b {{ color:var(--ink); font-weight:600; }}
  .para .mono {{ color:var(--ink); }}

  .kpis {{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:10px; }}
  .kpi {{ background:var(--ink); color:#fff; border-radius:9px; padding:12px 13px; }}
  .kpi__n {{ font-size:23px; font-weight:600; letter-spacing:-1px; line-height:1; }}
  .kpi__l {{ font-size:9.5px; font-weight:500; margin-top:5px; }}
  .kpi__s {{ font-size:8px; color:rgba(255,255,255,.62); margin-top:2px; }}

  .limits ul {{ margin:6px 0 0; padding:0; list-style:none; }}
  .limits li {{ color:var(--body); padding:4px 0 4px 13px; position:relative; }}
  .limits li::before {{ content:""; position:absolute; left:0; top:8px; width:4px; height:4px; border-radius:50%; background:var(--warn); }}

  .proofs {{ margin-top:10px; border-top:1px solid var(--hair); padding-top:8px; display:flex; gap:7px 16px; flex-wrap:wrap; }}
  .proofs .kv {{ font-size:8.5px; color:var(--body); }}
  .proofs .kv b {{ color:var(--ink); font-weight:600; }}
  .proofs .mono {{ color:var(--ink); }}
</style></head>
<body>
  <div class="hero">
    <div class="mesh"></div>
    <div class="hero__top"><img src="{logo_white}" alt="Sentinel"><span class="eyebrow">Sentinel &middot; ESSECKATHON Track 01 &middot; Fintech Security &middot; Equipe 2</span></div>
    <h1>Defense sheet</h1>
    <p>Un garde devant tout paiement d'agent IA : il verifie l'autorite et l'intention, delivre un visa on-chain si OK, refuse et flague si c'est une arnaque, escalade a un humain en cas de doute. Chaque decision est une preuve inviolable sur Avalanche.</p>
    <div class="badges"><span class="badge badge--live">SentinelL1 Live</span><span class="badge">chainId 99999</span><span class="badge">ERC-8004 + x402</span><span class="badge">2026-10-11</span></div>
  </div>

  <div class="sec threat">
    <h2>Scenario de menace traite</h2>
    <p class="quote">&laquo; a low-privilege agent, fed a booby-trapped document, tells a financial agent to execute a payment. Without authority-chain checks, it goes through. &raquo; (Track 01, probleme 2)</p>
    <p>Un agent peu privilegie, nourri d'un document piege, ordonne un paiement a un agent financier. Sans verification de la chaine d'autorite, il passe. Cas reel Scamlexity : un agent de shopping achete sur un faux site et livre les donnees de paiement.</p>
    <p class="vectors"><b>Vecteurs couverts :</b> injection indirecte (HTML cache, PDF, mail), tool poisoning (MCP), confusion d'autorite, address poisoning, tresorerie migree, encodage (base64 / hex / url / ROT13), homoglyphes, unicode invisible, depassement de mandat, contrepartie frauduleuse (domaine neuf, marque sosie, honeypot).</p>
  </div>

  <div class="two">
    <div class="card"><h2>Fonctions NIST CSF couvertes</h2>{nist_rows}</div>
    <div class="card"><h2>ATT&amp;CK / ATLAS &amp; risques OWASP</h2><ul>{tech_rows}</ul></div>
  </div>

  <div class="para">
    <b>La parade : verify_payment.</b> Pipeline pur et explicable, avant la signature : sanitisation (HTML cache, unicode invisible, blobs encodes), puis 7 couches de signaux (contenu, mandat, autorite on-chain, contrepartie, transaction, outils, comportement), blocs durs, fusion Claude sur l'intention, score de confiance degressif, seuils <span class="mono">allow &ge; 70 &middot; humain 30 a 70 &middot; block &lt; 30</span>. Le mandat est resolu cote serveur. Une adresse flaguee est refusee d'office la fois suivante.
  </div>

  <div class="sec">
    <h2>Metriques atteintes (reproductibles)</h2>
    <div class="kpis">{kpi_cards}</div>
  </div>

  <div class="sec limits">
    <h2>Limites connues</h2>
    <ul>{limit_items}</ul>
  </div>

  <div class="proofs">
    <span class="kv"><b>SentinelL1</b> <span class="mono">chainId 99999 &middot; SEC</span></span>
    <span class="kv"><b>AuthorityRegistry</b> <span class="mono">0x7A7e&hellip;bcb6</span></span>
    <span class="kv"><b>GuardedVault</b> <span class="mono">0xc7de&hellip;C7c0</span></span>
    <span class="kv"><b>API</b> <span class="mono">rpc.petroi.fr</span></span>
    <span class="kv"><b>Explorer</b> <span class="mono">explorer.petroi.fr</span></span>
    <span class="kv"><b>Ville 3D</b> <span class="mono">city.petroi.fr</span></span>
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
