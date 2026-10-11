"""The agents' tests run offline: the state registry check (GUARD_KYB, on by default for the agents) is switched off
here, and test_kyb_default.py checks it with the registry mocked."""
import os

os.environ.setdefault("GUARD_KYB", "off")
