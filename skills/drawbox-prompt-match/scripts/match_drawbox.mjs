#!/usr/bin/env node

import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_BASE = "https://angel-gril.github.io/DrawBox";
const CACHE_VERSION = "v1";
const DEFAULT_CACHE_TTL_HOURS = 12;
const FIELD_BOOST = { title: 1.15, category: 1.12, prompt: 1.0 };
const EN_STOP = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "with", "and", "or",
  "is", "are", "was", "were", "this", "that", "image", "photo", "picture", "style"
]);
const ZH_STOP = new Set([
  "的", "了", "在", "是", "和", "与", "及", "或", "一个", "一位", "一名",
  "这个", "那个", "以及", "并且", "还有", "非常", "可以", "一些"
]);
const SKIP_PATH_SEGMENTS = new Set([
  "count", "reference_image_roles", "reference_image_role", "uncertain",
  "negative_prompt", "negative", "constraints"
]);

const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
const tokenCache = new Map();
const CJK_RUN = /[\p{Script=Han}\u3040-\u30ff\uac00-\ud7af]+/gu;

function parseArgs(argv) {
  const opts = {
    top: 8,
    minScore: 0,
    format: "json",
    cacheTtlHours: DEFAULT_CACHE_TTL_HOURS,
    refresh: false,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--refresh") {
      opts.refresh = true;
      continue;
    }
    if (raw === "--help" || raw === "-h") {
      opts.help = true;
      continue;
    }
    if (!raw.startsWith("--")) continue;

    const eq = raw.indexOf("=");
    const key = eq >= 0 ? raw.slice(2, eq) : raw.slice(2);
    const value = eq >= 0 ? raw.slice(eq + 1) : argv[++i];
    if (value == null) throw new Error(`Missing value for --${key}`);

    if (key === "input") opts.input = value;
    else if (key === "root") opts.root = path.resolve(value);
    else if (key === "base") opts.base = value.replace(/\/+$/, "");
    else if (key === "top") opts.top = clampInt(value, 1, 50, "--top");
    else if (key === "category") opts.category = value;
    else if (key === "min-score") opts.minScore = Number(value);
    else if (key === "format") opts.format = value.toLowerCase();
    else if (key === "cache-ttl") opts.cacheTtlHours = Number(value);
    else throw new Error(`Unknown option --${key}`);
  }

  if (!Number.isFinite(opts.minScore)) throw new Error("--min-score must be a number");
  if (!Number.isFinite(opts.cacheTtlHours) || opts.cacheTtlHours < 0) {
    throw new Error("--cache-ttl must be a non-negative number of hours");
  }
  if (!["json", "text"].includes(opts.format)) {
    throw new Error("--format must be json or text");
  }
  return opts;
}

