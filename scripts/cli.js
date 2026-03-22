#!/usr/bin/env node
/**
 * 保研档案库维护 CLI
 * Usage: npm run cli -- <command> [args]
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { execSync, spawnSync } from 'child_process';
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

/** Domains blocked regardless of allowlist (URL shorteners). */
const BLOCKED_SHORTENERS = new Set(['t.co', 'bit.ly', 'suo.im', 'is.gd', 'tinyurl.com']);

/** Escape a string for safe use inside a RegExp. */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Commands that modify files and therefore support the --commit cascade flag. */
const COMMIT_CAPABLE_CMDS = new Set(['replace', 'sync-readme', 'migrate-meta']);

// ─── shared helpers ───────────────────────────────────────────────────────────

function walkMd(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMd(full));
    else if (/\.mdx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

function parseFrontmatterTitle(content) {
  const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const t = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return t ? t[1] : null;
}

/** Interactive readline prompt – resolves with the trimmed answer. */
function prompt(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.setEncoding('utf-8');
    process.stdin.once('data', data => {
      process.stdin.pause();
      resolve(data.trim());
    });
    process.stdin.resume();
  });
}

// ─── replace ──────────────────────────────────────────────────────────────────
// 补充稿命名规范（来自 api/submit_pr.js）：
//   {baseName}_补充_{YYYYMMDDTHHMMZ}.md  →  原文件 {baseName}.md

const SUPPLEMENT_RE = /^(.+)_补充_.+\.md$/;

function findSupplementPair(supplementAbs) {
  const base = path.basename(supplementAbs);
  const m = base.match(SUPPLEMENT_RE);
  if (!m) return null;
  const originalAbs = path.join(path.dirname(supplementAbs), m[1] + '.md');
  return { supplementAbs, originalAbs };
}

function applyOnePair(pair) {
  const { supplementAbs, originalAbs } = pair;
  const relOrig = path.relative(ROOT, originalAbs);
  const relSupp = path.relative(ROOT, supplementAbs);
  if (!fs.existsSync(originalAbs)) {
    console.warn(c.yellow(`⚠  原文件不存在，跳过（防止误操作）: ${relOrig}`));
    return false;
  }
  fs.copyFileSync(supplementAbs, originalAbs);
  fs.unlinkSync(supplementAbs);
  console.log(c.green(`✓  已覆盖原文件: ${relOrig}`));
  console.log(c.cyan(`   补充文件已删除: ${relSupp}`));
  return true;
}

function cmdReplace(args) {
  const allFlag  = args.includes('--all');
  const fIdx     = args.indexOf('-f');
  const filePath = fIdx !== -1 ? args[fIdx + 1] : null;

  if (!allFlag && !filePath) {
    console.error('用法:');
    console.error('  npm run cli -- replace --all          替换全部补充稿');
    console.error('  npm run cli -- replace -f <文件路径>  替换指定补充稿');
    process.exit(1);
  }

  if (filePath) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
      console.error(c.red(`✗ 文件不存在: ${filePath}`));
      process.exit(1);
    }
    const pair = findSupplementPair(abs);
    if (!pair) {
      console.error(c.red(`✗ 该文件不符合补充稿命名规范（应含 "_补充_" 后缀）: ${filePath}`));
      process.exit(1);
    }
    applyOnePair(pair);
    return;
  }

  // --all: scan entire archive dir
  const supplements = walkMd(ARCHIVE_DIR).filter(f => SUPPLEMENT_RE.test(path.basename(f)));
  if (supplements.length === 0) {
    console.log(c.yellow('未发现任何补充稿（*_补充_*.md）。'));
    return;
  }

  console.log(c.cyan(`发现 ${supplements.length} 个补充稿：`));
  supplements.forEach(s => console.log(`  ${path.relative(ROOT, s)}`));
  console.log('');

  let replaced = 0;
  for (const s of supplements) {
    const pair = findSupplementPair(s);
    if (pair && applyOnePair(pair)) replaced++;
  }
  console.log(`\n共替换 ${replaced}/${supplements.length} 个文件。`);
}

// ─── auto-commit ──────────────────────────────────────────────────────────────

async function cmdAutoCommit({ auto = false, message = 'chore: 自动化维护' } = {}) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore', cwd: ROOT });
  } catch {
    console.error(c.red('✗ 当前目录不在 Git 仓库中。'));
    process.exit(1);
  }

  const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd: ROOT });
  if (!status.trim()) {
    console.log(c.green('✓ 工作区干净，无需提交。'));
    return;
  }

  console.log(c.bold('工作区变更：'));
  console.log(status);

  let confirmed = auto;
  if (!auto) {
    const answer = await prompt('是否提交以上变更？(y/n) ');
    confirmed = answer.toLowerCase() === 'y';
  }

  if (confirmed) {
    execSync('git add .', { stdio: 'inherit', cwd: ROOT });
    execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: 'inherit', cwd: ROOT });
    console.log(c.green('✓ 提交成功。'));
  } else {
    console.log('已取消。');
  }
}

