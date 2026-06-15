/* nav.js — injects header + footer into every page */

const NAV_HTML = `
<header id="site-header">
  <div class="header-inner">
    <a class="logo" href="/index.html">MyGrid<span class="logo-accent">NZ</span> 🇳🇿</a>
    <button id="nav-toggle" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
    <nav id="main-nav">
      <ul>
        <li>
          <a href="/last-28-days/index.html">Electricity Data ▾</a>
          <ul>
            <li><a href="/last-28-days/index.html">Last Month</a></li>
            <li><a href="/last-12-months/index.html">Last 12 Months</a></li>
            <li><a href="/historicaldata/index.html">Generation History</a></li>
          </ul>
        </li>
        <li><a href="/2030grid/index.html">2030 Blueprint</a></li>
        <li>
          <a href="/about/index.html">About ▾</a>
          <ul>
            <li><a href="/about/index.html">About MyGridNZ</a></li>
            <li><a href="/about-me/index.html">About Me</a></li>
          </ul>
        </li>
      </ul>
    </nav>
  </div>
</header>`;

const FOOTER_HTML = `
<footer id="site-footer">
  <p>© MyGridNZ</p>
</footer>`;

document.addEventListener('DOMContentLoaded', () => {
  // On GitHub Pages the site lives under /<repo>/ rather than /.
  // On a custom domain (or localhost) it lives at /, so BASE is empty.
  // For file:// protocol, derive base from the current file path.
  let BASE = '';
  if (window.location.hostname.endsWith('github.io')) {
    BASE = '/' + window.location.pathname.split('/')[1];
  } else if (window.location.protocol === 'file:') {
    // Walk up from the current file to find the repo root (contains index.html)
    const parts = window.location.pathname.split('/');
    // Find the directory containing index.html at the root level
    BASE = parts.slice(0, parts.indexOf('mygridnz') + 2).join('/').replace(/\/$/, '');
    if (!BASE.endsWith('mygridnz')) BASE = '';
  }

  const IMG = (path) => BASE ? BASE + path : path;

  const SIDEBAR_HTML = `
<div class="bottom-cards">
  <div class="bottom-card" style="display:none;">
    <div class="bottom-card-label">Supported by</div>
    <a href="https://www.dur.ac.uk/dei/" target="_blank" style="display:block; text-align:center;">
      <img src="${IMG('/images/dei.webp')}" alt="Durham Energy Institute" style="max-width:100%;border-radius:6px;">
    </a>
    <p>MyGridNZ is kindly supported by the Durham Energy Institute.</p>
  </div>
  <div class="bottom-card">
    <div class="bottom-card-label">Book</div>
    <a href="https://www.amazon.co.uk/Decarbonising-Electricity-Routledge-Explorations-Studies/dp/0367203324" target="_blank" style="display:block;text-align:center;">
      <img src="${IMG('/images/9780367203320.jpg')}" alt="Decarbonising Electricity Made Simple" style="max-height:160px;width:auto;border-radius:6px;">
    </a>
    <p>Decarbonising Electricity Made Simple — <a href="https://www.amazon.co.uk/Decarbonising-Electricity-Routledge-Explorations-Studies/dp/0367203324" target="_blank">buy on Amazon</a></p>
  </div>
  <div class="bottom-card">
    <div class="bottom-card-label">Connect</div>
    <a href="https://www.linkedin.com/in/afcrossland" target="_blank" style="display:block;text-align:center;text-decoration:none;">
      <svg viewBox="0 0 72 72" xmlns="http://www.w3.org/2000/svg" style="width:56px;height:56px;display:block;margin:0 auto 10px;">
        <rect width="72" height="72" rx="8" fill="#0a66c2"/>
        <path fill="#fff" d="M13.4 27.5h9.2v29.1h-9.2zm4.6-14.7a5.35 5.35 0 110 10.7 5.35 5.35 0 010-10.7zM28.2 27.5h8.8v4h.1c1.2-2.3 4.2-4.7 8.7-4.7 9.3 0 11 6.1 11 14.1v16.2h-9.1V42.7c0-3.4-.1-7.8-4.7-7.8-4.8 0-5.5 3.7-5.5 7.5v14.2h-9.3z"/>
      </svg>
      <span style="font-size:13px;font-weight:600;color:#0a66c2;">Andrew Crossland</span>
    </a>
    <p style="margin:4px 0 12px;">Energy engineer, author &amp; researcher sharing analysis on Aotearoa NZ and GB electricity decarbonisation.</p>
    <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
      <a href="https://www.linkedin.com/in/afcrossland" target="_blank" class="follow-btn" style="background:#0a66c2;text-align:center;">Connect on LinkedIn</a>
      <a href="https://www.future-zero.com" target="_blank" class="follow-btn" style="background:var(--brand);text-align:center;">future-zero.com ↗</a>
    </div>
  </div>
</div>`;

  // Inject header
  document.body.insertAdjacentHTML('afterbegin', NAV_HTML);

  // Prefix every internal link in the header with the base path
  if (BASE) {
    document.querySelectorAll('#site-header a[href^="/"]').forEach(a => {
      a.setAttribute('href', BASE + a.getAttribute('href'));
    });
  }

  // Inject footer
  document.body.insertAdjacentHTML('beforeend', FOOTER_HTML);

  // Inject sidebar where placeholder exists
  const sidebarPlaceholder = document.getElementById('sidebar-placeholder');
  if (sidebarPlaceholder) sidebarPlaceholder.outerHTML = SIDEBAR_HTML;

  // Highlight active nav link
  const path = window.location.pathname;
  document.querySelectorAll('#main-nav a').forEach(a => {
    if (a.getAttribute('href') && path.includes(a.getAttribute('href').split('/')[1])) {
      a.classList.add('active');
    }
  });

  // Mobile nav toggle
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
  }

  // Mobile dropdown toggles — tap the parent link to expand/collapse
  document.querySelectorAll('#main-nav > ul > li > a').forEach(a => {
    if (a.nextElementSibling && a.nextElementSibling.tagName === 'UL') {
      a.addEventListener('click', e => {
        if (window.getComputedStyle(toggle).display !== 'none') {
          e.preventDefault();
          a.parentElement.classList.toggle('open');
        }
      });
    }
  });
});
