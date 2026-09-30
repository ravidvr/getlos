
import puppeteer from "puppeteer-core";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const page = await browser.newPage();
await page.goto("http://127.0.0.1:8123/dashboard.html", { waitUntil: "networkidle2", timeout: 45000 });
await new Promise(r => setTimeout(r, 4000));
const out = await page.evaluate(() => {
  const r = {};
  r.initial = { header: document.getElementById("headerLabel").textContent, lang, btn: document.getElementById("langToggle").textContent, chip: document.querySelector("[data-lang=all]").textContent };
  toggleLang();
  r.firstClick = { header: document.getElementById("headerLabel").textContent, lang, btn: document.getElementById("langToggle").textContent, chip: document.querySelector("[data-lang=all]").textContent };
  toggleLang();
  r.secondClick = { header: document.getElementById("headerLabel").textContent, lang, btn: document.getElementById("langToggle").textContent, chip: document.querySelector("[data-lang=all]").textContent };
  return r;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
