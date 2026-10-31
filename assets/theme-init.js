(function () {
  "use strict";

  const requestedTheme = new URLSearchParams(window.location.search).get("theme");
  let theme = "dark";
  if (requestedTheme === "dark" || requestedTheme === "light") {
    theme = requestedTheme;
  } else {
    try {
      if (window.localStorage.getItem("asterion-theme") === "light") theme = "light";
    } catch (_error) {
      /* Zakázané úložiště nemění výchozí tmavý vzhled. */
    }
  }
  document.documentElement.dataset.theme = theme;
}());
