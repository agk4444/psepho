// Tiny file cache: data/cache.json, per-key TTLs.
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'cache.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(all) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(all, null, 1));
}

function get(key, ttlSec) {
  const all = load();
  const e = all[key];
  if (!e) return null;
  if (Date.now() - e.ts > ttlSec * 1000) return null;
  return e.value;
}

function set(key, value) {
  const all = load();
  all[key] = { ts: Date.now(), value };
  save(all);
}

module.exports = { get, set };
