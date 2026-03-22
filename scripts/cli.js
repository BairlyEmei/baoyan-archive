#!/usr/bin/env node
/**
 * 保研档案库维护 CLI
 * Usage: npm run cli -- <command> [args]
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ARCHIVE_DIR = path.join(ROOT, 'src', 'content', 'docs', '统计专业档案');

const c = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
};

// ─── replace ──────────────────────────────────────────────────────────────────

function cmdReplace(src, dest) {
  if (!src || !dest) {
    console.error('Usage: npm run cli -- replace <src> <dest>');
    process.exit(1);
  }
  const srcAbs  = path.resolve(src);
  const destAbs = path.resolve(dest);
  if (!fs.existsSync(srcAbs)) {
    console.error(c.red(`✗ Source not found: ${src}`));
    process.exit(1);
  }
  const destDir = path.dirname(destAbs);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const existed = fs.existsSync(destAbs);
  fs.copyFileSync(srcAbs, destAbs);
  console.log(c.green(`✓ ${existed ? 'Replaced' : 'Created'}: ${dest}`));
}

// ─── diff ─────────────────────────────────────────────────────────────────────

/** Build an edit-script via LCS and return [{type:' '|'+'|'-', line}]. */
function buildEditScript(a, b) {
  const m = a.length, n = b.length;
  // dp[i][j] = LCS length of a[0..i-1] vs b[0..j-1]
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);

  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      ops.unshift({ type: ' ', line: a[i-1] }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      ops.unshift({ type: '+', line: b[j-1] }); j--;
    } else {
      ops.unshift({ type: '-', line: a[i-1] }); i--;
    }
  }
  return ops;
}

function cmdDiff(file1, file2) {
  if (!file1 || !file2) {
    console.error('Usage: npm run cli -- diff <file1> <file2>');
    process.exit(1);
  }
  const p1 = path.resolve(file1), p2 = path.resolve(file2);
  if (!fs.existsSync(p1)) { console.error(c.red(`✗ Not found: ${file1}`)); process.exit(1); }
  if (!fs.existsSync(p2)) { console.error(c.red(`✗ Not found: ${file2}`)); process.exit(1); }

  const lines1 = fs.readFileSync(p1, 'utf-8').split('\n');
  const lines2 = fs.readFileSync(p2, 'utf-8').split('\n');

  const ops = buildEditScript(lines1, lines2);
  const changedIdx = ops.reduce((acc, op, i) => { if (op.type !== ' ') acc.push(i); return acc; }, []);

  if (changedIdx.length === 0) {
    console.log(c.green('✓ Files are identical'));
    return;
  }

  console.log(c.bold(`--- ${file1}`));
  console.log(c.bold(`+++ ${file2}`));

  // Group changed positions into hunks with 3 lines of context
  const CTX = 3;
  const hunks = [];
  let hs = changedIdx[0] - CTX, he = changedIdx[0] + CTX;
  for (let k = 1; k < changedIdx.length; k++) {
    if (changedIdx[k] <= he + CTX) {
      he = changedIdx[k] + CTX;
    } else {
      hunks.push([Math.max(0, hs), Math.min(ops.length - 1, he)]);
      hs = changedIdx[k] - CTX; he = changedIdx[k] + CTX;
    }
  }
  hunks.push([Math.max(0, hs), Math.min(ops.length - 1, he)]);

  for (const [start, end] of hunks) {
    console.log(c.cyan(`@@ -${start+1} +${start+1} @@`));
    for (let k = start; k <= end; k++) {
      const { type, line } = ops[k];
      if      (type === '+') process.stdout.write(c.green(`+${line}\n`));
      else if (type === '-') process.stdout.write(c.red(`-${line}\n`));
      else                   process.stdout.write(` ${line}\n`);
    }
  }

  const added   = ops.filter(o => o.type === '+').length;
  const removed = ops.filter(o => o.type === '-').length;
  console.log(`\n${c.green(`+${added}`)} ${c.red(`-${removed}`)}`);
}

// ─── check (dead-link scanner) ────────────────────────────────────────────────

function extractLinks(content) {
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const links = [];
  let m;
  while ((m = re.exec(content)) !== null) links.push({ text: m[1], url: m[2] });
  return links;
}

function probeUrl(url) {
  return new Promise(resolve => {
    let done = false;
    const finish = result => { if (!done) { done = true; resolve(result); } };
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        { hostname: parsed.hostname, path: parsed.pathname + parsed.search,
          method: 'HEAD',
          headers: { 'User-Agent': 'baoyan-archive-cli/1.0' } },
        res => finish({ url, status: res.statusCode, ok: res.statusCode < 400 })
      );
      req.setTimeout(8000, () => { req.destroy(); finish({ url, status: 'TIMEOUT', ok: false }); });
      req.on('error',   e  => finish({ url, status: `ERR: ${e.code || e.message}`, ok: false }));
      req.end();
    } catch (e) {
      finish({ url, status: `INVALID URL`, ok: false });
    }
  });
}

