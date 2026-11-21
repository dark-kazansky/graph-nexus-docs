/* Home page motion: sections rise in once, and the tagline lights up word by
   word as it crosses the middle of the viewport. Reduced motion: no animation. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Hide reveal sections only once JS is running, so no-JS readers see everything.
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  }

  var line = document.querySelector('.tagline-text');
  if (!line) return;
  var words = line.textContent.trim().split(/\s+/);
  line.innerHTML = words.map(function (w) { return '<span class="w">' + w + '</span>'; }).join(' ');
  var spans = line.querySelectorAll('.w');
  if (reduce) { spans.forEach(function (s) { s.classList.add('on'); }); return; }

  // One scroll listener, throttled to one update per frame.
  var queued = false;
  function update() {
    queued = false;
    var trigger = window.innerHeight * 0.65;
    var box = line.getBoundingClientRect();
    // Progress of the block through the trigger line, 0..1, mapped onto words in order.
    var progress = (trigger - box.top) / Math.max(box.height, 1) * 1.6;
    var lit = Math.round(Math.max(0, Math.min(1, progress)) * spans.length);
    spans.forEach(function (s, i) { s.classList.toggle('on', i < lit); });
  }
  window.addEventListener('scroll', function () {
    if (!queued) { queued = true; window.requestAnimationFrame(update); }
  }, { passive: true });
  update();
})();
