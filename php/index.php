<?php
/*
 * Psepho — Election Forecast (PHP version for the Plesk box)
 * Single self-contained file. Fetches the live forecast data.json
 * (kept current every 2 hours by the Chunav refresh job on GitHub Pages),
 * caches it locally for 10 minutes, and renders the page server-side.
 * On fetch failure it falls back to the last cached copy.
 */
declare(strict_types=1);

const PSEPHO_DATA_URL = 'https://psepho.socialnews.xyz/data.json';
const PSEPHO_CACHE_TTL = 600;          // seconds
const PSEPHO_STALE_MS  = 4 * 3600;     // badge turns "stale" after 4h

function psepho_cache_path(): string {
    $dir = __DIR__;
    if (!is_writable($dir)) {
        $dir = sys_get_temp_dir();
    }
    return $dir . '/psepho-data-cache.json';
}

function psepho_fetch_remote(): ?string {
    if (function_exists('curl_init')) {
        $ch = curl_init(PSEPHO_DATA_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_USERAGENT => 'PsephoPHP/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body !== false && $code >= 200 && $code < 300) {
            return (string) $body;
        }
        return null;
    }
    $ctx = stream_context_create([
        'http' => ['timeout' => 10, 'user_agent' => 'PsephoPHP/1.0'],
    ]);
    $body = @file_get_contents(PSEPHO_DATA_URL, false, $ctx);
    return $body === false ? null : $body;
}

function psepho_load_data(): array {
    $cache = psepho_cache_path();
    $raw = null;
    $usedFallback = false;

    if (is_file($cache) && (time() - (int) filemtime($cache)) < PSEPHO_CACHE_TTL) {
        $raw = @file_get_contents($cache);
    }
    if ($raw === null || $raw === false || $raw === '') {
        $fresh = psepho_fetch_remote();
        if ($fresh !== null) {
            $raw = $fresh;
            @file_put_contents($cache, $fresh, LOCK_EX);
        } elseif (is_file($cache)) {
            // Fetch failed — fall back to the last cached copy, however old.
            $raw = @file_get_contents($cache);
            $usedFallback = true;
        }
    }
    if (!is_string($raw) || $raw === '') {
        return ['data' => null, 'stale' => true];
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data['groups'])) {
        return ['data' => null, 'stale' => true];
    }
    $updated = isset($data['updated_at']) ? strtotime((string) $data['updated_at']) : false;
    $stale = $usedFallback || $updated === false || (time() - $updated) > PSEPHO_STALE_MS;
    return ['data' => $data, 'stale' => $stale];
}

function psepho_esc($s): string {
    return htmlspecialchars((string) ($s ?? ''), ENT_QUOTES, 'UTF-8');
}

function psepho_model_short(?string $m): string {
    if (!$m) return 'Jev';
    if (preg_match('/^([a-zA-Z]+)-([\d.]+)$/', $m, $mm)) {
        return ucfirst($mm[1]) . ' ' . $mm[2];
    }
    return $m;
}

function psepho_fmt_time(?string $iso): ?string {
    if (!$iso) return null;
    try {
        $d = new DateTime((string) $iso);
        $d->setTimezone(new DateTimeZone('America/New_York'));
        return $d->format('F j, Y, g:i A') . ' ET';
    } catch (Exception $e) {
        return null;
    }
}

const PSEPHO_CALL = [
    'democrat_win'   => ['cls' => 'dem',  'pill' => 'Democrat win',   'prob' => 'Dem win'],
    'republican_win' => ['cls' => 'gop',  'pill' => 'Republican win', 'prob' => 'Republican win'],
    'toss_up'        => ['cls' => 'toss', 'pill' => 'Toss-up',        'prob' => 'Toss-up'],
];

function psepho_call(array $r): array {
    return PSEPHO_CALL[$r['choice'] ?? ''] ?? PSEPHO_CALL['toss_up'];
}

function psepho_prob_block(array $r): string {
    $c = psepho_call($r);
    $choice = (string) ($r['choice'] ?? '');
    $mod = $choice === 'republican_win' ? ' gop' : ($choice === 'toss_up' ? ' toss' : '');
    $pct = (int) round((float) ($r['display_pct'] ?? 0));
    $aria = $choice === 'toss_up'
        ? $pct . ' percent display for a toss-up'
        : $pct . ' percent ' . $c['prob'] . ' probability';
    return '<div class="probability' . $mod . '"><div class="bar-labels"><span>' . $c['prob'] .
        '</span><strong>' . $pct . '%</strong></div><div class="bar" role="img" aria-label="' .
        psepho_esc($aria) . '"><span style="width:' . $pct . '%"></span></div></div>';
}