// ─── lint (markdown format check) ────────────────────────────────────────────

function cmdLint(dir) {
  const targetDir = dir ? path.resolve(dir) : ARCHIVE_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`✗ 目录不存在: ${targetDir}`)); process.exit(1);
  }
  const relDir = path.relative(ROOT, targetDir);
  console.log(c.cyan(`运行 Markdown 格式检查：${relDir}/**/*.md`));

  const result = spawnSync(
    'npx', ['--yes', 'markdownlint-cli2', `${relDir}/**/*.md`],
    { stdio: 'inherit', shell: true, cwd: ROOT }
  );

  if (result.status === 0) {
    console.log(c.green('✓ Markdown 格式检查通过。'));
  } else {
    console.log(c.red('✗ Markdown 格式检查发现问题（见上方输出）。'));
    process.exitCode = 1;
  }
}

// ─── url-policy (link allowlist check) ───────────────────────────────────────
// 与 scripts/check_new_urls.py 逻辑对应，在本地对全量档案文件执行白名单校验

function loadAllowlist() {
  const p = path.join(ROOT, 'config', 'link-allowlist.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function domainAllowed(domain, allowlist) {
  for (const pattern of allowlist) {
    if (domain === pattern) return true;
    if (pattern.startsWith('*.') && domain.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function cmdUrlPolicy(dir) {
  const targetDir = dir ? path.resolve(dir) : ARCHIVE_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`✗ 目录不存在: ${targetDir}`)); process.exit(1);
  }

  const allowlist = loadAllowlist();
  if (allowlist.length === 0) {
    console.log(c.yellow('⚠  白名单为空（config/link-allowlist.txt），跳过检查。'));
    return;
  }

  const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
  const URL_RE = /https?:\/\/[^\s<>"')]+/g;

  const mdFiles = walkMd(targetDir);
  console.log(c.cyan(`检查 ${mdFiles.length} 个档案文件的链接策略…`));

  const violations = [];
  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const url of (content.match(URL_RE) ?? [])) {
      let domain;
      try { domain = new URL(url).hostname.split(':')[0]; } catch { continue; }
      if (!domain) continue;

      if (IP_RE.test(domain)) {
        violations.push({ file: path.relative(ROOT, file), url, reason: '禁止使用裸 IP' });
      } else if (BLOCKED_SHORTENERS.has(domain)) {
        violations.push({ file: path.relative(ROOT, file), url, reason: '禁止使用短网址服务' });
      } else if (!domainAllowed(domain, allowlist)) {
        violations.push({ file: path.relative(ROOT, file), url, reason: `域名 ${domain} 不在白名单` });
      }
    }
  }

  if (violations.length === 0) {
    console.log(c.green(`✓ 全部链接符合白名单规则。`));
  } else {
    console.log(c.red(`\n✗ 发现 ${violations.length} 个违规链接：\n`));
    for (const v of violations) {
      console.log(`  ${c.red('[违规]')} ${v.url}`);
      console.log(`    原因: ${v.reason}`);
      console.log(`    文件: ${v.file}\n`);
    }
    process.exitCode = 1;
  }
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
      req.on('error', e => finish({ url, status: `ERR: ${e.code || e.message}`, ok: false }));
      req.end();
    } catch {
      finish({ url, status: 'INVALID URL', ok: false });
    }
  });
}

