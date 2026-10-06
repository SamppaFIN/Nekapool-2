/* Nekapool 2 -kotisivu: sarjataulukko, pelaajatilastot, uutiset, otteluohjelma
 * ja live-ottelupöytäkirja (ks. live.js). */
(function () {
  'use strict';

  var ME = 'Nekapool 2';
  var PELEJA = 4;
  var HARAKKA = 'https://harakka.es3-world-worker.workers.dev';
  var COLORS = ['var(--orange)', 'var(--cyan)', 'var(--yellow)', 'var(--pink)'];
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

  /* rytmipalkit */
  Array.prototype.forEach.call(document.querySelectorAll('.bars'), function (box) {
    var s = Number(box.getAttribute('data-seed')) || 1;
    function rnd() { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }
    for (var i = 0; i < 23; i++) {
      var b = document.createElement('i');
      b.style.height = (20 + Math.round(rnd() * 40)) + 'px';
      b.style.background = COLORS[i % 4];
      b.style.animationDelay = '-' + (rnd() * 1.8).toFixed(2) + 's';
      box.appendChild(b);
    }
  });

  /* =====================================================================
   * LIVE-PÖYTÄKIRJA
   * Tila: { v:1, ts, pvm, koti, vieras, race, pelit:[{k, v, ke, ve}] }
   * pelit[i] on peli numero i+1: kotijoukkueen i+1. pelaaja vastaan
   * vierasjoukkueen i+1. pelaaja, ke/ve = voitetut erät.
   * ===================================================================== */
  var state = null;
  var live = null;
  var editing = false;
  var rows = [];

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
      pelit.push({ k: koti === ME ? oma : '', v: koti === ME ? '' : oma, ke: 0, ve: 0 });
    }
    return { v: 1, ts: 0, pvm: o ? o.pvm : today(), koti: koti, vieras: vieras, race: 4, pelit: pelit };
  }

  /* Muilta tullut tila on ulkopuolista dataa: siivotaan ennen käyttöä. */
  function siivoa(s) {
    if (!s || !Array.isArray(s.pelit)) return null;
    var race = int(s.race, 15) || 4;
    var pelit = [];
    for (var i = 0; i < PELEJA; i++) {
      var g = s.pelit[i] || {};
      pelit.push({ k: str(g.k), v: str(g.v), ke: int(g.ke, race), ve: int(g.ve, race) });
    }
    return {
      v: 1, ts: Number(s.ts) || 0,
      pvm: /^\d{4}-\d\d-\d\d$/.test(s.pvm) ? s.pvm : today(),
      koti: str(s.koti, 60) || 'Kotijoukkue', vieras: str(s.vieras, 60) || 'Vierasjoukkue',
      race: race, pelit: pelit
    };
  }

  function erat(s) {
    var k = 0, v = 0;
    s.pelit.forEach(function (g) { k += g.ke; v += g.ve; });
    return [k, v];
  }
  function pelivoitot(s) {
    var k = 0, v = 0;
    s.pelit.forEach(function (g) { if (g.ke >= s.race) k++; else if (g.ve >= s.race) v++; });
    return [k, v];
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
        inp.setAttribute('list', 'nimilista');
        inp.setAttribute('aria-label', (side ? 'Vierasjoukkueen' : 'Kotijoukkueen') + ' pelaaja ' + (i + 1));
        inp.placeholder = 'Pelaaja ' + (i + 1);
        inp.addEventListener('change', function () {
          state.pelit[r.i][key] = inp.value.trim().slice(0, 40);
          commit();
        });
        nm.appendChild(txt);
        nm.appendChild(inp);
        var tally = el('div', 'g-tally');
        var marks = el('span');
        var pm = el('span', 'pm');
        var minus = el('button', 'minus', '−');
        var plus = el('button', 'plus', '+');
        minus.type = plus.type = 'button';
        minus.setAttribute('aria-label', 'Poista erä');
        plus.setAttribute('aria-label', 'Lisää erävoitto');
        minus.addEventListener('click', function () { muutaEra(r.i, side, -1); });
        plus.addEventListener('click', function () { muutaEra(r.i, side, 1); });
        pm.appendChild(minus);
        pm.appendChild(plus);
        if (side) { tally.appendChild(pm); tally.appendChild(marks); } else { tally.appendChild(marks); tally.appendChild(pm); }
        s.appendChild(nro);
        s.appendChild(nm);
        s.appendChild(tally);
        r.sides.push({ txt: txt, inp: inp, marks: marks, minus: minus, plus: plus });
        if (side === 0) {
          r.row.appendChild(s);
          r.mid = el('div', 'g-mid', '0–0');
          r.row.appendChild(r.mid);
        } else {
          r.row.appendChild(s);
        }
      });
      box.appendChild(r.row);
      return r;
  }

  function render(flash) {
    var s = state;
    $('pDate').textContent = fmtDate(s.pvm, true);
    $('pKoti').textContent = s.koti;
    $('pVieras').textContent = s.vieras;
    $('raceSel').value = String(s.race);
    $('paper').classList.toggle('editing', editing);

    var dl = $('nimilista');
    dl.textContent = '';
    omatEtunimet().forEach(function (n) { var o = el('option'); o.value = n; dl.appendChild(o); });

    rows.forEach(function (r) {
      var g = s.pelit[r.i];
      var done = g.ke >= s.race || g.ve >= s.race;
      var vals = [g.ke, g.ve];
      var names = [g.k, g.v];
      r.sides.forEach(function (sd, side) {
        sd.txt.textContent = names[side] || '—';
        sd.txt.hidden = editing;
        sd.inp.hidden = !editing;
        if (document.activeElement !== sd.inp) sd.inp.value = names[side];
        sd.marks.textContent = '';
        sd.marks.appendChild(tallyNode(vals[side], r.prev[side]));
        sd.minus.disabled = vals[side] === 0;
        sd.plus.disabled = done;
      });
      r.mid.textContent = g.ke + '–' + g.ve;
      r.row.classList.toggle('won-home', g.ke >= s.race);
      r.row.classList.toggle('won-away', g.ve >= s.race);
      if (flash && (r.prev[0] !== g.ke || r.prev[1] !== g.ve)) {
        r.row.classList.add('flash');
        setTimeout(function () { r.row.classList.remove('flash'); }, 900);
      }
      r.prev = vals;
    });

    var e = erat(s), p = pelivoitot(s);
    $('pErat').textContent = e[0] + '–' + e[1];
    $('pPelit').textContent = p[0] + '–' + p[1];

    var valmiit = s.pelit.filter(function (g) { return g.ke >= s.race || g.ve >= s.race; }).length;
    var status;
    if (e[0] + e[1] === 0) status = 'Ottelu ei ole alkanut. Pelit ' + s.race + ' erävoittoon.';
    else if (valmiit === PELEJA) {
      if (p[0] === p[1]) status = 'Ottelu päättyi tasan ' + p[0] + '–' + p[1] + '.';
      else status = (p[0] > p[1] ? s.koti : s.vieras) + ' voitti ' + Math.max(p[0], p[1]) + '–' + Math.min(p[0], p[1]) + '!';
    } else status = 'Ottelu käynnissä · ' + valmiit + '/' + PELEJA + ' peliä valmiina';
    $('pStatus').textContent = status;
  }

  function commit() {
    render(false);
    if (!live) return;
    live.save(JSON.parse(JSON.stringify(state))).catch(function () {
      setSync(false, 'Tallennus epäonnistui – tarkista verkko');
    });
  }

  function muutaEra(i, side, d) {
    var g = state.pelit[i];
    var key = side ? 've' : 'ke';
    var n = g[key] + d;
    if (n < 0 || (d > 0 && (g.ke >= state.race || g.ve >= state.race))) return;
    g[key] = n;
    commit();
  }

  function setSync(ok, text) {
    $('syncDot').className = 'live-dot ' + (ok ? 'ok' : 'err');
    $('syncText').textContent = text;
  }

  function arvo() {
    var played = erat(state);
    if (played[0] + played[1] > 0 && !confirm('Ottelussa on jo kirjattuja eriä. Arvonta nollaa erät. Jatketaanko?')) return;
    var paper = $('paper');
    var btn = $('drawBtn');
    btn.disabled = true;
    paper.classList.add('shuffling');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var kotiN = state.pelit.map(function (g) { return g.k; });
    var vierasN = state.pelit.map(function (g) { return g.v; });
    var kierros = 0, kierroksia = reduce ? 1 : 9;
    (function pyorita() {
      var k = shuffle(kotiN), v = shuffle(vierasN);
      state.pelit = k.map(function (n, i) { return { k: n, v: v[i], ke: 0, ve: 0 }; });
      render(false);
      if (++kierros < kierroksia) { setTimeout(pyorita, 90); return; }
      paper.classList.remove('shuffling');
      btn.disabled = false;
      commit();
      $('pStatus').textContent = 'Peliparit arvottu! 🎱';
    })();
  }

  function initLive() {
    buildRows();
    state = uusiTila();
    render(false);

    $('editBtn').addEventListener('click', function () {
      editing = !editing;
      this.setAttribute('aria-pressed', String(editing));
      this.textContent = editing ? 'Valmis' : 'Kirjaa tuloksia';
      $('live').classList.toggle('editing-mode', editing);
      render(false);
    });
    $('drawBtn').addEventListener('click', arvo);
    $('raceSel').addEventListener('change', function () {
      state.race = Number(this.value);
      commit();
    });
    $('newBtn').addEventListener('click', function () {
      if (!confirm('Aloitetaanko uusi pöytäkirja seuraavasta ottelusta? Nykyiset merkinnät poistuvat.')) return;
      state = uusiTila();
      rows.forEach(function (r) { r.prev = [0, 0]; });
      commit();
    });
    $('swapBtn').addEventListener('click', function () {
      var t = state.koti; state.koti = state.vieras; state.vieras = t;
      state.pelit.forEach(function (g) {
        var n = g.k; g.k = g.v; g.v = n;
        var e = g.ke; g.ke = g.ve; g.ve = e;
      });
      rows.forEach(function (r) { r.prev = [r.prev[1], r.prev[0]]; });
      commit();
    });

    if (!window.Live) { setSync(false, 'Live-yhteys ei käytössä'); return; }
    live = window.Live.connect({
      onState: function (s) {
        s = siivoa(s);
        // Vanha pöytäkirja (edelliseltä ottelupäivältä) vaihtuu tämän päivän otteluun.
        var seur = seuraavaOttelu();
        if (s && seur && s.pvm < seur.pvm && s.pvm < today()) s = null;
        if (!s) { render(false); return; }
        state = s;
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
      [[r.sija + '.', 'num'], [r.joukkue, 'team'], [r.o, 'num'], [r.v, 'num'], [r.t, 'num'], [r.h, 'num'],
       [r.pp + '–' + r.pm, 'num'], [r.ep + '–' + r.em, 'num'], [r.p, 'num']].forEach(function (c) {
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
      [[oma.sija + '.', 'sija sarjassa', 'var(--orange)'], [oma.p, 'pistettä', 'var(--cyan)'],
       [oma.pp + '–' + oma.pm, 'pelit', 'var(--yellow)'], [oma.ep + '–' + oma.em, 'erät', 'var(--pink)']].forEach(function (s) {
        var d = el('div', 'stat');
        d.style.setProperty('--c', s[2]);
        d.appendChild(el('b', null, String(s[0])));
        d.appendChild(el('span', null, s[1]));
        ts.appendChild(d);
      });
      $('heroLede').textContent = 'Sarjassa ' + oma.sija + '. · ' + oma.p + ' pistettä · erät ' + oma.ep + '–' + oma.em + '. Nekalan taideteknillisen tehtaan poolijoukkue.';
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
        var b = el('a', 'badge', o.pvm === t ? 'Tänään · live' : 'Seuraava');
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
      fill.style.setProperty('--b', /^#[0-9a-f]{3,8}$/i.test(o.vari) ? o.vari : 'var(--orange)');
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
