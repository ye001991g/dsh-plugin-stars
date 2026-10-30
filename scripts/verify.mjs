#!/usr/bin/env node
/**
 * Smoke-test a published index: fetch it and run DSH's own format-1 validator,
 * then assert the presentation invariants this index promises.
 *
 * Node's fetch only reads HTTPS_PROXY when NODE_USE_ENV_PROXY was set before the
 * process started (or `--use-env-proxy` was passed), so the caller must set it:
 *   NODE_USE_ENV_PROXY=1 npm run verify
 *
 * Usage:
 *   node scripts/verify.mjs                      # the published jsDelivr URL
 *   node scripts/verify.mjs index.json           # a local file
 *   node scripts/verify.mjs https://.../index.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED_INDEX_URL = 'https://cdn.jsdelivr.net/gh/ye001991g/dsh-plugin-stars@main/index.json';
const FETCH_TIMEOUT_MS = 120_000;

function assertProxyWiring(target) {
  if (!/^https?:\/\//u.test(target)) return;
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.ALL_PROXY ?? process.env.all_proxy;
  const enabled = /^(?:1|true)$/iu.test(process.env.NODE_USE_ENV_PROXY ?? '');
  if (proxy !== undefined && !enabled) {
    throw new Error(
      'HTTPS_PROXY is set but Node fetch will ignore it: re-run with NODE_USE_ENV_PROXY=1 ' +
        '(PowerShell: $env:NODE_USE_ENV_PROXY="1"; npm run verify) or `node --use-env-proxy scripts/verify.mjs`.',
    );
  }
}

/** Mirrors `formatCount` in build.mjs so the ★ text can be re-derived from the value. */
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

async function load(target) {
  if (/^https?:\/\//u.test(target)) {
    const response = await fetch(target, {
      headers: { 'user-agent': 'dsh-plugin-stars-verify/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${target} -> HTTP ${response.status}`);
    return { index: await response.json(), indexUrl: target };
  }
  const file = path.resolve(ROOT, target);
  return { index: JSON.parse(await fs.readFile(file, 'utf8')), indexUrl: pathToFileURL(file).href };
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const target = process.argv[2] ?? PUBLISHED_INDEX_URL;
  assertProxyWiring(target);

  const { index, indexUrl } = await load(target);
  const parsed = parseMarketIndex(index, indexUrl);

  const counts = { positive: 0, zero: 0, missing: 0 };
  let starAuthors = 0;
  let expectedStarAuthors = 0;
  for (const plugin of parsed.plugins) {
    const stars = plugin.metadata.sortKeys.stars;
    if (!Number.isFinite(stars)) counts.missing += 1;
    else if (stars > 0) counts.positive += 1;
    else counts.zero += 1;

    const expected = Number.isFinite(stars) && stars > 0 ? `★${formatCount(stars)}` : undefined;
    if (typeof plugin.author === 'string' && plugin.author.includes('★')) starAuthors += 1;
    if (expected === undefined) {
      // 0/unknown stars must not carry a fake ★ marker.
      check(
        !(typeof plugin.author === 'string' && plugin.author.includes('★')),
        `${plugin.name}: unexpected ★ in author`,
      );
    } else {
      expectedStarAuthors += 1;
      check(
        typeof plugin.author === 'string' && plugin.author.endsWith(expected),
        `${plugin.name}: author ${JSON.stringify(plugin.author)} does not end with ${expected}`,
      );
    }
  }

  check(parsed.format === 1, 'format must be 1');
  check(parsed.plugins.length > 0, 'index has no plugins');
  check(Object.hasOwn(parsed.metadata.sortKeys, 'stars'), 'stars sort key is missing');
  check(Object.hasOwn(parsed.metadata.sortKeys, 'downloads'), 'downloads sort key is missing');
  check(counts.positive > 0, 'no plugin carries a positive stars value');
  check(
    parsed.plugins.every(
      (plugin, i) =>
        i === 0 || (parsed.plugins[i - 1].metadata.sortKeys.stars ?? -1) >= (plugin.metadata.sortKeys.stars ?? -1),
    ),
    'plugins are not sorted by stars (descending)',
  );
  check(starAuthors === expectedStarAuthors, `★ author count ${starAuthors} != plugins with positive stars ${expectedStarAuthors}`);

  const top = parsed.plugins
    .filter((plugin) => Number.isFinite(plugin.metadata.sortKeys.stars) && plugin.metadata.sortKeys.stars > 0)
    .slice(0, 5)
    .map((plugin) => `${plugin.name} ${plugin.metadata.sortKeys.stars}★`);
  process.stdout.write(
    [
      `VALID ${indexUrl}`,
      `plugins:   ${parsed.plugins.length}`,
      `stars:     ${counts.positive} positive, ${counts.zero} zero, ${counts.missing} missing`,
      `authors:   ${starAuthors} carry ★ (all consistent with sortKeys.stars)`,
      `top 5:     ${top.join(', ')}`,
    ].join('\n') + '\n',
  );
}

main().catch((error) => {
  process.stderr.write(`verify failed: ${error.message}\n`);
  process.exitCode = 1;
});
