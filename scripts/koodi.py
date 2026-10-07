#!/usr/bin/env python3
"""Laskee pelaajan kirjautumiskoodin tiivisteen data/joukkue.json-tiedostoon.

Käyttö: python3 scripts/koodi.py <id> <koodi>   esim. python3 scripts/koodi.py arto 001"""
import hashlib
import sys

if len(sys.argv) != 3:
    sys.exit(__doc__)
print(hashlib.sha256(f"nekapool2:{sys.argv[1]}:{sys.argv[2]}".encode()).hexdigest())