function psepho_chamber_card(array $r): string {
    $c = psepho_call($r);
    $conf = (int) round(((float) ($r['confidence'] ?? 0)) * 100);
    return '<article class="card chamber-card win-' . $c['cls'] . '">' .
        '<div class="card-top"><h3>' . psepho_esc($r['label'] ?? '') . '</h3><span class="call ' . $c['cls'] . '">' .
        $c['pill'] . '</span></div>' .
        psepho_prob_block($r) .
        '<div class="metric-row"><span>Jev confidence</span><strong>' . $conf . '%</strong></div>' .
        '<p class="inputs">' . psepho_esc($r['inputs_line'] ?? '') . '.</p>' .
        '</article>';
}

function psepho_race_card(array $r): string {
    $c = psepho_call($r);
    $conf = (int) round(((float) ($r['confidence'] ?? 0)) * 100);
    return '<article class="card race-card win-' . $c['cls'] . '"><div><div class="race-top"><h3>' .
        psepho_esc($r['label'] ?? '') . '</h3><span class="call ' . $c['cls'] . '">' . $c['pill'] . '</span></div>' .
        '<p class="inputs">' . psepho_esc($r['inputs_line'] ?? '') . '.</p></div>' .
        '<div class="race-metrics">' . psepho_prob_block($r) .
        '<div class="metric-row"><span>Confidence</span><strong>' . $conf . '%</strong></div></div>' .
        '</article>';
}

function psepho_legend(): string {
    return '<div class="legend" aria-label="Call color legend">' .
        '<span><i class="d"></i>Democrat win</span>' .
        '<span><i class="r"></i>Republican win</span>' .
        '<span><i class="t"></i>Toss-up</span></div>';
}

$loaded = psepho_load_data();
$data = $loaded['data'];
$isStale = $loaded['stale'];

$groups    = is_array($data) ? ($data['groups'] ?? []) : [];
$chambers  = $groups['chambers']  ?? [];
$senate    = $groups['senate']    ?? [];
$governors = $groups['governors'] ?? [];

