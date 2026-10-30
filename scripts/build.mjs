#!/usr/bin/env node
/**
 * Build a format-1 DSH plugin market index from the `dsh-plugin-catalog` data,
 * enriched with GitHub stars and npm downloads.
 *
 * Source (upstream, published daily by awesome-dsh-plugin.com):
 *   - index.json    format-1 market index of npm-installable DSH plugins
 *   - plugins.json  full curated list with stars / downloads / install hints
 *
 * Output: ./index.json — same plugins, plus:
 *   - metadata.sortKeys: `stars` (GitHub stars) and `downloads` (npm, last 30 days),
 *     both declared `desc`, so the market's sort menu can order by popularity.
 *   - per-plugin metadata.sortKeys values.
 *   - `author` written as "<owner> · ★<stars>" (stars > 0) because the market card
 *     renders author inside its meta line (`{version} · {author} · {date}`) and
 *     format 1 has no dedicated numeric field; this is the only slot that shows on
 *     a card. Plugins with 0/unknown stars keep the bare owner.
 *   - plugins sorted by stars desc (then downloads desc, then name), so the
 *     market's default order is popularity order.
 *
 * Guards (fail instead of publishing a bad index):
 *   - DSH's own validator (@deepseek-ai/dsh-plugin-market-index) rejects a
 *     malformed index, and nothing is written unless it passes.
 *   - >5% day-over-day shrink of the plugin count aborts.
 *   - <90% join rate against the curated list, or <90% of joined plugins without
 *     a numeric star value, aborts: a silent "no stars anywhere" index is a
 *     feature break, not a valid build.
 *
 * Usage (Node >= 22.21; set NODE_USE_ENV_PROXY=1 when you need HTTPS_PROXY):
 *   NODE_USE_ENV_PROXY=1 npm run build
 *   node --use-env-proxy scripts/build.mjs --version 2026.1030.12510
 *   node scripts/build.mjs --source-dir <dir>   # offline: index.json + plugins.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PACKAGE = 'dsh-plugin-catalog';
const SOURCE_SITE = 'https://awesome-dsh-plugin.com';
const PUBLISHED_INDEX_URL = 'https://cdn.jsdelivr.net/gh/ye001991g/dsh-plugin-stars@main/index.json';
const USER_AGENT = 'dsh-plugin-stars-build/1.0 (+https://github.com/ye001991g/dsh-plugin-stars)';
const MAX_SHRINK_RATIO = 0.95;
const MIN_JOINED_RATIO = 0.9;
const MIN_STARRED_RATIO = 0.9;
const FETCH_TIMEOUT_MS = 120_000;

/**
 * Node's fetch only reads HTTPS_PROXY when NODE_USE_ENV_PROXY was set before the
 * process started (or `--use-env-proxy` was passed); setting it here is too late.
 * Fail early with the fix instead of silently fetching direct.
 */
function assertProxyWiring() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.ALL_PROXY ?? process.env.all_proxy;
  const enabled = /^(?:1|true)$/iu.test(process.env.NODE_USE_ENV_PROXY ?? '');
  if (proxy !== undefined && !enabled) {
    throw new Error(
      'HTTPS_PROXY is set but Node fetch will ignore it: re-run with NODE_USE_ENV_PROXY=1 ' +
        '(PowerShell: $env:NODE_USE_ENV_PROXY="1"; npm run build) or `node --use-env-proxy scripts/build.mjs`.',
    );
  }
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

/** npm-file mirrors, tried in order. */
const CDNS = [
  (version, file) => `https://cdn.jsdelivr.net/npm/${SOURCE_PACKAGE}@${version}/${file}`,
  (version, file) => `https://unpkg.com/${SOURCE_PACKAGE}@${version}/${file}`,
];

async function fetchPackageFile(version, file) {
  const errors = [];
  for (const url of CDNS.map((cdn) => cdn(version, file))) {
    try {
      return await fetchJson(url);
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`cannot fetch ${file}@${version}\n${errors.join('\n')}`);
}

/** Resolve `version` (or npm's latest) and load upstream data for exactly that version. */
async function loadRemote(version) {
  let resolved = version;
  if (resolved === undefined) {
    resolved = (await fetchJson(`https://registry.npmjs.org/${SOURCE_PACKAGE}/latest`)).version;
  } else {
    // Fail loudly for a version that does not exist, instead of silently building `latest`.
    await fetchJson(`https://registry.npmjs.org/${SOURCE_PACKAGE}/${encodeURIComponent(resolved)}`);
  }
  const [index, full] = await Promise.all([
    fetchPackageFile(resolved, 'index.json'),
    fetchPackageFile(resolved, 'plugins.json'),
  ]);
  return { version: resolved, index, full };
}

async function loadLocal(dir) {
  const read = async (name) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
  const [index, full] = await Promise.all([read('index.json'), read('plugins.json')]);
  return { version: `local:${path.basename(dir)}`, index, full };
}

/** "12345" -> "12.3k"; 1000 -> "1k"; 1234567 -> "1.2M". Values below 1000 stay exact. */
function formatCount(value) {
  if (!Number.isFinite(value)) return undefined;
  const abs = Math.abs(value);
  for (const [size, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) {
    if (abs >= size) {
      const scaled = abs / size;
      const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/u, '');
      return `${value < 0 ? '-' : ''}${text}${suffix}`;
    }
  }
  return String(value);
}

/** `https://github.com/owner/repo(.git)?...` -> `owner/repo` lowercased, else undefined. */
function repoKey(url) {
  if (typeof url !== 'string') return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return undefined;
    const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return undefined;
    return `${owner}/${repo.replace(/\.git$/u, '')}`.toLowerCase();
  } catch {
    return undefined;
  }
}

