/* Free-audit form — client-side validation + POST /api/audit.
   Shared by index.html and /free-audit. No dependencies.

   Selector-tolerant on purpose: it works with both the current markup
   (#email-error / #site-error / #form-success / #success-email / #form-status)
   and the older one (.lf-err[data-for] / #audit-done / #audit-done-email /
   #audit-global), so a future template tweak can't silently kill feedback. */
(function () {
  'use strict';

  var form = document.getElementById('audit-form');
  if (!form) return;

  var emailEl = form.querySelector('#email');
  var siteEl = form.querySelector('#site');
  var button = form.querySelector('button[type="submit"]');
  var statusEl = byId('form-status', 'audit-global');
  var doneEl = byId('form-success', 'audit-done');
  var doneEmail = byId('success-email', 'audit-done-email');
  var wrap = document.getElementById('free-audit') || form;
  var sending = false;

  function byId() {
    for (var i = 0; i < arguments.length; i++) {
      var el = document.getElementById(arguments[i]);
      if (el) return el;
    }
    return null;
  }

  // Same rules as functions/api/audit.js — the server is the authority,
  // this only saves the visitor a round trip.
  var EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
  var DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/\S*)?$/;
  var HANDLE_RE = /^@?[a-z0-9](?:[a-z0-9._-]{1,58})[a-z0-9]$/;
  var DISPOSABLE = ['mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'grr.la',
    '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com',
    'trashmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com'];

  var COPY = { email: 'email', site: 'site' };
  var errors = {};

  function errNode(field) {
    return byId(field + '-error') || form.querySelector('.lf-err[data-for="' + field + '"]');
  }

  function setError(field, message) {
    var node = errNode(field);
    var input = form.querySelector('#' + COPY[field]);
    if (message) {
      errors[field] = message;
      if (node) { node.textContent = message; node.hidden = false; node.classList.add('visible'); }
      if (input) input.setAttribute('aria-invalid', 'true');
    } else {
      delete errors[field];
      if (node) { node.textContent = ''; node.hidden = true; node.classList.remove('visible'); }
      if (input) input.removeAttribute('aria-invalid');
    }
  }

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.innerHTML = message || '';
    statusEl.classList.toggle('visible', !!message);
    statusEl.style.display = message ? 'block' : '';
  }

  function checkEmail(raw) {
    var email = String(raw || '').trim().toLowerCase();
    if (!email) return 'Enter your email address.';
    var at = email.lastIndexOf('@');
    var local = at > 0 ? email.slice(0, at) : '';
    var domain = at > 0 ? email.slice(at + 1) : '';
    if (!local || !domain) return 'That email address is missing an \u201C@\u201D or a domain.';
    if (local.length > 64) return 'That email address is too long.';
    if (email.indexOf('..') > -1 || !EMAIL_RE.test(email)) return 'That email address does not look right \u2014 check for typos.';
    if (DISPOSABLE.indexOf(domain) > -1) return 'Please use your business email address.';
    return null;
  }

  function checkSite(raw) {
    var site = String(raw || '').trim();
    if (!site) return 'Add your website or Instagram handle.';
    if (/\s/.test(site)) return 'Website or Instagram handle \u2014 no spaces.';
    site = site.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    if (!DOMAIN_RE.test(site) && !HANDLE_RE.test(site)) {
      return 'That does not look like a domain or an @handle \u2014 e.g. yourbusiness.hk';
    }
    return null;
  }

  function validate() {
    setError('email', checkEmail(emailEl && emailEl.value));
    setError('site', checkSite(siteEl && siteEl.value));
    setStatus('');
    var first = Object.keys(errors)[0];
    if (first) {
      var input = form.querySelector('#' + COPY[first]);
      if (input) input.focus();
      return false;
    }
    return true;
  }

  ['email', 'site'].forEach(function (field) {
    var input = form.querySelector('#' + COPY[field]);
    if (!input) return;
    input.addEventListener('blur', function () {
      setError(field, field === 'email' ? checkEmail(input.value) : checkSite(input.value));
    });
    input.addEventListener('input', function () {
      if (errors[field]) setError(field, null);
      setStatus('');
    });
  });

  function showDone(email) {
    if (doneEmail) doneEmail.textContent = email;
    if (doneEl) {
      doneEl.hidden = false;
      doneEl.style.display = 'block';
      form.hidden = true;
      form.style.display = 'none';
      if (wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // No success panel in this template: say it in the status line instead.
      setStatus('Audit on its way \u2014 we will reply to ' + email + ' within 48 hours.');
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) return;
    if (!validate()) return;

    var email = String(emailEl.value).trim().toLowerCase();
    var site = String(siteEl.value).trim();
    var hp = form.querySelector('input[name="company_url"]');
    var params = new URLSearchParams(window.location.search);
    var payload = {
      email: email,
      site: site,
      page: window.location.pathname,
      source: document.body.getAttribute('data-form-context') || 'landing page',
      ref: document.referrer || '',
      company_url: hp ? hp.value : '',
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || ''
    };

    var label = button ? button.innerHTML : '';
    sending = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Sending\u2026';
    }
    setStatus('');

    // Never leave the visitor staring at a spinner: give up after 15s.
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 15000);
    var late = false;
    setTimeout(function () { if (sending) { late = true; setStatus('Still working on it\u2026'); } }, 6000);

    fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          return { status: res.status, data: data || {} };
        });
      })
      .then(function (r) {
        if (r.data.fields) {
          Object.keys(r.data.fields).forEach(function (f) { setError(f, r.data.fields[f]); });
          var first = Object.keys(r.data.fields)[0];
          var input = form.querySelector('#' + COPY[first]);
          if (input) input.focus();
          return;
        }
        if (r.data.ok) { showDone(email); return; }
        setStatus('Something went wrong on our side. Email <a href="mailto:hello@hkexposurelab.com?subject=Free%20audit%20request">hello@hkexposurelab.com</a> and we will pick it up straight away.');
      })
      .catch(function () {
        setStatus('No connection to our server. Email <a href="mailto:hello@hkexposurelab.com?subject=Free%20audit%20request">hello@hkexposurelab.com</a> and we will pick it up straight away.');
      })
      .then(function () {
        clearTimeout(timer);
        sending = false;
        if (button) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.innerHTML = label;
        }
      });
  });
})();
