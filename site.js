/* Site behaviour: FAQ accordion, mobile nav, sticky-header state, reveal on scroll.
   Progressive enhancement — every section works with JavaScript disabled. */
(function () {
  'use strict';

  /* ── FAQ accordion (index.html uses buttons; based on aria-expanded) ── */
  var questions = document.querySelectorAll('.faq-question');
  Array.prototype.forEach.call(questions, function (btn) {
    var item = btn.closest('.faq-item');
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!item || !panel) return;
    panel.style.maxHeight = '0px';
    panel.style.opacity = '0';
    panel.setAttribute('aria-hidden', 'true');

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      // close siblings so only one answer is open at a time
      Array.prototype.forEach.call(questions, function (other) {
        if (other === btn) return;
        var oi = other.closest('.faq-item');
        var op = document.getElementById(other.getAttribute('aria-controls'));
        other.setAttribute('aria-expanded', 'false');
        if (oi) oi.classList.remove('open');
        if (op) { op.style.maxHeight = '0px'; op.style.opacity = '0'; op.setAttribute('aria-hidden', 'true'); }
      });
      btn.setAttribute('aria-expanded', String(!open));
      item.classList.toggle('open', !open);
      panel.style.maxHeight = open ? '0px' : (panel.scrollHeight + 40) + 'px';
      panel.style.opacity = open ? '0' : '1';
      panel.setAttribute('aria-hidden', String(open));
    });
  });

  /* ── native <details> answers (detailed-audit.html) ── */
  Array.prototype.forEach.call(document.querySelectorAll('details'), function (d) {
    var panel = d.querySelector('[data-answer]');
    if (!panel) return;
    panel.style.maxHeight = '0px';
    panel.style.opacity = '0';
    panel.style.overflow = 'hidden';
    panel.style.transition = 'max-height 400ms cubic-bezier(.16,1,.3,1), opacity 250ms cubic-bezier(.16,1,.3,1)';
    d.addEventListener('toggle', function () {
      panel.style.maxHeight = d.open ? (panel.scrollHeight + 24) + 'px' : '0px';
      panel.style.opacity = d.open ? '1' : '0';
    });
  });

  /* ── mobile nav ── */
  var toggle = document.querySelector('.mobile-menu-btn');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.classList.toggle('nav-open', !open);
    });
    Array.prototype.forEach.call(nav.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── sticky header state ── */
  var header = document.getElementById('header');
  if (header) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── reveal on scroll ── */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (reduced || !('IntersectionObserver' in window)) {
    Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  Array.prototype.forEach.call(items, function (el) { io.observe(el); });
})();
