"""Wallet simulé de l'agent : solde, historique, exécution. C'est lui qui 'signe' : si on l'appelle, l'argent part."""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class Wallet:
    address: str
    balance: float = 1000.0
    currency: str = "USDC"
    avg_amount: float = 60.0           # moyenne historique, pour la feature amount_vs_history_zscore
    known_recipients: list[str] = field(default_factory=list)
    executed: list[dict] = field(default_factory=list)

    def history(self) -> dict:
        now = time.time()
        return {"avg_amount": self.avg_amount, "balance": self.balance,
                "payments_last_hour": sum(1 for p in self.executed if now - p["ts"] < 3600),
                "prior_purchase": bool(self.executed)}

    def execute(self, order: dict, note: str = "") -> dict:
        amt = float(order["amount"])
        if amt > self.balance:
            return {"status": "failed", "reason": f"insufficient balance ({self.balance} {self.currency})"}
        self.balance -= amt
        rec = {"ts": time.time(), "action": order.get("action", "pay"), "amount": amt, "currency": order.get("currency", self.currency),
               "recipient": order.get("recipient", ""), "note": note, "balance_after": self.balance}
        self.executed.append(rec)
        return {"status": "executed", "tx": f"0xsim{len(self.executed):04d}", "amount": amt, "recipient": rec["recipient"],
                "balance_after": self.balance, "irreversible": True}
