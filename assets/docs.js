/* Graph Nexus documentation behaviour: mobile nav drawer, TOC scroll-spy, search.
   No dependencies. Works from the file:// protocol because the search index is
   loaded as a plain script, not fetched. */
(function () {
  'use strict';

  /* ---------- light / dark theme ---------- */
  // Initial theme is set before paint by the inline script in <head>.

  // The switch is a checkbox: checked means dark mode.
  var themeSwitch = document.querySelector('.toggle-switch .checkbox');
  if (themeSwitch) {
    themeSwitch.checked = document.documentElement.getAttribute('data-theme') === 'dark';
    themeSwitch.addEventListener('change', function () {
      var next = themeSwitch.checked ? 'dark' : 'light';
      var apply = function () { document.documentElement.setAttribute('data-theme', next); };
      // Crossfade the colour swap where supported (180ms, see doc.css); instant otherwise
      // and for reduced motion.
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !reduce) document.startViewTransition(apply); else apply();
      try { window.localStorage.setItem('nexus-docs-theme', next); } catch (e) { /* private mode / file:// */ }
    });
  }

  /* ---------- mobile drawer ---------- */

  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.doc-nav');

  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      setNav(!document.body.classList.contains('nav-open'));
    });
  }
  document.addEventListener('click', function (e) {
    if (!document.body.classList.contains('nav-open')) return;
    if (nav && !nav.contains(e.target) && toggle && !toggle.contains(e.target)) setNav(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setNav(false);
  });

  /* Keep the current sidebar entry in view on load. */
  var current = document.querySelector('.doc-nav a.current');
  if (current && nav && nav.scrollHeight > nav.clientHeight) {
    var top = current.offsetTop - nav.clientHeight / 2;
    if (top > 0) nav.scrollTop = top;
  }

  /* ---------- copy buttons on code blocks ---------- */

  [].slice.call(document.querySelectorAll('.doc-content pre')).forEach(function (pre) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'doc-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code to clipboard');
    // Scrollable code must be reachable without a pointer.
    if (!pre.hasAttribute('tabindex')) pre.setAttribute('tabindex', '0');
    button.addEventListener('click', function () {
      var text = pre.innerText.replace(/\s*Copy\s*$/, '');
      var done = function (label, state) {
        button.textContent = label;
        button.setAttribute('data-state', state);
        setTimeout(function () { button.textContent = 'Copy'; button.removeAttribute('data-state'); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done('Copied', 'done'); },
                                                 function () { done('Press Ctrl+C', 'fail'); });
      } else {
        var area = document.createElement('textarea');
        area.value = text; document.body.appendChild(area); area.select();
        try { document.execCommand('copy'); done('Copied', 'done'); } catch (e) { done('Press Ctrl+C', 'fail'); }
        document.body.removeChild(area);
      }
    });
    pre.appendChild(button);
  });

  /* ---------- remember the Plain JS / React choice ---------- */

  (function () {
    var toggleLinks = [].slice.call(document.querySelectorAll('.variant-toggle a'));
    if (!toggleLinks.length) return;
    var KEY = 'nexus-docs-variant';
    var read = function () { try { return window.localStorage.getItem(KEY); } catch (e) { return null; } };
    var write = function (v) { try { window.localStorage.setItem(KEY, v); } catch (e) { /* private mode / file:// */ } };
    var variantOf = function (a) { var m = /\/timeline\/(js|react)\//.exec(a.getAttribute('href')); return m && m[1]; };

    toggleLinks.forEach(function (a) {
      a.addEventListener('click', function () { var v = variantOf(a); if (v) write(v); });
    });

    // Landed on the other flavour (e.g. via a sidebar link)? Go to the saved one once.
    var saved = read();
    var here = /\/timeline\/(js|react)\//.exec(window.location.pathname);
    if (saved && here && here[1] !== saved) {
      var target = toggleLinks.filter(function (a) { return variantOf(a) === saved; })[0];
      if (target) window.location.replace(target.href + window.location.hash);
    }
  })();

  /* ---------- table of contents scroll-spy ---------- */

  var tocLinks = [].slice.call(document.querySelectorAll('.doc-toc a'));
  if (tocLinks.length) {
    var targets = tocLinks
      .map(function (a) {
        var el = document.getElementById(decodeURIComponent(a.hash.slice(1)));
        return el ? { link: a, el: el } : null;
      })
      .filter(Boolean);

    var active = null;
    var mark = function () {
      var line = window.scrollY + 120;
      var found = targets.length ? targets[0] : null;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].el.offsetTop <= line) found = targets[i];
        else break;
      }
      // At the very bottom, highlight the last entry.
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        found = targets[targets.length - 1];
      }
      if (found === active) return;
      if (active) active.link.classList.remove('active');
      if (found) found.link.classList.add('active');
      active = found;
    };

    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; mark(); });
    }, { passive: true });
    window.addEventListener('resize', mark);
    mark();
  }

  /* ---------- search ---------- */

  var input = document.querySelector('.doc-search input');
  var results = document.querySelector('.search-results');
  var index = window.NEXUS_SEARCH_INDEX;

  if (input && results && index) {
    var prefix = document.body.getAttribute('data-root') || '';
    var selected = -1;

    var score = function (entry, terms) {
      var title = entry.t.toLowerCase();
      var group = (entry.g || '').toLowerCase();
      var text = (entry.x || '').toLowerCase();
      var total = 0;
      for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        if (title === term) total += 100;
        else if (title.indexOf(term) === 0) total += 60;
        else if (title.indexOf(term) > -1) total += 40;
        else if (group.indexOf(term) > -1) total += 12;
        else if (text.indexOf(term) > -1) total += 6;
        else return 0; // every term must appear somewhere
      }
      return total;
    };

    var render = function (matches) {
      results.innerHTML = '';
      selected = -1;
      if (!matches.length) {
        results.innerHTML = '<li class="search-empty">No matches. Try a shorter term or an API name such as "fit" or "markers".</li>';
        return;
      }
      matches.forEach(function (m) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = prefix + m.u;
        a.innerHTML = '<span class="r-title"></span><span class="r-group"></span>';
        a.querySelector('.r-title').textContent = m.t;
        a.querySelector('.r-group').textContent = m.g || '';
        li.appendChild(a);
        results.appendChild(li);
      });
    };

    var run = function () {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { results.innerHTML = ''; return; }
      var terms = q.split(/\s+/);
      render(
        index
          .map(function (e) { return { e: e, s: score(e, terms) }; })
          .filter(function (r) { return r.s > 0; })
          .sort(function (a, b) { return b.s - a.s; })
          .slice(0, 12)
          .map(function (r) { return r.e; })
      );
    };

    input.addEventListener('input', run);

    input.addEventListener('keydown', function (e) {
      var links = [].slice.call(results.querySelectorAll('a'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!links.length) return;
        if (selected > -1) links[selected].classList.remove('active');
        selected = e.key === 'ArrowDown'
          ? (selected + 1) % links.length
          : (selected <= 0 ? links.length - 1 : selected - 1);
        links[selected].classList.add('active');
        links[selected].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && selected > -1) {
        e.preventDefault();
        links[selected].click();
      } else if (e.key === 'Escape') {
        input.value = '';
        results.innerHTML = '';
      }
    });

    document.addEventListener('click', function (e) {
      if (!results.contains(e.target) && e.target !== input) results.innerHTML = '';
    });

    /* "/" focuses search, the way most docs sites behave. */
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      input.focus();
    });
  }
})();
