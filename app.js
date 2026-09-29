/* Psepho frontend: fetches data.json, renders cards, auto-refreshes. */
(function () {
  "use strict";
  var DATA_URL = "data.json";
  var REFRESH_MS = 10 * 60 * 1000;
  var panelsEl = document.getElementById("panels");
  var tabBar = document.getElementById("tabBar");
  var tabs = Array.prototype.slice.call(tabBar.querySelectorAll(".tab"));
  var freshText = document.getElementById("freshText");
  var freshDot = document.getElementById("freshDot");
  var errBox = document.getElementById("errBox");
  var current = 0;
  var startX = null;

  function pillClass(choice) {
    return choice === "democrat_win" ? "dem" : choice === "republican_win" ? "rep" : "toss";
  }
  function pillText(choice) {
    return choice === "democrat_win" ? "DEM WIN" : choice === "republican_win" ? "GOP WIN" : "TOSS-UP";
  }
  function verdictText(choice) {
    return choice === "democrat_win" ? "Democrats take it"
         : choice === "republican_win" ? "Republicans take it"
         : "Too close to call";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cardHTML(r) {
    var pc = pillClass(r.choice);
    var conf = Math.round((r.confidence || 0) * 100);
    return '<div class="card">' +
      '<div class="card-top"><div class="race-label">' + esc(r.label) + "</div>" +
      '<div class="pill ' + pc + '">' + pillText(r.choice) + "</div></div>" +
      '<div class="pct ' + pc + '">' + r.display_pct + '%</div>' +
      '<div class="verdict">' + verdictText(r.choice) + "</div>" +
      '<div class="conf"><span>confidence</span><div class="bar"><i style="width:' + conf + '%"></i></div><span>' + conf + "%</span></div>" +
      '<div class="inputs">' + esc(r.inputs_line) + "</div>" +
      "</div>";
  }

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " hr ago";
    return Math.round(h / 24) + " days ago";
  }

  function render(data) {
    var groups = data.groups || {};
    document.getElementById("panel-0").innerHTML = (groups.chambers || []).map(cardHTML).join("");
    document.getElementById("panel-1").innerHTML = (groups.senate || []).map(cardHTML).join("");
    document.getElementById("panel-2").innerHTML = (groups.governors || []).map(cardHTML).join("");
    var ts = Date.parse(data.updated_at);
    var stale = !ts || Date.now() - ts > 4 * 3600 * 1000;
    freshDot.className = "dot" + (stale ? " stale" : "");
    freshText.textContent = ts
      ? "Fresh " + ago(ts) + " · auto-refreshes every 10 min"
      : "Update time unknown";
  }

  function fail(msg) {
    errBox.style.display = "block";
    errBox.textContent = msg;
  }

  function load() {
    fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) { errBox.style.display = "none"; render(data); })
      .catch(function () { fail("Couldn't reach fresh data — showing last loaded numbers."); });
  }

  function go(i) {
    current = Math.max(0, Math.min(2, i));
    tabs.forEach(function (t, k) { t.classList.toggle("active", k === current); });
    panelsEl.style.transform = "translateX(-" + current * 100 + "%)";
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { go(parseInt(t.dataset.i, 10)); });
  });
  panelsEl.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
  panelsEl.addEventListener("touchend", function (e) {
    if (startX == null) return;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) go(current + (dx < 0 ? 1 : -1));
    startX = null;
  }, { passive: true });

  load();
  setInterval(load, REFRESH_MS);
})();
