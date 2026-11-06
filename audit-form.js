/* Free-audit form — client-side validation + POST /api/audit.
   Shared by index.html (hero) and free-audit.html. No dependencies. */
(function () {
  'use strict';

  var form = document.getElementById('audit-form');
  if (!form) return;

  var emailEl = form.querySelector('#email');
  var siteEl = form.querySelector('#site');
  var button = form.querySelector('button[type="submit"]');
  var globalEl = document.getElementById('audit-global');
  var doneEl = document.getElementById('audit-done');
  var doneEmail = document.getElementById('audit-done-email');
  var wrap = document.getElementById('free-audit') || form;

  // Same rules as functions/api/audit.js — the server is the authority,
  // this only saves the visitor a round trip.
  var EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
  var DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/\S*)?$/;
  var HANDLE_RE = /^@?[a-z0-9](?:[a-z0-9._-]{1,58})[a-z0-9]$/;
  var DISPOSABLE = [
    'mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'grr.la', '10minutemail.com',
    'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
    'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com'
  ];

  var COPY = { email: 'email', site: 'site' };
  var errors = {};

  function errNode(field) {
    return form.querySelector('.lf-err[data-for="' + field + '"]');
  }

  function setError(field, message) {
    var node = errNode(field);
    var input = form.querySelector('#' + COPY[field]);
    if (message) {
      errors[field] = message;
      if (node) { node.textContent = message; node.hidden = false; }
      if (input) input.setAttribute('aria-invalid', 'true');
    } else {
      delete errors[field];
      if (node) { node.textContent = ''; node.hidden = true; }
      if (input) input.removeAttribute('aria-invalid');
    }
  }

  function setGlobal(message) {
    if (!globalEl) return;
    globalEl.innerHTML = message || '';
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
    setGlobal('');
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
      setGlobal('');
    });
  });

  function showDone(email) {
    if (doneEmail) doneEmail.textContent = email;
    if (doneEl) {
      doneEl.hidden = false;
      form.hidden = true;
      if (wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      setGlobal('Audit on its way \u2014 we will reply to ' + email + ' within two days.');
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
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
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Sending\u2026';
    }
    setGlobal('');

    fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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
        if (r.data.ok) {
          showDone(email);
          return;
        }
        setGlobal(
          'Something went wrong on our side. Email <a href="mailto:hello@hkexposurelab.com?subject=Free%20audit%20request">hello@hkexposurelab.com</a> and we will pick it up straight away.'
        );
      })
      .catch(function () {
        setGlobal(
          'No connection to our server. Email <a href="mailto:hello@hkexposurelab.com?subject=Free%20audit%20request">hello@hkexposurelab.com</a> and we will pick it up straight away.'
        );
      })
      .then(function () {
        if (button) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.innerHTML = label;
        }
      });
  });
})();
