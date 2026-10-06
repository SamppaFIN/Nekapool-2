/* Nekapool 2 -kotisivu: sarjataulukko, pelaajatilastot, uutiset, otteluohjelma
 * ja live-ottelupöytäkirja (ks. live.js). */
(function () {
  'use strict';

  var ME = 'Nekapool 2';
  var PELEJA = 4;
  var HARAKKA = 'https://harakka.es3-world-worker.workers.dev';
  var COLORS = ['var(--pink)', 'var(--gold)', 'var(--violet)', 'var(--green)'];
  var VIIKONPAIVAT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];

  var liiga = null;

  /* ---------- apurit ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtDate(iso, year) {
    var d = parseDate(iso);
    return d.getDate() + '.' + (d.getMonth() + 1) + '.' + (year ? d.getFullYear() : '');
  }
  /* "Salmi Mikko" -> { etu: "Mikko", koko: "Mikko Salmi" } */
  function nimi(sukuEtu) {
    var i = sukuEtu.indexOf(' ');
    if (i < 0) return { etu: sukuEtu, koko: sukuEtu };
    var etu = sukuEtu.slice(i + 1), suku = sukuEtu.slice(0, i);
    return { etu: etu, koko: etu + ' ' + suku };
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 40) : ''; }
  function int(v, max) { v = Math.floor(Number(v)); return isFinite(v) && v > 0 ? Math.min(v, max) : 0; }

  /* ekvalisaattori */
  Array.prototype.forEach.call(document.querySelectorAll('.eq'), function (box) {
    var s = 7;
    function rnd() { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }
    for (var i = 0; i < 32; i++) {
      var b = document.createElement('i');
      var mid = 1 - Math.abs(i - 15.5) / 16;
      b.style.height = Math.round(14 + mid * 26 + rnd() * 14) + 'px';
      b.style.background = i % 3 === 0 ? 'var(--gold)' : (i % 3 === 1 ? 'var(--pink)' : 'var(--violet)');
      b.style.animationDuration = (0.5 + rnd() * 0.7).toFixed(2) + 's';
      b.style.animationDelay = '-' + rnd().toFixed(2) + 's';
      box.appendChild(b);
    }
  });

  /* aktiivinen välilehti alanavigaatiossa */
  (function () {
    var links = document.querySelectorAll('.tabbar a');
    if (!window.IntersectionObserver) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        Array.prototype.forEach.call(links, function (a) {
          a.classList.toggle('on', a.getAttribute('data-sec') === en.target.id);
          if (a.getAttribute('data-sec') === en.target.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Array.prototype.forEach.call(document.querySelectorAll('main > section'), function (sec) { io.observe(sec); });
  })();

  /* =====================================================================
   * LIVE-PÖYTÄKIRJA
   *
   * Kulku:
   *  1. Kokoonpano – nimet ja vastustaja muokataan paperilla. Luonnos on vain
   *     tällä laitteella (localStorage), sitä ei julkaista.
   *  2. Arvo peliparit -> Aloita ottelu julkaisee pöytäkirjan kaikille.
   *  3. Ottelun aikana "+ Erä" kirjaa erän voittajan ja julkaisee heti,
   *     "−" poistaa pelaajalta vahingossa kirjatun erän.
   *  4. Kun toisella on `race` erävoittoa, "Lopeta peli" sulkee pelin.
   *  5. Kun kaikki pelit on lopetettu, "Päätä ottelu" päättää ottelun.
   *
   * Tila: { v:2, ts, id, vaihe:'kokoonpano'|'kaynnissa'|'paattynyt', pvm,
   *         koti, vieras, race, arvottu, pelit:[{ k, v, h, p }] }
   * pelit[i] on peli i+1: kotijoukkueen pelaaja k vastaan vierasjoukkueen v.
   * h on erien järjestys, esim. "kkvk" (k = koti voitti erän, v = vieras),
   * p = peli lopetettu (sallittu vain, kun toisella on race erävoittoa).
   * ===================================================================== */
  var LS_LUONNOS = 'nekapool2:luonnos';
  var LS_KIRJAAJA = 'nekapool2:kirjaaja';
  var AKTIIVINEN_MS = 16 * 3600 * 1000; // julkaistu ottelu näkyy 16 h

  var live = null;
  var remote = null;   // viimeisin julkaistu tila
  var draft = null;    // oma kokoonpanoluonnos
  var view = null;     // se tila, joka on nyt paperilla
  var mode = 'kokoonpano'; // 'kokoonpano' | 'live' | 'valmis' (ottelu päätetty)
  var editNames = false;
  var picking = -1;    // pelin indeksi, jonka "kuka voitti?" -valinta on auki
  var rows = [];

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ei tallennusta */ } }

  function seuraavaOttelu() {
    if (!liiga) return null;
    var t = today();
    for (var i = 0; i < liiga.ottelut.length; i++) {
      var o = liiga.ottelut[i];
      if (!o.pelit && o.pvm >= t) return o;
    }
    return null;
  }
  function omatEtunimet() {
    return liiga ? liiga.pelaajat.map(function (p) { return nimi(p.nimi).etu; }) : [];
  }

  function uusiTila() {
    var o = seuraavaOttelu();
    var koti = o ? o.koti : ME;
    var vieras = o ? o.vieras : 'Vastustaja';
    var omat = omatEtunimet();
    var pelit = [];
    for (var i = 0; i < PELEJA; i++) {
      var oma = omat[i] || '';
      pelit.push({ k: koti === ME ? oma : '', v: koti === ME ? '' : oma, h: '', p: false });
    }
    return { v: 2, ts: 0, id: '', vaihe: 'kokoonpano', pvm: o ? o.pvm : today(), koti: koti, vieras: vieras, race: 4, arvottu: false, pelit: pelit };
  }

  /* Muilta tullut tila on ulkopuolista dataa: siivotaan ennen käyttöä. */
  function siivoa(s) {
    if (!s || !Array.isArray(s.pelit)) return null;
    var race = int(s.race, 15) || 4;
    var pelit = [];
    for (var i = 0; i < PELEJA; i++) {
      var g = s.pelit[i] || {};
      var h = '', k = 0, v = 0;
      String(typeof g.h === 'string' ? g.h : '').replace(/[^kv]/g, '').split('').forEach(function (c) {
        if (k >= race || v >= race) return;
        h += c;
        if (c === 'k') k++; else v++;
      });
      pelit.push({ k: str(g.k), v: str(g.v), h: h, p: !!g.p && (k >= race || v >= race) });
    }
    return {
      v: 2, ts: Number(s.ts) || 0, id: str(s.id, 16),
      vaihe: s.vaihe === 'kaynnissa' || s.vaihe === 'paattynyt' ? s.vaihe : 'kokoonpano',
      pvm: /^\d{4}-\d\d-\d\d$/.test(s.pvm) ? s.pvm : today(),
      koti: str(s.koti, 60) || 'Kotijoukkue', vieras: str(s.vieras, 60) || 'Vierasjoukkue',
      race: race, arvottu: !!s.arvottu, pelit: pelit
    };
  }
  function kopio(s) { return JSON.parse(JSON.stringify(s)); }

  function erat(g) {
    var k = 0, v = 0;
    for (var i = 0; i < g.h.length; i++) { if (g.h[i] === 'k') k++; else v++; }
    return [k, v];
  }
  /* ratkennut = toisella on tarvittavat erävoitot; lopetettu (g.p) = kirjaaja on sulkenut pelin */
  function ratkennut(s, g) { var e = erat(g); return e[0] >= s.race || e[1] >= s.race; }
  function summat(s) {
    var ek = 0, ev = 0, pk = 0, pv = 0, valmiit = 0;
    s.pelit.forEach(function (g) {
      var e = erat(g);
      ek += e[0]; ev += e[1];
      if (!g.p) return;
      valmiit++;
      if (e[0] > e[1]) pk++; else pv++;
    });
    return { ek: ek, ev: ev, pk: pk, pv: pv, valmiit: valmiit };
  }

  function olenKirjaaja() { return !!view && !!view.id && lsGet(LS_KIRJAAJA) === view.id; }

  /* Mikä tila paperilla näytetään: julkaistu ottelu, jos sellainen on käynnissä, muuten oma luonnos. */
  function valitseNakyma() {
    var aktiivinen = remote && remote.vaihe !== 'kokoonpano' && Date.now() - remote.ts < AKTIIVINEN_MS;
    if (aktiivinen) {
      view = remote;
      mode = remote.vaihe === 'paattynyt' ? 'valmis' : 'live';
    } else {
      view = draft;
      mode = 'kokoonpano';
    }
    if (mode !== 'live') picking = -1;
  }

  function tallyNode(n, prev) {
    var wrap = el('span', 'tally');
    for (var g = 0; g * 5 < n; g++) {
      var grp = el('span', 'tg');
      var inGrp = Math.min(5, n - g * 5);
      for (var i = 0; i < Math.min(4, inGrp); i++) {
        var mark = el('i');
        if (g * 5 + i >= prev) mark.className = 'new';
        grp.appendChild(mark);
      }
      if (inGrp === 5) grp.classList.add('five');
      wrap.appendChild(grp);
    }
    wrap.setAttribute('aria-label', n + ' erävoittoa');
    return wrap;
  }

  function buildRows() {
    var box = $('pGames');
    box.textContent = '';
    rows = [];
    for (var i = 0; i < PELEJA; i++) rows.push(buildRow(box, i));
    var dl = el('datalist');
    dl.id = 'nimilista';
    box.appendChild(dl);

    // joukkueiden nimet
    ['koti', 'vieras'].forEach(function (key) {
      var inp = $(key === 'koti' ? 'pKotiIn' : 'pVierasIn');
      inp.addEventListener('change', function () {
        muokkaa(function (s) { s[key] = inp.value.trim().slice(0, 60) || (key === 'koti' ? 'Kotijoukkue' : 'Vierasjoukkue'); });
      });
    });
  }

  function buildRow(box, i) {
    var r = { i: i, prev: [0, 0] };
    r.row = el('div', 'g-row');
    r.sides = [];
    ['k', 'v'].forEach(function (key, side) {
      var s = el('div', 'g-side' + (side ? ' right' : ''));
      var nro = el('span', 'g-nro', (i + 1) + '.');
      var nm = el('div', 'g-name');
      var txt = el('span', 'g-name-txt');
      var inp = el('input');
      inp.type = 'text';
      inp.maxLength = 40;
      inp.autocomplete = 'off';
      inp.setAttribute('list', 'nimilista');
      inp.setAttribute('aria-label', (side ? 'Vierasjoukkueen' : 'Kotijoukkueen') + ' pelaaja ' + (i + 1));
      inp.placeholder = 'Pelaaja ' + (i + 1);
      inp.addEventListener('change', function () {
        var val = inp.value.trim().slice(0, 40);
        muokkaa(function (st) { st.pelit[r.i][key] = val; });
      });
      nm.appendChild(txt);
      nm.appendChild(inp);
      var marks = el('div', 'g-tally');
      s.appendChild(nro);
      s.appendChild(nm);
      s.appendChild(marks);
      r.sides.push({ txt: txt, inp: inp, marks: marks });
      r.row.appendChild(s);
      if (side === 0) {
        r.mid = el('div', 'g-mid', '0–0');
        r.row.appendChild(r.mid);
      }
    });
    r.act = el('div', 'g-act');
    r.row.appendChild(r.act);
    box.appendChild(r.row);
    return r;
  }

  function actButton(cls, text, onClick, label) {
    var b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  function renderActions(r, g) {
    var act = r.act;
    act.textContent = '';
    var recorder = mode === 'live' && olenKirjaaja() && !editNames;
    act.hidden = !recorder;
    if (!recorder) return;
    var e = erat(g);
    var s = view;
    var kotiNimi = g.k || 'Koti', vierasNimi = g.v || 'Vieras';
    if (picking === r.i && !ratkennut(s, g)) {
      act.className = 'g-act asking';
      act.appendChild(el('span', 'g-ask', 'Kuka voitti erän?'));
      var wrap = el('div', 'g-pick');
      wrap.appendChild(actButton('pick', '◀ ' + kotiNimi, function () { kirjaaEra(r.i, 'k'); }, kotiNimi + ' voitti erän'));
      wrap.appendChild(actButton('pick right', vierasNimi + ' ▶', function () { kirjaaEra(r.i, 'v'); }, vierasNimi + ' voitti erän'));
      act.appendChild(wrap);
      act.appendChild(actButton('g-cancel', 'Peruuta', function () { picking = -1; render(false); }));
      return;
    }
    act.className = 'g-act';
    var minusK = actButton('g-minus', '−', function () { poistaEra(r.i, 'k'); }, 'Poista erä pelaajalta ' + kotiNimi);
    var minusV = actButton('g-minus', '−', function () { poistaEra(r.i, 'v'); }, 'Poista erä pelaajalta ' + vierasNimi);
    minusK.disabled = e[0] === 0;
    minusV.disabled = e[1] === 0;
    var mid;
    if (g.p) {
      var voittaja = e[0] > e[1] ? kotiNimi : vierasNimi;
      mid = el('span', 'g-done', '✓ ' + voittaja + ' voitti ' + Math.max(e[0], e[1]) + '–' + Math.min(e[0], e[1]));
    } else if (ratkennut(s, g)) {
      mid = actButton('g-end', '✓ Lopeta peli', function () { lopetaPeli(r.i); }, 'Lopeta peli ' + (r.i + 1));
    } else {
      mid = actButton('g-add', '+ Erä', function () { picking = r.i; render(false); }, 'Lisää erä peliin ' + (r.i + 1));
    }
    act.appendChild(minusK);
    act.appendChild(mid);
    act.appendChild(minusV);
  }

  function render(flash) {
    if (!view) return;
    var s = view;
    var setup = mode === 'kokoonpano';
    var namesEditable = setup || editNames;
    var paper = $('paper');
    paper.classList.toggle('setup', setup);
    paper.classList.toggle('names-edit', namesEditable);
    $('live').setAttribute('data-mode', mode);

    $('pDate').textContent = fmtDate(s.pvm, true);
    [['pKoti', 'pKotiIn', s.koti], ['pVieras', 'pVierasIn', s.vieras]].forEach(function (x) {
      $(x[0]).textContent = x[2];
      $(x[0]).hidden = namesEditable;
      $(x[1]).hidden = !namesEditable;
      if (document.activeElement !== $(x[1])) $(x[1]).value = x[2];
    });
    $('raceSel').value = String(s.race);

    var dl = $('nimilista');
    dl.textContent = '';
    omatEtunimet().forEach(function (n) { var o = el('option'); o.value = n; dl.appendChild(o); });

    rows.forEach(function (r) {
      var g = s.pelit[r.i];
      var e = erat(g);
      var names = [g.k, g.v];
      r.sides.forEach(function (sd, side) {
        sd.txt.textContent = names[side] || '—';
        sd.txt.hidden = namesEditable;
        sd.inp.hidden = !namesEditable;
        if (document.activeElement !== sd.inp) sd.inp.value = names[side];
        sd.marks.textContent = '';
        sd.marks.appendChild(tallyNode(e[side], r.prev[side]));
      });
      r.mid.textContent = e[0] + '–' + e[1];
      r.row.classList.toggle('won-home', g.p && e[0] > e[1]);
      r.row.classList.toggle('won-away', g.p && e[1] > e[0]);
      r.row.classList.toggle('decided', ratkennut(s, g) && !g.p);
      r.row.classList.toggle('picking', picking === r.i);
      if (flash && (r.prev[0] !== e[0] || r.prev[1] !== e[1])) {
        r.row.classList.remove('flash');
        void r.row.offsetWidth;
        r.row.classList.add('flash');
      }
      r.prev = e;
      renderActions(r, g);
    });

    var sum = summat(s);
    $('pErat').textContent = sum.ek + '–' + sum.ev;
    $('pPelit').textContent = sum.pk + '–' + sum.pv;

    var status;
    if (setup) status = s.arvottu ? 'Peliparit arvottu. Aloita ottelu, kun olette valmiita!' : 'Kokoonpano. Muokkaa nimiä ja arvo peliparit.';
    else if (mode === 'valmis') {
      if (sum.pk === sum.pv) status = '🏁 Ottelu päättyi tasan ' + sum.pk + '–' + sum.pv + '.';
      else status = '🏁 ' + (sum.pk > sum.pv ? s.koti : s.vieras) + ' voitti ottelun ' + Math.max(sum.pk, sum.pv) + '–' + Math.min(sum.pk, sum.pv) + '! 🤘';
    } else if (sum.valmiit === PELEJA) status = 'Kaikki pelit ratkesivat – päätä ottelu!';
    else if (sum.ek + sum.ev === 0) status = 'Ottelu alkoi! Pelit ' + s.race + ' erävoittoon.';
    else status = 'Ottelu käynnissä · ' + sum.valmiit + '/' + PELEJA + ' peliä valmiina';
    $('pStatus').textContent = status;

    // napit vaiheen mukaan
    var rec = olenKirjaaja();
    $('setupCtl').hidden = !setup;
    $('startBtn').hidden = !s.arvottu;
    $('startLink').hidden = s.arvottu;
    $('drawBtn').classList.toggle('btn-rock', !s.arvottu);
    $('drawBtn').classList.toggle('btn-ghost', s.arvottu);
    $('drawBtn').lastChild.textContent = s.arvottu ? ' Arvo uudelleen' : ' Arvo peliparit';
    $('liveCtl').hidden = setup;
    $('joinBtn').hidden = setup || rec;
    $('namesBtn').hidden = setup || !rec || mode === 'valmis';
    $('namesBtn').textContent = editNames ? 'Valmis' : 'Muokkaa nimiä';
    $('namesBtn').setAttribute('aria-pressed', String(editNames));
    $('finishBtn').hidden = !(mode === 'live' && rec && sum.valmiit === PELEJA);
    $('endBtn').hidden = setup || !rec;
    $('endBtn').textContent = mode === 'valmis' ? 'Uusi ottelu' : 'Keskeytä ottelu';
    $('fixBtn').hidden = !(mode === 'valmis' && rec);
    $('liveHint').hidden = !(mode === 'live' && rec && !editNames && sum.valmiit < PELEJA);
    $('paper').classList.toggle('final', mode === 'valmis');

    // tikkeri
    var t;
    if (setup) {
      t = ['Seuraava ottelu: ' + s.koti + ' – ' + s.vieras + ' ' + fmtDate(s.pvm)];
    } else {
      t = [s.koti + ' ' + sum.pk + '–' + sum.pv + ' ' + s.vieras + ' (erät ' + sum.ek + '–' + sum.ev + ')'];
      s.pelit.forEach(function (g, i) {
        var e = erat(g);
        t.push((i + 1) + '. ' + (g.k || '?') + ' ' + e[0] + '–' + e[1] + ' ' + (g.v || '?'));
      });
    }
    t.push(status);
    $('ticker').textContent = t.join('   ★   ');
  }

  /* Muutos näkyvään tilaan: luonnokseen tallennetaan paikallisesti, käynnissä oleva ottelu julkaistaan. */
  function muokkaa(fn) {
    if (mode === 'kokoonpano') {
      fn(draft);
      lsSet(LS_LUONNOS, draft);
      valitseNakyma();
      render(false);
    } else {
      var s = kopio(remote);
      fn(s);
      julkaise(s);
    }
  }

  function julkaise(s) {
    s.ts = Date.now();
    remote = s;
    valitseNakyma();
    render(true);
    if (!live) return;
    live.save(kopio(s)).catch(function () {
      setSync(false, 'Julkaisu epäonnistui – tarkista verkko ja yritä uudelleen');
    });
  }

  function kirjaaEra(i, kuka) {
    picking = -1;
    muokkaa(function (s) {
      if (!ratkennut(s, s.pelit[i])) s.pelit[i].h += kuka;
    });
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* ei värinää */ } }
  }
  /* Poistaa pelaajan viimeisimmän erävoiton (vahinkopainallus). Avaa lopetetun pelin uudelleen. */
  function poistaEra(i, kuka) {
    picking = -1;
    muokkaa(function (s) {
      var g = s.pelit[i];
      var at = g.h.lastIndexOf(kuka);
      if (at < 0) return;
      g.h = g.h.slice(0, at) + g.h.slice(at + 1);
      if (!ratkennut(s, g)) g.p = false;
    });
  }
  function lopetaPeli(i) {
    muokkaa(function (s) { if (ratkennut(s, s.pelit[i])) s.pelit[i].p = true; });
  }
  function paataOttelu() {
    var sum = summat(view);
    if (!confirm('Päätetäänkö ottelu lopputulokseen ' + view.koti + ' ' + sum.pk + '–' + sum.pv + ' ' + view.vieras + '?')) return;
    muokkaa(function (s) { s.vaihe = 'paattynyt'; });
  }

  function setSync(ok, text) {
    $('syncDot').className = 'live-dot ' + (ok ? 'ok' : 'err');
    $('syncText').textContent = text;
  }

  function arvo() {
    var paper = $('paper');
    var btn = $('drawBtn');
    btn.disabled = true;
    paper.classList.add('shuffling');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var kotiN = draft.pelit.map(function (g) { return g.k; });
    var vierasN = draft.pelit.map(function (g) { return g.v; });
    var kierros = 0, kierroksia = reduce ? 1 : 10;
    (function pyorita() {
      var k = shuffle(kotiN), v = shuffle(vierasN);
      draft.pelit = k.map(function (n, i) { return { k: n, v: v[i], h: '', p: false }; });
      render(false);
      if (++kierros < kierroksia) { setTimeout(pyorita, 90); return; }
      paper.classList.remove('shuffling');
      btn.disabled = false;
      draft.arvottu = true;
      lsSet(LS_LUONNOS, draft);
      render(false);
      $('pStatus').textContent = 'Peliparit arvottu! Aloita ottelu, kun olette valmiita. 🎱';
    })();
  }

  function aloita() {
    var puuttuu = draft.pelit.some(function (g) { return !g.k || !g.v; });
    if (puuttuu && !confirm('Kaikille peleille ei ole merkitty molempia pelaajia. Aloitetaanko silti?')) return;
    if (remote && remote.vaihe === 'kaynnissa' && Date.now() - remote.ts < AKTIIVINEN_MS &&
        remote.vaihe === 'kaynnissa' && summat(remote).ek + summat(remote).ev > 0 &&
        !confirm('Toinen ottelu on jo käynnissä. Korvataanko se?')) return;
    var s = kopio(draft);
    s.vaihe = 'kaynnissa';
    s.id = Math.random().toString(36).slice(2, 12);
    s.pelit.forEach(function (g) { g.h = ''; g.p = false; });
    lsSet(LS_KIRJAAJA, s.id);
    editNames = false;
    rows.forEach(function (r) { r.prev = [0, 0]; });
    julkaise(s);
    document.getElementById('live').scrollIntoView({ block: 'start' });
  }

  function lopeta() {
    var valmis = mode === 'valmis';
    if (!confirm(valmis ? 'Aloitetaanko uusi ottelu? Tämä tulos poistuu live-näkymästä.' :
      'Keskeytetäänkö ottelu? Pöytäkirja poistuu kaikkien live-näkymästä.')) return;
    var s = kopio(remote);
    s.vaihe = 'kokoonpano';
    draft = uusiTila();
    lsSet(LS_LUONNOS, draft);
    editNames = false;
    julkaise(s);
  }

  function initLive() {
    buildRows();
    draft = siivoa(lsGet(LS_LUONNOS));
    var seur = seuraavaOttelu();
    // vanha luonnos (mennyt ottelu) vaihtuu seuraavaan otteluun
    if (!draft || draft.pvm < today() || (seur && draft.pvm < seur.pvm)) draft = uusiTila();
    valitseNakyma();
    render(false);

    $('drawBtn').addEventListener('click', arvo);
    $('startBtn').addEventListener('click', aloita);
    $('startLink').addEventListener('click', aloita);
    $('raceSel').addEventListener('change', function () {
      var v = Number(this.value);
      muokkaa(function (s) { s.race = v; });
    });
    $('swapBtn').addEventListener('click', function () {
      muokkaa(function (s) {
        var t = s.koti; s.koti = s.vieras; s.vieras = t;
        s.pelit.forEach(function (g) { var n = g.k; g.k = g.v; g.v = n; });
      });
    });
    $('resetBtn').addEventListener('click', function () {
      if (!confirm('Palautetaanko kokoonpano otteluohjelman mukaiseksi?')) return;
      draft = uusiTila();
      lsSet(LS_LUONNOS, draft);
      render(false);
    });
    $('joinBtn').addEventListener('click', function () {
      if (!view || !view.id) return;
      lsSet(LS_KIRJAAJA, view.id);
      render(false);
    });
    $('namesBtn').addEventListener('click', function () {
      editNames = !editNames;
      render(false);
    });
    $('endBtn').addEventListener('click', lopeta);
    $('finishBtn').addEventListener('click', paataOttelu);
    $('fixBtn').addEventListener('click', function () {
      muokkaa(function (s) { s.vaihe = 'kaynnissa'; });
    });

    if (!window.Live) { setSync(false, 'Live-yhteys ei käytössä'); return; }
    live = window.Live.connect({
      onState: function (s) {
        s = siivoa(s);
        if (!s) return;
        remote = s;
        valitseNakyma();
        render(true);
      },
      onStatus: setSync
    });
  }

  /* =====================================================================
   * SARJATAULUKKO, PELAAJAT, OHJELMA
   * ===================================================================== */
  function renderTaulukko() {
    var st = liiga.sarjataulukko;
    var seur = seuraavaOttelu();
    var vastus = seur ? (seur.koti === ME ? seur.vieras : seur.koti) : null;
    $('stSub').textContent = st.otsikko.replace(/\s+/g, ' ');
    var tb = $('stTable').querySelector('tbody');
    tb.textContent = '';
    st.rivit.forEach(function (r) {
      var tr = el('tr', r.joukkue === ME ? 'us' : (r.joukkue === vastus ? 'opp' : ''));
      [[r.sija + '.', 'num'], [r.joukkue, 'team'], [r.o, 'num'], [r.v, 'num opt'], [r.t, 'num opt'], [r.h, 'num opt'],
       [r.pp + '–' + r.pm, 'num opt'], [r.ep + '–' + r.em, 'num'], [r.p, 'num']].forEach(function (c) {
        tr.appendChild(el('td', c[1], String(c[0])));
      });
      if (r.joukkue === vastus) tr.title = 'Seuraava vastustaja';
      tb.appendChild(tr);
    });
    var upd = new Date(liiga.paivitetty);
    Array.prototype.forEach.call(document.querySelectorAll('.upd'), function (n) {
      n.textContent = upd.toLocaleString('fi-FI', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    });
  }

  function renderPelaajat() {
    var oma = liiga.sarjataulukko.rivit.filter(function (r) { return r.joukkue === ME; })[0];
    var ts = $('teamStats');
    ts.textContent = '';
    if (oma) {
      [[oma.sija + '.', 'sija sarjassa', 'var(--pink)'], [oma.p, 'pistettä', 'var(--gold)'],
       [oma.pp + '–' + oma.pm, 'pelit', 'var(--violet)'], [oma.ep + '–' + oma.em, 'erät', 'var(--green)']].forEach(function (s) {
        var d = el('div', 'stat');
        d.style.setProperty('--c', s[2]);
        d.appendChild(el('b', null, String(s[0])));
        d.appendChild(el('span', null, s[1]));
        ts.appendChild(d);
      });
      $('heroLede').textContent = (oma.sija === 1 ? 'Listaykkönen! ' : 'Sarjassa ' + oma.sija + '. · ') + oma.p + ' pistettä · erät ' + oma.ep + '–' + oma.em + '. Nekalan taideteknillisen tehtaan poolijoukkue.';
    }

    var box = $('playerCards');
    box.textContent = '';
    var pelaajat = liiga.pelaajat.slice().sort(function (a, b) {
      return b.v - a.v || (b.ep - b.em) - (a.ep - a.em) || a.ranking - b.ranking;
    });
    pelaajat.forEach(function (p, idx) {
      var n = nimi(p.nimi);
      var pct = p.ep + p.em ? Math.round(100 * p.ep / (p.ep + p.em)) : 0;
      var card = el('article', 'card');
      card.style.setProperty('--c', COLORS[idx % 4]);
      card.appendChild(el('div', 'tile', n.etu.charAt(0))).setAttribute('aria-hidden', 'true');
      var body = el('div');
      body.appendChild(el('p', 'kick', 'Ranking ' + p.ranking + '. · erävoitot ' + pct + ' %'));
      body.appendChild(el('h3', null, n.koko));
      var dl = el('dl', 'pstats');
      [['Pelit', p.o], ['V–H', p.v + '–' + p.h], ['Erät', p.ep + '–' + p.em], ['P', p.p]].forEach(function (x) {
        var d = el('div');
        d.appendChild(el('dt', null, x[0]));
        d.appendChild(el('dd', null, String(x[1])));
        dl.appendChild(d);
      });
      body.appendChild(dl);
      var m = el('div', 'meter');
      var fill = el('span');
      fill.style.width = pct + '%';
      m.appendChild(fill);
      m.setAttribute('aria-hidden', 'true');
      body.appendChild(m);
      var ul = el('ul', 'games');
      liiga.ottelut.forEach(function (o) {
        (o.pelit_erittely || []).forEach(function (g) {
          var koti = g.koti === p.nimi;
          if (!koti && g.vieras !== p.nimi) return;
          var li = el('li');
          li.appendChild(el('span', null, fmtDate(o.pvm) + ' vs ' + nimi(koti ? g.vieras : g.koti).koko));
          li.appendChild(el('b', null, koti ? g.tulos[0] + '–' + g.tulos[1] : g.tulos[1] + '–' + g.tulos[0]));
          ul.appendChild(li);
        });
      });
      if (ul.children.length) body.appendChild(ul);
      card.appendChild(body);
      box.appendChild(card);
    });
    if (!pelaajat.length) box.appendChild(el('p', 'note', 'Tilastoja ei vielä ole.'));
  }

  function renderOhjelma() {
    var ol = $('fixtures');
    ol.textContent = '';
    var seur = seuraavaOttelu();
    var t = today();
    liiga.ottelut.forEach(function (o) {
      var koti = o.koti === ME;
      var vastus = koti ? o.vieras : o.koti;
      var li = el('li', 'fx');
      var d = el('div', 'fx-date', fmtDate(o.pvm));
      d.appendChild(el('small', null, VIIKONPAIVAT[parseDate(o.pvm).getDay()] + ' ' + parseDate(o.pvm).getFullYear()));
      li.appendChild(d);
      var tm = el('div', 'fx-teams');
      tm.appendChild(el('div', 'ha', koti ? 'Koti' : 'Vieras'));
      tm.appendChild(el('div', null, vastus));
      li.appendChild(tm);
      var res = el('div', 'fx-res');
      if (o.pelit) {
        var my = koti ? o.pelit[0] : o.pelit[1], their = koti ? o.pelit[1] : o.pelit[0];
        var me = koti ? o.erat[0] : o.erat[1], te = koti ? o.erat[1] : o.erat[0];
        li.classList.add(my > their ? 'win' : my < their ? 'loss' : 'draw');
        var a = el('a', null, my + '–' + their);
        a.href = o.linkki || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = 'Ottelutilastot pirkanmaanpool.fi:ssä';
        res.appendChild(a);
        res.appendChild(el('small', null, 'erät ' + me + '–' + te));
      } else if (o === seur) {
        li.classList.add('next');
        var b = el('a', 'badge', o.pvm === t ? 'Tänään · live' : 'Seuraava keikka');
        b.href = '#live';
        res.appendChild(b);
      }
      li.appendChild(res);
      ol.appendChild(li);
    });
  }

  /* =====================================================================
   * UUTISET
   * ===================================================================== */
  function pollNode(tulokset) {
    var total = tulokset.reduce(function (s, o) { return s + o.aanet; }, 0);
    var box = el('div', 'poll');
    tulokset.forEach(function (o) {
      var row = el('div', 'poll-row');
      row.appendChild(el('span', null, o.teksti));
      var pct = total ? Math.round(100 * o.aanet / total) : 0;
      row.appendChild(el('b', null, o.aanet + ' (' + pct + ' %)'));
      var bar = el('div', 'poll-bar');
      var fill = el('span');
      fill.style.setProperty('--b', /^#[0-9a-f]{3,8}$/i.test(o.vari) ? o.vari : 'var(--pink)');
      bar.appendChild(fill);
      row.appendChild(bar);
      box.appendChild(row);
      requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = pct + '%'; }); });
    });
    box.appendChild(el('p', 'note', total + ' ääntä'));
    return box;
  }

  function haeAanestys(id, card, body, pollBox) {
    fetch(HARAKKA + '/api/votes/' + encodeURIComponent(id), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (v) {
        if (!v || !Array.isArray(v.options)) return;
        var uusi = pollNode(v.options.map(function (o) {
          return { teksti: str(o.text, 80), vari: str(o.color, 9), aanet: int(o.votes, 1e6) };
        }));
        pollBox.replaceWith(uusi);
        if (v.media && v.media.kind === 'image' && typeof v.media.src === 'string') {
          var img = el('img', 'news-img');
          img.src = v.media.src.charAt(0) === '/' ? HARAKKA + v.media.src : v.media.src;
          img.alt = '';
          img.loading = 'lazy';
          card.insertBefore(img, card.firstChild);
        }
      })
      .catch(function () { /* näytetään tallennettu tulos */ });
  }

  function renderUutiset(list) {
    var box = $('news');
    box.textContent = '';
    list.sort(function (a, b) { return a.pvm < b.pvm ? 1 : -1; });
    list.forEach(function (u, i) {
      var card = el('article', 'news-card');
      card.style.setProperty('--c', COLORS[i % 4]);
      var body = el('div', 'news-body');
      var tyyppi = { raportti: 'Otteluraportti', aanestys: 'Äänestys', uutinen: 'Uutinen' }[u.tyyppi] || 'Uutinen';
      body.appendChild(el('p', 'kick', tyyppi + ' · ' + fmtDate(u.pvm, true)));
      body.appendChild(el('h3', null, u.otsikko));
      if (u.teksti) body.appendChild(el('p', null, u.teksti));
      var pollBox = null;
      if (u.tulokset) { pollBox = pollNode(u.tulokset); body.appendChild(pollBox); }
      if (u.linkki) {
        var a = el('a', 'btn link-btn', u.linkkiteksti || 'Lue lisää');
        a.href = u.linkki;
        a.target = '_blank';
        a.rel = 'noopener';
        body.appendChild(a);
      }
      card.appendChild(body);
      box.appendChild(card);
      if (u.aanestys) {
        if (!pollBox) { pollBox = el('div'); body.insertBefore(pollBox, body.lastChild); }
        haeAanestys(u.aanestys, body, body, pollBox);
      }
    });
    if (!list.length) box.appendChild(el('p', 'note', 'Ei uutisia vielä.'));
  }

  /* ---------- käynnistys ---------- */
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.json();
    });
  }

  getJSON('data/uutiset.json').then(renderUutiset).catch(function () {
    $('news').textContent = 'Uutisia ei saatu ladattua.';
  });

  getJSON('data/liiga.json')
    .then(function (d) {
      liiga = d;
      renderTaulukko();
      renderPelaajat();
      renderOhjelma();
    })
    .catch(function () {
      $('playerCards').textContent = 'Tilastoja ei saatu ladattua.';
    })
    .then(initLive);
})();
