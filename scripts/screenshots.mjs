// Screenshot the getlos dashboard (desktop + mobile) for visual QA.
// Usage: node scripts/screenshots.mjs [url] [prefix]
//   default url: http://localhost:8123/dashboard.html
//   default prefix: dev
// Saves screenshots/<prefix>-desktop.png and screenshots/<prefix>-mobile.png
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const url = process.argv[2] || 'http://localhost:8123/dashboard.html';
const prefix = process.argv[3] || 'dev';
mkdirSync('screenshots', { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--disable-extensions'],
});

async function shot(name, width, height, opts = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, ...opts });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 5000)); // tiles + data settle
  await page.screenshot({ path: `screenshots/${prefix}-${name}.png` });
  const state = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      title: document.title,
      mapH: q('#map')?.offsetHeight,
      markers: typeof markers !== 'undefined' ? markers.length : null,
      statFilms: q('#statFilms')?.textContent,
      statCinemas: q('#statCinemas')?.textContent,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      fontLoaded: document.fonts.check('16px "InterVar"'),
      displayFont: document.fonts.check('16px "SpaceGrotesk"'),
      tiles: q('#map img.leaflet-tile')?.src || null,
      overlayVisible: q('#loadingOverlay')?.style.display,
      lang: q('#headerLabel')?.textContent,
    };
  });
  console.log(`[${name}]`, JSON.stringify(state));
  console.log(`[${name}] errors:`, errors.length ? errors.join(' | ') : 'none');
  await page.close();
}

await shot('desktop', 1440, 900);
await shot('mobile', 390, 844, { isMobile: true, hasTouch: true });
await browser.close();
console.log('done');
