# Nekapool 2

Biljardijoukkue Nekapool 2:n kotisivu (Pirkanmaan Pool, 3. divisioona). Julkaistaan GitHub Pagesissa.

- **Live-ottelupöytäkirja**: "Kirjaa tuloksia" -tilassa erävoitot merkitään tukkimerkein, ja muutokset näkyvät heti kaikille sivulla oleville. "Arvo peliparit" arpoo molempien joukkueiden pelijärjestyksen.
- **Uutiset**: `data/uutiset.json` (otteluraportit, äänestykset Harakasta – äänestystulos haetaan livenä).
- **Sarjataulukko, pelaajatilastot, otteluohjelma**: `data/liiga.json`, jonka `scripts/paivita_data.py` hakee pirkanmaanpool.fi:stä.

## Käyttöönotto

1. Repon asetuksista: **Settings → Pages → Source: GitHub Actions**.
2. Työnkulku `Julkaisu` julkaisee oletushaaran jokaisesta pushista osoitteeseen
   `https://samppafin.github.io/Nekapool-2/` ja päivittää liigadatan kolmen tunnin välein
   (tai käsin: Actions → Julkaisu → Run workflow).

## Uutisen lisääminen

Lisää `data/uutiset.json`-tiedostoon olio:

```json
{ "pvm": "2026-10-06", "tyyppi": "raportti", "otsikko": "…", "teksti": "…", "linkki": "https://…", "linkkiteksti": "Lue raportti" }
```

`tyyppi` on `raportti`, `aanestys` tai `uutinen`. Äänestykselle anna lisäksi `"aanestys": "<harakan äänestyksen id>"`.

## Live-pöytäkirjan tekniikka

GitHub Pages on staattinen, joten pöytäkirjan tila välitetään ilmaisen [ntfy.sh](https://ntfy.sh)-palvelun kautta
(`js/live.js`, aihe `AIHE`). Tila säilyy palvelussa noin 12 tuntia. Kuka tahansa aiheen nimen tietävä voi kirjoittaa
pöytäkirjaan – vaihda nimi, jos sitä alkaa käyttää joku ulkopuolinen.

## Paikallinen kokeilu

```sh
python3 scripts/paivita_data.py   # päivitä data
python3 -m http.server             # avaa http://localhost:8000
```
