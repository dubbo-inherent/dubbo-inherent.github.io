/* kd-theme.js — behavior for the standalone Kdubbo theme.
   Replaces the Material JS this site actually used: client-side search over
   the mkdocs search index, header shadow on scroll, TOC scroll-spy and code
   copy buttons. No external dependencies. */
(function () {
  'use strict';

  var cfg = { base: '.', lang: 'zh' };
  var cfgEl = document.getElementById('__config');
  if (cfgEl) {
    try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { /* keep defaults */ }
  }
  var zh = cfg.lang !== 'en';

  document.addEventListener('DOMContentLoaded', function () {

    /* === Header shadow — solid blurred backdrop once the page scrolls === */
    var header = document.querySelector('.md-header');
    if (header) {
      var syncShadow = function () {
        header.classList.toggle('md-header--shadow', window.scrollY > 4);
      };
      window.addEventListener('scroll', syncShadow, { passive: true });
      syncShadow();
    }

    /* === Search === */
    var searchBox = document.querySelector('.md-search');
    var searchInput = document.querySelector('.md-search__input');
    var searchToggle = document.getElementById('__search');
    var resultList = document.querySelector('.md-search-result__list');

    if (searchBox && searchInput && searchToggle && resultList) {
      var index = null;
      var loading = false;

      var loadIndex = function () {
        if (index || loading) return;
        loading = true;
        fetch(cfg.base + '/search/search_index.json')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            index = (data.docs || []).map(function (doc) {
              var text = (doc.text || '').replace(/¶/g, ' ').replace(/\s+/g, ' ');
              return {
                location: doc.location,
                title: (doc.title || '').replace(/¶/g, '').trim(),
                text: text,
                ltitle: (doc.title || '').replace(/¶/g, '').trim().toLowerCase(),
                ltext: text.toLowerCase()
              };
            });
            runSearch();
          })
          .catch(function () { loading = false; });
      };

      var escapeHtml = function (s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      };

      var highlight = function (text, terms) {
        var safe = escapeHtml(text);
        terms.forEach(function (t) {
          if (!t) return;
          var re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
          safe = safe.replace(re, '<mark>$1</mark>');
        });
        return safe;
      };

      var runSearch = function () {
        var query = searchInput.value.trim().toLowerCase();
        resultList.innerHTML = '';
        var meta = searchBox.querySelector('.md-search-result__meta');
        if (meta) meta.remove();
        searchBox.classList.remove('md-search--results');

        if (!query) return;
        if (!index) { loadIndex(); return; }

        var terms = query.split(/\s+/).filter(Boolean);
        var results = [];
        for (var i = 0; i < index.length; i++) {
          var doc = index[i];
          if (!doc.title && !doc.text) continue;
          var score = 0;
          var ok = true;
          for (var j = 0; j < terms.length; j++) {
            var t = terms[j];
            var inTitle = doc.ltitle.indexOf(t) !== -1;
            var inText = doc.ltext.indexOf(t) !== -1;
            if (!inTitle && !inText) { ok = false; break; }
            score += inTitle ? 12 : 1;
          }
          if (!ok) continue;
          if (doc.location.indexOf('#') === -1) score += 4; /* prefer whole pages */
          results.push({ doc: doc, score: score });
        }
        results.sort(function (a, b) { return b.score - a.score; });
        results = results.slice(0, 12);

        var container = searchBox.querySelector('.md-search-result');
        if (!results.length) {
          var info = document.createElement('div');
          info.className = 'md-search-result__meta';
          info.textContent = zh ? '没有找到匹配的文档' : 'No matching documents';
          container.insertBefore(info, resultList);
        }

        results.forEach(function (r) {
          var doc = r.doc;
          var pos = doc.ltext.indexOf(terms[0]);
          var start = Math.max(0, pos - 40);
          var teaser = doc.text.slice(start, start + 140);
          if (start > 0) teaser = '…' + teaser;

          var li = document.createElement('li');
          li.className = 'md-search-result__item';
          li.innerHTML =
            '<a class="md-search-result__link" href="' + cfg.base + '/' + doc.location + '">' +
              '<article class="md-search-result__article md-typeset">' +
                '<h1>' + highlight(doc.title, terms) + '</h1>' +
                (teaser ? '<p class="md-search-result__teaser">' + highlight(teaser, terms) + '</p>' : '') +
              '</article>' +
            '</a>';
          resultList.appendChild(li);
        });

        searchBox.classList.add('md-search--results');
        searchToggle.checked = true;
      };

      /* The magnifier is a label for #__search: clicking it expands the pill
         and focuses the input; clicking again (or outside / Escape) folds it. */
      searchToggle.addEventListener('change', function () {
        if (searchToggle.checked) searchInput.focus();
        else searchInput.blur();
      });
      searchInput.addEventListener('focus', function () {
        loadIndex();
        searchToggle.checked = true;
      });
      searchInput.addEventListener('input', runSearch);

      document.addEventListener('click', function (e) {
        /* Clicking the magnifier label fires a synthetic click on the hidden
           #__search checkbox (a sibling of the header, outside .md-search) —
           it must not count as an outside click or the panel closes at once. */
        if (e.target === searchToggle || searchBox.contains(e.target)) return;
        searchToggle.checked = false;
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchToggle.checked = false;
          searchInput.blur();
        } else if (e.key === '/' && document.activeElement !== searchInput &&
                   !/^(input|textarea|select)$/i.test(document.activeElement.tagName)) {
          e.preventDefault();
          searchInput.focus();
        }
      });
    }

    /* === Code copy buttons === */
    var copyLabel = zh ? '复制' : 'Copy';
    document.querySelectorAll('.md-typeset .highlight').forEach(function (block) {
      var code = block.querySelector('pre > code');
      if (!code) return;
      var btn = document.createElement('button');
      btn.className = 'md-clipboard md-icon';
      btn.type = 'button';
      btn.title = copyLabel;
      btn.setAttribute('aria-label', copyLabel);
      btn.addEventListener('click', function () {
        var text = code.innerText.replace(/\n+$/, '\n');
        var done = function () {
          btn.style.color = 'var(--mesh-accent, #1D5BC4)';
          setTimeout(function () { btn.style.color = ''; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done);
        } else {
          var range = document.createRange();
          range.selectNodeContents(code);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('copy');
          sel.removeAllRanges();
          done();
        }
      });
      block.insertBefore(btn, block.firstChild);
    });

    /* === TOC scroll-spy === */
    var tocLinks = Array.prototype.slice.call(
      document.querySelectorAll('.md-sidebar--secondary .md-nav__link[href^="#"]')
    );
    if (tocLinks.length) {
      var targets = tocLinks
        .map(function (link) {
          var el = document.getElementById(decodeURIComponent(link.hash.slice(1)));
          return el ? { link: link, el: el } : null;
        })
        .filter(Boolean);

      var spyTicking = false;
      var spy = function () {
        spyTicking = false;
        var line = window.scrollY + 96;
        var current = null;
        for (var i = 0; i < targets.length; i++) {
          if (targets[i].el.offsetTop <= line) current = targets[i];
          else break;
        }
        targets.forEach(function (t) {
          t.link.classList.toggle('md-nav__link--active', t === current);
          t.link.classList.toggle(
            'md-nav__link--passed',
            !!current && t.el.offsetTop < current.el.offsetTop
          );
        });
      };
      window.addEventListener('scroll', function () {
        if (!spyTicking) { spyTicking = true; requestAnimationFrame(spy); }
      }, { passive: true });
      spy();
    }

    /* === Drawer: close after choosing a page (mobile) === */
    var drawer = document.getElementById('__drawer');
    if (drawer) {
      document.querySelectorAll('.md-sidebar--primary a.md-nav__link').forEach(function (link) {
        link.addEventListener('click', function () { drawer.checked = false; });
      });
    }
  });
})();
