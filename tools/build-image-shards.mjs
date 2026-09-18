#!/usr/bin/env node
/**
 * Split a local image tree into GitHub Pages-sized shards.
 *
 * Dry run:
 *   node tools/build-image-shards.mjs --source images-source
 *
 * Apply: copy files into image-shards/<repo>/ and update data/image-map.json
 *   node tools/build-image-shards.mjs --source images-source --apply --owner YOUR_GITHUB_NAME
 *
 * Paths are preserved, so images/originals/1.jpg remains:
 *   <repo>/images/originals/1.jpg
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

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

function positiveNumber(value, fallback, label) {
  if (value == null || value === true) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`${label} must be a positive number`);
  return parsed;
}

function positiveInt(value, fallback, label) {
  const parsed = positiveNumber(value, fallback, label);
  if (!Number.isInteger(parsed)) fail(`${label} must be an integer`);
  return parsed;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

async function walkFiles(root) {
  const output = [];
  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        output.push(fullPath);
      }
    }
  }
  await walk(root);
  return output;
}

function validateRelativePath(relativePath) {
  const normalized = path.posix.normalize(relativePath);
  if (normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) {
    fail(`unsafe source path: ${relativePath}`);
  }
  if (!normalized.startsWith('images/')) {
    fail(`expected source files under images/; found: ${relativePath}`);
  }
  return normalized;
}

function createBins(explicitCount) {
  if (!explicitCount) return [];
  return Array.from({ length: explicitCount }, (_, index) => ({
    index,
    files: [],
    bytes: 0
  }));
}

function bestFitBin(bins, fileSize, capacity, allowNew) {
  let candidate = null;
  for (const bin of bins) {
    if (capacity - bin.bytes >= fileSize) {
      if (!candidate || capacity - bin.bytes < capacity - candidate.bytes) candidate = bin;
    }
  }
  if (candidate) return candidate;
  if (!allowNew) return null;
  const bin = { index: bins.length, files: [], bytes: 0 };
  bins.push(bin);
  return bin;
}

async function copyShardFiles(sourceDir, outDir, repositories, overwrite) {
  let copied = 0;
  let skipped = 0;

  for (const repo of repositories) {
    const repoDir = path.join(outDir, repo.name);
    await fsp.mkdir(repoDir, { recursive: true });

    for (const file of repo.files) {
      const source = path.join(sourceDir, ...file.path.split('/'));
      const destination = path.join(repoDir, ...file.path.split('/'));
      await fsp.mkdir(path.dirname(destination), { recursive: true });

      let shouldCopy = overwrite;
      if (!shouldCopy) {
        try {
          const stat = await fsp.stat(destination);
          shouldCopy = !stat.isFile() || stat.size !== file.bytes;
        } catch {
          shouldCopy = true;
        }
      }

      if (shouldCopy) {
        await fsp.copyFile(source, destination);
        copied++;
      } else {
        skipped++;
      }
    }

    await fsp.writeFile(path.join(repoDir, '.nojekyll'), '', 'utf8');
    await fsp.writeFile(
      path.join(repoDir, 'README.md'),
      `# ${repo.name}\n\nDrawBox static image shard. GitHub Pages serves the files under \`images/\` in this repository.\n`,
      'utf8'
    );
  }

  return { copied, skipped };
}

async function main() {
  const sourceArg = getArg('source');
  if (!sourceArg || sourceArg === true) fail('--source is required, for example: --source images-source');

  const projectDir = path.resolve(getArg('project', process.cwd()));
  const sourceDir = path.resolve(projectDir, String(sourceArg));
  const outDir = path.resolve(projectDir, getArg('out', 'image-shards'));
  const mapPath = path.resolve(projectDir, getArg('map', 'data/image-map.json'));
  const planPath = path.resolve(projectDir, getArg('plan', 'tools/image-shard-plan.json'));
  const repoSizeMiB = positiveNumber(getArg('repo-size-mib'), 450, '--repo-size-mib');
  const maxFileMiB = positiveNumber(getArg('max-file-mib'), 95, '--max-file-mib');
  const limit = positiveInt(getArg('limit'), 0, '--limit');
  const prefix = String(getArg('prefix', 'drawbox-img'));
  const repoCountArg = getArg('repos', 'auto');
  const explicitRepos = repoCountArg === 'auto' ? 0 : positiveInt(repoCountArg, 0, '--repos');
  const apply = hasFlag('apply');
  const overwrite = hasFlag('overwrite');

  if (sourceDir === outDir) fail('--source and --out must be different directories');
  if (repoSizeMiB > 990) console.warn('Warning: --repo-size-mib above 990 leaves almost no room under the GitHub Pages 1 GB published-site limit.');
  if (repoSizeMiB > 800) console.warn('Warning: shards above 800 MiB leave very little margin under GitHub Pages and Git repository size recommendations.');

  const sourceStat = await fsp.stat(sourceDir).catch(() => null);
  if (!sourceStat?.isDirectory()) fail(`source directory not found: ${sourceDir}`);

  const allFiles = await walkFiles(sourceDir);
  if (!allFiles.length) fail(`no supported image files found in ${sourceDir}`);

  let files = [];
  for (const fullPath of allFiles) {
    const stat = await fsp.stat(fullPath);
    const relativePath = validateRelativePath(path.relative(sourceDir, fullPath).split(path.sep).join('/'));
    files.push({ path: relativePath, bytes: stat.size });
  }

  files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  if (limit) files = files.slice(0, limit);

  const maxFileBytes = maxFileMiB * 1024 ** 2;
  const tooLarge = files.filter(file => file.bytes > maxFileBytes);
  if (tooLarge.length) {
    fail(`${tooLarge.length} file(s) exceed ${maxFileMiB} MiB and may be rejected by GitHub: ${tooLarge.slice(0, 5).map(file => file.path).join(', ')}`);
  }

  const capacity = repoSizeMiB * 1024 ** 2;
  const bins = createBins(explicitRepos);

  for (const file of files) {
    const bin = bestFitBin(bins, file.bytes, capacity, !explicitRepos || bins.length < explicitRepos);
    if (!bin) fail(`cannot fit all files with --repos ${explicitRepos}; increase the repo count or --repo-size-mib`);
    bin.files.push(file);
    bin.bytes += file.bytes;
  }

  const width = Math.max(2, String(bins.length).length);
  const repositories = bins
    .filter(bin => bin.files.length)
    .map((bin, index) => ({
      name: `${prefix}-${String(index + 1).padStart(width, '0')}`,
      bytes: bin.bytes,
      fileCount: bin.files.length,
      files: bin.files.slice().sort((a, b) => a.path.localeCompare(b.path))
    }));

  if (explicitRepos && repositories.length > explicitRepos) {
    fail(`generated ${repositories.length} repositories, more than --repos ${explicitRepos}`);
  }

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const imageMap = {};
  for (const repo of repositories) {
    for (const file of repo.files) imageMap[file.path] = repo.name;
  }

  const plan = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: sourceDir,
    repoSizeMiB,
    totalFiles: files.length,
    totalBytes,
    repositoryCount: repositories.length,
    repositories: repositories.map(repo => ({
      name: repo.name,
      fileCount: repo.fileCount,
      bytes: repo.bytes,
      humanSize: formatBytes(repo.bytes),
      files: repo.files
    }))
  };

  await fsp.mkdir(path.dirname(planPath), { recursive: true });
  await fsp.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  console.log(`Source files: ${files.length}`);
  console.log(`Total size: ${formatBytes(totalBytes)}`);
  console.log(`Repository capacity: ${repoSizeMiB} MiB`);
  console.log(`Repositories: ${repositories.length}`);
  for (const repo of repositories) {
    console.log(`  ${repo.name}: ${repo.fileCount} files, ${formatBytes(repo.bytes)}`);
  }
  console.log(`Plan: ${path.relative(projectDir, planPath)}`);

  if (!apply) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to copy files and write data/image-map.json.');
    return;
  }

  const copyResult = await copyShardFiles(sourceDir, outDir, repositories, overwrite);

  await fsp.mkdir(path.dirname(mapPath), { recursive: true });
  await fsp.writeFile(mapPath, `${JSON.stringify(imageMap, null, 2)}\n`, 'utf8');

  const pagesOriginArg = getArg('pages-origin', '');
  const owner = getArg('owner', '');
  const pagesOrigin = owner && owner !== true
    ? `https://${owner}.github.io`
    : (pagesOriginArg && pagesOriginArg !== true ? String(pagesOriginArg) : '');

  const repoNames = repositories.map(repo => repo.name);
  const configSnippet = {
    pagesOrigin,
    imageMapUrl: 'data/image-map.json',
    note: pagesOrigin ? 'Copy pagesOrigin into js/config.js.' : 'Set pagesOrigin to https://YOUR_NAME.github.io before deployment.',
    imageRepositories: repoNames,
    imageShards: {
      originals: repoNames,
      twitter: repoNames,
      'twitter-cat1': repoNames,
      'twitter-cat2': repoNames
    }
  };
  await fsp.writeFile(path.join(projectDir, 'tools', 'config-snippet.json'), `${JSON.stringify(configSnippet, null, 2)}\n`, 'utf8');

  console.log('');
  console.log(`Copied: ${copyResult.copied}, skipped existing: ${copyResult.skipped}`);
  console.log(`Shards: ${path.relative(projectDir, outDir)}`);
  console.log(`Image map: ${path.relative(projectDir, mapPath)}`);
  console.log(`Config snippet: tools/config-snippet.json`);
  if (!pagesOrigin) console.log('Next: set pagesOrigin in js/config.js manually or rerun with --owner YOUR_GITHUB_NAME.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