function clampInt(value, min, max, label) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`${label} must be an integer`);
  return Math.max(min, Math.min(max, n));
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addToken(out, token) {
  const value = String(token ?? "").trim();
  if (!value) return;
  if (/^[a-z0-9][a-z0-9'-]*$/.test(value)) {
    if (value.length >= 2 && !EN_STOP.has(value)) out.push(value);
    return;
  }
  if (value.length < 2 || ZH_STOP.has(value)) return;
  out.push(value);
}

function tokenize(text) {
  const key = String(text ?? "");
  if (tokenCache.has(key)) return tokenCache.get(key);
  const norm = normalizeText(key);
  if (!norm) {
    tokenCache.set(key, []);
    return [];
  }

  const out = [];
  for (const item of segmenter.segment(norm)) {
    if (item.isWordLike) addToken(out, item.segment);
  }

  for (const run of norm.match(CJK_RUN) ?? []) {
    const chars = [...run];
    if (chars.length === 2) addToken(out, run);
    for (let i = 0; i < chars.length - 1; i += 1) {
      addToken(out, chars.slice(i, i + 2).join(""));
    }
  }

  for (const match of norm.match(/[a-z0-9][a-z0-9'-]*/g) ?? []) {
    addToken(out, match);
  }

  const unique = [...new Set(out)];
  if (tokenCache.size > 25000) tokenCache.clear();
  tokenCache.set(key, unique);
  return unique;
}

function weightForPath(pathKey) {
  if (pathKey === "search_terms_zh" || pathKey === "search_terms_en") return 12;
  if (pathKey === "subject.identity") return 8;
  if (pathKey === "subject.type") return 7;
  if (pathKey === "subject.features" || pathKey === "subject.hair") return 7;
  if (pathKey === "subject.makeup" || pathKey === "subject.body") return 5;
  if (pathKey === "subject.gender") return 3;
  if (pathKey === "subject.age_range") return 3;
  if (pathKey === "pose_expression.pose") return 8;
  if (pathKey === "pose_expression.expression") return 6;
  if (pathKey === "pose_expression.gaze") return 6;
  if (pathKey === "pose_expression.gesture") return 5;
  if (pathKey === "wardrobe.garments") return 7;
  if (pathKey === "wardrobe.colors") return 3;
  if (pathKey === "wardrobe.materials") return 3;
  if (pathKey === "wardrobe.accessories") return 4;
  if (pathKey === "scene.location") return 6;
  if (pathKey === "scene.background") return 4;
  if (pathKey === "scene.props") return 6;
  if (pathKey === "scene.weather_or_time") return 3;
  if (pathKey === "lighting.type") return 6;
  if (pathKey === "lighting.direction") return 4;
  if (pathKey === "lighting.contrast") return 3;
  if (pathKey === "lighting.color_temperature") return 3;
  if (pathKey === "lighting.shadows") return 3;
  if (pathKey === "camera.shot") return 6;
  if (pathKey === "camera.angle") return 4;
  if (pathKey === "camera.lens") return 4;
  if (pathKey === "camera.depth_of_field") return 4;
  if (pathKey === "camera.film_stock") return 4;
  if (pathKey === "camera.motion") return 3;
  if (pathKey === "composition.framing") return 4;
  if (pathKey === "composition.aspect_ratio") return 2;
  if (pathKey === "composition.layout") return 3;
  if (pathKey === "composition.subject_position") return 3;
  if (pathKey === "style.medium") return 4;
  if (pathKey === "style.aesthetic") return 6;
  if (pathKey === "style.rendering") return 5;
  if (pathKey === "style.era") return 3;
  if (pathKey.startsWith("colors.")) return 3;
  if (pathKey === "mood") return 5;
  if (pathKey.startsWith("text_elements.")) return 4;
  return 3;
}

function collectQueryTerms(value, pathParts, out) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectQueryTerms(item, pathParts, out);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SKIP_PATH_SEGMENTS.has(key)) continue;
      collectQueryTerms(child, [...pathParts, key], out);
    }
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") return;

  const raw = String(value).trim();
  if (!raw) return;
  const phrase = normalizeText(raw);
  if (!phrase) return;
  const tokens = tokenize(raw);
  if (!tokens.length) return;

  const pathKey = pathParts.join(".");
  if (!pathKey) return;
  out.push({
    path: pathKey,
    raw,
    phrase,
    tokens,
    sourceWeight: weightForPath(pathKey)
  });
}

