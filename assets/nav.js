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
  <p>MyGridNZ is kindly supported by the <a href="https://www.dur.ac.uk/dei/" target="_blank">Durham Energy Institute</a>.</p>
  <p style="margin-top:8px">© MyGridNZ</p>
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
  <div class="bottom-card">
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
    <p style="margin-bottom:12px">Connect on LinkedIn for the latest Aotearoa New Zealand electricity data and analysis.</p>
    <a href="https://www.linkedin.com/in/afcrossland" target="_blank" class="follow-btn" style="background:#0a66c2">Connect on LinkedIn</a>
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
