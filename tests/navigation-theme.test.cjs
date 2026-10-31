const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "assets/site.js"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "assets/theme-init.js"), "utf8");

function initialTheme(saved, search = "", storageBlocked = false) {
  const document = { documentElement: { dataset: { theme: "dark" } } };
  vm.runInNewContext(bootstrap, {
    document,
    URLSearchParams,
    window: {
      location: { search },
      localStorage: { getItem() { if (storageBlocked) throw new Error("blocked"); return saved; } }
    }
  });
  return document.documentElement.dataset.theme;
}

test("dark is the first-visit default, including unavailable or invalid storage", () => {
  assert.equal(initialTheme(null), "dark");
  assert.equal(initialTheme("invalid"), "dark");
  assert.equal(initialTheme(null, "", true), "dark");
  assert.match(html, /<html lang="cs" data-theme="dark">/);
  assert.ok(html.indexOf("assets/theme-init.js") < html.indexOf("assets/site.css"));
  assert.match(app, /applyTheme\(document\.documentElement\.dataset\.theme, false\)/);
});

test("visitor's saved choice and explicit theme URLs remain supported", () => {
  assert.equal(initialTheme("light"), "light");
  assert.equal(initialTheme("dark"), "dark");
  assert.equal(initialTheme("light", "?theme=dark"), "dark");
  assert.equal(initialTheme("dark", "?theme=light", true), "light");
  assert.equal(initialTheme("light", "?theme=unknown"), "light");
});

test("sidebar and home replace the archive shortcut with the existing Asterion Patreon", () => {
  const navigation = html.match(/<ul class="main-navigation"[\s\S]*?<\/ul>/)[0];
  const shortcuts = app.match(/<div class="quick-sections">[\s\S]*?<\/div>/)[0];
  for (const markup of [navigation, shortcuts]) {
    assert.match(markup, /href="https:\/\/www\.patreon\.com\/AsterionRPG\/posts" target="_blank" rel="noopener"/);
    assert.doesNotMatch(markup, /href="#\/archive"/);
  }
  assert.match(app, /function renderArchive\(/);
});
