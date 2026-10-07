/* Vetokassa ja profiilit.
 *
 * Jokainen tapahtuma (uusi veto, panos, ratkaisu, lempinimi) on oma viestinsä
 * ntfy.sh-aiheessa. Saldot ja vedot lasketaan tapahtumista, joten kahden
 * puhelimen yhtäaikaiset panokset eivät kumoa toisiaan.
 *
 * ntfy.sh säilyttää viestejä noin 12 h. Pysyvä kopio tallentuu repoon
 * (data/kassa.json), jonka GitHub Actions päivittää muutaman tunnin välein
 * (scripts/tallenna_kassa.py). Sivu yhdistää molemmat lähteet.
 *
 * Tapahtumat:
 *   { typ:'veto', id, t, kuka, kysymys, vaihtoehdot:[...] }
 *   { typ:'panos', id, t, kuka, veto, valinta, maara }
 *   { typ:'ratkaisu', id, t, kuka, veto, voittaja }   voittaja -1 = veto peruttu
 *   { typ:'profiili', id, t, kuka, lempinimi } */
(function () {
  'use strict';

  var PALVELIN = 'https://ntfy.sh';
  var AIHE = 'nekapool2-kassa-499563937e83';
  var LS_KEY = 'nekapool2:kassa';
  var EHDOTUKSET = [
    'Voittaako Nekapool 2 seuraavan ottelunsa?',
    'Tuleeko seuraavassa ottelussa AP?',
    'Pelaako joku illan pelinsä 4–0?',
    'Menevätkö illan erät yli 15?'
  ];

  var events = {};   // id -> tapahtuma
  var state = null;  // laskettu tila
  var pending = {};  // omat lähetykset, joita ei vielä ole kuultu takaisin

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
  function lsSet() { try { localStorage.setItem(LS_KEY, JSON.stringify(Object.keys(events).map(function (k) { return events[k]; }))); } catch (e) { /* ei tallennusta */ } }
  function nimi(id) {
    var p = window.Auth.player(id);
    if (!p) return id;
    var nick = state && state.lempinimi[id];
    return nick ? p.nimi.split(' ')[0] + ' "' + nick + '"' : p.nimi.split(' ')[0];
  }
  function kk(n) { return n + ' 🪙'; }

  /* ---------- tapahtumien laskenta ---------- */
  function fold() {
    var players = window.Auth.players();
    var known = {};
    var s = { saldo: {}, lempinimi: {}, vedot: {}, jarjestys: [], voitot: {}, panostettu: {} };
    players.forEach(function (p) { known[p.id] = true; s.saldo[p.id] = window.Auth.startBalance(); s.voitot[p.id] = 0; s.panostettu[p.id] = 0; });
    var list = Object.keys(events).map(function (k) { return events[k]; });
    list.sort(function (a, b) { return a.t - b.t || (a.id < b.id ? -1 : 1); });
    list.forEach(function (e) {
      if (!known[e.kuka]) return;
      if (e.typ === 'profiili') {
        s.lempinimi[e.kuka] = str(e.lempinimi, 24);
      } else if (e.typ === 'veto') {
        if (s.vedot[e.id]) return;
        var opts = (Array.isArray(e.vaihtoehdot) ? e.vaihtoehdot : []).map(function (o) { return str(o, 40); }).filter(Boolean).slice(0, 4);
        var q = str(e.kysymys, 120);
        if (!q || opts.length < 2) return;
        s.vedot[e.id] = { id: e.id, t: e.t, kuka: e.kuka, kysymys: q, vaihtoehdot: opts, panokset: [], tila: 'auki', voittaja: null, maksut: {} };
        s.jarjestys.push(e.id);
      } else if (e.typ === 'panos') {
        var v = s.vedot[e.veto];
        var m = Math.floor(Number(e.maara));
        var c = Math.floor(Number(e.valinta));
        if (!v || v.tila !== 'auki' || !(m > 0) || m > s.saldo[e.kuka] || !(c >= 0 && c < v.vaihtoehdot.length)) return;
        s.saldo[e.kuka] -= m;
        s.panostettu[e.kuka] += m;
        v.panokset.push({ kuka: e.kuka, valinta: c, maara: m });
      } else if (e.typ === 'ratkaisu') {
        var w = s.vedot[e.veto];
        if (!w || w.tila !== 'auki' || e.kuka !== w.kuka) return;
        var win = Math.floor(Number(e.voittaja));
        var pot = 0, winStake = 0;
        w.panokset.forEach(function (p) { pot += p.maara; if (p.valinta === win) winStake += p.maara; });
        var maksut = {};
        if (win < 0 || win >= w.vaihtoehdot.length || winStake === 0) {
          // peruttu tai kukaan ei osunut: panokset palautetaan
          w.panokset.forEach(function (p) { maksut[p.kuka] = (maksut[p.kuka] || 0) + p.maara; });
        } else {
          // potti jaetaan oikein veikanneille panosten suhteessa
          var jaettu = 0, isoin = null;
          w.panokset.forEach(function (p) {
            if (p.valinta !== win) return;
            var osuus = Math.floor(pot * p.maara / winStake);
            maksut[p.kuka] = (maksut[p.kuka] || 0) + osuus;
            jaettu += osuus;
            if (!isoin || p.maara > isoin.maara) isoin = p;
          });
          if (isoin) maksut[isoin.kuka] += pot - jaettu;
          Object.keys(maksut).forEach(function (k) { s.voitot[k] += 1; });
        }
        Object.keys(maksut).forEach(function (k) { s.saldo[k] += maksut[k]; });
        w.maksut = maksut;
        w.tila = win < 0 ? 'peruttu' : 'ratkaistu';
        w.voittaja = win;
      }
    });
    state = s;
    return s;
  }

  function valid(e) {
    return e && typeof e.id === 'string' && e.id.length <= 24 && typeof e.kuka === 'string' &&
      typeof e.t === 'number' && ['veto', 'panos', 'ratkaisu', 'profiili'].indexOf(e.typ) >= 0;
  }
  function add(list) {
    var changed = false;
    list.forEach(function (e) {
      if (valid(e) && !events[e.id]) { events[e.id] = e; changed = true; }
      if (e && pending[e.id]) delete pending[e.id];
    });
    if (changed) { lsSet(); fold(); render(); }
    return changed;
  }
  function parseMsg(text) {
    try { var m = JSON.parse(text); return m && m.v === 3 ? m.e : null; } catch (e) { return null; }
  }

  /* ---------- ntfy ---------- */
  function poll() {
    return fetch(PALVELIN + '/' + AIHE + '/json?poll=1&since=12h', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (body) {
        var list = [];
        body.split('\n').forEach(function (line) {
          if (!line.trim()) return;
          try { var m = JSON.parse(line); if (m.event === 'message') { var e = parseMsg(m.message); if (e) list.push(e); } } catch (err) { /* ohitetaan */ }
        });
        add(list);
      });
  }
  var retry = 2000;
  function listen() {
    if (!window.EventSource) return;
    var es = new EventSource(PALVELIN + '/' + AIHE + '/sse');
    es.onopen = function () { retry = 2000; };
    es.onmessage = function (ev) {
      try { var m = JSON.parse(ev.data); if (m.event === 'message') { var e = parseMsg(m.message); if (e) add([e]); } } catch (err) { /* ohitetaan */ }
    };
    es.onerror = function () {
      es.close();
      setTimeout(function () { poll().catch(function () {}); listen(); }, retry);
      retry = Math.min(retry * 2, 30000);
    };
  }
  function send(e) {
    var me = window.Auth.user();
    if (!me) return Promise.reject(new Error('Kirjaudu ensin'));
    e.id = uid();
    e.t = Date.now();
    e.kuka = me.id;
    pending[e.id] = e;
    add([e]);
    return fetch(PALVELIN + '/' + AIHE, { method: 'POST', body: JSON.stringify({ v: 3, e: e }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })
      .catch(function (err) { toast('Lähetys epäonnistui. Tarkista verkko ja yritä uudelleen.'); throw err; });
  }

  /* ---------- käyttöliittymä ---------- */
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.h);
    toast.h = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function renderMe() {
    var me = window.Auth.user();
    var btn = $('meBtn');
    btn.textContent = '';
    if (me) {
      btn.appendChild(el('span', 'me-name', nimi(me.id)));
      btn.appendChild(el('span', 'me-coins', kk(state ? state.saldo[me.id] : window.Auth.startBalance())));
    } else {
      btn.appendChild(el('span', 'me-name', 'Kirjaudu'));
    }
  }

  function renderBoard() {
    var ol = $('board');
    ol.textContent = '';
    var me = window.Auth.user();
    window.Auth.players().slice().sort(function (a, b) { return state.saldo[b.id] - state.saldo[a.id]; }).forEach(function (p, i) {
      var li = el('li', 'board-row' + (me && me.id === p.id ? ' me' : ''));
      li.appendChild(el('span', 'board-pos', (i + 1) + '.'));
      var who = el('span', 'board-who');
      who.appendChild(el('b', null, p.nimi.split(' ')[0]));
      if (state.lempinimi[p.id]) who.appendChild(el('small', null, '"' + state.lempinimi[p.id] + '"'));
      li.appendChild(who);
      li.appendChild(el('span', 'board-coins', kk(state.saldo[p.id])));
      ol.appendChild(li);
    });
  }

  function betCard(v) {
    var me = window.Auth.user();
    var card = el('article', 'bet ' + v.tila);
    var head = el('div', 'bet-head');
    head.appendChild(el('span', 'bet-by', nimi(v.kuka) + ' · ' + new Date(v.t).toLocaleDateString('fi-FI', { day: 'numeric', month: 'numeric' })));
    var pot = v.panokset.reduce(function (s, p) { return s + p.maara; }, 0);
    head.appendChild(el('span', 'bet-pot', 'Potti ' + kk(pot)));
    card.appendChild(head);
    card.appendChild(el('h3', 'bet-q', v.kysymys));

    var opts = el('div', 'bet-opts');
    v.vaihtoehdot.forEach(function (o, i) {
      var sum = 0, who = [];
      v.panokset.forEach(function (p) { if (p.valinta === i) { sum += p.maara; who.push(nimi(p.kuka).split(' ')[0] + ' ' + p.maara); } });
      var row = el('div', 'bet-opt' + (v.voittaja === i ? ' won' : ''));
      var top = el('div', 'bet-opt-top');
      top.appendChild(el('span', 'bet-opt-name', (v.voittaja === i ? '✓ ' : '') + o));
      top.appendChild(el('b', null, kk(sum)));
      row.appendChild(top);
      var bar = el('div', 'bet-bar');
      var fill = el('span');
      fill.style.width = (pot ? Math.round(100 * sum / pot) : 0) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      if (who.length) row.appendChild(el('small', 'bet-who', who.join(', ')));
      opts.appendChild(row);
    });
    card.appendChild(opts);

    if (v.tila !== 'auki') {
      var res = [];
      Object.keys(v.maksut).forEach(function (k) { res.push(nimi(k).split(' ')[0] + ' +' + v.maksut[k]); });
      card.appendChild(el('p', 'bet-result', (v.tila === 'peruttu' ? 'Veto peruttu, panokset palautettu. ' : 'Ratkaistu. ') + (res.length ? res.join(', ') : 'Ei panoksia.')));
      return card;
    }
    if (!me) {
      card.appendChild(el('p', 'bet-note', 'Kirjaudu koodilla lyödäksesi vetoa.'));
      return card;
    }

    // panos
    var form = el('form', 'bet-form');
    var sel = el('div', 'bet-choice');
    var chosen = { i: -1 };
    v.vaihtoehdot.forEach(function (o, i) {
      var b = el('button', 'chip', o);
      b.type = 'button';
      b.addEventListener('click', function () {
        chosen.i = i;
        Array.prototype.forEach.call(sel.children, function (c, j) { c.setAttribute('aria-pressed', String(j === i)); });
      });
      b.setAttribute('aria-pressed', 'false');
      sel.appendChild(b);
    });
    form.appendChild(sel);
    var amt = el('div', 'bet-amt');
    var input = el('input');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = String(state.saldo[me.id]);
    input.value = String(Math.min(10, state.saldo[me.id]));
    input.id = 'amt-' + v.id;
    input.setAttribute('aria-label', 'Panos kumikolikkoina');
    [5, 10, 25].forEach(function (n) {
      var q = el('button', 'chip small', '+' + n);
      q.type = 'button';
      q.addEventListener('click', function () { input.value = String(Math.min(state.saldo[me.id], (Number(input.value) || 0) + n)); });
      amt.appendChild(q);
    });
    amt.appendChild(input);
    var go = el('button', 'btn btn-bet', 'Lyö veto');
    go.type = 'submit';
    amt.appendChild(go);
    form.appendChild(amt);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = Math.floor(Number(input.value));
      if (chosen.i < 0) { toast('Valitse ensin vaihtoehto.'); return; }
      if (!(m > 0)) { toast('Panoksen pitää olla vähintään 1 kumikolikko.'); return; }
      if (m > state.saldo[me.id]) { toast('Saldo ei riitä: sinulla on ' + kk(state.saldo[me.id]) + '.'); return; }
      send({ typ: 'panos', veto: v.id, valinta: chosen.i, maara: m }).then(function () {
        toast('Veto lyöty: ' + m + ' 🪙 → ' + v.vaihtoehdot[chosen.i]);
      }).catch(function () {});
    });
    card.appendChild(form);

    if (me.id === v.kuka) {
      var settle = el('div', 'bet-settle');
      settle.appendChild(el('span', 'bet-note', 'Ratkaise veto:'));
      v.vaihtoehdot.forEach(function (o, i) {
        var b = el('button', 'chip', o);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (!confirm('Ratkaistaanko veto: "' + o + '"? Potti jaetaan oikein veikanneille.')) return;
          send({ typ: 'ratkaisu', veto: v.id, voittaja: i }).catch(function () {});
        });
        settle.appendChild(b);
      });
      var cancel = el('button', 'chip ghost', 'Peru veto');
      cancel.type = 'button';
      cancel.addEventListener('click', function () {
        if (!confirm('Perutaanko veto? Kaikki panokset palautetaan.')) return;
        send({ typ: 'ratkaisu', veto: v.id, voittaja: -1 }).catch(function () {});
      });
      settle.appendChild(cancel);
      card.appendChild(settle);
    }
    return card;
  }

  function renderBets() {
    var open = $('betsOpen'), done = $('betsDone');
    open.textContent = '';
    done.textContent = '';
    var ids = state.jarjestys.slice().reverse();
    var auki = ids.filter(function (id) { return state.vedot[id].tila === 'auki'; });
    var valmiit = ids.filter(function (id) { return state.vedot[id].tila !== 'auki'; }).slice(0, 8);
    auki.forEach(function (id) { open.appendChild(betCard(state.vedot[id])); });
    valmiit.forEach(function (id) { done.appendChild(betCard(state.vedot[id])); });
    if (!auki.length) open.appendChild(el('p', 'note', 'Ei avoimia vetoja. Heitä ensimmäinen!'));
    $('betsDoneWrap').hidden = !valmiit.length;
    var me = window.Auth.user();
    $('newBet').hidden = !me;
    $('betLogin').hidden = !!me;
    $('joinBanner').hidden = !!me;
  }

  /* pelaajakortit (app.js piirtää kortit, tämä lisää lempinimen ja saldon) */
  function renderCards() {
    Array.prototype.forEach.call(document.querySelectorAll('.card[data-liiga]'), function (card) {
      var p = window.Auth.players().filter(function (x) { return x.liiga === card.getAttribute('data-liiga'); })[0];
      var line = card.querySelector('.kassa-line');
      if (!line) return;
      if (!p) { line.hidden = true; return; }
      line.hidden = false;
      line.textContent = (state.lempinimi[p.id] ? '"' + state.lempinimi[p.id] + '" · ' : '') + kk(state.saldo[p.id]) + ' · vetovoittoja ' + state.voitot[p.id];
    });
  }

  function showReveal(nick) {
    var r = $('reveal');
    $('revealNick').textContent = nick;
    r.hidden = false;
    r.classList.remove('go');
    void r.offsetWidth;
    r.classList.add('go');
    try { if (navigator.vibrate) navigator.vibrate([60, 80, 160]); } catch (e) { /* ei värinää */ }
  }

  function renderProfile() {
    var me = window.Auth.user();
    $('loginView').hidden = !!me;
    $('profileView').hidden = !me;
    if (!me) { $('reveal').hidden = true; return; }
    $('profName').textContent = me.nimi;
    if (document.activeElement !== $('nickIn')) $('nickIn').value = state.lempinimi[me.id] || '';
    var liiga = (window.NekaLiiga && window.NekaLiiga.pelaaja(me.liiga)) || null;
    var stats = $('profStats');
    stats.textContent = '';
    var rows = [['Kumikolikot', kk(state.saldo[me.id])], ['Vetovoittoja', String(state.voitot[me.id])], ['Panostettu yhteensä', kk(state.panostettu[me.id])]];
    if (liiga) rows.unshift(['Liigapelit V–H', liiga.v + '–' + liiga.h], ['Erät', liiga.ep + '–' + liiga.em], ['Ranking', liiga.ranking + '.']);
    rows.forEach(function (r) {
      var d = el('div');
      d.appendChild(el('dt', null, r[0]));
      d.appendChild(el('dd', null, r[1]));
      stats.appendChild(d);
    });
  }

  function render() {
    if (!state) return;
    renderMe();
    renderBoard();
    renderBets();
    renderCards();
    renderProfile();
  }

  /* ---------- tapahtumankäsittelijät ---------- */
  // Ensimmäisellä kirjautumisella salainen lempinimi paljastuu ja julkaistaan joukkueelle.
  function tervetuloa(p) {
    var salainen = window.Auth.secretNick();
    if (salainen && !(state && state.lempinimi[p.id])) {
      showReveal(salainen);
      send({ typ: 'profiili', lempinimi: salainen }).catch(function () {});
    } else {
      toast('Tervetuloa, ' + p.nimi.split(' ')[0] + '! Kassassa ' + kk(state ? state.saldo[p.id] : window.Auth.startBalance()) + '.');
    }
    render();
  }

  /* Lunastuslinkki: ?koodi=001 kirjaa sisään suoraan ja avaa profiilin. */
  function lunastus() {
    var m = /[?&]koodi=([0-9]{1,8})/.exec(location.search);
    if (!m) return Promise.resolve();
    try { history.replaceState(null, '', location.pathname + '#vedot'); } catch (e) { /* ok */ }
    return window.Auth.login(m[1]).then(function (p) {
      if (!p) { toast('Lunastuslinkin koodi ei kelpaa. Kirjaudu koodilla yläkulmasta.'); return; }
      var dlg = $('profileDlg');
      renderProfile();
      if (dlg.showModal && !dlg.open) dlg.showModal();
      tervetuloa(p);
    });
  }

  function initUi() {
    var dlg = $('profileDlg');
    function open() {
      renderProfile();
      $('loginErr').textContent = '';
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      if (!window.Auth.user()) setTimeout(function () { $('codeIn').focus(); }, 50);
    }
    $('meBtn').addEventListener('click', open);
    Array.prototype.forEach.call(document.querySelectorAll('[data-open-login]'), function (b) { b.addEventListener('click', open); });
    $('dlgClose').addEventListener('click', function () { dlg.close ? dlg.close() : dlg.removeAttribute('open'); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && dlg.close) dlg.close(); });

    $('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('codeIn').value;
      $('loginErr').textContent = '';
      window.Auth.login(code).then(function (p) {
        if (!p) { $('loginErr').textContent = 'Koodi ei kelpaa. Tarkista koodi ja yritä uudelleen.'; return; }
        $('codeIn').value = '';
        tervetuloa(p);
      }).catch(function () { $('loginErr').textContent = 'Kirjautuminen ei onnistu tällä selaimella.'; });
    });
    $('logoutBtn').addEventListener('click', function () { window.Auth.logout(); render(); });
    $('nickForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = str($('nickIn').value, 24);
      send({ typ: 'profiili', lempinimi: nick }).then(function () { toast(nick ? 'Lempinimi tallennettu: ' + nick : 'Lempinimi poistettu.'); }).catch(function () {});
    });

    // uusi veto
    var optsBox = $('betOpts');
    function addOpt(val) {
      if (optsBox.children.length >= 4) return;
      var i = el('input');
      i.type = 'text';
      i.maxLength = 40;
      i.value = val || '';
      i.placeholder = 'Vaihtoehto ' + (optsBox.children.length + 1);
      i.id = 'betOpt' + optsBox.children.length;
      i.setAttribute('aria-label', 'Vaihtoehto ' + (optsBox.children.length + 1));
      optsBox.appendChild(i);
      $('addOpt').hidden = optsBox.children.length >= 4;
    }
    function resetForm() {
      $('betQ').value = '';
      optsBox.textContent = '';
      addOpt('Kyllä');
      addOpt('Ei');
    }
    resetForm();
    $('addOpt').addEventListener('click', function () { addOpt(''); });
    var sug = $('betSuggest');
    EHDOTUKSET.forEach(function (q) {
      var b = el('button', 'chip small', q);
      b.type = 'button';
      b.addEventListener('click', function () { $('betQ').value = q; $('betQ').focus(); });
      sug.appendChild(b);
    });
    $('newBet').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = str($('betQ').value, 120);
      var opts = Array.prototype.map.call(optsBox.children, function (i) { return str(i.value, 40); }).filter(Boolean);
      if (!q) { toast('Kirjoita vedon kysymys.'); return; }
      if (opts.length < 2) { toast('Vedossa pitää olla vähintään kaksi vaihtoehtoa.'); return; }
      send({ typ: 'veto', kysymys: q, vaihtoehdot: opts }).then(function () { toast('Veto julkaistu!'); resetForm(); }).catch(function () {});
    });
  }

  /* ---------- käynnistys ---------- */
  initUi();
  window.Auth.ready.then(function () {
    add(lsGet());
    fold();
    render();
    window.Auth.onChange(render);
    return fetch('data/kassa.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : { tapahtumat: [] }; })
      .then(function (d) { add(d.tapahtumat || []); })
      .catch(function () { /* repon kopiota ei ole vielä */ });
  }).then(function () {
    return poll().catch(function () { toast('Vetokassan live-yhteys ei vastaa. Näytetään tallennettu tilanne.'); });
  }).then(function () {
    listen();
    return lunastus();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll().catch(function () {}); });

  window.Kassa = { render: render };
})();
