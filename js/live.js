/* Live-pöytäkirjan jakaminen katsojien kesken.
 *
 * GitHub Pages on pelkkä staattinen palvelin, joten reaaliaikainen tila kulkee
 * ilmaisen ntfy.sh-palvelun kautta (ei tunnuksia, CORS sallittu):
 *   - tallennus:  POST https://ntfy.sh/<aihe>  (viestinä koko pöytäkirja JSONina)
 *   - kuuntelu:   EventSource https://ntfy.sh/<aihe>/sse
 *   - avaus:      GET  https://ntfy.sh/<aihe>/json?poll=1&since=12h  (viimeisin tila)
 * ntfy.sh säilyttää viestejä noin 12 tuntia, mikä riittää yhden ottelupäivän ajan.
 * Lisäksi viimeisin tila tallennetaan selaimen localStorageen.
 *
 * Aiheen nimen voi vaihtaa alla; kuka tahansa joka tietää nimen voi kirjoittaa
 * pöytäkirjaan, joten pidä se vähänkään arvaamattomana. */
(function () {
  'use strict';

  var PALVELIN = 'https://ntfy.sh';
  var AIHE = 'nekapool2-poytakirja-3d8b64e2a2e5';
  var LS_KEY = 'nekapool2:live';

  function lsGet() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  function lsSet(v) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) { /* yksityinen ikkuna tms. */ }
  }

  function parse(text) {
    try {
      var s = JSON.parse(text);
      return s && s.v === 2 ? s : null;
    } catch (e) { return null; }
  }

  /* Live.connect({ onState(state), onStatus(ok, text) }) */
  function connect(opts) {
    var latest = 0;
    var es = null;
    var retry = 2000;

    function accept(state) {
      if (!state || !(state.ts > latest)) return;
      latest = state.ts;
      lsSet(state);
      opts.onState(state);
    }

    function poll() {
      return fetch(PALVELIN + '/' + AIHE + '/json?poll=1&since=12h', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (body) {
          var best = null;
          body.split('\n').forEach(function (line) {
            if (!line.trim()) return;
            try {
              var m = JSON.parse(line);
              if (m.event !== 'message') return;
              var s = parse(m.message);
              if (s && (!best || s.ts > best.ts)) best = s;
            } catch (e) { /* ohitetaan rikkinäinen rivi */ }
          });
          accept(best);
        });
    }

    function listen() {
      if (!window.EventSource) { opts.onStatus(false, 'Selain ei tue live-päivityksiä'); return; }
      es = new EventSource(PALVELIN + '/' + AIHE + '/sse');
      es.onopen = function () { retry = 2000; opts.onStatus(true, 'Live – muutokset näkyvät kaikille'); };
      es.onmessage = function (ev) {
        try {
          var m = JSON.parse(ev.data);
          if (m.event === 'message') accept(parse(m.message));
        } catch (e) { /* ohitetaan */ }
      };
      es.onerror = function () {
        opts.onStatus(false, 'Yhteys katkesi – yritetään uudelleen…');
        es.close();
        setTimeout(function () { poll().catch(function () {}); listen(); }, retry);
        retry = Math.min(retry * 2, 30000);
      };
    }

    var cached = lsGet();
    if (cached) accept(cached);

    poll()
      .catch(function () { opts.onStatus(false, 'Live-palvelimeen ei saatu yhteyttä'); })
      .then(function () { if (!latest) opts.onState(null); listen(); });

    // Kun puhelin herää taustalta, haetaan tuorein tila heti.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) poll().catch(function () {});
    });

    return {
      save: function (state) {
        state.ts = Math.max(Date.now(), latest + 1);
        latest = state.ts;
        lsSet(state);
        return fetch(PALVELIN + '/' + AIHE, {
          method: 'POST',
          body: JSON.stringify(state) // pelkkä tekstirunko = ei CORS-esikyselyä
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
        });
      }
    };
  }

  window.Live = { connect: connect };
})();