async function cmdCheck(dir) {
  const targetDir = dir ? path.resolve(dir) : ARCHIVE_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`✗ 目录不存在: ${targetDir}`)); process.exit(1);
  }

  const mdFiles = walkMd(targetDir);
  console.log(c.cyan(`扫描 ${mdFiles.length} 个文件的链接…`));

  const allLinks = [];
  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    for (const link of extractLinks(content))
      allLinks.push({ file: path.relative(ROOT, file), ...link });
  }
  if (allLinks.length === 0) { console.log(c.yellow('未发现任何链接。')); return; }
  console.log(c.cyan(`发现 ${allLinks.length} 个链接，开始探测…`));

  const CONC = 5;
  const results = [];
  for (let i = 0; i < allLinks.length; i += CONC) {
    const batch = allLinks.slice(i, i + CONC);
    const statuses = await Promise.all(batch.map(l => probeUrl(l.url)));
    for (let j = 0; j < batch.length; j++) results.push({ ...batch[j], ...statuses[j] });
    process.stdout.write(`\r  进度: ${Math.min(i + CONC, allLinks.length)}/${allLinks.length}  `);
  }
  process.stdout.write('\n');

  const dead = results.filter(r => !r.ok);
  if (dead.length === 0) {
    console.log(c.green(`✓ 全部 ${results.length} 个链接可访问！`));
  } else {
    console.log(c.red(`\n✗ 发现 ${dead.length} 个死链：\n`));
    for (const d of dead) {
      console.log(`  ${c.red(`[${d.status}]`)} ${d.url}`);
      console.log(`    锚文字: "${d.text}"`);
      console.log(`    文件: ${d.file}\n`);
    }
    process.exitCode = 1;
  }
}

// ─── ci (combined checks) ─────────────────────────────────────────────────────

async function cmdCi(dir) {
  console.log(c.bold('════ 运行全量 CI 检查 ════\n'));

  console.log(c.bold('【1/3】Markdown 格式检查'));
  cmdLint(dir);

  console.log(c.bold('\n【2/3】链接白名单策略检查'));
  cmdUrlPolicy(dir);

  console.log(c.bold('\n【3/3】死链探测'));
  await cmdCheck(dir);

  console.log('');
  if (process.exitCode) {
    console.log(c.red('✗ CI 检查存在失败项（见上方输出）。'));
  } else {
    console.log(c.green('✓ 全量 CI 检查通过！'));
  }
}

// ─── sync-readme ──────────────────────────────────────────────────────────────

const README_START = '<!-- SCHOOL-LIST:START -->';
const README_END   = '<!-- SCHOOL-LIST:END -->';

function cmdSyncReadme() {
  const readmePath = path.join(ROOT, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf-8');

  if (!readme.includes(README_START) || !readme.includes(README_END)) {
    console.error(c.red(`✗ README.md 中未找到锚点注释 ${README_START} / ${README_END}`));
    process.exit(1);
  }

  // Collect schools → colleges from archive directory
  const schools = new Map();
  if (!fs.existsSync(ARCHIVE_DIR)) {
    console.error(c.red(`✗ 档案目录不存在: ${ARCHIVE_DIR}`)); process.exit(1);
  }
  for (const entry of fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const schoolDir = path.join(ARCHIVE_DIR, entry.name);
    const colleges = [];
    for (const file of fs.readdirSync(schoolDir, { withFileTypes: true })) {
      if (!/\.mdx?$/.test(file.name)) continue;
      // Skip supplement files (_补充_*.md)
      if (SUPPLEMENT_RE.test(file.name)) continue;
      const content = fs.readFileSync(path.join(schoolDir, file.name), 'utf-8');
      const title = parseFrontmatterTitle(content);
      // Use the part after " - " in "学校 - 学院" title, fallback to filename stem
      const collegeName = title
        ? (title.includes(' - ') ? title.split(' - ').slice(1).join(' - ') : title)
        : file.name.replace(/\.mdx?$/, '');
      colleges.push(collegeName);
    }
    if (colleges.length > 0) schools.set(entry.name, colleges);
  }

  if (schools.size === 0) {
    console.log(c.yellow('未发现任何档案文件，README 未修改。'));
    return;
  }

  // Build list lines
  let list = '';
  for (const [school, colleges] of schools) {
    list += `- **${school}**：${colleges.join('、')}\n`;
  }
  list += '- *(更多院校档案欢迎社区贡献……)*';

  // Replace between anchors
  const newReadme = readme.replace(
    new RegExp(`${README_START}[\\s\\S]*?${README_END}`),
    `${README_START}\n${list}\n${README_END}`
  );

  if (newReadme === readme) {
    console.log(c.green('✓ README 院校列表无变化，无需更新。'));
    return;
  }
  fs.writeFileSync(readmePath, newReadme, 'utf-8');
  console.log(c.green(`✓ README.md 院校列表已同步（${schools.size} 所学校）。`));
}

// ─── migrate-meta (batch frontmatter update) ─────────────────────────────────

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
  if (!m) return null;
  return { yaml: m[1], body: m[2] };
}

