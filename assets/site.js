(function () {
  "use strict";

  const data = window.ASTERION_DATA;
  const baseTimelineData = window.ASTERION_TIMELINE;
  const kronikaData = window.ASTERION_KRONIKA;
  const timelineData = (function () {
    if (!baseTimelineData || !kronikaData || !Array.isArray(kronikaData.events)) return baseTimelineData;
    const kronikaYears = new Set(kronikaData.events.map(function (event) { return Number(event.year); }));
    return Object.assign({}, baseTimelineData, {
      events: baseTimelineData.events
        .filter(function (event) { return !kronikaYears.has(Number(event.year)); })
        .concat(kronikaData.events)
    });
  }());
  const main = document.getElementById("main-content");
  const right = document.getElementById("right-sidebar");
  const navigation = document.getElementById("main-navigation");
  const menu = document.getElementById("left-sidebar");
  const menuToggle = document.querySelector(".menu-toggle");
  const themeToggle = document.getElementById("theme-toggle");
  const searchForm = document.getElementById("site-search-form");
  const searchInput = document.getElementById("site-search");
  const timelineDock = document.getElementById("timeline-dock");
  const timelineDockContent = document.getElementById("timeline-dock-content");
  const timelineDockToggle = timelineDock.querySelector(".timeline-dock-toggle");
  const timelineDockClose = timelineDock.querySelector(".timeline-dock-close");
  const pageSize = 30;
  let timelineController = null;

  function applyTheme(theme, remember) {
    const dark = theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.textContent = dark ? "Světlé pozadí" : "Černé pozadí";
    if (remember) {
      try {
        window.localStorage.setItem("asterion-theme", dark ? "dark" : "light");
      } catch (_error) {
        /* Přímé otevření přes file:// může mít ukládání zakázané. */
      }
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("cs");
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + " kB";
    return (value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0) + " MB";
  }

  function formatDate(value) {
    const date = new Date(value + "T12:00:00");
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("cs-CZ").format(date);
  }

  function safeHref(value) {
    const href = String(value || "");
    if (href.startsWith("#/")) return href;
    if (href.startsWith("../")) return href;
    if (href.startsWith("assets/")) return href;
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
    return "#";
  }

  function linkAttributes(href) {
    return /^https?:\/\//i.test(href)
      ? ' target="_blank" rel="noopener noreferrer"'
      : "";
  }

  function routeInfo() {
    const raw = (location.hash || "#/home").replace(/^#\/?/, "");
    const question = raw.indexOf("?");
    const path = question === -1 ? raw : raw.slice(0, question);
    const query = new URLSearchParams(question === -1 ? "" : raw.slice(question + 1));
    return { path: decodeURIComponent(path || "home"), query };
  }

  function setTitle(title) {
    document.title = title + " – Asterion";
  }

  function updateActiveNavigation(path) {
    navigation.querySelectorAll("a").forEach(function (link) {
      const target = link.dataset.route || "";
      const active = path === target || (target === "archive" && path.startsWith("archive/"));
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function renderSocialPanel() {
    const social = data.social;
    if (!social || !Array.isArray(social.sources) || !social.sources.length) return "";

    const limit = Math.max(1, Math.min(5, Number(social.limit_per_source) || 3));
    const sources = social.sources.filter(function (source) { return !source.in_news; }).map(function (source) {
      const sourceHref = safeHref(source.url);
      const items = Array.isArray(source.items) ? source.items.slice(0, limit) : [];
      const entries = items.length
        ? items.map(function (item) {
            const href = safeHref(item.url);
            return `
              <article class="social-item">
                <div class="social-date">${escapeHtml(formatDate(item.date))}</div>
                <a href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(item.title)}</a>
              </article>`;
          }).join("")
        : '<p class="social-empty">Zatím bez uložených příspěvků.</p>';

      return `
        <div class="social-source">
          <h3>${escapeHtml(source.title)}</h3>
          ${entries}
          <p class="social-source-link"><a href="${escapeHtml(sourceHref)}"${linkAttributes(sourceHref)}>${escapeHtml(source.link_label || "Otevřít zdroj")}</a></p>
        </div>`;
    }).join("");

    return `<section class="right-panel social-panel"><h2>Nově jinde</h2>${sources}</section>`;
  }

  function renderSidebar() {
    function newsItem(item) {
      const href = safeHref(item.route);
      return `
        <article class="news-item">
          <div class="news-date">${escapeHtml(formatDate(item.date))}${item.source ? ` · ${escapeHtml(item.source)}` : ""}</div>
          <h3><a href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(item.title)}</a></h3>
          <p>${escapeHtml(item.text)}</p>
        </article>`;
    }
    const news = data.config.news.slice(0, 5).map(newsItem).join("");
    const olderNews = data.config.news.slice(5);
    const archive = olderNews.length ? `<details class="news-archive"><summary>Starší novinky (${olderNews.length})</summary>${olderNews.map(newsItem).join("")}</details>` : "";

    const panels = data.config.panels.map(function (panel) {
      const links = panel.links.map(function (item) {
        const href = safeHref(item[1]);
        return `<li><a href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(item[0])}</a></li>`;
      }).join("");
      return `<section class="right-panel"><h2>${escapeHtml(panel.title)}</h2><ul class="plain-links">${links}</ul></section>`;
    }).join("");

    right.innerHTML = `<section class="right-panel"><h2>Novinky</h2>${news}${archive}</section>${renderSocialPanel()}${panels}`;
  }

  function renderHome() {
    setTitle("Úvod");
    const stats = data.stats;
    const originalHome = data.pages.find(function (page) { return page.slug === "uvod"; });
    const historicalHome = originalHome
      ? originalHome.html.replace(/<h1(\s|>)/gi, "<h2$1").replace(/<\/h1>/gi, "</h2>")
      : "";

    main.innerHTML = `
      <h1>${escapeHtml(data.config.site_title)}</h1>
      <p class="intro">${escapeHtml(data.config.intro)}</p>
      <p class="stats-line">
        <span><strong>${stats.catalog_items}</strong> unikátních souborů</span>
        ${stats.public_patreon_posts ? `<span><a href="#/materials?group=${encodeURIComponent("Veřejně z Patreonu")}"><strong>${stats.public_patreon_posts}</strong> veřejných příspěvků z Patreonu</a></span>` : ""}
        <span><a href="#/dech-draka?tag=pov%C3%ADdka"><strong>${stats.dech_draka_stories}</strong> povídek</a></span>
        <span><a href="#/dech-draka?tag=dobrodru%C5%BEstv%C3%AD"><strong>${stats.dech_draka_adventures}</strong> dobrodružství</a></span>
        <span><a href="#/dech-draka?tag=tematick%C3%BD%20%C4%8Dl%C3%A1nek"><strong>${stats.dech_draka_thematic_articles}</strong> tematických článků</a></span>
      </p>
      <div class="quick-sections">
        <section><h2><a href="#/materials">Materiály ke stažení</a></h2><p>Mapy, dobrodružství, pravidlové aplikace, články a další herní materiály.</p></section>
        <section><h2><a href="#/dech-draka">Co vyšlo v Dechu draka</a></h2><p>Povídky, dobrodružství, postavy, bestiář a tematické články. <a href="#/dech-draka-cela-cisla">Celá čísla ke stažení</a>.</p></section>
        <section><h2><a href="#/modules">Herní moduly</a></h2><p>Popisy modulů, aplikace pravidel, doplňky, mapy a dobrodružství.</p></section>
        <section><h2><a href="https://www.patreon.com/AsterionRPG/posts" target="_blank" rel="noopener">Asterion na Patreonu</a></h2><p>Nové materiály, ukázky z tvorby a zprávy ze světa Asterionu.</p></section>
      </div>
      ${historicalHome ? `
        <div class="homepage-history">
          <div class="legacy-content homepage-history-content">${historicalHome}</div>
        </div>` : ""}`;
  }

  function catalogMetadataText(item) {
    if (item._metadataText) return item._metadataText;
    item._metadataText = normalize([
      item.title,
      item.group,
      item.tags.join(" "),
      item.description,
      item.summary,
      item.path
    ].join(" "));
    return item._metadataText;
  }

  function catalogText(item) {
    if (item._catalogText) return item._catalogText;
    item._catalogText = normalize(catalogMetadataText(item) + " " + (item.search_text || ""));
    return item._catalogText;
  }

  function catalogPreset(path) {
    const presets = {
      "dech-draka": { title: "Co vyšlo v Dechu draka", group: "Dech draka", intro: "Historická skupina článků a příloh publikovaných v časopisu Dech draka." },
      "maps": { title: "Mapy", group: "Mapy", intro: "Mapy světa, jednotlivých oblastí, měst, podzemí a dobrodružství." },
      "adventures": { title: "Dobrodružství", group: "", contentKind: "adventure", intro: "Samostatná dobrodružství pro vypravěče bez ohledu na to, zda původně vyšla na webu, v Dechu draka nebo jako doplněk modulu." },
      "rules": { title: "Aplikace pravidel", group: "Aplikace pravidel", intro: "Pravidlové převody, tabulky a další herní pomůcky pro různé systémy." },
      "indexes": { title: "Rejstříky a databáze", group: "Rejstříky a databáze", intro: "Rejstříky, databáze a přehledy asterionských pramenů." },
      "archive/dech-draka": { title: "Články v časopise Dech draka", group: "Dech draka", intro: "Povídky, články, dobrodružství a herní materiály, které vyšly v časopise Dech draka.", legacy: [["Původní stránka Dech draka", "dech-draka"], ["Starší přehled podle čísel", "dech-draka-79"], ["Původní společný rozcestník článků", "clanky-v-casopisech"]] },
      "archive/alduron": { title: "Články v časopise Alduron", group: "Alduron", intro: "Dochované články o Asterionu publikované v časopise Alduron.", legacy: [["Původní stránka časopisu Alduron", "alduron"]] },
      "archive/legenda": { title: "Články v časopise Legenda", group: "Legenda", intro: "Dochované části článku o Asterionu publikovaného v časopise Legenda.", legacy: [["Původní stránka časopisu Legenda", "legenda"]] }
    };
    return presets[path] || { title: "Materiály ke stažení", group: "", intro: "Mapy, dobrodružství, pravidlové aplikace, články a další materiály pro hru na Asterionu." };
  }

  function renderSourceRegister() {
    const register = data.source_register;
    if (!register) return "";
    const recovered = (Array.isArray(register.recovered) ? register.recovered : []).map(function (source) {
      const files = (source.files || []).map(function (file) {
        const href = safeHref(file.href);
        return `<a href="${escapeHtml(href)}">${escapeHtml(file.label)}</a>`;
      }).join(" · ");
      return `
        <li>
          <strong>${escapeHtml(source.title)}</strong>
          <span class="source-status">${escapeHtml(source.status)}</span>
          <p>${escapeHtml(source.description)}</p>
          ${files ? `<p>${files}</p>` : ""}
          ${source.provenance ? `<small>${escapeHtml(source.provenance)}</small>` : ""}
        </li>`;
    }).join("");
    const missing = (Array.isArray(register.missing) ? register.missing : []).map(function (source) {
      return `
        <li>
          <strong>${escapeHtml(source.title)}</strong>
          <span class="source-status">${escapeHtml(source.status)}</span>
          <p>${escapeHtml(source.description)}</p>
          ${source.recovery ? `<small>${escapeHtml(source.recovery)}</small>` : ""}
        </li>`;
    }).join("");
    if (!recovered && !missing) return "";
    return `
      <section class="source-register" aria-labelledby="source-register-title">
        <h2 id="source-register-title">${escapeHtml(register.title || "Stav pramenů")}</h2>
        <p>${escapeHtml(register.intro || "")}</p>
        ${recovered ? `<h3>Dohledané prameny</h3><ul class="missing-source-list">${recovered}</ul>` : ""}
        ${missing ? `<h3>Dosud chybí</h3><ul class="missing-source-list">${missing}</ul>` : ""}
      </section>`;
  }

  function renderCatalog(path, query) {
    const preset = catalogPreset(path);
    setTitle(preset.title);
    let shown = pageSize;
    const groups = data.groups.map(function (pair) { return pair[0]; });
    const initial = {
      q: query.get("q") || "",
      group: query.get("group") || preset.group,
      tag: query.get("tag") || preset.tag || ""
    };

    function countGroup(group) {
      const pair = data.groups.find(function (item) { return item[0] === group; });
      return pair ? Number(pair[1]) : 0;
    }

    const topicCards = path === "materials" ? `
      <nav class="catalog-topics" aria-label="Připravené skupiny materiálů">
        <a href="#/dech-draka"><strong>Dech draka</strong><span>${data.stats.dech_draka} položek</span></a>
        <a href="#/adventures"><strong>Dobrodružství</strong><span>${data.stats.adventures_total || 0} připravených scénářů</span></a>
        <a href="#/maps"><strong>Mapy</strong><span>${countGroup("Mapy")} map a plánků</span></a>
        <a href="#/rules"><strong>Aplikace pravidel</strong><span>${countGroup("Aplikace pravidel")} souborů</span></a>
        <a href="#/indexes"><strong>Rejstříky a databáze</strong><span>${countGroup("Rejstříky a databáze")} soubory</span></a>
        ${data.stats.patreon_catalogue_entries ? `<a href="#/materials?group=${encodeURIComponent("Veřejně z Patreonu")}"><strong>Veřejně z Patreonu</strong><span>${data.stats.patreon_catalogue_entries} článků a galerií · ${data.stats.patreon_pdfs} PDF</span></a>` : ""}
        <a href="#/materials?group=${encodeURIComponent("Vaše tvorba")}"><strong>Vaše tvorba</strong><span>${countGroup("Vaše tvorba")} příspěvků</span></a>
      </nav>` : "";

    const archiveBack = path.startsWith("archive/") ? '<p class="archive-back"><a href="#/archive">← Zpět na rozcestník archivu</a></p>' : "";
    const legacyLinks = preset.legacy
      ? `<p class="legacy-index-links">Staré členění: ${preset.legacy.map(function (item) { return `<a href="#/page/${encodeURIComponent(item[1])}">${escapeHtml(item[0])}</a>`; }).join(" · ")}</p>`
      : "";
    const sourceRegister = path === "indexes" ? renderSourceRegister() : "";
    main.innerHTML = `
      ${archiveBack}<h1>${escapeHtml(preset.title)}</h1>
      <p>${escapeHtml(preset.intro)}</p>
      ${legacyLinks}
      ${sourceRegister}
      ${topicCards}
      <form class="catalog-controls" id="catalog-controls">
        <div class="control-grid">
          <label>Hledat
            <input type="search" name="q" value="${escapeHtml(initial.q)}" autocomplete="off" placeholder="Název, téma nebo slovo z dokumentu">
          </label>
          <label>Skupina
            <select name="group">
              <option value="">Všechny skupiny</option>
              ${groups.map(function (group) { return `<option value="${escapeHtml(group)}"${group === initial.group ? " selected" : ""}>${escapeHtml(group)}</option>`; }).join("")}
            </select>
          </label>
        </div>
        <div class="catalog-actions"><button type="button" id="catalog-reset">Vymazat</button></div>
      </form>
      <p class="catalog-search-note">Hledání prochází názvy, témata, text ${data.stats.fulltext_items || 0} rozpoznaných dokumentů i texty veřejných příspěvků z Patreonu.</p>
      <p class="result-count" id="result-count" aria-live="polite"></p>
      <div class="material-list" id="material-list"></div>
      <button type="button" class="load-more" id="load-more">Zobrazit další</button>`;

    const form = document.getElementById("catalog-controls");
    const list = document.getElementById("material-list");
    const count = document.getElementById("result-count");
    const load = document.getElementById("load-more");

    function currentFilters() {
      const values = new FormData(form);
      return {
        q: String(values.get("q") || ""),
        group: String(values.get("group") || ""),
        tag: initial.tag
      };
    }

    function renderCatalogOverview() {
      const grouped = {};
      data.catalog.forEach(function (item) {
        if (!grouped[item.group]) grouped[item.group] = [];
        grouped[item.group].push(item);
      });
      return data.groups.filter(function (pair) {
        return grouped[pair[0]] && grouped[pair[0]].length;
      }).map(function (pair) {
        const group = pair[0];
        const items = grouped[group].sort(function (a, b) { return a.title.localeCompare(b.title, "cs"); });
        const files = items.map(function (item) {
          const href = safeHref(item.href);
          return `<div class="rule-file"><a href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(item.title)}</a><span>${escapeHtml(catalogItemInfo(item, true))}</span>${catalogPostLinks(item)}</div>`;
        }).join("");
        return `
          <section class="rules-system catalog-overview-group">
            <h2><a href="#/materials?group=${encodeURIComponent(group)}">${escapeHtml(group)}</a> <span>${items.length} ${items.length === 1 ? "položka" : (items.length < 5 ? "položky" : "položek")}</span></h2>
            <div class="catalog-overview-files">${files}</div>
          </section>`;
      }).join("");
    }

    function updateList(resetLimit) {
      if (resetLimit) shown = pageSize;
      const filters = currentFilters();
      const search = normalize(filters.q);
      const tag = normalize(filters.tag);
      if (path === "materials" && !search && !filters.group && !tag) {
        list.classList.add("catalog-overview");
        list.innerHTML = renderCatalogOverview();
        count.textContent = `Přehled všech ${data.catalog.length} položek v ${data.groups.length} skupinách.`;
        load.hidden = true;
        return;
      }
      list.classList.remove("catalog-overview");
      const filtered = data.catalog.filter(function (item) {
        if (preset.contentKind && item.content_kind !== preset.contentKind) return false;
        if (filters.group && item.group !== filters.group) return false;
        if (tag && !item.tags.some(function (value) { return normalize(value).includes(tag); })) return false;
        return !search || catalogText(item).includes(search);
      });
      if (path === "adventures") filtered.sort(function (a, b) { return a.title.localeCompare(b.title, "cs"); });

      const visible = filtered.slice(0, shown);
      const options = { search: search, showGroup: path !== "adventures" && !filters.group && !preset.group, showSummary: path === "adventures" || path === "indexes" || filters.group === "Veřejně z Patreonu" };
      list.innerHTML = path === "maps"
        ? renderMapGroups(visible, options)
        : (visible.map(function (item) { return materialRow(item, options); }).join("") || '<p class="empty-result">Tomuto výběru neodpovídá žádný soubor.</p>');
      count.textContent = `Nalezeno ${filtered.length} položek${filtered.length > shown ? `, zobrazeno prvních ${shown}` : ""}.`;
      load.hidden = filtered.length <= shown;
      load.onclick = function () {
        shown += pageSize;
        updateList(false);
      };
    }

    form.addEventListener("input", function () { updateList(true); });
    form.addEventListener("change", function () { updateList(true); });
    form.addEventListener("submit", function (event) { event.preventDefault(); updateList(true); });
    document.getElementById("catalog-reset").addEventListener("click", function () {
      form.elements.q.value = "";
      form.elements.group.value = preset.group;
      initial.tag = "";
      updateList(true);
    });
    updateList(true);
  }

  function renderMapGroups(items, options) {
    if (!items.length) return '<p class="empty-result">Tomuto výběru neodpovídá žádná mapa.</p>';
    const order = ["Mapy z herních modulů", "Samostatné mapy a plánky", "Slepé mapy pro hráče", "Starší mapy a podklady"];
    const grouped = {};
    items.forEach(function (item) {
      const group = item.map_category || "Samostatné mapy a plánky";
      if (!grouped[group]) grouped[group] = [];
      grouped[group].push(item);
    });
    return order.filter(function (group) { return grouped[group]; }).map(function (group) {
      const unique = {};
      grouped[group].forEach(function (item) {
        const key = normalize(item.title);
        if (!unique[key] || Number(item.size || 0) > Number(unique[key].size || 0)) unique[key] = item;
      });
      return `<section class="material-subgroup"><h2>${escapeHtml(group)}</h2>${Object.keys(unique).map(function (key) { return materialRow(unique[key], options); }).join("")}</section>`;
    }).join("");
  }

  function visibleTags(item) {
    const hidden = new Set([
      normalize(item.group),
      normalize(item.extension),
      "pdf", "zip", "doc", "docx", "rtf", "jpg", "jpeg", "png",
      "webovy clanek", "webovy material", "verejny web", "serverovy archiv"
    ]);
    return item.tags.filter(function (tag) { return !hidden.has(normalize(tag)); });
  }

  function materialRow(item, options) {
    options = options || {};
    const href = safeHref(item.href);
    const tags = visibleTags(item);
    const meta = [];
    if (options.showGroup) meta.push(escapeHtml(item.group));
    if (tags.length) meta.push(`<span class="tags">${tags.map(function (tag) { return `<span>${escapeHtml(tag)}</span>`; }).join("")}</span>`);
    if (options.search && !catalogMetadataText(item).includes(options.search) && normalize(item.search_text || "").includes(options.search)) {
      meta.push('<span class="content-hit">shoda v obsahu dokumentu</span>');
    }
    const summary = options.showSummary && item.summary ? `<p class="material-summary">${escapeHtml(item.summary)}</p>` : "";
    return `
      <article class="material-row${summary ? " with-summary" : ""}">
        <h2><a href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(item.title)}</a></h2>
        <div class="file-info">${escapeHtml(catalogItemInfo(item))}</div>
        ${summary}
        ${catalogPostLinks(item)}
        ${meta.length ? `<div class="meta">${meta.join(" · ")}</div>` : ""}
      </article>`;
  }

  function catalogItemInfo(item, showType) {
    if (item.extension === "web") return "Patreon · " + formatDate(item.published_date);
    return (showType ? item.extension.toUpperCase() + ", " : "") + formatBytes(item.size);
  }

  function catalogPostLinks(item) {
    const attachments = (item.attachments || []).map(function (file) {
      const href = safeHref(file.href);
      return `<a href="${escapeHtml(href)}">${escapeHtml(file.label)} (PDF, ${escapeHtml(formatBytes(file.size))})</a>`;
    });
    const related = (item.related_posts || []).map(function (post) {
      const href = safeHref(post.url);
      return `<a href="${escapeHtml(href)}"${linkAttributes(href)}>Další verze: ${escapeHtml(post.title)}</a>`;
    });
    return attachments.length || related.length ? `<div class="catalog-post-links">${attachments.concat(related).join(" · ")}</div>` : "";
  }

  function renderDechDraka(query) {
    setTitle("Co vyšlo v Dechu draka");
    const categoryOrder = [
      "Povídky",
      "Dobrodružství",
      "Tematické články",
      "Cizí postavy",
      "Drakolidé",
      "Bestiář a bytosti",
      "Pravidla a aplikace",
      "Obrazové přílohy",
      "Související soubory bez doloženého čísla"
    ];
    const allItems = data.catalog.filter(function (item) { return item.group === "Dech draka"; });
    let selectedTag = query.get("tag") || "";

    main.innerHTML = `
      <h1>Co vyšlo v Dechu draka</h1>
      <p>Články a přílohy jsou rozdělené podle tématu. U ${data.stats.dech_draka_dated || 0} položek původní přehled uvádí také konkrétní číslo a rok vydání.</p>
      <p class="dech-full-issues-link"><a href="#/dech-draka-cela-cisla"><strong>Celá čísla Dechu draka ke stažení</strong></a></p>
      <p class="catalog-search-note">V pozdějších letech vycházel Dech draka jako součást časopisu Pevnost; překryv obou historických přehledů proto není duplicita ani chyba.</p>
      <form class="catalog-controls dech-controls" id="dech-controls">
        <div class="control-grid">
          <label>Hledat v Dechu draka
            <input type="search" name="q" value="${escapeHtml(query.get("q") || "")}" autocomplete="off" placeholder="Název, téma nebo slovo z dokumentu">
          </label>
        </div>
        <div class="catalog-actions"><button type="button" id="dech-reset">Zobrazit vše</button></div>
      </form>
      <p class="catalog-search-note">Hledání prochází názvy, témata i rozpoznaný text dokumentů.</p>
      <p class="result-count" id="dech-result-count" aria-live="polite"></p>
      <div class="dech-groups" id="dech-groups"></div>`;

    const form = document.getElementById("dech-controls");
    const container = document.getElementById("dech-groups");
    const count = document.getElementById("dech-result-count");

    function latestIssue(item) {
      return (item.dech_issues || []).reduce(function (latest, issue) {
        const parts = issue.split("/");
        return Math.max(latest, Number(parts[1] || 0) * 100 + Number(parts[0] || 0));
      }, 0);
    }

    function issueLabel(item) {
      const issues = item.dech_issues || [];
      return issues.length
        ? `Dech draka ${issues.join(" a ")}`
        : "číslo v původním přehledu neuvedeno";
    }

    function renderGroups(items) {
      const grouped = {};
      items.forEach(function (item) {
        const category = item.dech_category || "Tematické články";
        if (!grouped[category]) grouped[category] = [];
        grouped[category].push(item);
      });
      return categoryOrder.filter(function (category) { return grouped[category]; }).map(function (category) {
        const rows = grouped[category].sort(function (a, b) {
          return latestIssue(b) - latestIssue(a) || a.title.localeCompare(b.title, "cs");
        }).map(function (item) {
          const href = safeHref(item.href);
          const metadata = `${issueLabel(item)} · ${item.extension.toUpperCase()}, ${formatBytes(item.size)}`;
          return `<div class="rule-file"><a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a><span>${escapeHtml(metadata)}</span></div>`;
        }).join("");
        const note = category === "Související soubory bez doloženého čísla"
          ? '<p class="dech-group-note">Tyto soubory jsou s archivem propojené, ale dochované přehledy u nich neuvádějí číslo časopisu. Údaj proto nedoplňujeme odhadem.</p>'
          : "";
        return `
          <section class="rules-system dech-category">
            <h2>${escapeHtml(category)} <span>${grouped[category].length} ${grouped[category].length === 1 ? "položka" : (grouped[category].length < 5 ? "položky" : "položek")}</span></h2>
            ${note}<div class="dech-category-files">${rows}</div>
          </section>`;
      }).join("");
    }

    function update() {
      const search = normalize(String(new FormData(form).get("q") || ""));
      const tag = normalize(selectedTag);
      const filtered = allItems.filter(function (item) {
        if (tag && !item.tags.some(function (value) { return normalize(value).includes(tag); })) return false;
        return !search || catalogText(item).includes(search);
      });
      container.innerHTML = renderGroups(filtered) || '<p class="empty-result">Tomuto hledání neodpovídá žádná položka.</p>';
      count.textContent = search || tag
        ? `Nalezeno ${filtered.length} položek.`
        : `Tematický přehled všech ${allItems.length} položek.`;
    }

    form.addEventListener("input", update);
    form.addEventListener("submit", function (event) { event.preventDefault(); update(); });
    document.getElementById("dech-reset").addEventListener("click", function () {
      form.elements.q.value = "";
      selectedTag = "";
      update();
    });
    update();
  }

  function renderDechDrakaFullIssues(query) {
    const archive = data.dech_draka_full_issues;
    setTitle(archive.title);
    const selectedIssue = query.get("issue") || "";
    const grouped = {};
    archive.issues.forEach(function (issue) {
      if (!grouped[issue.year]) grouped[issue.year] = [];
      grouped[issue.year].push(issue);
    });

    const sourceLinks = archive.sources.map(function (source) {
      const href = safeHref(source.url);
      return `<li><a href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(source.label)}</a> – ${escapeHtml(source.note)}</li>`;
    }).join("");

    const years = Object.keys(grouped).sort(function (a, b) { return Number(b) - Number(a); }).map(function (year) {
      const cards = grouped[year].sort(function (a, b) { return b.number - a.number; }).map(function (issue) {
        const download = safeHref(issue.download_url);
        const source = safeHref(issue.source_page);
        const deepLink = "#/dech-draka-cela-cisla?issue=" + encodeURIComponent(issue.id);
        const selected = issue.id === selectedIssue;
        return `
          <article class="issue-card${selected ? " selected" : ""}" data-issue="${escapeHtml(issue.id)}">
            <h3><a href="${escapeHtml(deepLink)}">Dech draka ${escapeHtml(issue.label)}</a></h3>
            <p class="issue-meta">${issue.pages} stran · ${escapeHtml(formatBytes(issue.size))}</p>
            <p><span class="source-badge">${escapeHtml(issue.source_label)}</span></p>
            <div class="issue-actions">
              <a class="issue-download" href="${escapeHtml(download)}"${linkAttributes(download)}>Stáhnout PDF</a>
              <a href="${escapeHtml(source)}"${linkAttributes(source)}>Původní zdroj</a>
              <a href="${escapeHtml(deepLink)}">Odkaz na číslo</a>
            </div>
          </article>`;
      }).join("");
      return `
        <section class="issue-year" aria-labelledby="issue-year-${escapeHtml(year)}">
          <h2 id="issue-year-${escapeHtml(year)}">Ročník ${escapeHtml(year)} <span>${grouped[year].length} čísel</span></h2>
          <div class="issue-grid">${cards}</div>
        </section>`;
    }).join("");

    main.innerHTML = `
      <h1>${escapeHtml(archive.title)}</h1>
      <p class="intro">${escapeHtml(archive.intro)}</p>
      <p class="stats-line full-issues-stats">
        <span><strong>${archive.stats.issues}</strong> čísel</span>
        <span><strong>${archive.stats.years}</strong> ročníků</span>
        <span><strong>${archive.stats.pages}</strong> stran</span>
        <span><strong>${escapeHtml(formatBytes(archive.stats.bytes))}</strong> celkem</span>
      </p>
      <p>Všechny zde uvedené soubory byly staženy a ověřeny jako platná PDF. Přímé odkazy vedou na původní veřejné zdroje; velké soubory proto nejsou duplikovány do testovacího webu.</p>
      <div class="full-issues-sources">
        <h2>Zdroje</h2>
        <ul>${sourceLinks}</ul>
      </div>
      <div class="issue-years">${years}</div>`;

    if (selectedIssue) {
      window.requestAnimationFrame(function () {
        const selected = main.querySelector(".issue-card.selected");
        if (selected) selected.scrollIntoView({ block: "center" });
      });
    }
  }

  function renderRules() {
    setTitle("Aplikace pravidel");
    const systemOrder = ["DrD 1.6", "Dračí hlídka", "DrD II", "DrD+", "D&D 5e", "Ostatní"];
    const items = data.catalog.filter(function (item) { return item.group === "Aplikace pravidel"; });
    const grouped = {};

    items.forEach(function (item) {
      const system = item.rule_system || "Ostatní";
      const module = item.rule_module || "Nezařazené";
      if (!grouped[system]) grouped[system] = {};
      if (!grouped[system][module]) grouped[system][module] = [];
      grouped[system][module].push(item);
    });

    const sections = systemOrder.filter(function (system) { return grouped[system]; }).map(function (system) {
      const modules = Object.keys(grouped[system]).sort(function (a, b) {
        const orderA = Math.min.apply(null, grouped[system][a].map(function (item) { return item.rule_order == null ? 999 : Number(item.rule_order); }));
        const orderB = Math.min.apply(null, grouped[system][b].map(function (item) { return item.rule_order == null ? 999 : Number(item.rule_order); }));
        return orderA - orderB || a.localeCompare(b, "cs");
      });
      const count = modules.reduce(function (sum, module) { return sum + grouped[system][module].length; }, 0);
      const rows = modules.map(function (module) {
        const files = grouped[system][module].sort(function (a, b) { return a.title.localeCompare(b.title, "cs"); }).map(function (item) {
          const href = safeHref(item.href);
          return `<div class="rule-file"><a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a><span>${escapeHtml(item.extension.toUpperCase())}, ${escapeHtml(formatBytes(item.size))}</span></div>`;
        }).join("");
        return `<div class="rule-module-row"><h3>${escapeHtml(module)}</h3><div>${files}</div></div>`;
      }).join("");
      return `<section class="rules-system"><h2>${escapeHtml(system)} <span>${count} ${count === 1 ? "soubor" : (count < 5 ? "soubory" : "souborů")}</span></h2>${rows}</section>`;
    }).join("");

    main.innerHTML = `
      <h1>Aplikace pravidel</h1>
      <p>Pravidlové aplikace pro DrD 1.6, Dračí hlídku, DrD II, DrD+ a další herní systémy.</p>
      ${sections}`;
  }

  function moduleApplications(module) {
    const moduleNames = [module.rule_module || module.name].concat(module.rule_modules || []);
    const systemOrder = ["DrD 1.6", "Dračí hlídka", "DrD II", "DrD+", "D&D 5e"];
    const candidates = data.catalog.filter(function (item) { return moduleNames.includes(item.rule_module); }).sort(function (a, b) {
      const preferredA = a.group === "Aplikace pravidel" ? 0 : 1;
      const preferredB = b.group === "Aplikace pravidel" ? 0 : 1;
      return preferredA - preferredB || Number(a.rule_order || 999) - Number(b.rule_order || 999) || a.title.localeCompare(b.title, "cs");
    });
    const bySystem = {};
    candidates.forEach(function (item) {
      const system = item.rule_system || "Další pravidla";
      if (!bySystem[system]) bySystem[system] = item;
    });
    return Object.keys(bySystem).sort(function (a, b) {
      const indexA = systemOrder.indexOf(a);
      const indexB = systemOrder.indexOf(b);
      return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB) || a.localeCompare(b, "cs");
    }).map(function (system) { return bySystem[system]; });
  }

  function moduleActionLinks(module, includeCatalog) {
    const actions = [];
    if (includeCatalog) actions.push(`<a href="#/materials?q=${encodeURIComponent(module.name)}">Soubory v katalogu (${module.count})</a>`);
    moduleApplications(module).forEach(function (item) {
      const href = safeHref(item.href);
      actions.push(`<a href="${escapeHtml(href)}">Aplikace ${escapeHtml(item.rule_system)}</a>`);
    });
    if (module.purchase_url) {
      const href = safeHref(module.purchase_url);
      actions.push(`<a class="purchase-link" href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(module.purchase_label || "Koupit na Imagu")}</a>`);
    }
    (module.links || []).forEach(function (link) {
      const href = safeHref(link.href);
      actions.push(`<a${link.purchase ? ' class="purchase-link"' : ""} href="${escapeHtml(href)}"${linkAttributes(href)}>${escapeHtml(link.label)}</a>`);
    });
    return actions.join(" · ");
  }

  function moduleMissingSources(module) {
    if (!Array.isArray(module.missing_sources) || !module.missing_sources.length) return "";
    return module.missing_sources.map(function (source) {
      return `<p class="missing-source-note"><strong>${escapeHtml(source.title)}:</strong> ${escapeHtml(source.status)}. ${escapeHtml(source.recovery || "")}</p>`;
    }).join("");
  }

  function renderModules() {
    setTitle("Herní moduly");
    const rows = data.modules.map(function (module) {
      const cover = module.cover ? `<img src="${escapeHtml(safeHref(module.cover))}" alt="Obálka: ${escapeHtml(module.name)}" loading="lazy">` : "";
      const detailPage = data.pages.some(function (page) { return page.slug === module.slug; });
      const detailLink = detailPage ? `<a href="#/page/${encodeURIComponent(module.slug)}">Původní stránka modulu</a>` : "";
      const actions = moduleActionLinks(module, true);
      const missing = moduleMissingSources(module);
      return `<article class="module-row${cover ? "" : " no-cover"}">${cover}<div><h2>${escapeHtml(module.name)}</h2>${detailLink ? `<p>${detailLink}</p>` : ""}<p class="module-actions">${actions}</p>${missing}</div></article>`;
    }).join("");
    main.innerHTML = `
      <h1>Herní moduly</h1>
      <p>Základní a rozšiřující moduly Asterionu, jejich doplňky a pravidlové aplikace.</p>
      <p class="store-overview"><a href="https://www.imago.cz/asterion-moduly" target="_blank" rel="noopener noreferrer">Aktuální nabídka asterionských modulů na Imagu</a></p>
      <div class="module-list">${rows}</div>`;
  }

  function enhanceLegacyModuleTables(root) {
    root.querySelectorAll("table").forEach(function (table) {
      const headingCell = table.querySelector("tr:first-child td[colspan]");
      if (!headingCell) return;
      const heading = normalize(headingCell.textContent).replace(/^asterion\s*:?\s*/, "");
      const module = data.modules.find(function (item) {
        const name = normalize(item.name);
        return heading === name || heading.includes(name) || name.includes(heading);
      });
      if (!module) return;

      const coverCell = table.querySelector("tr:nth-child(2) td:first-child");
      if (coverCell && module.cover) {
        let cover = coverCell.querySelector("img");
        if (!cover) {
          cover = document.createElement("img");
          coverCell.insertBefore(cover, coverCell.firstChild);
        }
        cover.src = safeHref(module.cover);
        cover.alt = `Obálka: ${module.name}`;
        cover.width = 110;
        cover.height = 153;
        cover.loading = "lazy";
      }

      table.querySelectorAll('a[href*="fantasyobchod.cz"], a[href*="obchod.altar.cz"], a[href*="imago.cz"]').forEach(function (link) {
        const container = link.closest("div");
        if (container && normalize(container.textContent) === normalize(link.textContent)) container.remove();
        else link.remove();
      });

      const contentCell = table.querySelector("tr:nth-child(2) td:last-child");
      const actions = moduleActionLinks(module, false);
      if (!contentCell || !actions) return;
      const paragraph = document.createElement("p");
      paragraph.className = "legacy-module-actions";
      paragraph.innerHTML = actions;
      contentCell.insertBefore(paragraph, contentCell.firstChild);
      const missing = moduleMissingSources(module);
      if (missing) paragraph.insertAdjacentHTML("afterend", missing);
    });
  }

  function renderGallery() {
    setTitle("Galerie");
    const allowedGroups = new Set(["Galerie", "Fotogalerie", "Knihy a obálky"]);
    const images = data.catalog.filter(function (item) {
      return allowedGroups.has(item.group) && ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(item.extension);
    });
    const figures = images.slice(0, 150).map(function (item) {
      const href = safeHref(item.href);
      return `<figure class="gallery-item"><a href="${escapeHtml(href)}"><img src="${escapeHtml(href)}" alt="${escapeHtml(item.title)}" loading="lazy"></a><figcaption>${escapeHtml(item.title)}<br><span class="meta">${escapeHtml(item.group)}</span></figcaption></figure>`;
    }).join("");
    main.innerHTML = `<h1>Galerie a obrazový archiv</h1><p>Obálky knih a modulů, ilustrace, fotografie a další obrazové materiály. Zobrazeno ${Math.min(150, images.length)} z ${images.length} položek.</p><div class="gallery-grid">${figures}</div>`;
  }

  function archivePageList(pages, summaries) {
    return `<ul class="archive-list">${pages.map(function (page) {
      return `<li><a href="#/page/${encodeURIComponent(page.slug)}">${escapeHtml(page.title)}</a>${summaries && page.summary ? `<small>${escapeHtml(page.summary)}</small>` : ""}</li>`;
    }).join("")}</ul>`;
  }

  function renderOtherArchive(query) {
    setTitle("Ostatní články a stránky");
    const search = normalize(query.get("q") || "");
    const pages = data.pages.filter(function (page) {
      const excludedGroups = new Set(["Moduly", "Profily autorů", "Časopis Dech draka", "Časopis Alduron", "Časopis Legenda"]);
      if (excludedGroups.has(page.group) || ["uvod"].includes(page.slug)) return false;
      return !search || normalize(page.title + " " + page.summary + " " + page.group).includes(search);
    });
    const groups = {};
    pages.forEach(function (page) {
      if (!groups[page.group]) groups[page.group] = [];
      groups[page.group].push(page);
    });
    const sections = Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, "cs"); }).map(function (group) {
      return `<section class="archive-group"><h2>${escapeHtml(group)}</h2>${archivePageList(groups[group], true)}</section>`;
    }).join("");
    main.innerHTML = `<p class="archive-back"><a href="#/archive">← Zpět na rozcestník archivu</a></p><h1>Ostatní články a stránky</h1><p>Webové články, starší rozcestníky, zápisy z her a galerie.</p>${sections || '<p class="empty-result">Nebyly nalezeny žádné stránky.</p>'}`;
  }

  function renderArchive(path, query) {
    const magazines = [
      { route: "dech-draka", title: "Dech draka", group: "Dech draka", description: "Rozsáhlý archiv povídek, článků a herních materiálů." },
      { route: "alduron", title: "Alduron", group: "Alduron", description: "Dva dochované články o světě Asterionu." },
      { route: "legenda", title: "Legenda", group: "Legenda", description: "Tři dochované části článku o Asterionu." }
    ].map(function (magazine) {
      magazine.count = data.catalog.filter(function (item) { return item.group === magazine.group; }).length;
      return magazine;
    });

    if (path === "archive/other") {
      renderOtherArchive(query);
      return;
    }

    setTitle("Archiv článků");
    const magazineLinks = magazines.map(function (magazine) {
      return `<li><a href="#/archive/${magazine.route}">${escapeHtml(magazine.title)}</a><span>${magazine.count} ${magazine.count === 1 ? "soubor" : (magazine.count < 5 ? "soubory" : "souborů")}</span><small>${escapeHtml(magazine.description)}</small></li>`;
    }).join("");
    main.innerHTML = `
      <h1>Archiv článků</h1>
      <p>Články z časopisů Dech draka, Alduron a Legenda, webové texty a <a href="#/page/autori">profily autorů</a>.</p>
      <div class="archive-index">
        <section class="archive-card">
          <h2>Články v časopisech</h2>
          <ul class="magazine-list">${magazineLinks}</ul>
        </section>
        <section class="archive-card">
          <h2><a href="#/archive/other">Ostatní články a stránky</a></h2>
          <p>Obecné články, historické rozcestníky, zápisy z her, galerie a další zachovaný obsah.</p>
        </section>
        <section class="archive-card module-archive-note">
          <h2>Podstránky herních modulů</h2>
          <p>Najdete je v samostatné sekci <a href="#/modules">Herní moduly</a>.</p>
        </section>
      </div>`;
  }

  function renderLegacyPage(slug) {
    const page = data.pages.find(function (item) { return item.slug === slug; });
    if (!page) {
      setTitle("Stránka nenalezena");
      main.innerHTML = '<h1>Stránka nebyla nalezena</h1><p><a href="#/archive">Přejít do archivu článků</a></p>';
      return;
    }
    setTitle(page.title);
    const isPublicationsPage = page.slug === "dosud-vyslo";
    const publicationOverview = isPublicationsPage ? renderPublicationOverview() : "";
    const legacyHeading = isPublicationsPage ? '<h2 class="legacy-section-title">Herní moduly</h2>' : "";
    const sourceNote = isPublicationsPage
      ? `<a href="${escapeHtml(page.original)}" target="_blank" rel="noopener noreferrer">Původní přehled herních modulů na asterionrpg.cz</a>`
      : `<a href="${escapeHtml(page.original)}" target="_blank" rel="noopener noreferrer">Původní stránka na asterionrpg.cz</a>`;
    main.innerHTML = `<article class="legacy-page" data-page="${escapeHtml(page.slug)}"><h1>${escapeHtml(page.title)}</h1><p class="source-note">${sourceNote}</p>${publicationOverview}${legacyHeading}<div class="legacy-content">${page.html}</div></article>`;
    if (isPublicationsPage) enhanceLegacyModuleTables(main.querySelector(".legacy-content"));
  }

  function renderPublicationOverview() {
    const publications = data.publications;
    if (!publications || !Array.isArray(publications.groups)) return "";

    const groups = publications.groups.map(function (group) {
      const items = Array.isArray(group.items) ? group.items : [];
      const cards = items.map(function (item) {
        const cover = safeHref(item.cover);
        const note = item.note ? `<p class="publication-note">${escapeHtml(item.note)}</p>` : "";
        const purchase = item.purchase && item.purchase.url
          ? `<p class="publication-purchase"><a href="${escapeHtml(safeHref(item.purchase.url))}"${linkAttributes(item.purchase.url)}>${escapeHtml(item.purchase.label || "Koupit na Imagu")}</a></p>`
          : "";
        return `
          <article class="publication-card">
            <img src="${escapeHtml(cover)}" alt="Obálka knihy ${escapeHtml(item.title)}" loading="lazy">
            <div>
              <h4>${escapeHtml(item.title)}</h4>
              <p class="publication-author">${escapeHtml(item.author)}</p>
              <p class="publication-kind">${escapeHtml(item.kind)}</p>
              ${note}
              ${purchase}
            </div>
          </article>`;
      }).join("");
      return `
        <section class="publication-group" aria-labelledby="publication-${escapeHtml(group.id)}">
          <h3 id="publication-${escapeHtml(group.id)}">${escapeHtml(group.title)}</h3>
          <p>${escapeHtml(group.description)}</p>
          <div class="publication-grid">${cards}</div>
        </section>`;
    }).join("");

    return `
      <section class="publication-overview" aria-labelledby="publication-overview-title">
        <h2 id="publication-overview-title">${escapeHtml(publications.title)}</h2>
        <p>${escapeHtml(publications.intro)}</p>
        ${publications.store_url ? `<p class="store-overview"><a href="${escapeHtml(safeHref(publications.store_url))}"${linkAttributes(publications.store_url)}>Všechny dostupné asterionské knihy na Imagu</a></p>` : ""}
        ${groups}
      </section>`;
  }

  function timelineYearNumber(year) {
    const value = Number(year);
    return value < 0 ? "−" + Math.abs(value) : String(value);
  }

  function timelineYearLabel(event) {
    if (Number.isFinite(event.endYear) && event.endYear !== event.year) {
      return timelineYearNumber(event.year) + "–" + timelineYearNumber(event.endYear) + " k. l.";
    }
    return timelineYearNumber(event.year) + " k. l.";
  }

  function renderTimeline() {
    setTitle("Časová osa");
    if (!timelineData || !Array.isArray(timelineData.events)) {
      main.innerHTML = '<h1>Časová osa</h1><p class="error-message">Data časové osy se nepodařilo načíst.</p>';
      return;
    }

    const moduleLegend = timelineData.moduleBands.map(function (band) {
      const years = band.start === band.end
        ? timelineYearNumber(band.start) + " k. l."
        : timelineYearNumber(band.start) + "–" + timelineYearNumber(band.end) + " k. l.";
      return `
        <li>
          <button type="button" data-timeline-band="${escapeHtml(band.id)}">
            <strong>${escapeHtml(band.title)}</strong>
            <span>${escapeHtml(years)}</span>
          </button>
        </li>`;
    }).join("");

    main.innerHTML = `
      <section class="timeline-page" aria-labelledby="timeline-title">
        <h1 id="timeline-title">Časová osa Asterionu</h1>
        <div class="timeline-toolbar" aria-label="Ovládání časové osy">
          <button type="button" data-timeline-action="older" title="Posunout do minulosti">← Starší</button>
          <button type="button" data-timeline-action="zoom-in" title="Přiblížit">+</button>
          <button type="button" data-timeline-action="zoom-out" title="Oddálit">−</button>
          <button type="button" data-timeline-action="present">Rok 845</button>
          <button type="button" data-timeline-action="newer" title="Posunout do budoucnosti">Novější →</button>
        </div>
        <div class="timeline-stage" tabindex="0" aria-label="Interaktivní časová osa. Tažením nebo kolečkem se posouvá, klávesami plus a minus se mění měřítko.">
          <svg class="timeline-svg" aria-labelledby="timeline-svg-title timeline-svg-desc" role="img"></svg>
          <div class="timeline-window" aria-live="polite"></div>
        </div>
        <p class="timeline-help">Táhněte myší nebo použijte kolečko. Ctrl + kolečko mění měřítko. Kliknutím otevřete událost.</p>
        <article class="timeline-detail" hidden aria-live="polite"></article>
        <section class="timeline-modules" aria-labelledby="timeline-modules-title">
          <h2 id="timeline-modules-title">Roky zachycené v modulech</h2>
          <ul>${moduleLegend}</ul>
        </section>
      </section>`;

    timelineController = createTimelineController(main.querySelector(".timeline-page"), timelineData);
  }

  function createTimelineController(root, timeline) {
    const stage = root.querySelector(".timeline-stage");
    const svg = root.querySelector(".timeline-svg");
    const detail = root.querySelector(".timeline-detail");
    const windowLabel = root.querySelector(".timeline-window");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const events = timeline.events.slice().sort(function (a, b) { return a.year - b.year; });
    const byId = new Map(events.map(function (event) { return [event.id, event]; }));
    const state = {
      center: Number(timeline.range.initialCenter) || 848,
      yearsPerPixel: 0.027,
      width: 560,
      height: 380,
      dragging: false,
      dragX: 0,
      dragCenter: 0,
      moved: false,
      selectedId: null,
      highlightedId: null,
      hovered: false,
      lastInteraction: performance.now(),
      autoStarted: 0,
      lastHighlight: 0,
      lastJump: 0,
      jump: null,
      seed: 0xA57E210,
      destroyed: false,
      frame: 0,
      lastFrame: performance.now()
    };

    function random() {
      state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
      return state.seed / 4294967296;
    }

    function clampView() {
      const half = state.width * state.yearsPerPixel / 2;
      const minimum = Number(timeline.range.min);
      const maximum = Number(timeline.range.max);
      if (half * 2 >= maximum - minimum) {
        state.center = (minimum + maximum) / 2;
        return;
      }
      state.center = Math.max(minimum + half, Math.min(maximum - half, state.center));
    }

    function yearX(year) {
      return (Number(year) - state.center) / state.yearsPerPixel + state.width / 2;
    }

    function xYear(x) {
      return state.center + (x - state.width / 2) * state.yearsPerPixel;
    }

    function visibleRange() {
      const half = state.width * state.yearsPerPixel / 2;
      return [state.center - half, state.center + half];
    }

    function axisYear(year) {
      if (Math.abs(year) < 0.0001) return "počátek letopočtu";
      return timelineYearNumber(Math.round(year));
    }

    function tickStep() {
      const minimumPixels = 78;
      const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
      return candidates.find(function (candidate) {
        return candidate / state.yearsPerPixel >= minimumPixels;
      }) || 5000;
    }

    function shortTitle(value, limit) {
      const title = String(value);
      return title.length <= limit ? title : title.slice(0, Math.max(1, limit - 1)).trimEnd() + "…";
    }

    function render() {
      if (state.destroyed) return;
      const range = visibleRange();
      const axisY = 218;
      const step = tickStep();
      const firstTick = Math.ceil(range[0] / step) * step;
      const ticks = [];
      for (let year = firstTick; year <= range[1]; year += step) {
        const x = yearX(year);
        ticks.push(`
          <g class="timeline-tick">
            <line x1="${x.toFixed(2)}" y1="${axisY - 6}" x2="${x.toFixed(2)}" y2="${axisY + 7}"></line>
            <text x="${x.toFixed(2)}" y="${axisY + 24}" text-anchor="middle">${escapeHtml(axisYear(year))}</text>
          </g>`);
      }

      const bands = timeline.moduleBands.map(function (band, index) {
        const start = yearX(Number(band.start) - 0.48);
        const end = yearX(Number(band.end) + 0.48);
        const left = Math.max(0, Math.min(start, end));
        const rightEdge = Math.min(state.width, Math.max(start, end));
        const width = rightEdge - left;
        if (width <= 0 || rightEdge < 0 || left > state.width) return "";
        const bandClass = band.kind === "snapshot" ? " snapshot" : "";
        const text = width > 106
          ? `<text x="${(left + 7).toFixed(2)}" y="${37 + index % 2 * 27}">${escapeHtml(shortTitle(band.title, 28))}</text>`
          : "";
        return `
          <g class="timeline-module-band band-${index % 4}${bandClass}" data-band-id="${escapeHtml(band.id)}">
            <rect x="${left.toFixed(2)}" y="${18 + index % 2 * 27}" width="${Math.max(2, width).toFixed(2)}" height="24"></rect>
            ${text}
          </g>`;
      }).join("");

      const visibleEvents = events.filter(function (event) {
        const end = Number.isFinite(event.endYear) ? event.endYear : event.year;
        return end >= range[0] && event.year <= range[1];
      });
      const laneEnds = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
      const laneY = [176, 138, 100, 286, 328, 366];
      const eventMarkup = [];

      visibleEvents.forEach(function (event) {
        const x = yearX(event.year);
        const labelWidth = Math.max(72, Math.min(148, 38 + String(event.title).length * 5.4));
        const labelX = Math.max(labelWidth / 2 + 6, Math.min(state.width - labelWidth / 2 - 6, x));
        let lane = -1;
        for (let candidate = 0; candidate < laneEnds.length; candidate += 1) {
          if (labelX - labelWidth / 2 > laneEnds[candidate] + 6) {
            lane = candidate;
            break;
          }
        }
        if (lane === -1) {
          if ((Number(event.importance) || 0) < 2) return;
          lane = laneEnds.indexOf(Math.min.apply(null, laneEnds));
        }
        laneEnds[lane] = labelX + labelWidth / 2;
        const labelY = laneY[lane];
        const above = labelY < axisY;
        const connectorY = above ? labelY + 10 : labelY - 24;
        const selected = state.selectedId === event.id ? " is-selected" : "";
        const highlighted = state.highlightedId === event.id ? " is-highlighted" : "";
        const importance = " importance-" + Math.max(1, Math.min(3, Number(event.importance) || 1));
        const rangeEnd = Number.isFinite(event.endYear) ? yearX(event.endYear) : x;
        const span = Number.isFinite(event.endYear) && event.endYear !== event.year
          ? `<line class="timeline-event-span" x1="${x.toFixed(2)}" y1="${axisY}" x2="${rangeEnd.toFixed(2)}" y2="${axisY}"></line>`
          : "";
        eventMarkup.push(`
          <g class="timeline-event${selected}${highlighted}${importance}" data-event-id="${escapeHtml(event.id)}" role="button" tabindex="0" aria-label="${escapeHtml(timelineYearLabel(event) + ": " + event.title)}">
            ${span}
            <line class="timeline-event-connector" x1="${x.toFixed(2)}" y1="${axisY}" x2="${labelX.toFixed(2)}" y2="${connectorY}"></line>
            <circle cx="${x.toFixed(2)}" cy="${axisY}" r="${event.importance === 3 ? 5 : 4}"></circle>
            <text class="timeline-event-year" x="${labelX.toFixed(2)}" y="${labelY - 8}" text-anchor="middle">${escapeHtml(timelineYearLabel(event))}</text>
            <text class="timeline-event-title" x="${labelX.toFixed(2)}" y="${labelY + 8}" text-anchor="middle">${escapeHtml(shortTitle(event.title, 25))}</text>
          </g>`);
      });

      svg.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);
      svg.innerHTML = `
        <title id="timeline-svg-title">Dějiny Asterionu</title>
        <desc id="timeline-svg-desc">Časová osa s událostmi a barevnými pásy let popsaných v herních modulech.</desc>
        <defs>
          <pattern id="timeline-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7"></line>
          </pattern>
        </defs>
        <rect class="timeline-backdrop" x="0" y="0" width="${state.width}" height="${state.height}"></rect>
        <g class="timeline-bands">${bands}</g>
        <line class="timeline-axis" x1="0" y1="${axisY}" x2="${state.width}" y2="${axisY}"></line>
        <g class="timeline-ticks">${ticks.join("")}</g>
        <g class="timeline-events">${eventMarkup.join("")}</g>`;

      const start = Math.round(range[0]);
      const end = Math.round(range[1]);
      windowLabel.textContent = timelineYearNumber(start) + " až " + timelineYearNumber(end) + " k. l.";
    }

    function markInteraction() {
      state.lastInteraction = performance.now();
      state.autoStarted = 0;
      state.jump = null;
      state.highlightedId = null;
    }

    function zoomAt(factor, x) {
      markInteraction();
      const anchorX = Number.isFinite(x) ? x : state.width / 2;
      const anchorYear = xYear(anchorX);
      state.yearsPerPixel = Math.max(0.008, Math.min(14, state.yearsPerPixel * factor));
      state.center = anchorYear - (anchorX - state.width / 2) * state.yearsPerPixel;
      clampView();
      render();
    }

    function moveTo(year, interactive) {
      if (interactive) markInteraction();
      state.center = Number(year);
      clampView();
      render();
    }

    function showEvent(id, interactive) {
      const event = byId.get(id);
      if (!event) return;
      if (interactive) markInteraction();
      state.selectedId = event.id;
      state.highlightedId = null;
      const source = event.source ? `<p class="timeline-detail-source"><strong>Pramen:</strong> ${escapeHtml(event.source)}</p>` : "";
      detail.hidden = false;
      detail.innerHTML = `
        <button class="timeline-detail-close" type="button" aria-label="Zavřít podrobnosti">×</button>
        <p class="timeline-detail-year">${escapeHtml(timelineYearLabel(event))}</p>
        <h2>${escapeHtml(event.title)}</h2>
        <p>${escapeHtml(event.description)}</p>
        ${source}`;
      const x = yearX(event.year);
      if (x < 70 || x > state.width - 70) state.center = event.year;
      clampView();
      render();
    }

    function hideDetail() {
      markInteraction();
      state.selectedId = null;
      detail.hidden = true;
      detail.innerHTML = "";
      render();
      stage.focus({ preventScroll: true });
    }

    function resize() {
      const rect = stage.getBoundingClientRect();
      state.width = Math.max(280, Math.round(rect.width));
      state.height = state.width < 450 ? 430 : 380;
      clampView();
      render();
    }

    function eventFromTarget(target) {
      const group = target.closest ? target.closest("[data-event-id]") : null;
      return group ? group.getAttribute("data-event-id") : null;
    }

    function pointerDown(event) {
      if (event.button !== 0) return;
      markInteraction();
      state.dragging = true;
      state.dragX = event.clientX;
      state.dragCenter = state.center;
      state.moved = false;
      stage.classList.add("is-dragging");
      stage.setPointerCapture(event.pointerId);
    }

    function pointerMove(event) {
      if (!state.dragging) return;
      const delta = event.clientX - state.dragX;
      if (Math.abs(delta) > 3) state.moved = true;
      state.center = state.dragCenter - delta * state.yearsPerPixel;
      clampView();
      render();
    }

    function pointerUp(event) {
      if (!state.dragging) return;
      state.dragging = false;
      stage.classList.remove("is-dragging");
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      if (!state.moved) {
        const id = eventFromTarget(event.target);
        if (id) showEvent(id, true);
      }
    }

    function wheel(event) {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) * state.width / Math.max(1, rect.width);
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(event.deltaY * 0.002), x);
        return;
      }
      markInteraction();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      state.center += delta * state.yearsPerPixel * (event.shiftKey ? 1.8 : 0.72);
      clampView();
      render();
    }

    function keyDown(event) {
      const id = eventFromTarget(event.target);
      if (id && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        showEvent(id, true);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        markInteraction();
        state.center += (event.key === "ArrowLeft" ? -1 : 1) * state.width * state.yearsPerPixel * 0.14;
        clampView();
        render();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(0.72);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomAt(1.38);
      } else if (event.key === "Escape" && state.selectedId) {
        hideDetail();
      }
    }

    function toolbarClick(event) {
      const button = event.target.closest("[data-timeline-action]");
      if (!button) return;
      const action = button.dataset.timelineAction;
      if (action === "zoom-in") zoomAt(0.72);
      else if (action === "zoom-out") zoomAt(1.38);
      else if (action === "present") moveTo(845, true);
      else {
        markInteraction();
        const direction = action === "older" ? -1 : 1;
        state.center += direction * state.width * state.yearsPerPixel * 0.42;
        clampView();
        render();
      }
    }

    function bandClick(event) {
      const button = event.target.closest("[data-timeline-band]");
      if (!button) return;
      const band = timeline.moduleBands.find(function (item) { return item.id === button.dataset.timelineBand; });
      if (!band) return;
      markInteraction();
      state.center = (Number(band.start) + Number(band.end)) / 2;
      state.yearsPerPixel = Math.min(state.yearsPerPixel, 0.027);
      clampView();
      render();
      stage.focus({ preventScroll: true });
    }

    function autoFrame(now) {
      if (state.destroyed) return;
      const delta = Math.min(80, now - state.lastFrame);
      state.lastFrame = now;
      const idle = !reducedMotion && !state.dragging && !state.selectedId && !state.hovered && document.visibilityState === "visible" && now - state.lastInteraction > 12000;

      if (idle) {
        if (!state.autoStarted) {
          state.autoStarted = now;
          state.lastHighlight = now - 5000;
          state.lastJump = now;
        }
        if (state.jump) {
          const progress = Math.min(1, (now - state.jump.start) / state.jump.duration);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          state.center = state.jump.from + (state.jump.to - state.jump.from) * eased;
          if (progress >= 1) state.jump = null;
        } else {
          state.center += state.yearsPerPixel * 3.2 * delta / 1000;
        }
        clampView();

        if (now - state.lastHighlight > 7000) {
          const range = visibleRange();
          const candidates = events.filter(function (item) {
            return item.importance >= 2 && item.year >= range[0] && item.year <= range[1];
          });
          state.highlightedId = candidates.length ? candidates[Math.floor(random() * candidates.length)].id : null;
          state.lastHighlight = now;
        }

        if (!state.jump && now - state.lastJump > 34000) {
          const candidates = events.filter(function (item) {
            return item.importance >= 2 && item.year < 833;
          });
          const target = candidates[Math.floor(random() * candidates.length)];
          if (target) {
            state.jump = { from: state.center, to: target.year, start: now, duration: 1800 };
            state.highlightedId = target.id;
          }
          state.lastJump = now;
        }
        render();
      } else if (state.autoStarted) {
        state.autoStarted = 0;
      }
      state.frame = requestAnimationFrame(autoFrame);
    }

    stage.addEventListener("pointerdown", pointerDown);
    stage.addEventListener("pointermove", pointerMove);
    stage.addEventListener("pointerup", pointerUp);
    stage.addEventListener("pointercancel", pointerUp);
    stage.addEventListener("wheel", wheel, { passive: false });
    stage.addEventListener("keydown", keyDown);
    stage.addEventListener("mouseenter", function () { state.hovered = true; });
    stage.addEventListener("mouseleave", function () { state.hovered = false; state.lastInteraction = performance.now(); });
    root.querySelector(".timeline-toolbar").addEventListener("click", toolbarClick);
    root.querySelector(".timeline-modules").addEventListener("click", bandClick);
    detail.addEventListener("click", function (event) {
      if (event.target.closest(".timeline-detail-close")) hideDetail();
    });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();
    state.frame = requestAnimationFrame(autoFrame);

    return {
      destroy: function () {
        state.destroyed = true;
        cancelAnimationFrame(state.frame);
        resizeObserver.disconnect();
      }
    };
  }

  function setTimelineDockOpen(open, focusPanel) {
    const panel = timelineDock.querySelector(".timeline-dock-panel");
    const expanded = Boolean(open);
    timelineDock.classList.toggle("is-open", expanded);
    timelineDockToggle.setAttribute("aria-expanded", String(expanded));
    panel.setAttribute("aria-hidden", String(!expanded));
    panel.inert = !expanded;
    navigation.querySelectorAll("[data-open-timeline]").forEach(function (link) {
      link.setAttribute("aria-expanded", String(expanded));
    });
    if (expanded && timelineController) timelineController.refresh();
    if (expanded && focusPanel) timelineDockClose.focus({ preventScroll: true });
    if (!expanded && focusPanel) timelineDockToggle.focus({ preventScroll: true });
  }

  function initializeTimelineDock() {
    if (!timelineData || !Array.isArray(timelineData.events)) {
      timelineDockContent.innerHTML = '<p class="timeline-dock-error">Data časové osy se nepodařilo načíst.</p>';
      return;
    }

    const moduleLegend = timelineData.moduleBands.map(function (band) {
      const years = band.start === band.end
        ? timelineYearNumber(band.start) + " k. l."
        : timelineYearNumber(band.start) + "–" + timelineYearNumber(band.end) + " k. l.";
      return `
        <li>
          <button type="button" data-timeline-band="${escapeHtml(band.id)}">
            <strong>${escapeHtml(band.title)}</strong>
            <span>${escapeHtml(years)}</span>
          </button>
        </li>`;
    }).join("");

    timelineDockContent.innerHTML = `
      <section class="timeline-page timeline-page-vertical">
        <div class="timeline-toolbar" aria-label="Ovládání časové osy">
          <button type="button" data-timeline-action="older" title="Posunout do minulosti">↑ Starší</button>
          <button type="button" data-timeline-action="zoom-in" title="Přiblížit">+</button>
          <button type="button" data-timeline-action="zoom-out" title="Oddálit">−</button>
          <button type="button" data-timeline-action="present">Rok 845</button>
          <button type="button" data-timeline-action="newer" title="Posunout k novějším rokům">Novější ↓</button>
        </div>
        <div class="timeline-stage" tabindex="0" aria-label="Svislá interaktivní časová osa. Tažením nebo kolečkem se posouvá, klávesami plus a minus se mění měřítko.">
          <svg class="timeline-svg" aria-labelledby="timeline-svg-title timeline-svg-desc" role="img"></svg>
          <div class="timeline-window" aria-live="polite"></div>
        </div>
        <p class="timeline-help">Táhněte svisle nebo použijte kolečko. Ctrl + kolečko mění měřítko.</p>
        <article class="timeline-detail" hidden aria-live="polite"></article>
        <section class="timeline-modules" aria-labelledby="timeline-modules-title">
          <h3 id="timeline-modules-title">Modulová období</h3>
          <ul>${moduleLegend}</ul>
        </section>
      </section>`;

    timelineController = createVerticalTimelineController(timelineDockContent.querySelector(".timeline-page"), timelineData);
    setTimelineDockOpen(false, false);

    timelineDockToggle.addEventListener("click", function () {
      setTimelineDockOpen(!timelineDock.classList.contains("is-open"), true);
    });
    timelineDockClose.addEventListener("click", function () {
      setTimelineDockOpen(false, true);
    });
    navigation.addEventListener("click", function (event) {
      const link = event.target.closest("[data-open-timeline]");
      if (!link) return;
      event.preventDefault();
      setTimelineDockOpen(true, true);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && timelineDock.classList.contains("is-open") && !timelineDock.querySelector(".timeline-detail:not([hidden])")) {
        setTimelineDockOpen(false, true);
      }
    });
  }

  function createVerticalTimelineController(root, timeline) {
    const stage = root.querySelector(".timeline-stage");
    const svg = root.querySelector(".timeline-svg");
    const detail = root.querySelector(".timeline-detail");
    const windowLabel = root.querySelector(".timeline-window");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const events = timeline.events.slice().sort(function (a, b) { return a.year - b.year; });
    const byId = new Map(events.map(function (event) { return [event.id, event]; }));
    const state = {
      center: Number(timeline.range.initialCenter) || 848,
      yearsPerPixel: 0.024,
      width: 292,
      height: 620,
      dragging: false,
      dragY: 0,
      dragCenter: 0,
      moved: false,
      selectedId: null,
      highlightedId: null,
      hovered: false,
      lastInteraction: performance.now(),
      autoStarted: 0,
      lastHighlight: 0,
      lastJump: 0,
      jump: null,
      seed: 0xA57E210,
      destroyed: false,
      frame: 0,
      lastFrame: performance.now()
    };

    function random() {
      state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
      return state.seed / 4294967296;
    }

    function clampView() {
      const half = state.height * state.yearsPerPixel / 2;
      const minimum = Number(timeline.range.min);
      const maximum = Number(timeline.range.max);
      if (half * 2 >= maximum - minimum) {
        state.center = (minimum + maximum) / 2;
        return;
      }
      state.center = Math.max(minimum + half, Math.min(maximum - half, state.center));
    }

    function yearY(year) {
      return (Number(year) - state.center) / state.yearsPerPixel + state.height / 2;
    }

    function yYear(y) {
      return state.center + (y - state.height / 2) * state.yearsPerPixel;
    }

    function visibleRange() {
      const half = state.height * state.yearsPerPixel / 2;
      return [state.center - half, state.center + half];
    }

    function axisYear(year) {
      if (Math.abs(year) < 0.0001) return "počátek";
      return timelineYearNumber(Math.round(year));
    }

    function tickStep() {
      const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
      return candidates.find(function (candidate) {
        return candidate / state.yearsPerPixel >= 72;
      }) || 5000;
    }

    function shortTitle(value, limit) {
      const title = String(value);
      return title.length <= limit ? title : title.slice(0, Math.max(1, limit - 1)).trimEnd() + "…";
    }

    function render() {
      if (state.destroyed) return;
      const range = visibleRange();
      const axisX = Math.max(68, Math.min(82, state.width * 0.25));
      const labelX = axisX + 22;
      const step = tickStep();
      const firstTick = Math.ceil(range[0] / step) * step;
      const ticks = [];
      for (let year = firstTick; year <= range[1]; year += step) {
        const y = yearY(year);
        ticks.push(`
          <g class="timeline-tick">
            <line x1="${axisX - 6}" y1="${y.toFixed(2)}" x2="${axisX + 7}" y2="${y.toFixed(2)}"></line>
            <text x="${axisX - 11}" y="${(y + 3).toFixed(2)}" text-anchor="end">${escapeHtml(axisYear(year))}</text>
          </g>`);
      }

      const bands = timeline.moduleBands.map(function (band, index) {
        const start = yearY(Number(band.start) - 0.48);
        const end = yearY(Number(band.end) + 0.48);
        const top = Math.max(0, Math.min(start, end));
        const bottom = Math.min(state.height, Math.max(start, end));
        const height = bottom - top;
        if (height <= 0 || bottom < 0 || top > state.height) return "";
        const bandClass = band.kind === "snapshot" ? " snapshot" : "";
        const text = height > 34
          ? `<text x="8" y="${(top + 17).toFixed(2)}">${escapeHtml(shortTitle(band.title, 16))}</text>`
          : "";
        return `
          <g class="timeline-module-band band-${index % 4}${bandClass}" data-band-id="${escapeHtml(band.id)}">
            <rect x="0" y="${top.toFixed(2)}" width="${state.width}" height="${Math.max(2, height).toFixed(2)}"></rect>
            ${text}
          </g>`;
      }).join("");

      const visibleEvents = events.filter(function (event) {
        const end = Number.isFinite(event.endYear) ? event.endYear : event.year;
        return end >= range[0] && event.year <= range[1];
      });
      const yearCounts = new Map();
      const yearIndexes = new Map();
      visibleEvents.forEach(function (event) {
        yearCounts.set(event.year, (yearCounts.get(event.year) || 0) + 1);
      });
      const eventMarkup = [];

      visibleEvents.forEach(function (event) {
        const pointY = yearY(event.year);
        const count = yearCounts.get(event.year) || 1;
        const index = yearIndexes.get(event.year) || 0;
        yearIndexes.set(event.year, index + 1);
        const sameYearOffset = (index - (count - 1) / 2) * 28;
        const eventLabelY = Math.max(23, Math.min(state.height - 19, pointY + sameYearOffset));
        const selected = state.selectedId === event.id ? " is-selected" : "";
        const highlighted = state.highlightedId === event.id ? " is-highlighted" : "";
        const importance = " importance-" + Math.max(1, Math.min(3, Number(event.importance) || 1));
        const rangeEnd = Number.isFinite(event.endYear) ? yearY(event.endYear) : pointY;
        const span = Number.isFinite(event.endYear) && event.endYear !== event.year
          ? `<line class="timeline-event-span" x1="${axisX}" y1="${Math.max(0, pointY).toFixed(2)}" x2="${axisX}" y2="${Math.min(state.height, rangeEnd).toFixed(2)}"></line>`
          : "";
        eventMarkup.push(`
          <g class="timeline-event${selected}${highlighted}${importance}" data-event-id="${escapeHtml(event.id)}" role="button" tabindex="0" aria-label="${escapeHtml(timelineYearLabel(event) + ": " + event.title)}">
            ${span}
            <line class="timeline-event-connector" x1="${axisX}" y1="${pointY.toFixed(2)}" x2="${labelX - 5}" y2="${(eventLabelY - 3).toFixed(2)}"></line>
            <circle cx="${axisX}" cy="${pointY.toFixed(2)}" r="${event.importance === 3 ? 5 : 4}"></circle>
            <text class="timeline-event-year" x="${labelX}" y="${(eventLabelY - 3).toFixed(2)}" text-anchor="start">${escapeHtml(timelineYearLabel(event))}</text>
            <text class="timeline-event-title" x="${labelX}" y="${(eventLabelY + 12).toFixed(2)}" text-anchor="start">${escapeHtml(shortTitle(event.title, 29))}</text>
          </g>`);
      });

      svg.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);
      svg.innerHTML = `
        <title id="timeline-svg-title">Dějiny Asterionu</title>
        <desc id="timeline-svg-desc">Svislá časová osa s událostmi a pásy let popsaných v herních modulech. Starší roky jsou nahoře.</desc>
        <defs>
          <pattern id="timeline-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7"></line>
          </pattern>
        </defs>
        <rect class="timeline-backdrop" x="0" y="0" width="${state.width}" height="${state.height}"></rect>
        <g class="timeline-bands">${bands}</g>
        <line class="timeline-axis" x1="${axisX}" y1="0" x2="${axisX}" y2="${state.height}"></line>
        <g class="timeline-ticks">${ticks.join("")}</g>
        <g class="timeline-events">${eventMarkup.join("")}</g>`;

      windowLabel.textContent = timelineYearNumber(Math.round(range[0])) + " až " + timelineYearNumber(Math.round(range[1])) + " k. l.";
    }

    function markInteraction() {
      state.lastInteraction = performance.now();
      state.autoStarted = 0;
      state.jump = null;
      state.highlightedId = null;
    }

    function zoomAt(factor, y) {
      markInteraction();
      const anchorY = Number.isFinite(y) ? y : state.height / 2;
      const anchorYear = yYear(anchorY);
      state.yearsPerPixel = Math.max(0.008, Math.min(14, state.yearsPerPixel * factor));
      state.center = anchorYear - (anchorY - state.height / 2) * state.yearsPerPixel;
      clampView();
      render();
    }

    function moveTo(year, interactive) {
      if (interactive) markInteraction();
      state.center = Number(year);
      clampView();
      render();
    }

    function showEvent(id, interactive) {
      const event = byId.get(id);
      if (!event) return;
      if (interactive) markInteraction();
      state.selectedId = event.id;
      state.highlightedId = null;
      const chronicleSections = [];
      if (Array.isArray(event.items)) {
        event.items.forEach(function (item) {
          const sectionName = item.section || "Obecně";
          let section = chronicleSections[chronicleSections.length - 1];
          if (!section || section.name !== sectionName) {
            section = { name: sectionName, items: [] };
            chronicleSections.push(section);
          }
          section.items.push(item);
        });
      }
      const chronicleMarkup = chronicleSections.map(function (section) {
        const items = section.items.map(function (item) {
          return `
            <li>
              <h4>${escapeHtml(item.title)}</h4>
              <p>${escapeHtml(item.text)}</p>
            </li>`;
        }).join("");
        return `
          <section class="timeline-chronicle-group">
            <h3>${escapeHtml(section.name)}</h3>
            <ol>${items}</ol>
          </section>`;
      }).join("");
      detail.hidden = false;
      detail.innerHTML = `
        <button class="timeline-detail-close" type="button" aria-label="Zavřít podrobnosti">×</button>
        <p class="timeline-detail-year">${escapeHtml(timelineYearLabel(event))}</p>
        <h2>${escapeHtml(event.title)}</h2>
        ${chronicleMarkup || `<p>${escapeHtml(event.description)}</p>`}
        ${event.source ? `<p class="timeline-detail-source"><strong>Pramen:</strong> ${escapeHtml(event.source)}</p>` : ""}`;
      const y = yearY(event.year);
      if (y < 55 || y > state.height - 55) state.center = event.year;
      clampView();
      render();
    }

    function hideDetail() {
      markInteraction();
      state.selectedId = null;
      detail.hidden = true;
      detail.innerHTML = "";
      render();
      stage.focus({ preventScroll: true });
    }

    function resize() {
      const rect = stage.getBoundingClientRect();
      state.width = Math.max(260, Math.round(rect.width));
      state.height = Math.max(410, Math.round(rect.height));
      clampView();
      render();
    }

    function eventFromTarget(target) {
      const group = target.closest ? target.closest("[data-event-id]") : null;
      return group ? group.getAttribute("data-event-id") : null;
    }

    function pointerDown(event) {
      if (event.button !== 0) return;
      markInteraction();
      state.dragging = true;
      state.dragY = event.clientY;
      state.dragCenter = state.center;
      state.moved = false;
      stage.classList.add("is-dragging");
      stage.setPointerCapture(event.pointerId);
    }

    function pointerMove(event) {
      if (!state.dragging) return;
      const delta = event.clientY - state.dragY;
      if (Math.abs(delta) > 3) state.moved = true;
      state.center = state.dragCenter - delta * state.yearsPerPixel;
      clampView();
      render();
    }

    function pointerUp(event) {
      if (!state.dragging) return;
      state.dragging = false;
      stage.classList.remove("is-dragging");
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      if (!state.moved) {
        const id = eventFromTarget(event.target);
        if (id) showEvent(id, true);
      }
    }

    function wheel(event) {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const y = (event.clientY - rect.top) * state.height / Math.max(1, rect.height);
      if (event.ctrlKey || event.metaKey) {
        zoomAt(Math.exp(event.deltaY * 0.002), y);
        return;
      }
      markInteraction();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      state.center += delta * state.yearsPerPixel * (event.shiftKey ? 1.8 : 0.72);
      clampView();
      render();
    }

    function keyDown(event) {
      const id = eventFromTarget(event.target);
      if (id && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        showEvent(id, true);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        markInteraction();
        state.center += (event.key === "ArrowUp" ? -1 : 1) * state.height * state.yearsPerPixel * 0.14;
        clampView();
        render();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(0.72);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomAt(1.38);
      } else if (event.key === "Escape" && state.selectedId) {
        event.stopPropagation();
        hideDetail();
      }
    }

    function toolbarClick(event) {
      const button = event.target.closest("[data-timeline-action]");
      if (!button) return;
      const action = button.dataset.timelineAction;
      if (action === "zoom-in") zoomAt(0.72);
      else if (action === "zoom-out") zoomAt(1.38);
      else if (action === "present") moveTo(845, true);
      else {
        markInteraction();
        state.center += (action === "older" ? -1 : 1) * state.height * state.yearsPerPixel * 0.42;
        clampView();
        render();
      }
    }

    function bandClick(event) {
      const button = event.target.closest("[data-timeline-band]");
      if (!button) return;
      const band = timeline.moduleBands.find(function (item) { return item.id === button.dataset.timelineBand; });
      if (!band) return;
      markInteraction();
      state.center = (Number(band.start) + Number(band.end)) / 2;
      state.yearsPerPixel = Math.min(state.yearsPerPixel, 0.024);
      clampView();
      render();
      stage.focus({ preventScroll: true });
    }

    function autoFrame(now) {
      if (state.destroyed) return;
      const delta = Math.min(80, now - state.lastFrame);
      state.lastFrame = now;
      const dockOpen = timelineDock.classList.contains("is-open");
      const idle = dockOpen && !reducedMotion && !state.dragging && !state.selectedId && !state.hovered && document.visibilityState === "visible" && now - state.lastInteraction > 12000;
      if (idle) {
        if (!state.autoStarted) {
          state.autoStarted = now;
          state.lastHighlight = now - 5000;
          state.lastJump = now;
        }
        if (state.jump) {
          const progress = Math.min(1, (now - state.jump.start) / state.jump.duration);
          const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          state.center = state.jump.from + (state.jump.to - state.jump.from) * eased;
          if (progress >= 1) state.jump = null;
        } else {
          state.center += state.yearsPerPixel * 3.2 * delta / 1000;
        }
        clampView();
        if (now - state.lastHighlight > 7000) {
          const range = visibleRange();
          const candidates = events.filter(function (item) {
            return item.importance >= 2 && item.year >= range[0] && item.year <= range[1];
          });
          state.highlightedId = candidates.length ? candidates[Math.floor(random() * candidates.length)].id : null;
          state.lastHighlight = now;
        }
        if (!state.jump && now - state.lastJump > 34000) {
          const candidates = events.filter(function (item) { return item.importance >= 2 && item.year < 833; });
          const target = candidates[Math.floor(random() * candidates.length)];
          if (target) {
            state.jump = { from: state.center, to: target.year, start: now, duration: 1800 };
            state.highlightedId = target.id;
          }
          state.lastJump = now;
        }
        render();
      } else if (state.autoStarted) {
        state.autoStarted = 0;
      }
      state.frame = requestAnimationFrame(autoFrame);
    }

    stage.addEventListener("pointerdown", pointerDown);
    stage.addEventListener("pointermove", pointerMove);
    stage.addEventListener("pointerup", pointerUp);
    stage.addEventListener("pointercancel", pointerUp);
    stage.addEventListener("wheel", wheel, { passive: false });
    stage.addEventListener("keydown", keyDown);
    stage.addEventListener("mouseenter", function () { state.hovered = true; });
    stage.addEventListener("mouseleave", function () { state.hovered = false; state.lastInteraction = performance.now(); });
    root.querySelector(".timeline-toolbar").addEventListener("click", toolbarClick);
    root.querySelector(".timeline-modules").addEventListener("click", bandClick);
    detail.addEventListener("click", function (event) {
      if (event.target.closest(".timeline-detail-close")) hideDetail();
    });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(stage);
    resize();
    state.frame = requestAnimationFrame(autoFrame);

    return {
      refresh: function () {
        markInteraction();
        resize();
      },
      destroy: function () {
        state.destroyed = true;
        cancelAnimationFrame(state.frame);
        resizeObserver.disconnect();
      }
    };
  }

  function renderRoute() {
    if (!data) {
      main.innerHTML = '<p class="error-message">Nepodařilo se načíst obsah webu.</p>';
      return;
    }
    const route = routeInfo();
    updateActiveNavigation(route.path);
    if (route.path === "home") renderHome();
    else if (route.path === "dech-draka") renderDechDraka(route.query);
    else if (route.path === "dech-draka-cela-cisla") renderDechDrakaFullIssues(route.query);
    else if (["materials", "maps", "adventures", "indexes", "archive/dech-draka", "archive/alduron", "archive/legenda"].includes(route.path)) renderCatalog(route.path, route.query);
    else if (route.path === "rules") renderRules();
    else if (route.path === "timeline") {
      renderHome();
      setTitle("Časová osa");
      setTimelineDockOpen(true, false);
    }
    else if (route.path === "modules") renderModules();
    else if (route.path === "gallery") renderGallery();
    else if (route.path === "archive/authors") renderLegacyPage("autori");
    else if (route.path === "archive" || route.path === "archive/other") renderArchive(route.path, route.query);
    else if (route.path.startsWith("page/")) renderLegacyPage(route.path.slice(5));
    else renderHome();

    if (window.matchMedia("(max-width: 650px)").matches) {
      menu.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    }
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  menuToggle.addEventListener("click", function () {
    const open = menu.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });

  themeToggle.addEventListener("click", function () {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });

  searchForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const value = searchInput.value.trim();
    location.hash = value ? "#/materials?q=" + encodeURIComponent(value) : "#/materials";
  });

  applyTheme(document.documentElement.dataset.theme, false);
  renderSidebar();
  initializeTimelineDock();
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}());
