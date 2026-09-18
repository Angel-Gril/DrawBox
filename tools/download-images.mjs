#!/usr/bin/env node
/**
 * Download every image referenced by DrawBox JSON data.
 *
 * Usage:
 *   node tools/download-images.mjs --origin https://example.com --out images-source
 *
 * The script keeps the original relative paths such as images/originals/1.jpg.
 * It is resumable: existing non-empty files are skipped unless --overwrite is set.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const argv = process.argv.slice(2);

function getArg(name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

function hasFlag(name) {
  return argv.includes(`--${name}`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function positiveInt(value, fallback, label) {
  if (value == null || value === true) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${label} must be a positive integer`);
  return parsed;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeRelativeUrl(relativePath) {
  return relativePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

async function collectImagePaths(dataDir) {
  const entries = await fsp.readdir(dataDir, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && /^(?:list|prompts)\.part\d+\.json$/i.test(entry.name))
    .map(entry => path.join(dataDir, entry.name))
    .sort();

  if (!files.length) fail(`no list.part*.json or prompts.part*.json files found in ${dataDir}`);

  const refs = new Set();
  for (const file of files) {
    const data = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (!Array.isArray(data)) fail(`${file} does not contain a JSON array`);
    for (const item of data) {
      if (typeof item?.image === 'string' && item.image.trim()) refs.add(item.image.trim().replaceAll('\\', '/'));
    }
  }
  return [...refs].sort();
}

function validateRelativePath(relativePath) {
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) {
    fail(`unsafe image path in data: ${relativePath}`);
  }
  if (!normalized.startsWith('images/')) fail(`image path must start with images/: ${relativePath}`);
  return normalized;
}

async function downloadOne(origin, outDir, relativePath, options) {
  const safePath = validateRelativePath(relativePath);
  const destination = path.join(outDir, ...safePath.split('/'));
  const temp = `${destination}.part`;

  if (!options.overwrite) {
    try {
      const stat = await fsp.stat(destination);
      if (stat.isFile() && stat.size > 0) return { skipped: true, bytes: stat.size };
    } catch {
      // File does not exist yet.
    }
  }

  const url = new URL(encodeRelativeUrl(safePath), origin.endsWith('/') ? origin : `${origin}/`);
  let lastError;

  for (let attempt = 1; attempt <= options.retries; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { 'user-agent': 'DrawBox-image-migrator/1.0' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      if (!response.body) throw new Error('response body is empty');

      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
      const stat = await fsp.stat(temp);
      if (!stat.size) throw new Error('downloaded file is empty');
      await fsp.rm(destination, { force: true });
      await fsp.rename(temp, destination);
      return { bytes: stat.size };
    } catch (error) {
      lastError = error;
      await fsp.rm(temp, { force: true }).catch(() => {});
      if (attempt < options.retries) await sleep(Math.min(800 * attempt, 4000));
    }
  }

  throw new Error(`${safePath}: ${lastError?.message || 'download failed'}`);
}

async function main() {
  const originArg = getArg('origin');
  if (!originArg || originArg === true) fail('--origin is required, for example: --origin https://example.com');

  let origin;
  try {
    origin = new URL(String(originArg)).origin;
  } catch {
    fail(`invalid --origin URL: ${originArg}`);
  }

  const projectDir = path.resolve(getArg('project', process.cwd()));
  const dataDir = path.resolve(projectDir, getArg('data', 'data'));
  const outDir = path.resolve(projectDir, getArg('out', 'images-source'));
  const concurrency = positiveInt(getArg('concurrency'), 6, '--concurrency');
  const retries = positiveInt(getArg('retries'), 3, '--retries');
  const timeoutMs = positiveInt(getArg('timeout-ms'), 60000, '--timeout-ms');
  const limit = positiveInt(getArg('limit'), 0, '--limit');
  const overwrite = hasFlag('overwrite');

  let refs = await collectImagePaths(dataDir);
  if (limit) refs = refs.slice(0, limit);

  await fsp.mkdir(outDir, { recursive: true });

  console.log(`Source: ${origin}`);
  console.log(`Output: ${outDir}`);
  console.log(`Images: ${refs.length}, concurrency: ${concurrency}`);
  if (overwrite) console.log('Existing files will be overwritten.');

  let nextIndex = 0;
  let downloaded = 0;
  let skipped = 0;
  let downloadedBytes = 0;
  const failures = [];

  async function worker(workerId) {
    while (true) {
      const index = nextIndex++;
      if (index >= refs.length) return;
      const relativePath = refs[index];

      try {
        const result = await downloadOne(origin, outDir, relativePath, {
          overwrite,
          retries,
          timeoutMs
        });
        if (result.skipped) {
          skipped++;
        } else {
          downloaded++;
          downloadedBytes += result.bytes;
        }

        const done = downloaded + skipped;
        if (done % 25 === 0 || done === refs.length) {
          console.log(`[${done}/${refs.length}] downloaded=${downloaded} skipped=${skipped}`);
        }
      } catch (error) {
        failures.push(error.message);
        console.error(`[worker ${workerId}] ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, (_, index) => worker(index + 1)));

  console.log('');
  console.log(`Downloaded: ${downloaded} (${(downloadedBytes / 1024 / 1024).toFixed(1)} MiB)`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failures.length}`);
  if (failures.length) {
    console.log('Failed paths are listed above. Re-run the same command to retry only missing files.');
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});