function cmdMigrateMeta(args) {
  const addIdx    = args.indexOf('--add');
  const renameIdx = args.indexOf('--rename');

  if (addIdx === -1 && renameIdx === -1) {
    console.error('用法:');
    console.error('  npm run cli -- migrate-meta --add "key: value"     批量添加新字段');
    console.error('  npm run cli -- migrate-meta --rename "old: new"    批量重命名字段');
    process.exit(1);
  }

  const mdFiles = walkMd(ARCHIVE_DIR);
  let updated = 0;

  if (addIdx !== -1) {
    const spec = args[addIdx + 1];
    if (!spec) { console.error(c.red('✗ --add 需要参数，如 --add "key: value"')); process.exit(1); }
    const colonIdx = spec.indexOf(':');
    if (colonIdx === -1) { console.error(c.red('✗ 格式错误，应为 "key: value"')); process.exit(1); }
    const key   = spec.slice(0, colonIdx).trim();
    const value = spec.slice(colonIdx + 1).trim();
    const keyRe = new RegExp(`^${escapeRegex(key)}\\s*:`, 'm');

    for (const file of mdFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed  = parseFrontmatter(content);
      if (!parsed) {
        console.warn(c.yellow(`  ⚠  无 frontmatter，跳过: ${path.relative(ROOT, file)}`));
        continue;
      }
      if (keyRe.test(parsed.yaml)) {
        console.log(c.yellow(`  跳过（字段已存在）: ${path.relative(ROOT, file)}`));
        continue;
      }
      const newContent = `---\n${parsed.yaml}\n${key}: ${value}\n---\n${parsed.body}`;
      fs.writeFileSync(file, newContent, 'utf-8');
      console.log(c.green(`  ✓ 添加 ${key}: ${value}  →  ${path.relative(ROOT, file)}`));
      updated++;
    }
  }

  if (renameIdx !== -1) {
    const spec = args[renameIdx + 1];
    if (!spec) { console.error(c.red('✗ --rename 需要参数，如 --rename "old: new"')); process.exit(1); }
    const colonIdx = spec.indexOf(':');
    if (colonIdx === -1) { console.error(c.red('✗ 格式错误，应为 "oldKey: newKey"')); process.exit(1); }
    const oldKey    = spec.slice(0, colonIdx).trim();
    const newKey    = spec.slice(colonIdx + 1).trim();
    const oldKeyRe  = new RegExp(`^${escapeRegex(oldKey)}(\\s*:)`, 'm');

    for (const file of mdFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed  = parseFrontmatter(content);
      if (!parsed) continue;
      if (!oldKeyRe.test(parsed.yaml)) continue;
      const newYaml    = parsed.yaml.replace(oldKeyRe, `${newKey}$1`);
      const newContent = `---\n${newYaml}\n---\n${parsed.body}`;
      fs.writeFileSync(file, newContent, 'utf-8');
      console.log(c.green(`  ✓ 重命名 ${oldKey} → ${newKey}  →  ${path.relative(ROOT, file)}`));
      updated++;
    }
  }

  console.log(`\n共更新 ${updated} 个文件。`);
}

// ─── index (archive coverage table) ──────────────────────────────────────────

function cmdIndex(dir, outFile) {
  const targetDir = dir ? path.resolve(dir) : ARCHIVE_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(c.red(`✗ 目录不存在: ${targetDir}`)); process.exit(1);
  }

  const schools = [];
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const schoolDir = path.join(targetDir, entry.name);
    const colleges = [];
    for (const file of fs.readdirSync(schoolDir, { withFileTypes: true })) {
      if (!/\.mdx?$/.test(file.name)) continue;
      if (SUPPLEMENT_RE.test(file.name)) continue;
      const filePath = path.join(schoolDir, file.name);
      const content  = fs.readFileSync(filePath, 'utf-8');
      const title    = parseFrontmatterTitle(content) ?? file.name.replace(/\.mdx?$/, '');
      const relPath  = path.relative(targetDir, filePath).replace(/\\/g, '/').replace(/\.mdx?$/, '');
      colleges.push({ title, relPath });
    }
    if (colleges.length > 0) schools.push({ name: entry.name, colleges });
  }

  if (schools.length === 0) { console.log(c.yellow('未发现档案文件。')); return; }

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
    console.log(c.green(`✓ 索引已写入: ${outFile}`));
  } else {
    process.stdout.write(md);
  }
  console.error(c.cyan(`  ${schools.length} 所学校，${totalColleges} 个档案`));
}

// ─── diff ─────────────────────────────────────────────────────────────────────