function uniqueQueryTerms(terms) {
  const seen = new Set();
  return terms.filter((term) => {
    const key = `${term.path}\u0000${term.phrase}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCandidate(record) {
  const title = normalizeText(record.title);
  const category = normalizeText(record.category);
  const prompt = normalizeText(record.prompt);
  const titleTokens = new Set(tokenize(record.title));
  const categoryTokens = new Set(tokenize(record.category));
  const promptTokens = new Set(tokenize(record.prompt));
  const combinedTokens = new Set([...titleTokens, ...categoryTokens, ...promptTokens]);
  return { record, title, category, prompt, titleTokens, categoryTokens, promptTokens, combinedTokens };
}

function buildDocumentFrequency(candidates) {
  const df = new Map();
  for (const candidate of candidates) {
    for (const token of candidate.combinedTokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  return df;
}

function makeIdf(df, documentCount) {
  return (token) => {
    const frequency = df.get(token) ?? 0;
    return Math.log(1 + (documentCount + 1) / (frequency + 1));
  };
}

function fieldMatch(term, text, tokenSet, idf) {
  const exact = term.phrase.length >= 2 && text.includes(term.phrase);
  let total = 0;
  let matched = 0;
  const matchedTokens = [];
  for (const token of term.tokens) {
    const weight = idf(token);
    total += weight;
    if (tokenSet.has(token)) {
      matched += weight;
      matchedTokens.push(token);
    }
  }
  const ratio = total > 0 ? matched / total : 0;
  return {
    score: exact ? Math.max(0.92, ratio) : ratio,
    exact,
    matchedTokens
  };
}

function scoreCandidate(candidate, queryTerms, idf) {
  let weighted = 0;
  let total = 0;
  const evidence = [];
  const parts = new Map();

  for (const term of queryTerms) {
    let termIdf = 0;
    for (const token of term.tokens) termIdf += idf(token);
    termIdf /= Math.max(1, term.tokens.length);
    if (!Number.isFinite(termIdf) || termIdf <= 0) continue;

    const possible = term.sourceWeight * termIdf;
    total += possible;

    const choices = [
      { field: "title", ...fieldMatch(term, candidate.title, candidate.titleTokens, idf) },
      { field: "category", ...fieldMatch(term, candidate.category, candidate.categoryTokens, idf) },
      { field: "prompt", ...fieldMatch(term, candidate.prompt, candidate.promptTokens, idf) }
    ];
    let best = choices[0];
    let bestBoosted = best.score * FIELD_BOOST[best.field];
    for (const choice of choices.slice(1)) {
      const boosted = choice.score * FIELD_BOOST[choice.field];
      if (boosted > bestBoosted) {
        best = choice;
        bestBoosted = boosted;
      }
    }

    const contribution = possible * bestBoosted;
    weighted += contribution;

    if (best.score >= 0.25) {
      const root = term.path.split(".")[0] || term.path;
      parts.set(root, (parts.get(root) ?? 0) + contribution);
      evidence.push({
        path: term.path,
        value: term.raw,
        field: best.field,
        match: Number(best.score.toFixed(3)),
        exact: best.exact,
        contribution
      });
    }
  }

  const score = total > 0 ? Math.min(100, (weighted / total) * 100) : 0;
  evidence.sort((a, b) => b.contribution - a.contribution);
  const breakdown = {};
  for (const [key, value] of [...parts.entries()].sort((a, b) => b[1] - a[1])) {
    breakdown[key] = total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0;
  }

  return {
    candidate,
    score: Number(score.toFixed(2)),
    evidence: evidence.slice(0, 8),
    breakdown
  };
}

function resolveImageUrl(imagePath, imageMap, sourceBase) {
  if (!imagePath) return null;
  const imageRoot = imageMap?.[imagePath];
  if (imageRoot) return `${imageRoot.replace(/\/+$/, "")}/${imagePath}`;
  if (sourceBase) return `${sourceBase.replace(/\/+$/, "")}/${imagePath}`;
  return null;
}

function formatEvidence(evidence) {
  return evidence.map((item) => `${item.path}: ${item.value} -> ${item.field}`);
}

async function readJsonFile(filePath, required = true) {
  try {
    const text = stripBom(await fs.readFile(filePath, "utf8"));
    return JSON.parse(text);
  } catch (error) {
    if (error?.code === "ENOENT" && !required) return null;
    throw new Error(`Failed to read JSON ${filePath}: ${error.message}`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return stripBom(Buffer.concat(chunks).toString("utf8"));
}

async function fetchText(url, cacheFile, ttlHours, refresh) {
  if (!refresh && ttlHours > 0 && fsSync.existsSync(cacheFile)) {
    const stat = await fs.stat(cacheFile);
    const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
    if (ageHours <= ttlHours) return fs.readFile(cacheFile, "utf8");
  }

  let response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": "drawbox-prompt-match/1.0" },
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    if (fsSync.existsSync(cacheFile)) return fs.readFile(cacheFile, "utf8");
    throw new Error(`Network request failed for ${url}: ${error.message}`);
  }

  if (!response.ok) {
    if (fsSync.existsSync(cacheFile)) return fs.readFile(cacheFile, "utf8");
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const text = await response.text();
  await fs.writeFile(cacheFile, text, "utf8");
  return text;
}

async function loadPromptData(opts) {
  const sourceBase = opts.base ?? DEFAULT_BASE;
  if (opts.root) {
    const prompts = [];
    for (let i = 1; i <= 6; i += 1) {
      const filePath = path.join(opts.root, "data", `prompts.part${i}.json`);
      const part = await readJsonFile(filePath, i === 1);
      if (!part) break;
      if (!Array.isArray(part)) throw new Error(`${filePath} must contain an array`);
      prompts.push(...part);
    }
    const imageMap = (await readJsonFile(path.join(opts.root, "data", "image-map.json"), false)) ?? {};
    return { prompts, imageMap, source: { mode: "local", root: opts.root } };
  }

  const cacheDir = path.join(os.tmpdir(), "drawbox-prompt-match", CACHE_VERSION);
  await fs.mkdir(cacheDir, { recursive: true });
  const baseHash = crypto.createHash("sha1").update(sourceBase).digest("hex").slice(0, 10);
  const cacheFileFor = (relativePath) => path.join(cacheDir, `${baseHash}-${relativePath.replace(/[^a-z0-9._-]/gi, "_")}`);

  const prompts = [];
  for (let i = 1; i <= 6; i += 1) {
    const relativePath = `data/prompts.part${i}.json`;
    try {
      const text = await fetchText(`${sourceBase}/${relativePath}`, cacheFileFor(relativePath), opts.cacheTtlHours, opts.refresh);
      const part = JSON.parse(stripBom(text));
      if (!Array.isArray(part)) throw new Error(`${relativePath} must contain an array`);
      prompts.push(...part);
    } catch (error) {
      if (i === 1 || !String(error.message).startsWith("HTTP 404")) throw error;
      break;
    }
  }

  const mapPath = "data/image-map.json";
  const mapText = await fetchText(`${sourceBase}/${mapPath}`, cacheFileFor(mapPath), opts.cacheTtlHours, opts.refresh);
  const imageMap = JSON.parse(stripBom(mapText));
  return { prompts, imageMap, source: { mode: "remote", base: sourceBase } };
}

function buildResult(opts, data, queryTerms, scored) {
  const matches = scored
    .filter((item) => item.score >= opts.minScore)
    .slice(0, opts.top)
    .map((item, index) => {
      const record = item.candidate.record;
      return {
        rank: index + 1,
        id: record.id,
        title: record.title,
        category: record.category,
        score: item.score,
        why: formatEvidence(item.evidence),
        breakdown: item.breakdown,
        prompt: record.prompt,
        image_path: record.image,
        image_url: resolveImageUrl(record.image, data.imageMap, opts.root ? null : data.source.base),
        likes: record.likes ?? 0
      };
    });

  return {
    source: {
      ...data.source,
      prompt_count: data.prompts.length,
      cache_ttl_hours: opts.root ? null : opts.cacheTtlHours
    },
    query: {
      term_count: queryTerms.length,
      filtered_category: opts.category ?? null,
      top: opts.top
    },
    matches
  };
}

function formatText(result) {
  const lines = [
    `DrawBox matches (${result.matches.length}/${result.source.prompt_count} prompts, ${result.source.mode})`,
    ""
  ];
  for (const match of result.matches) {
    lines.push(`${match.rank}. ${match.score.toFixed(2)}%  #${match.id}  ${match.title}  [${match.category}]`);
    lines.push(`   why: ${match.why.join(" | ") || "no direct evidence"}`);
    if (match.image_url) lines.push(`   image: ${match.image_url}`);
    lines.push(`   prompt: ${match.prompt}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function printHelp() {
  process.stdout.write(`Usage: node match_drawbox.mjs --input visual.json [options]\n\nOptions:\n  --input <file>       Read visual JSON from a file\n  --root <path>        Use a local DrawBox checkout\n  --base <url>         Override remote DrawBox Pages base URL\n  --top <n>            Number of matches (default 8)\n  --category <text>    Restrict category substring\n  --min-score <n>      Minimum score\n  --refresh            Ignore prompt-data cache\n  --cache-ttl <hours>  Cache lifetime (default 12)\n  --format <json|text> Output format (default json)\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  let inputText;
  if (opts.input) {
    inputText = stripBom(await fs.readFile(path.resolve(opts.input), "utf8"));
  } else {
    if (process.stdin.isTTY) throw new Error("Provide --input <file> or pipe visual JSON through stdin");
    inputText = await readStdin();
  }
  if (!inputText.trim()) throw new Error("Visual JSON input is empty");

  let visual;
  try {
    visual = JSON.parse(inputText);
  } catch (error) {
    throw new Error(`Visual input is not valid JSON: ${error.message}`);
  }

  const data = await loadPromptData(opts);
  const queryTerms = [];
  collectQueryTerms(visual, [], queryTerms);
  const uniqueTerms = uniqueQueryTerms(queryTerms);
  if (!uniqueTerms.length) throw new Error("No searchable terms found in visual JSON");

  let candidates = data.prompts.map(buildCandidate);
  if (opts.category) {
    const category = normalizeText(opts.category);
    candidates = candidates.filter((candidate) => candidate.category.includes(category));
  }
  if (!candidates.length) throw new Error("No prompts remain after category filtering");

  const idf = makeIdf(buildDocumentFrequency(candidates), candidates.length);
  const scored = candidates
    .map((candidate) => scoreCandidate(candidate, uniqueTerms, idf))
    .sort((a, b) => b.score - a.score || (b.candidate.record.likes ?? 0) - (a.candidate.record.likes ?? 0));

  const result = buildResult(opts, data, uniqueTerms, scored);
  if (opts.format === "text") process.stdout.write(`${formatText(result)}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`drawbox-prompt-match: ${error.message}\n`);
  process.exit(1);
});
