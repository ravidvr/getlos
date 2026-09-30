// Deterministic visual audit of the redesigned dashboard.
// Usage: node scripts/ui-audit.mjs [url]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:8123/dashboard.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--disable-extensions'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, 5000));

const audit = await page.evaluate(() => {
  const out = {};
  const cs = (el) => getComputedStyle(el);
  const lum = (rgb) => {
    const m = rgb.match(/(\d+)[, ]+(\d+)[, ]+(\d+)/);
    if (!m) return 0.5;
    const [r, g, b] = [+m[1], +m[2], +m[3]].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return ((l1 + 0.05) / (l2 + 0.05)).toFixed(2);
  };
  const q = (s) => document.querySelector(s);
  const g = (s) => q(s) ? cs(q(s)) : null;

  // canvas + text contrast
  const bodyBg = cs(document.body).backgroundColor;
  out.bodyBg = bodyBg;
  out.headerBg = g('.header').backgroundColor;
  out.textVsBody = contrast(cs(document.body).color, bodyBg);
  out.headerTextVsHeaderBg = contrast(g('.header h1').color, g('.header').backgroundColor);
  out.mutedVsHeader = contrast(g('#headerLabel').color, g('.header').backgroundColor);

  // brand
  out.logoFont = g('.header h1 .logo').fontFamily.split(',')[0];
  out.logoSize = g('.header h1').fontSize;
  out.logoWeight = g('.header h1').fontWeight;

  // chips
  const chip = q('.filter-group button');
  out.chipBg = cs(chip).backgroundColor;
  out.chipColor = cs(chip).color;
  out.chipRadius = cs(chip).borderRadius;
  out.chipTextVsChip = contrast(cs(chip).color, cs(chip).backgroundColor);
  const activeChip = q('.filter-group button.active');
  out.activeChipBg = cs(activeChip).backgroundColor;
  out.activeChipColor = cs(activeChip).color;
  out.activeChipBorder = cs(activeChip).borderColor;
  out.activeChipTextVsBg = contrast(cs(activeChip).color, cs(activeChip).backgroundColor);

  // filter labels
  const label = q('.filter-group .label');
  out.labelColor = cs(label).color;
  out.labelVsBg = contrast(cs(label).color, g('.filters').backgroundColor);

  // bottom bar
  out.bottomBarBg = g('.bottom-bar').backgroundColor;
  out.statNum = g('#statFilms').fontFamily.split(',')[0] + ' ' + g('#statFilms').fontSize;
  out.supportChipColor = g('.support-link').color;
  out.supportChipBg = g('.support-link').backgroundColor;
  out.supportChipVsBg = contrast(g('.support-link').color, g('.support-link').backgroundColor);

  // search
  out.searchBg = g('#addrSearch').backgroundColor;
  out.searchTextVsBg = contrast(cs(q('#addrSearch')).color, g('#addrSearch').backgroundColor);

  // guide
  out.guideBg = g('#colorGuide').backgroundColor;
  out.guideColor = cs(q('#colorGuide')).color;
  out.guideVsBg = contrast(cs(q('#colorGuide')).color, g('#colorGuide').backgroundColor);

  // popup (open one)
  out.markers = markers.length;

  // geometry
  out.docScrollW = document.scrollingElement.scrollWidth;
  out.innerW = window.innerWidth;
  out.horizontalOverflow = document.scrollingElement.scrollWidth > window.innerWidth + 1;
  out.headerH = q('.header').offsetHeight;
  out.filtersH = q('#filters').offsetHeight;
  out.bottomBarH = q('.bottom-bar').offsetHeight;
  out.mapH = q('#map').offsetHeight;

  // fonts really loaded?
  out.interLoaded = document.fonts.check('500 14px "InterVar"');
  out.groteskLoaded = document.fonts.check('640 20px "SpaceGrotesk"');
  // used fonts actually resolve to woff2?
  out.bodyFontResolved = cs(document.body).fontFamily;

  // zoom control
  const zc = q('.leaflet-control-zoom a');
  out.zoomBg = cs(zc).backgroundColor;
  out.zoomColor = cs(zc).color;
  return out;
});

// now open a popup and re-measure
await page.evaluate(() => {
  if (markers.length) {
    map.setView(markers[0].getLatLng(), 15);
    markers[0].openPopup();
  }
});
await new Promise((r) => setTimeout(r, 1200));
const popup = await page.evaluate(() => {
  const w = document.querySelector('.leaflet-popup-content-wrapper');
  const c = document.querySelector('.leaflet-popup-content');
  if (!w) return { found: false };
  return {
    found: true,
    wrapperW: w.offsetWidth,
    wrapperBg: getComputedStyle(w).backgroundColor,
    contentH: c.offsetHeight,
    contentScrollH: c.scrollHeight,
    contentScrolls: c.scrollHeight > c.offsetHeight + 1,
    wrapperInViewport: (() => {
      const r = w.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    })(),
    h3Font: getComputedStyle(document.querySelector('.leaflet-popup-content h3')).fontFamily.split(',')[0],
    evtTimeFont: getComputedStyle(document.querySelector('.evt-time')).color,
  };
});
audit.popup = popup;
// popup must fit inside the map pane (Leaflet clips overflow) and the window
audit.popupFits = await page.evaluate(() => {
  const w = document.querySelector('.leaflet-popup-content-wrapper').getBoundingClientRect();
  const mapr = document.getElementById('map').getBoundingClientRect();
  const fitsMap = w.top >= mapr.top - 1 && w.bottom <= mapr.bottom + 1;
  const fitsWin = w.top >= 0 && w.bottom <= window.innerHeight;
  return {
    fitsMap, fitsWin,
    popupRect: [Math.round(w.top), Math.round(w.bottom)],
    mapRect: [Math.round(mapr.top), Math.round(mapr.bottom)],
  };
});
await page.screenshot({ path: 'screenshots/dev-popup.png' });
console.log(JSON.stringify(audit, null, 1));
await browser.close();
