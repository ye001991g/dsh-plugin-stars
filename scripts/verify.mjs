#!/usr/bin/env node
/**
 * Smoke-test a published index: fetch it and run DSH's own format-1 validator.
 *
 * Usage:
 *   node scripts/verify.mjs                                   # the published URL
 *   node scripts/verify.mjs <url-or-local-file>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';

if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  process.env.NODE_USE_ENV_PROXY = '1';
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED_INDEX_URL = 'https://cdn.jsdelivr.net/gh/ye001991g/dsh-plugin-stars@main/index.json';
const DEFAULT_TARGET = PUBLISHED_INDEX_URL;

async function load(target) {
  if (/^https?:\/\//u.test(target)) {
    const response = await fetch(target, { headers: { 'user-agent': 'dsh-plugin-stars-verify/1.0' } });
    if (!response.ok) throw new Error(`${target} -> HTTP ${response.status}`);
    return { index: await response.json(), indexUrl: target };
  }
  const file = path.resolve(ROOT, target);
  return { index: JSON.parse(await fs.readFile(file, 'utf8')), indexUrl: target.startsWith('file:') ? target : `file://${file}` };
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const target = process.argv[2] ?? DEFAULT_TARGET;
  const { index, indexUrl } = await load(target);
  const parsed = parseMarketIndex(index, indexUrl);

  const stars = parsed.plugins
    .map((plugin) => plugin.metadata.sortKeys.stars)
    .filter((value) => Number.isFinite(value));
  const downloads = parsed.plugins.filter((plugin) => Number.isFinite(plugin.metadata.sortKeys.downloads)).length;

  check(parsed.format === 1, 'format must be 1');
  check(parsed.plugins.length > 0, 'index has no plugins');
  check(Object.hasOwn(parsed.metadata.sortKeys, 'stars'), 'stars sort key is missing');
  check(Object.hasOwn(parsed.metadata.sortKeys, 'downloads'), 'downloads sort key is missing');
  check(stars.length > 0, 'no plugin carries a stars value');
  check(
    parsed.plugins.every((plugin, i) => i === 0 || (parsed.plugins[i - 1].metadata.sortKeys.stars ?? -1) >= (plugin.metadata.sortKeys.stars ?? -1)),
    'plugins are not sorted by stars (descending)',
  );
  const starAuthors = parsed.plugins.filter((plugin) => typeof plugin.author === 'string' && plugin.author.includes('★')).length;
  check(starAuthors > 0, 'no author line carries a ★ value');

  const top = parsed.plugins
    .filter((plugin) => Number.isFinite(plugin.metadata.sortKeys.stars))
    .slice(0, 5)
    .map((plugin) => `${plugin.name} ${plugin.metadata.sortKeys.stars}★`);
  process.stdout.write(
    [
      `VALID ${indexUrl}`,
      `plugins:   ${parsed.plugins.length}`,
      `stars:     ${stars.length} values, ${Math.min(...stars)}..${Math.max(...stars)}`,
      `downloads: ${downloads} values`,
      `authors:   ${starAuthors} carry ★`,
      `top 5:     ${top.join(', ')}`,
    ].join('\n') + '\n',
  );
}

main().catch((error) => {
  process.stderr.write(`verify failed: ${error.message}\n`);
  process.exitCode = 1;
});
