/* Psepho frontend: fetches data.json, renders cards, auto-refreshes. */
(function () {
  "use strict";
  var DATA_URL = "data.json";
  var REFRESH_MS = 10 * 60 * 1000;
  var STALE_MS = 4 * 3600 * 1000;

  var panelsEl = document.getElementById("panels");
  var tabBar = document.getElementById("tabBar");
  var tabs = Array.prototype.slice.call(tabBar.querySelectorAll(".tab"));
  var liveBadge = document.getElementById("liveBadge");
  var timestampEl = document.getElementById("timestamp");
  var changesBox = document.getElementById("changesBox");
  var changesText = document.getElementById("changesText");
  var footerLine = document.getElementById("footerLine");
  var errBox = document.getElementById("errBox");
  var current = 0;
  var startX = null;

  var CALL = {
    democrat_win:  { cls: "dem",  pill: "Democrat win",   prob: "Dem win" },
    republican_win:{ cls: "gop",  pill: "Republican win", prob: "Republican win" },
    toss_up:       { cls: "toss", pill: "Toss-up",        prob: "Toss-up" }
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function callOf(choice) {
    return CALL[choice] || CALL.toss_up;
  }

  function probBlock(r) {
    var c = callOf(r.choice);
    var mod = r.choice === "republican_win" ? " gop" : r.choice === "toss_up" ? " toss" : "";
    var pct = Math.round(r.display_pct);
    var aria = r.choice === "toss_up"
      ? pct + " percent display for a toss-up"
      : pct + " percent " + c.prob + " probability";
    return '<div class="probability' + mod + '"><div class="bar-labels"><span>' + c.prob +
      "</span><strong>" + pct + '%</strong></div><div class="bar" role="img" aria-label="' +
      esc(aria) + '"><span style="width:' + pct + '%"></span></div></div>';
  }

  function chamberCard(r) {
    var c = callOf(r.choice);
    var conf = Math.round((r.confidence || 0) * 100);
    return '<article class="card chamber-card win-' + c.cls + '">' +
      '<div class="card-top"><h3>' + esc(r.label) + '</h3><span class="call ' + c.cls + '">' +
      c.pill + "</span></div>" +
      probBlock(r) +
      '<div class="metric-row"><span>Jev confidence</span><strong>' + conf + "%</strong></div>" +
      '<p class="inputs">' + esc(r.inputs_line) + ".</p>" +
      "</article>";
  }

  function raceCard(r) {
    var c = callOf(r.choice);
    var conf = Math.round((r.confidence || 0) * 100);
    return '<article class="card race-card win-' + c.cls + '"><div><div class="race-top"><h3>' +
      esc(r.label) + '</h3><span class="call ' + c.cls + '">' + c.pill + "</span></div>" +
      '<p class="inputs">' + esc(r.inputs_line) + ".</p></div>" +
      '<div class="race-metrics">' + probBlock(r) +
      '<div class="metric-row"><span>Confidence</span><strong>' + conf + "%</strong></div></div>" +
      "</article>";
  }

  function legendHTML() {
    return '<div class="legend" aria-label="Call color legend">' +
      '<span><i class="d"></i>Democrat win</span>' +
      '<span><i class="r"></i>Republican win</span>' +
      '<span><i class="t"></i>Toss-up</span></div>';
  }

  function sectionHead(title, right) {
    return '<div class="section-head"><h2>' + title + "</h2>" + right + "</div>";
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var date = d.toLocaleDateString("en-US",
      { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
    var time = d.toLocaleTimeString("en-US",
      { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
    return date + ", " + time + " ET";
  }

  function modelShort(m) {
    // "jev-1.13.0" -> "Jev 1.13.0"
    if (!m) return "Jev";
    var mm = /^([a-zA-Z]+)-([\d.]+)$/.exec(m);
    if (mm) return mm[1].charAt(0).toUpperCase() + mm[1].slice(1) + " " + mm[2];
    return m;
  }

  function render(data) {
    var groups = data.groups || {};
    var chambers = groups.chambers || [];
    var senate = groups.senate || [];
    var governors = groups.governors || [];

    document.getElementById("panel-0").innerHTML =
      '<div class="section">' +
      sectionHead("Chambers", legendHTML()) +
      '<div class="chambers">' + chambers.map(chamberCard).join("") + "</div></div>";

    document.getElementById("panel-1").innerHTML =
      '<div class="section">' +
      sectionHead("Senate races",
        '<span class="count">' + senate.length + " races · Winner probability shown</span>") +
      '<div class="races">' + senate.map(raceCard).join("") + "</div></div>";

    document.getElementById("panel-2").innerHTML =
      '<div class="section">' +
      sectionHead("Governors",
        '<span class="count">' + governors.length + " races · Winner probability shown</span>") +
      '<div class="races">' + governors.map(raceCard).join("") + "</div></div>";

    var ts = Date.parse(data.updated_at);
    var label = fmtTime(data.updated_at);
    var stale = !ts || (Date.now() - ts > STALE_MS);
    liveBadge.textContent = "CURRENT · " + modelShort(data.model);
    liveBadge.classList.toggle("stale", stale);
    timestampEl.textContent = label
      ? "Last updated: " + label + " · auto-refreshes every 10 min"
      : "Update time unknown";
    footerLine.textContent = (label ? "Data from the " + label + " " + modelShort(data.model) + " run." : "Forecast data.") +
      " · Sources: Wikipedia polls and Polymarket markets.";

    if (data.changes) {
      changesText.textContent = data.changes;
      changesBox.hidden = false;
    } else {
      changesBox.hidden = true;
    }
  }

  function fail() {
    errBox.style.display = "block";
    errBox.textContent = "Couldn't reach fresh data — showing last loaded numbers.";
  }

  function load() {
    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { errBox.style.display = "none"; render(data); })
      .catch(fail);
  }

  function go(i) {
    current = Math.max(0, Math.min(2, i));
    tabs.forEach(function (t, k) {
      var on = k === current;
      t.setAttribute("aria-selected", on ? "true" : "false");
      if (on) { t.removeAttribute("tabindex"); } else { t.setAttribute("tabindex", "-1"); }
    });
    panelsEl.style.transform = "translateX(-" + current * 100 + "%)";
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { go(parseInt(t.getAttribute("data-i"), 10)); });
  });
  panelsEl.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
  panelsEl.addEventListener("touchend", function (e) {
    if (startX == null) return;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) go(current + (dx < 0 ? 1 : -1));
    startX = null;
  }, { passive: true });

  go(0);
  load();
  setInterval(load, REFRESH_MS);
})();
