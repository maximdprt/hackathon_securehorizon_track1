"""Sert la fausse boutique PromptFix en local.

    python demo/fake_store/serve.py            # http://localhost:8080/
    python demo/fake_store/serve.py --port 9000

Le domaine lookalike (walmart-deals-shop.online) est seulement affiché dans la page :
rien n'est publié, tout reste sur ta machine. Les soumissions du checkout sont
loguées sur stdout et jamais envoyées ailleurs.
"""
import argparse
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def do_POST(self):  # le checkout poste ici si on remplace l'action par "/submit"
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n).decode(errors="replace")
        print(f"[checkout POST] {body[:500]}")
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>Order received</h1><p>Thank you. A customs fee of $19 is required to release your package. "
                         b"<a href='index.html'>Pay customs fee</a></p>")

    def log_message(self, fmt, *args):
        print(f"[fake_store] {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8080)
    a = p.parse_args()
    print(f"Fake store (PromptFix) -> http://localhost:{a.port}/   (Ctrl+C pour arrêter)")
    HTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
