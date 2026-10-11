"""The simulated wallet: balance, history, execution. It signs whatever reaches it: if it is called, the money leaves."""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class Wallet:
    address: str
    balance: float = 1000.0
    currency: str = "USDC"
    avg_amount: float = 60.0                     # this wallet's usual payment size, for the guard's history check
    known_recipients: list[str] = field(default_factory=list)  # past payees, the wallet's own record
    executed: list[dict] = field(default_factory=list)

    def history(self, recipient: str = "") -> dict:
        """What the wallet itself knows, as the guard's `context.history`. prior_purchase is about THIS recipient."""
        now, r = time.time(), (recipient or "").lower()
        paid = {x.lower() for x in self.known_recipients} | {p["recipient"].lower() for p in self.executed}
        return {"avg_amount": self.avg_amount, "balance": round(self.balance, 6),
                "payments_last_hour": sum(1 for p in self.executed if now - p["ts"] < 3600),
                "prior_purchase": bool(r) and r in paid}

    def execute(self, order: dict, note: str = "") -> dict:
        """Sign and send. An `approve` is simulated as spent at once: an allowance is money the spender can take."""
        amt = float(order["amount"])
        if amt > self.balance:
            return {"status": "failed", "reason": f"insufficient balance ({self.balance:g} {self.currency})"}
        self.balance -= amt
        rec = {"ts": time.time(), "action": order.get("action", "pay"), "amount": amt, "currency": order.get("currency", self.currency),
               "recipient": order.get("recipient", ""), "note": note, "balance_after": self.balance}
        self.executed.append(rec)
        return {"status": "executed", "tx": f"0xsim{len(self.executed):04d}", "amount": amt, "recipient": rec["recipient"],
                "balance_after": round(self.balance, 6), "irreversible": True}
