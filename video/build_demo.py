"""Builds video/demo.html from video/demo.template.html: the tour's real shots (video/tour.html SHOTS) are pulled in
as they are, the template moves them in time, and the logo is embedded.

    .venv/bin/python video/build_demo.py
"""
import base64
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
tour = (HERE / "tour.html").read_text(encoding="utf-8")
shots = re.search(r"const SHOTS = (\[.*?\n\]);", tour, re.S).group(1)
logo = "data:image/png;base64," + base64.b64encode((HERE.parent / "landing" / "assets" / "logo-white.png").read_bytes()).decode()
page = (HERE / "demo.template.html").read_text(encoding="utf-8").replace("/*TOUR_SHOTS*/", shots).replace('src="LOGO"', f'src="{logo}"')
(HERE / "demo.html").write_text(page, encoding="utf-8")
print("wrote video/demo.html")