$modelShort = psepho_model_short(is_array($data) ? ($data['model'] ?? null) : null);
$timeLabel  = is_array($data) ? psepho_fmt_time($data['updated_at'] ?? null) : null;
$changes    = is_array($data) ? (string) ($data['changes'] ?? '') : '';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Psepho — Election Forecast</title>
<meta name="description" content="2026 US midterms, decoded. Polls + betting markets, called by the TypeSafe Jev decision model.">
<style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

    :root {
      color-scheme: light dark;
      --bg: #eef1f4;
      --surface: #ffffff;
      --surface-2: #f5f7f9;
      --ink: #111820;
      --muted: #56616c;
      --line: #d7dde3;
      --dem: #0a7b47;
      --dem-soft: #dcf6e9;
      --gop: #c63f45;
      --gop-soft: #ffeaeb;
      --toss: #8a6500;
      --toss-soft: #fff1bd;
      --live: #0a7b47;
      --live-soft: #dcf6e9;
      --shadow: 0 12px 34px rgba(16, 24, 32, .08);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #080b0f;
        --surface: #11161c;
        --surface-2: #171d24;
        --ink: #f2f5f7;
        --muted: #a6b0ba;
        --line: #29323c;
        --dem: #63daa1;
        --dem-soft: #123d2b;
        --gop: #ff7479;
        --gop-soft: #431d23;
        --toss: #f4c95d;
        --toss-soft: #403313;
        --live: #63daa1;
        --live-soft: #123d2b;
        --shadow: 0 18px 44px rgba(0, 0, 0, .34);
      }
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-width: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
      line-height: 1.45;
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: max(28px, env(safe-area-inset-top)) 0 max(48px, env(safe-area-inset-bottom));
    }
    .mast {
      border-bottom: 1px solid var(--line);
      padding: 6px 0 28px;
    }
    .status-row {
      display: flex;
      align-items: center;
      gap: 10px 14px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 5px 10px;
      border-radius: 8px;
      background: var(--live-soft);
      color: var(--live);
      font: 600 12px/1.2 "IBM Plex Mono", monospace;
      letter-spacing: .04em;
    }
    .live-badge::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 16%, transparent);
    }
    .live-badge.stale { color: var(--toss); background: var(--toss-soft); }
    .timestamp {
      color: var(--muted);
      font: 500 12px/1.4 "IBM Plex Mono", monospace;
    }
    h1 {
      max-width: 780px;
      margin: 0;
      font-size: clamp(36px, 8vw, 68px);
      line-height: .98;
      letter-spacing: -.055em;
      font-weight: 700;
    }
    .subtitle {
      max-width: 720px;
      margin: 18px 0 0;
      color: var(--muted);
      font-size: clamp(16px, 2.2vw, 20px);
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 22px;
      padding: 5px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--surface-2);
    }
    .tab {
      min-width: 0;
      border: 0;
      border-radius: 8px;
      padding: 10px 12px;
      background: transparent;
      color: var(--muted);
      font: 600 13px/1.2 "IBM Plex Sans", sans-serif;
      cursor: pointer;
    }
    .tab[aria-selected="true"] {
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 1px 5px rgba(16, 24, 32, .10);
    }
    .tab:focus-visible { outline: 2px solid var(--dem); outline-offset: 2px; }

    .changes {
      margin-top: 18px;
      padding: 14px 16px;
      border: 1px solid color-mix(in srgb, var(--toss) 38%, var(--line));
      border-radius: 12px;
      background: color-mix(in srgb, var(--toss-soft) 38%, var(--surface));
    }
    .changes strong {
      display: block;
      margin-bottom: 5px;
      color: var(--toss);
      font-size: 14px;
    }
    .changes p {
      margin: 0;
      color: var(--ink);
      font-size: 13px;
    }
    .err {
      margin-top: 18px;
      padding: 14px 16px;
      border-radius: 12px;
      background: var(--gop-soft);
      color: var(--gop);
      font-size: 13px;
      font-weight: 600;
    }
    main.panels-wrap { overflow: hidden; }
    .panels { display: flex; transition: transform .28s ease; }
    .panel { flex: 0 0 100%; min-width: 0; }
    .section { padding-top: 34px; }
    .section-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 15px;
    }
    h2 {
      margin: 0;
      font-size: clamp(22px, 3vw, 30px);
      line-height: 1.1;
      letter-spacing: -.025em;
    }
    .count {
      color: var(--muted);
      font: 500 12px/1.3 "IBM Plex Mono", monospace;
    }
    .chambers {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 15px;
    }
    .card {
      min-width: 0;
      background: var(--surface);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
    }
    .card.win-dem {
      background: color-mix(in srgb, var(--dem-soft) 24%, var(--surface));
      border-color: color-mix(in srgb, var(--dem) 30%, var(--line));
    }
    .card.win-gop {
      background: color-mix(in srgb, var(--gop-soft) 24%, var(--surface));
      border-color: color-mix(in srgb, var(--gop) 30%, var(--line));
    }
    .card.win-toss {
      background: color-mix(in srgb, var(--toss-soft) 30%, var(--surface));
      border-color: color-mix(in srgb, var(--toss) 34%, var(--line));
    }
    .chamber-card {
      padding: clamp(20px, 3vw, 30px);
      border-radius: 18px;
    }
    .card-top,
    .race-top,
    .metric-row,
    .bar-labels {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    h3 {
      margin: 0;
      font-size: clamp(20px, 2.5vw, 27px);
      line-height: 1.15;
      letter-spacing: -.025em;
    }
    .call {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 700;
    }
    .call.dem { color: var(--dem); background: var(--dem-soft); }
    .call.gop { color: var(--gop); background: var(--gop-soft); }
    .call.toss { color: var(--toss); background: var(--toss-soft); }
    .probability { margin: 24px 0 20px; }
    .bar-labels {
      margin-bottom: 9px;
      color: var(--muted);
      font: 500 12px/1.3 "IBM Plex Mono", monospace;
    }
    .bar-labels strong { color: var(--ink); font-size: 15px; }
    .bar {
      position: relative;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--gop);
    }
    .bar > span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--dem);
    }
    .probability.gop .bar { background: var(--dem); }
    .probability.gop .bar > span { background: var(--gop); }
    .probability.gop .bar-labels strong { color: var(--gop); }
    .probability.toss .bar { background: var(--surface-2); }
    .probability.toss .bar > span { background: var(--toss); }
    .probability.toss .bar-labels strong { color: var(--toss); }
    .metric-row {
      border-top: 1px solid var(--line);
      padding-top: 14px;
      color: var(--muted);
      font-size: 13px;
    }
    .metric-row strong {
      color: var(--ink);
      font: 600 14px/1.3 "IBM Plex Mono", monospace;
    }
    .inputs {
      margin: 13px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    .races {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .race-card {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(180px, .75fr);
      gap: 20px;
      align-items: center;
      padding: 19px 20px;
      border-radius: 14px;
      box-shadow: none;
    }
    .race-top {
      justify-content: flex-start;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .race-top h3 {
      font-size: 18px;
      margin-right: auto;
    }
    .race-card .inputs { margin-top: 9px; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .legend i { width: 9px; height: 9px; border-radius: 50%; }
    .legend .d { background: var(--dem); }
    .legend .r { background: var(--gop); }
    .legend .t { background: var(--toss); }
    footer {
      margin-top: 36px;
      padding-top: 22px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    footer p { margin: 0 0 8px; }

    @media (max-width: 860px) {
      .races { grid-template-columns: 1fr; }
    }
    @media (max-width: 660px) {
      .wrap { width: min(100% - 22px, 1120px); }
      .mast { padding-bottom: 23px; }
      h1 { font-size: clamp(38px, 13vw, 54px); }
      .chambers { grid-template-columns: 1fr; }
      .section { padding-top: 28px; }
      .section-head { align-items: start; flex-direction: column; gap: 8px; }
      .race-card { grid-template-columns: 1fr; gap: 16px; padding: 17px 16px; }
      .call { font-size: 11px; }
      .card-top { align-items: flex-start; flex-direction: column; }
      .chamber-card .call { margin-top: 2px; }
      .tab { padding: 9px 4px; font-size: 11px; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      .panels { transition: none; }
    }
</style>
</head>
<body>
<main class="wrap">
  <header class="mast">
    <div class="status-row">
      <span class="live-badge<?php echo $isStale ? ' stale' : ''; ?>">CURRENT · <?php echo psepho_esc($modelShort); ?></span>
      <span class="timestamp"><?php echo $timeLabel !== null
          ? 'Last updated: ' . psepho_esc($timeLabel) . ' · data refreshes every 2 hours'
          : 'Update time unknown'; ?></span>
    </div>
    <h1>Psepho — Election Forecast</h1>
    <p class="subtitle">2026 midterms, decoded — fresh Jev calls every two hours, no crystal ball required</p>
  </header>

  <nav class="tabs" role="tablist" aria-label="Forecast sections" id="tabBar">
    <button class="tab" type="button" role="tab" aria-selected="true" data-i="0">Chambers</button>
    <button class="tab" type="button" role="tab" aria-selected="false" data-i="1" tabindex="-1">Senate races</button>
    <button class="tab" type="button" role="tab" aria-selected="false" data-i="2" tabindex="-1">Governors</button>
  </nav>

<?php if ($changes !== ''): ?>
  <aside class="changes">
    <strong>Latest changes</strong>
    <p><?php echo psepho_esc($changes); ?></p>
  </aside>
<?php endif; ?>

<?php if ($data === null): ?>
  <div class="err">Couldn&rsquo;t reach fresh data — please check back in a few minutes.</div>
<?php else: ?>
  <main class="panels-wrap">
    <div class="panels" id="panels">
      <section class="panel" id="panel-0">
        <div class="section">
          <div class="section-head"><h2>Chambers</h2><?php echo psepho_legend(); ?></div>
          <div class="chambers"><?php foreach ($chambers as $r) { echo psepho_chamber_card($r); } ?></div>
        </div>
      </section>
      <section class="panel" id="panel-1">
        <div class="section">
          <div class="section-head"><h2>Senate races</h2><span class="count"><?php echo count($senate); ?> races · Winner probability shown</span></div>
          <div class="races"><?php foreach ($senate as $r) { echo psepho_race_card($r); } ?></div>
        </div>
      </section>
      <section class="panel" id="panel-2">
        <div class="section">
          <div class="section-head"><h2>Governors</h2><span class="count"><?php echo count($governors); ?> races · Winner probability shown</span></div>
          <div class="races"><?php foreach ($governors as $r) { echo psepho_race_card($r); } ?></div>
        </div>
      </section>
    </div>
  </main>
<?php endif; ?>

  <footer>
    <p><?php echo $timeLabel !== null
        ? 'Data from the ' . psepho_esc($timeLabel) . ' ' . psepho_esc($modelShort) . ' run.'
        : 'Forecast data.'; ?> · Sources: Wikipedia polls and Polymarket markets.</p>
    <p>A model reading polls is not a poll — treat it as a smart average, not a prophecy.</p>
  </footer>
</main>
<script>
(function () {
  "use strict";
  var panelsEl = document.getElementById("panels");
  if (!panelsEl) return;
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var current = 0;
  var startX = null;

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
})();
</script>
</body>
</html>
