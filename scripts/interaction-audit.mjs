// Interaction audit: lang toggle, search suggestions, mobile sheet + tap targets.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://127.0.0.1:8123/dashboard.html';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const out = {};

// ---------- desktop: lang toggle + search ----------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4500));

  out.lang = await page.evaluate(() => {
    const before = document.getElementById('headerLabel').textContent;
    toggleLang();
    const after = document.getElementById('headerLabel').textContent;
    const chipsBefore = [...document.querySelectorAll('[data-lang]')].map((b) => b.textContent).join(',');
    toggleLang();
    const chipsAfter = [...document.querySelectorAll('[data-lang]')].map((b) => b.textContent).join(',');
    return { before, after, chipsBefore, chipsAfter };
  });

  out.search = await page.evaluate(async () => {
    const input = document.getElementById('addrSearch');
    input.value = 'babylon';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 900));
    const sug = document.getElementById('suggestions');
    const items = [...sug.querySelectorAll('.item')].slice(0, 3).map((i) => i.textContent.trim());
    const bg = getComputedStyle(sug).backgroundColor;
    const vis = getComputedStyle(sug).display;
    return { visible: sug.classList.contains('show'), display: vis, bg, items };
  });
  await page.close();
}

// ---------- mobile: tap sizes, filter collapse, bottom sheet ----------
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 4500));

  out.mobile = await page.evaluate(() => {
    // expand the collapsed filter panel first (mobile starts collapsed)
    document.getElementById('filterToggle').click();
    const chip = document.querySelector('.filter-group button');
    const toggle = document.getElementById('filterToggle');
    const r = (el) => el.getBoundingClientRect();
    const chipR = r(chip);
    const toggleR = r(toggle);
    const searchR = r(document.getElementById('addrSearch'));
    const res = {
      chipH: Math.round(chipR.height),
      chipW: Math.round(chipR.width),
      filterToggleVisible: getComputedStyle(toggle).display !== 'none',
      filterToggleH: Math.round(toggleR.height),
      searchInputH: Math.round(searchR.height),
      panelCollapsedInitially: !document.getElementById('filterPanel').classList.contains('collapsed'),
      mapH: document.getElementById('map').offsetHeight,
    };
    return res;
  });

  // open a venue via bottom sheet (mobile click on marker)
  await page.evaluate(() => {
    if (markers.length) {
      map.setView(markers[10].getLatLng(), 15, { animate: false });
    }
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    // simulate tap on a marker near center
    const mk = markers.find((m) => map.getBounds().contains(m.getLatLng()));
    if (mk) mk.fire('click');
  });
  await new Promise((r) => setTimeout(r, 900));
  out.bottomSheet = await page.evaluate(() => {
    const bs = document.getElementById('bottomSheet');
    if (!bs) return { found: false };
    const isOpen = bs.classList.contains('open');
    const h3 = bs.querySelector('h3');
    const evt = bs.querySelector('.evt-time');
    return {
      found: true,
      open: isOpen,
      venueName: h3 ? h3.textContent.trim().slice(0, 40) : null,
      h3Font: h3 ? getComputedStyle(h3).fontFamily.split(',')[0] : null,
      evtColor: evt ? getComputedStyle(evt).color : null,
      bg: getComputedStyle(bs).backgroundColor,
      maxH: Math.round(bs.getBoundingClientRect().height),
    };
  });
  await page.close();
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