function buildEditScript(a, b) {
  const m = a.length, n = b.length;
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
    console.error('用法: npm run cli -- diff <文件1> <文件2>');
    process.exit(1);
  }
  const p1 = path.resolve(file1), p2 = path.resolve(file2);
  if (!fs.existsSync(p1)) { console.error(c.red(`✗ 文件不存在: ${file1}`)); process.exit(1); }
  if (!fs.existsSync(p2)) { console.error(c.red(`✗ 文件不存在: ${file2}`)); process.exit(1); }

  const lines1 = fs.readFileSync(p1, 'utf-8').split('\n');
  const lines2 = fs.readFileSync(p2, 'utf-8').split('\n');

  const ops = buildEditScript(lines1, lines2);
  const changedIdx = ops.reduce((acc, op, i) => { if (op.type !== ' ') acc.push(i); return acc; }, []);

  if (changedIdx.length === 0) {
    console.log(c.green('✓ 两文件内容相同'));
    return;
  }

  console.log(c.bold(`--- ${file1}`));
  console.log(c.bold(`+++ ${file2}`));

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

// ─── main ─────────────────────────────────────────────────────────────────────

const HELP = `${c.bold('保研档案库维护 CLI')}

用法: npm run cli -- <指令> [参数]

${c.bold('── 稿件管理 ──')}
  ${c.bold('replace')} --all                    将全部补充稿（*_补充_*.md）覆盖至原文件
  ${c.bold('replace')} -f <文件>                覆盖指定补充稿对应的原文件
  ${c.bold('diff')}    <文件1> <文件2>           对比两个文件的差异

${c.bold('── 质量检查 ──')}
  ${c.bold('lint')}        [目录]               Markdown 格式检查（markdownlint-cli2）
  ${c.bold('url-policy')}  [目录]               链接白名单策略检查
  ${c.bold('check')}       [目录]               死链探测（HTTP HEAD 请求）
  ${c.bold('ci')}          [目录]               运行全量 CI 检查（lint + url-policy + check）

${c.bold('── 数据维护 ──')}
  ${c.bold('sync-readme')}                      扫描档案目录，自动更新 README 院校列表
  ${c.bold('index')}       [目录] [--out 文件]  生成档案目录索引表（默认输出到 stdout）
  ${c.bold('migrate-meta')} --add "key: value"  为所有档案 frontmatter 批量添加新字段
  ${c.bold('migrate-meta')} --rename "old: new" 批量重命名 frontmatter 字段

${c.bold('── Git 操作 ──')}
  ${c.bold('auto-commit')} [--msg "消息"]          检测工作区变更并交互式提交

${c.bold('── 级联选项 ──')}
  replace / sync-readme / migrate-meta 支持追加 ${c.bold('--commit')} 选项，执行完毕后自动提交变更。
  示例: npm run cli -- replace --all --commit
`;

const [,, cmd, ...args] = process.argv;
const commitFlag = args.includes('--commit');

(async () => {
  switch (cmd) {
    case 'replace':
      cmdReplace(args.filter(a => a !== '--commit'));
      break;
    case 'diff':
      cmdDiff(args[0], args[1]);
      break;
    case 'lint': {
      const dir = args.find(a => !a.startsWith('-'));
      cmdLint(dir);
      break;
    }
    case 'url-policy': {
      const dir = args.find(a => !a.startsWith('-'));
      cmdUrlPolicy(dir);
      break;
    }
    case 'check': {
      const dir = args.find(a => !a.startsWith('-'));
      await cmdCheck(dir);
      break;
    }
    case 'ci': {
      const dir = args.find(a => !a.startsWith('-'));
      await cmdCi(dir);
      break;
    }
    case 'sync-readme':
      cmdSyncReadme();
      break;
    case 'index': {
      const outIdx = args.indexOf('--out');
      const outFile = outIdx !== -1 ? args[outIdx + 1] : undefined;
      const outValueIdx = outIdx !== -1 ? outIdx + 1 : -1;
      const dir = args.find((a, i) => !a.startsWith('-') && i !== outValueIdx);
      cmdIndex(dir, outFile);
      break;
    }
    case 'migrate-meta':
      cmdMigrateMeta(args.filter(a => a !== '--commit'));
      break;
    case 'auto-commit': {
      const msgIdx = args.indexOf('--msg');
      const message = msgIdx !== -1 ? args[msgIdx + 1] : undefined;
      await cmdAutoCommit({ message });
      return; // skip the --commit cascade below
    }
    default:
      process.stdout.write(HELP);
      if (cmd) { console.error(c.red(`\n✗ 未知指令: ${cmd}`)); process.exit(1); }
      return;
  }

  // Cascade --commit: only for write commands defined in COMMIT_CAPABLE_CMDS
  if (commitFlag && COMMIT_CAPABLE_CMDS.has(cmd)) {
    console.log('');
    await cmdAutoCommit({ auto: true, message: `chore(${cmd}): 自动化维护` });
  }
})();