function walkMd(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMd(full));
    else if (/\.mdx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

async function cmdCheck(dir) {
  const targetDir = dir ? path.resolve(dir) : ARCHIVE_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`✗ Directory not found: ${targetDir}`)); process.exit(1);
  }

  const mdFiles = walkMd(targetDir);
  console.log(c.cyan(`Scanning ${mdFiles.length} file(s) for links…`));

  const allLinks = [];
  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const link of extractLinks(content))
      allLinks.push({ file: path.relative(ROOT, file), ...link });
  }
  if (allLinks.length === 0) { console.log(c.yellow('No links found.')); return; }
  console.log(c.cyan(`Found ${allLinks.length} link(s). Probing…`));

  // Probe with concurrency=5
  const CONC = 5;
  const results = [];
  for (let i = 0; i < allLinks.length; i += CONC) {
    const batch = allLinks.slice(i, i + CONC);
    const statuses = await Promise.all(batch.map(l => probeUrl(l.url)));
    for (let j = 0; j < batch.length; j++) results.push({ ...batch[j], ...statuses[j] });
    process.stdout.write(`\r  Progress: ${Math.min(i + CONC, allLinks.length)}/${allLinks.length}  `);
  }
  process.stdout.write('\n');

  const dead = results.filter(r => !r.ok);
  if (dead.length === 0) {
    console.log(c.green(`✓ All ${results.length} link(s) are reachable!`));
  } else {
    console.log(c.red(`\n✗ ${dead.length} dead link(s) found:\n`));
    for (const d of dead) {
      console.log(`  ${c.red(`[${d.status}]`)} ${d.url}`);
      console.log(`    Text: "${d.text}"`);
      console.log(`    File: ${d.file}\n`);
    }
  }
}

// ─── index (archive coverage table) ──────────────────────────────────────────

function parseFrontmatterTitle(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const t = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return t ? t[1] : null;
}

function cmdIndex(dir, outFile) {
  const targetDir = dir ? path.resolve(dir) : ARCHIVE_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`✗ Directory not found: ${targetDir}`)); process.exit(1);
  }

  const schools = [];
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const schoolDir = path.join(targetDir, entry.name);
    const colleges = [];
    for (const file of fs.readdirSync(schoolDir, { withFileTypes: true })) {
      if (!/\.mdx?$/.test(file.name)) continue;
      const filePath = path.join(schoolDir, file.name);
      const content  = fs.readFileSync(filePath, 'utf-8');
      const title    = parseFrontmatterTitle(content) ?? file.name.replace(/\.mdx?$/, '');
      // Path relative to the archive dir root (for Starlight sidebar links)
      const relPath  = path.relative(targetDir, filePath).replace(/\\/g, '/').replace(/\.mdx?$/, '');
      colleges.push({ title, relPath });
    }
    if (colleges.length > 0) schools.push({ name: entry.name, colleges });
  }

  if (schools.length === 0) { console.log(c.yellow('No archive files found.')); return; }

  const totalColleges = schools.reduce((s, sc) => s + sc.colleges.length, 0);
  let md = `## 📋 已收录院校档案索引\n\n`;
  md += `| 学校 | 学院 / 专业 |\n| :--- | :--- |\n`;
  for (const school of schools) {
    for (let i = 0; i < school.colleges.length; i++) {
      const { title, relPath } = school.colleges[i];
      const schoolCell = i === 0 ? `**${school.name}**` : '';
      md += `| ${schoolCell} | [${title}](${relPath}) |\n`;
    }
  }

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), md, 'utf-8');
    console.log(c.green(`✓ Index written to: ${outFile}`));
  } else {
    process.stdout.write(md);
  }
  console.error(c.cyan(`  ${schools.length} school(s), ${totalColleges} archive(s) indexed`));
}

// ─── main ─────────────────────────────────────────────────────────────────────

const HELP = `${c.bold('保研档案库维护 CLI')}

Usage: npm run cli -- <command> [args]

Commands:
  ${c.bold('replace')} <src> <dest>        替换档案文件（自动创建目标目录）
  ${c.bold('diff')}    <file1> <file2>     比对两个文件的差异
  ${c.bold('check')}   [dir]               检查死链（默认：统计专业档案目录）
  ${c.bold('index')}   [dir] [--out file]  生成档案目录索引（默认输出到 stdout）
`;

const [,, cmd, ...args] = process.argv;

(async () => {
  switch (cmd) {
    case 'replace':
      cmdReplace(args[0], args[1]);
      break;
    case 'diff':
      cmdDiff(args[0], args[1]);
      break;
    case 'check':
      await cmdCheck(args[0]);
      break;
    case 'index': {
      const outIdx = args.indexOf('--out');
      const outFile = outIdx !== -1 ? args[outIdx + 1] : undefined;
      // Positional dir arg: any token that is not '--out' and not the value after '--out'
      const outValueIdx = outIdx !== -1 ? outIdx + 1 : -1;
      const dir = args.find((a, i) => i !== outIdx && i !== outValueIdx);
      cmdIndex(dir, outFile);
      break;
    }
    default:
      process.stdout.write(HELP);
      if (cmd) { console.error(c.red(`\n✗ Unknown command: ${cmd}`)); process.exit(1); }
  }
})();
