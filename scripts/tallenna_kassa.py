#!/usr/bin/env python3
"""Tallentaa vetokassan tapahtumat ntfy.sh:sta pysyvästi tiedostoon data/kassa.json.

ntfy.sh säilyttää viestejä vain noin 12 tuntia, joten GitHub Actions ajaa tämän
muutaman tunnin välein. Uudet tapahtumat yhdistetään aiempiin tunnisteen perusteella;
mitään ei poisteta. Sivu (js/kassa.js) laskee saldot tapahtumista."""
import json
import urllib.request
from pathlib import Path

AIHE = "nekapool2-kassa-499563937e83"  # sama kuin js/kassa.js
TIEDOSTO = Path(__file__).resolve().parent.parent / "data" / "kassa.json"
TYYPIT = {"veto", "panos", "ratkaisu", "profiili"}


def hae():
    req = urllib.request.Request(f"https://ntfy.sh/{AIHE}/json?poll=1&since=all",
                                 headers={"User-Agent": "Nekapool2-kotisivu/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        rivit = r.read().decode("utf-8").splitlines()
    tapahtumat = []
    for rivi in rivit:
        try:
            m = json.loads(rivi)
            if m.get("event") != "message":
                continue
            viesti = json.loads(m.get("message", ""))
        except ValueError:
            continue
        e = viesti.get("e") if isinstance(viesti, dict) and viesti.get("v") == 3 else None
        if isinstance(e, dict) and e.get("typ") in TYYPIT and isinstance(e.get("id"), str) and isinstance(e.get("t"), (int, float)):
            tapahtumat.append(e)
    return tapahtumat


def main():
    vanha = json.loads(TIEDOSTO.read_text(encoding="utf-8")) if TIEDOSTO.exists() else {"tapahtumat": []}
    kaikki = {e["id"]: e for e in vanha.get("tapahtumat", [])}
    uudet = 0
    for e in hae():
        if e["id"] not in kaikki:
            kaikki[e["id"]] = e
            uudet += 1
    lista = sorted(kaikki.values(), key=lambda e: (e["t"], e["id"]))
    TIEDOSTO.write_text(json.dumps({"tapahtumat": lista}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK: {uudet} uutta tapahtumaa, yhteensä {len(lista)}")


if __name__ == "__main__":
    main()
