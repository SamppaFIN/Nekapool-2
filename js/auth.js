/* Kirjautuminen henkilökohtaisella koodilla.
 *
 * Koodit ovat data/joukkue.json-tiedostossa tiivisteinä:
 *   tunniste = sha256('nekapool2:' + id + ':' + koodi)
 * Kirjautuminen muistetaan tällä laitteella (localStorage).
 *
 * Tämä on joukkueen sisäinen kevyt lukko eikä oikea tietoturva: staattisella
 * sivulla kaikki tarkistukset tehdään selaimessa. */
(function () {
  'use strict';

  var LS_KEY = 'nekapool2:kayttaja';
  var LS_NICK = 'nekapool2:salainen-lempinimi';
  var data = null;
  var current = null;
  var listeners = [];

  function lsGet() { try { return localStorage.getItem(LS_KEY); } catch (e) { return null; } }
  function lsSet(v) { try { if (v) localStorage.setItem(LS_KEY, v); else localStorage.removeItem(LS_KEY); } catch (e) { /* ei tallennusta */ } }

  function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error('Selain ei tue kirjautumista'));
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  function b64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  /* Salainen lempinimi on salattu pelaajan koodilla: avain = PBKDF2(koodi, 'nekapool2-nimi:' + id). */
  function decryptNick(p, code) {
    var enc = p.salainen_lempinimi;
    if (!enc || !(window.crypto && crypto.subtle)) return Promise.resolve('');
    var te = new TextEncoder();
    return crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('nekapool2-nimi:' + p.id), iterations: 100000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data)); })
      .then(function (buf) { return new TextDecoder().decode(buf); })
      .catch(function () { return ''; });
  }
  function nickGet() { try { return localStorage.getItem(LS_NICK) || ''; } catch (e) { return ''; } }
  function nickSet(v) { try { if (v) localStorage.setItem(LS_NICK, v); else localStorage.removeItem(LS_NICK); } catch (e) { /* ei tallennusta */ } }

  function emit() { listeners.forEach(function (fn) { try { fn(current); } catch (e) { console.error(e); } }); }

  var ready = fetch('data/joukkue.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      data = d;
      var id = lsGet();
      current = d.pelaajat.filter(function (p) { return p.id === id; })[0] || null;
      emit();
      return d;
    })
    .catch(function () { data = { aloitussaldo: 100, pelaajat: [] }; return data; });

  window.Auth = {
    ready: ready,
    user: function () { return current; },
    players: function () { return data ? data.pelaajat : []; },
    player: function (id) { return (data ? data.pelaajat : []).filter(function (p) { return p.id === id; })[0] || null; },
    startBalance: function () { return data && data.aloitussaldo || 100; },
    /* Palauttaa lupauksen pelaajasta tai null, jos koodi ei kelpaa. */
    login: function (code) {
      code = String(code || '').trim();
      return ready.then(function (d) {
        return Promise.all(d.pelaajat.map(function (p) {
          return sha256('nekapool2:' + p.id + ':' + code).then(function (h) { return h === p.tunniste ? p : null; });
        }));
      }).then(function (hits) {
        var p = hits.filter(Boolean)[0] || null;
        if (!p) return null;
        return decryptNick(p, code).then(function (nick) {
          current = p; lsSet(p.id); nickSet(nick);
          emit();
          return p;
        });
      });
    },
    logout: function () { current = null; lsSet(null); nickSet(''); emit(); },
    /* Koodilla avattu salainen lempinimi (vain tällä laitteella kirjautuneelle). */
    secretNick: function () { return current ? nickGet() : ''; },
    onChange: function (fn) { listeners.push(fn); }
  };
})();
