"""A local paid API speaking a simplified x402, driven by the scenario file (stdlib only, 127.0.0.1, ephemeral port).

    GET /weather                      -> 402 + {"x402Version": 1, "accepts": [quote]}
    GET /weather + X-PAYMENT: <order>  -> 200 + data

The server settles any payment header without checking it: that is exactly why the guard sits on the payer's side.
"""
from __future__ import annotations

import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def make_server(endpoints: dict[str, dict], data: dict, host: str = "127.0.0.1", port: int = 0) -> ThreadingHTTPServer:
    consumed: set[str] = set()  # settled nonces: one payment buys one access
    lock = threading.Lock()

    def quote(path: str) -> dict:
        e = endpoints[path]
        return {"amount": e["amount"], "currency": e.get("currency", "USDC"), "recipient": e["recipient"],
                "facilitator": e["facilitator"], "nonce": e.get("nonce") or "0x" + secrets.token_hex(8),
                "network": e.get("network", "avalanche-fuji"), "resource": path, "description": e.get("description", "")}

    class Handler(BaseHTTPRequestHandler):
        def _json(self, code: int, obj: dict, extra: dict | None = None) -> None:
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def _402(self, path: str, error: str = "Payment Required") -> None:
            q = quote(path)
            self._json(402, {"x402Version": 1, "error": error, "accepts": [q]}, {"X-402-Quote": json.dumps(q)})

        def do_GET(self) -> None:  # noqa: N802 (http.server API)
            path = self.path.split("?")[0]
            if path not in endpoints:
                return self._json(404, {"error": "unknown resource", "resources": sorted(endpoints)})
            payment = self.headers.get("X-PAYMENT")
            if not payment:
                return self._402(path)
            try:
                p = json.loads(payment)
            except ValueError:
                return self._json(400, {"error": "bad X-PAYMENT header"})
            nonce = str(p.get("nonce"))
            with lock:
                if nonce in consumed:
                    return self._402(path, "Payment Required (previous payment already consumed)")
                consumed.add(nonce)
            self._json(200, {"data": data, "settled": {"amount": p.get("amount"), "recipient": p.get("recipient"), "nonce": nonce}})

        def log_message(self, fmt: str, *args) -> None:  # keep the terminal for the agent's story
            pass

    srv = ThreadingHTTPServer((host, port), Handler)
    srv.daemon_threads = True
    return srv


def start(endpoints: dict[str, dict], data: dict) -> tuple[ThreadingHTTPServer, str]:
    """Serve in a daemon thread; return the server and its base URL."""
    srv = make_server(endpoints, data)
    threading.Thread(target=srv.serve_forever, name="x402-api", daemon=True).start()
    host, port = srv.server_address[:2]
    return srv, f"http://{host}:{port}"
