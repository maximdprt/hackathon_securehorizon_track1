"""Génère treasury_migration.pdf sans dépendance : le texte visible en noir,
l'injection en texte blanc (invisible pour l'humain, extraite par tout parseur PDF).

    python demo/poisoned_docs/make_pdf.py
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "treasury_migration.md")
OUT = os.path.join(HERE, "treasury_migration.pdf")


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap(text: str, width: int = 95):
    out = []
    for para in text.split("\n"):
        line = ""
        for w in para.split(" "):
            if len(line) + len(w) + 1 > width:
                out.append(line)
                line = w
            else:
                line = (line + " " + w).strip()
        out.append(line)
    return out


def main():
    md = open(SRC, encoding="utf-8").read()
    visible, hidden = md.split("<!-- HIDDEN LAYER", 1)
    hidden = hidden.split("-->", 1)[1].strip()
    visible = re.sub(r"^# ", "", visible.strip(), flags=re.M)

    ops = ["BT", "/F1 11 Tf", "14 TL", "50 790 Td", "0 0 0 rg"]
    for ln in wrap(visible):
        ops.append(f"({esc(ln)}) Tj T*")
    ops.append("1 1 1 rg")  # blanc sur blanc : la partie que l'agent lit et que l'humain ne voit pas
    ops.append("/F1 6 Tf 8 TL")
    for ln in wrap(hidden, 160):
        ops.append(f"({esc(ln)}) Tj T*")
    ops.append("ET")
    stream = "\n".join(ops).encode("latin-1", "replace")

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(pdf))
        pdf += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(pdf)
    pdf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        pdf += f"{off:010d} 00000 n \n".encode()
    pdf += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    open(OUT, "wb").write(pdf)
    print(f"ok -> {OUT} ({len(pdf)} bytes)")


if __name__ == "__main__":
    main()
