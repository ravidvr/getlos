
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://127.0.0.1:8123/dashboard.html", { waitUntil: "networkidle2", timeout: 45000 });
await new Promise(r => setTimeout(r, 5000));
const results = [];
for (const idx of [0, 20, 40, 60]) {
  await page.evaluate((i) => {
    map.setView(markers[i].getLatLng(), 15, { animate: false });
    markers[i].openPopup();
  }, idx);
  await new Promise(r => setTimeout(r, 900));
  const m = await page.evaluate((i) => {
    const w = document.querySelector(".leaflet-popup-content-wrapper").getBoundingClientRect();
    const mapr = document.getElementById("map").getBoundingClientRect();
    const v = ALL_VENUES.find(v => v.lat === markers[i].getLatLng().lat) || {};
    return {
      venue: v.name || "?",
      fitsMap: w.top >= mapr.top - 1 && w.bottom <= mapr.bottom + 1,
      fitsWin: w.top >= 0 && w.bottom <= window.innerHeight,
      popupTop: Math.round(w.top), popupBottom: Math.round(w.bottom),
      mapTop: Math.round(mapr.top), mapBottom: Math.round(mapr.bottom),
    };
  }, idx);
  results.push(m);
  await page.evaluate(() => map.closePopup());
}
console.log(JSON.stringify(results, null, 1));
await browser.close();
