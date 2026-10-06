#!/usr/bin/env python3
"""Hakee Pirkanmaan Poolin sivuilta Nekapool 2:n sarjataulukon, pelaajatilastot
ja otteluohjelman ja tallentaa ne data/-kansioon JSON-muodossa.

Ajetaan GitHub Actionsissa ajastetusti (ks. .github/workflows/paivita-data.yml),
koska pirkanmaanpool.fi ei salli selaimen suoria hakuja (CORS)."""
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

JOUKKUE = "Nekapool 2"
SARJA = "3divari2026"
BASE = "https://www.pirkanmaanpool.fi"
DATA = Path(__file__).resolve().parent.parent / "data"


def hae(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Nekapool2-kotisivu/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("latin-1")


def teksti(s):
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    return html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ").strip()


def solut(rivi):
    return [teksti(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", rivi, flags=re.S)]


def rivit(s):
    # Sivuilla on sulkemattomia <tr>-tageja, joten pilkotaan avaavien tagien kohdalta.
    return re.split(r"<tr\b[^>]*>", s)[1:]


def luku(s):
    try:
        return int(s)
    except ValueError:
        return None


def sarjataulukko():
    sivu = hae(f"{BASE}/sarjataulukot.shtml")
    m = re.search(r'name="3divari".*?<b>(.*?)</b>.*?<table[^>]*>(.*?)</table>', sivu, flags=re.S)
    if not m:
        raise RuntimeError("3. divisioonan sarjataulukkoa ei löytynyt")
    otsikko = teksti(m.group(1))
    taulu = []
    for rivi in rivit(m.group(2)):
        c = solut(rivi)
        if len(c) < 11 or not c[0].rstrip(".").isdigit():
            continue
        taulu.append({
            "sija": luku(c[0].rstrip(".")), "joukkue": c[1],
            "o": luku(c[2]), "v": luku(c[3]), "t": luku(c[4]), "h": luku(c[5]),
            "pp": luku(c[6]), "pm": luku(c[7]), "ep": luku(c[8]), "em": luku(c[9]),
            "p": luku(c[10]),
        })
    return {"otsikko": otsikko, "rivit": taulu}


def joukkue():
    q = urllib.parse.urlencode({"nimi": JOUKKUE, "sarja": SARJA, "lohko": "", "tiedot": 0}, encoding="latin-1")
    sivu = hae(f"{BASE}/cgi-bin/joukkue.cgi?{q}")
    pelaajat, ottelut = [], []
    for rivi in rivit(sivu):
        c = solut(rivi)
        if "pelaaja.cgi" in rivi and len(c) >= 8:
            pelaajat.append({
                "ranking": luku(c[0].rstrip(".")), "nimi": c[1],
                "o": luku(c[2]), "v": luku(c[3]), "h": luku(c[4]),
                "ep": luku(c[5]), "em": luku(c[6]), "p": luku(c[7]),
            })
        elif len(c) >= 4 and re.match(r"\d\d\.\d\d\.\d{4}:", c[0]):
            pvm = datetime.strptime(c[0].rstrip(":"), "%d.%m.%Y").date().isoformat()
            tulos = re.match(r"(\d+)-(\d+)\s*\((\d+)-(\d+)\)", c[3])
            linkki = re.search(r'href="([^"]*sarjapeli\.cgi[^"]*)"', rivi)
            ottelut.append({
                "pvm": pvm, "koti": c[1], "vieras": c[2].lstrip("- ").strip(),
                "pelit": [int(tulos.group(1)), int(tulos.group(2))] if tulos else None,
                "erat": [int(tulos.group(3)), int(tulos.group(4))] if tulos else None,
                "linkki": html.unescape(linkki.group(1)) if linkki else None,
            })
    return pelaajat, ottelut


def ottelun_pelit(linkki):
    """Ottelusivun yksittäiset pelit, esim. Salmi Mikko - Ebrahimi Edris 4-0."""
    sivu = hae(urllib.parse.quote(linkki, safe=":/?&=+%"))
    pelit = []
    for rivi in rivit(sivu):
        c = [x for x in solut(rivi) if x]
        if len(c) == 3 and re.fullmatch(r"\d+-\d+", c[2]) and c[1].startswith("-"):
            k, v = c[2].split("-")
            pelit.append({"koti": c[0], "vieras": c[1].lstrip("- ").strip(), "tulos": [int(k), int(v)]})
    return pelit


def main():
    taulukko = sarjataulukko()
    pelaajat, ottelut = joukkue()
    for o in ottelut:
        if o["linkki"]:
            try:
                o["pelit_erittely"] = ottelun_pelit(o["linkki"])
            except Exception as e:  # yksittäisen ottelusivun virhe ei kaada koko päivitystä
                print(f"Varoitus: {o['linkki']}: {e}", file=sys.stderr)
    data = {
        "paivitetty": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "joukkue": JOUKKUE, "sarja": SARJA,
        "sarjataulukko": taulukko, "pelaajat": pelaajat, "ottelut": ottelut,
    }
    DATA.mkdir(exist_ok=True)
    (DATA / "liiga.json").write_text(json.dumps(data, ensure_ascii=False, indent=1, separators=(",", ": ")) + "\n", encoding="utf-8")
    print(f"OK: {len(taulukko['rivit'])} joukkuetta, {len(pelaajat)} pelaajaa, {len(ottelut)} ottelua")


if __name__ == "__main__":
    main()