function ownerOf(url) {
  const key = repoKey(url);
  return key === undefined ? undefined : key.split('/')[0];
}

/** Code-point tie-break: deterministic regardless of the runner's locale. */
function compareName(left, right) {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

function enrich(index, full) {
  const byPage = new Map(full.plugins.map((plugin) => [plugin.page, plugin]));
  const byRepo = new Map();
  // Upstream snapshots per plugin entry can disagree for the same repository; use the
  // highest value seen for that repository so one repo always shows one star count.
  const repoMaxStars = new Map();
  for (const plugin of full.plugins) {
    const key = repoKey(plugin.url);
    if (key === undefined || typeof plugin.stars !== 'number' || !Number.isFinite(plugin.stars)) continue;
    repoMaxStars.set(key, Math.max(repoMaxStars.get(key) ?? 0, plugin.stars));
    if (!byRepo.has(key)) byRepo.set(key, plugin);
  }

  let joined = 0;
  let withDownloads = 0;
  const plugins = index.plugins.map((entry) => {
    const match =
      (entry.homepage === undefined ? undefined : byPage.get(entry.homepage)) ??
      byRepo.get(repoKey(entry.repository?.url));
    const key = match === undefined ? repoKey(entry.repository?.url) : repoKey(match.url);
    const stars =
      key === undefined || !repoMaxStars.has(key)
        ? undefined
        : repoMaxStars.get(key);
    const downloads =
      typeof match?.downloads === 'number' && Number.isFinite(match.downloads) ? match.downloads : undefined;
    if (match !== undefined) joined += 1;
    if (downloads !== undefined) withDownloads += 1;

    const owner = match?.owner ?? ownerOf(entry.repository?.url);
    // Only positive stars earn a ★ marker: a quarter of the list has 0 stars and a
    // wall of "★0" reads like "all of these are bad".
    const starText = stars !== undefined && stars > 0 ? `★${formatCount(stars)}` : undefined;
    // Format 1 has no numeric display slot; the card's meta line is `{version} · {author} · {date}`,
    // so the stars ride along in `author` next to the GitHub owner.
    const author = owner === undefined ? starText : starText === undefined ? owner : `${owner} · ${starText}`;

    const sortKeys = {};
    if (stars !== undefined) sortKeys.stars = stars;
    if (downloads !== undefined) sortKeys.downloads = downloads;

    return {
      ...entry,
      ...(author === undefined ? {} : { author }),
      metadata: { ...(entry.metadata ?? {}), sortKeys },
    };
  });

  plugins.sort(
    (left, right) =>
      (right.metadata.sortKeys.stars ?? -1) - (left.metadata.sortKeys.stars ?? -1) ||
      (right.metadata.sortKeys.downloads ?? -1) - (left.metadata.sortKeys.downloads ?? -1) ||
      compareName(left, right),
  );

  return { plugins, joined, withDownloads };
}

function compose(source) {
  const { plugins, joined, withDownloads } = enrich(source.index, source.full);
  const upstream = source.version;
  const index = {
    format: 1,
    title: { en: 'Awesome DSH Plugins — by GitHub stars', zh: 'DSH 插件榜 · 按 GitHub 星数' },
    description: {
      en:
        `Enriched mirror of ${SOURCE_SITE}'s format-1 index: npm-installable DSH plugins, ` +
        `sorted by GitHub stars, with npm 30-day downloads. Upstream ${upstream}.`,
      zh:
        `awesome-dsh-plugin.com 精选列表的增强镜像：npm 可安装的 DSH 插件，按 GitHub 星数排序，` +
        `附 npm 近 30 天下载量。上游版本 ${upstream}。`,
    },
    metadata: {
      categories: source.index.metadata?.categories ?? {},
      labels: source.index.metadata?.labels ?? {},
      sortKeys: {
        stars: { title: { en: 'GitHub stars', zh: 'GitHub 星数' }, order: 'desc' },
        downloads: { title: { en: 'npm downloads (30 days)', zh: 'npm 下载量（近 30 天）' }, order: 'desc' },
      },
    },
    plugins,
  };
  return { index, upstream, joined, withDownloads };
}

/**
 * One plugin per line keeps the daily commit diff reviewable: the index is the
 * trust root for what the market offers to install, so "one 3.4 MB line changed"
 * is not an auditable review unit.
 */
function serialize(index) {
  const { plugins, ...head } = index;
  const headText = JSON.stringify(head, null, 2);
  const headBody = headText.slice(0, -2); // drop the trailing "\n}"
  const pluginLines = plugins.map((plugin) => `    ${JSON.stringify(plugin)}`).join(',\n');
  return `${headBody},\n  "plugins": [\n${pluginLines}\n  ]\n}\n`;
}

/** Refuse a day-over-day collapse; a broken upstream release must not be published. */
async function assertNoShrink(nextCount) {
  let previous;
  try {
    previous = JSON.parse(await fs.readFile(path.join(ROOT, 'index.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const previousCount = Array.isArray(previous.plugins) ? previous.plugins.length : 0;
  if (previousCount > 0 && nextCount < previousCount * MAX_SHRINK_RATIO) {
    const percent = ((1 - nextCount / previousCount) * 100).toFixed(1);
    throw new Error(
      `refusing to publish a ${percent}% shrink: ${previousCount} -> ${nextCount} plugins ` +
        `(threshold ${((1 - MAX_SHRINK_RATIO) * 100).toFixed(0)}%)`,
    );
  }
}

/** A "valid but starless" index means the upstream join broke; fail loudly. */
function assertCoverage(composed) {
  const total = composed.index.plugins.length;
  // Numeric stars include 0: a fifth of the curated list legitimately has no stars yet.
  const numeric = composed.index.plugins.filter((plugin) =>
    Number.isFinite(plugin.metadata.sortKeys.stars),
  ).length;
  if (total > 0 && composed.joined < total * MIN_JOINED_RATIO) {
    throw new Error(
      `refusing to publish: only ${composed.joined}/${total} plugins joined the curated list ` +
        `(minimum ${(MIN_JOINED_RATIO * 100).toFixed(0)}%); upstream page/homepage keys probably changed`,
    );
  }
  if (composed.joined > 0 && numeric < composed.joined * MIN_STARRED_RATIO) {
    throw new Error(
      `refusing to publish: only ${numeric}/${composed.joined} joined plugins carry a numeric star count ` +
        `(minimum ${(MIN_STARRED_RATIO * 100).toFixed(0)}%); upstream stars field probably changed`,
    );
  }
}

function summarize(parsed, extra) {
  const stars = parsed.plugins.map((plugin) => plugin.metadata.sortKeys.stars).filter(Number.isFinite);
  const range = stars.length === 0 ? 'n/a' : `${Math.min(...stars)}..${Math.max(...stars)}`;
  const top = parsed.plugins
    .filter((plugin) => Number.isFinite(plugin.metadata.sortKeys.stars) && plugin.metadata.sortKeys.stars > 0)
    .slice(0, 8)
    .map((plugin) => `${plugin.name} (${plugin.metadata.sortKeys.stars}★)`);
  const starred = parsed.plugins.filter(
    (plugin) => Number.isFinite(plugin.metadata.sortKeys.stars) && plugin.metadata.sortKeys.stars > 0,
  ).length;
  const numeric = parsed.plugins.filter((plugin) => Number.isFinite(plugin.metadata.sortKeys.stars)).length;
  return [
    `upstream:       ${extra.upstream}`,
    `plugins:        ${parsed.plugins.length}`,
    `joined to full: ${extra.joined} (${extra.joined > 0 ? ((extra.joined / parsed.plugins.length) * 100).toFixed(1) : '0'}%), ` +
      `${extra.withDownloads} with downloads`,
    `stars:          ${numeric} numeric (${starred} positive), range ${range}`,
    `top 8:          ${top.join(', ')}`,
  ].join('\n');
}

async function main() {
  assertProxyWiring();

  const sourceDir = arg('source-dir');
  const source =
    sourceDir === undefined
      ? await loadRemote(arg('version'))
      : await loadLocal(path.resolve(sourceDir));

  const composed = compose(source);
  assertCoverage(composed);
  // Validate with DSH's own validator; also normalizes (drops unknown members, sorts versions).
  const parsed = parseMarketIndex(composed.index, PUBLISHED_INDEX_URL);
  await assertNoShrink(parsed.plugins.length);

  const outputPath = path.join(ROOT, 'index.json');
  await fs.writeFile(outputPath, serialize(parsed));
  const { size } = await fs.stat(outputPath);

  process.stdout.write(`${summarize(parsed, composed)}\n`);
  process.stdout.write(`wrote ${path.relative(process.cwd(), outputPath)} (${(size / 1024 / 1024).toFixed(2)} MiB)\n`);
}

main().catch((error) => {
  process.stderr.write(`build failed: ${error.stack ?? String(error)}\n`);
  process.exitCode = 1;
});
