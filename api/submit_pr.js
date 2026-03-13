// api/submit_pr.js
import { Octokit } from "@octokit/rest";
import { nanoid } from "nanoid";

// ============================================================
// 动态跨域白名单：在这里维护所有合法的请求来源域名
// ============================================================
const ALLOWED_ORIGINS = [
  'http://localhost:4321',             // Astro 本地开发默认端口
  'http://localhost:3000',             // 备用本地端口
  'https://baoyan-archive.vercel.app', // Vercel 生产域名
  'https://stat-archive.bairly.me' // 正式生产主域名
];

// 允许所有 Vercel 预览部署子域名（*.vercel.app）
function isOriginAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (/\.vercel\.app$/.test(origin)) return true;
  return false;
}

// ============================================================
// IP 请求频率限制：防止同一 IP 短时间内大量刷接口
// Serverless 实例热复用期间有效；冷启动后窗口自动重置
// ============================================================
const IP_RATE_LIMIT_MAX = 5;                          // 每个窗口期最多允许的请求数
const IP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;      // 窗口期长度：10 分钟

/** @type {Map<string, { count: number, windowStart: number }>} */
const ipRequestMap = new Map();

/**
 * 检查 IP 是否触发限流
 * 注：Node.js 单线程事件循环保证此函数内无竞态；
 * Serverless 冷启动会重置计数器，此为轻量级防护，
 * 生产级需求可替换为 Redis / Vercel KV 持久化存储。
 * @param {string} ip
 * @returns {{ limited: boolean, retryMinutes?: number }}
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = ipRequestMap.get(ip);

  if (!entry || now - entry.windowStart > IP_RATE_LIMIT_WINDOW_MS) {
    // 新窗口或首次访问：初始化计数
    ipRequestMap.set(ip, { count: 1, windowStart: now });
    return { limited: false };
  }

  if (entry.count >= IP_RATE_LIMIT_MAX) {
    const retryAfterMs = IP_RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    const retryMinutes = Math.ceil(retryAfterMs / 60000);
    return { limited: true, retryMinutes };
  }

  entry.count += 1;
  return { limited: false };
}

// ============================================================
// 超时保护工厂：Serverless 函数最多跑 8s，超时抛 TIMEOUT 错误
// 防止 GitHub API 慢响应拖死函数，确保前端能收到 504 并触发容灾
// ============================================================
const TIMEOUT_MS = 8000;

function createTimeoutPromise(ms) {
  return new Promise((_, reject) =>
  setTimeout(() => {
    const err = new Error(`函数执行超时（>${ms}ms），请稍后重试`);
    err.code = 'TIMEOUT';
    reject(err);
  }, ms)
  );
}

// ============================================================
// 主处理函数
// ============================================================
export default async function handler(req, res) {

  // ----------------------------------------------------------
  // 1. CORS 预检：动态白名单校验，阻断非法跨域请求
  // ----------------------------------------------------------
  const origin = req.headers.origin;

  if (isOriginAllowed(origin)) {
    // 在白名单内，动态注入允许来源（而非写死通配符 *）
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    // 不在白名单，网关层直接阻断，保护后续所有资源
    console.warn(`[CORS] 拦截到未授权来源: ${origin}`);
    return res.status(403).json({
      error: 'CORS policy violation: Origin not allowed'
    });
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 处理浏览器 CORS 预检请求（OPTIONS）
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只接受 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ----------------------------------------------------------
  // 2-a. IP 频率限制：超限直接 429，返回可读中文提示
  // ----------------------------------------------------------
  // x-real-ip 由 Vercel 基础设施注入，不可被客户端伪造；
  // x-forwarded-for 作为后备（可能含多跳，取第一段）
  const clientIp =
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const rateCheck = checkRateLimit(clientIp);
  if (rateCheck.limited) {
    console.warn(`[RateLimit] IP ${clientIp} 请求过于频繁`);
    return res.status(429).json({
      error: `IP 请求过于频繁，请 ${rateCheck.retryMinutes} 分钟后重试`,
    });
  }


  // ----------------------------------------------------------
  // 2-b. 请求体解析与字段空值校验
  // ----------------------------------------------------------
  const { markdownContent, universityName, turnstileToken, authorName, authorEmail, collegeName, submissionType } = req.body;

  if (!markdownContent || !universityName || !turnstileToken) {
    return res.status(400).json({
      error: '缺少核心提交数据或验证码拦截凭证',
      missing: {
        markdownContent: !markdownContent,
        universityName: !universityName,
        turnstileToken: !turnstileToken,
      }
    });
  }

  // ----------------------------------------------------------
  // 3. 防线介入：Cloudflare Turnstile 服务端验签
  //    验证失败直接 403，保护 GitHub API 额度不被滥耗
  // ----------------------------------------------------------
  const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

  try {
    const verifyResponse = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${TURNSTILE_SECRET_KEY}&response=${turnstileToken}`,
      }
    );
    const verifyData = await verifyResponse.json();

    if (!verifyData.success) {
      console.warn('[Turnstile] 人机验证失败:', verifyData['error-codes']);
      return res.status(403).json({
        error: '人机验证失败，请求被拦截',
        details: verifyData['error-codes']
      });
    }
  } catch (err) {
    console.error('[Turnstile] 无法连接到验证服务:', err.message);
    return res.status(500).json({ error: '无法连接到验证码校验服务' });
  }

  // ----------------------------------------------------------
  // 4. 核心业务逻辑：包裹在 Promise.race 中，实现超时竞争保护
  //    - 正常路径：调用 GitHub API 完成建分支 → 提交文件 → 开 PR
  //    - 超时路径：8s 后抢先 reject，前端接收 504 并触发本地下载容灾
  // ----------------------------------------------------------
  const mainTask = async () => {
    // 4-1. 初始化 Octokit（PAT 来自 Vercel 环境变量，严禁硬编码）
    const octokit = new Octokit({
      auth: process.env.GITHUB_PAT,
    });

    const REPO_OWNER = 'BairlyEmei';
    const REPO_NAME = 'baoyan-archive';

    // 4-2. 生成安全文件路径与动态唯一分支名
    //      使用 大学/学院.md 的嵌套目录结构
    const school = universityName || '未知大学';
    const college = collegeName || '';
    const safeSchool = school.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '');
    const safeCollege = college ? college.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '') : null;
    const baseFilePath = safeCollege
      ? `src/content/docs/统计专业档案/${safeSchool}/${safeCollege}.md`
      : `src/content/docs/统计专业档案/${safeSchool}/index.md`;

    const uniqueSuffix = nanoid(8); // 例：V1St8X3Z

    // 4-3. 获取 main 分支最新 commit SHA（作为新分支的起点）
    const { data: refData } = await octokit.git.getRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: 'heads/main',
    });
    const baseSha = refData.object.sha;

    // 4-4. 文件存在性校验：检查 main 分支是否已有同路径文件
    let fileExists = false;
    try {
      await octokit.repos.getContent({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: baseFilePath,
        ref: 'main',
      });
      fileExists = true;
    } catch (e) {
      if (e.status !== 404) throw e;
      fileExists = false;
    }

    // 4-5. 分支策略分流：根据文件存在性与提交意图决定路径和 PR 标题
    //      若声明为"新增"但文件已存在，则以文件存在性校验为准走补充逻辑
    const isSupplementFlow = fileExists || submissionType === 'supplement';
    let filePath = baseFilePath;
    let finalMarkdownContent = markdownContent;

    if (isSupplementFlow && fileExists) {
      // 文件已存在：重命名为补充文件，避免直接覆盖
      const timestamp = new Date().toISOString().replace(/[:\-]/g, '').slice(0, 16) + 'Z';
      const baseName = safeCollege || 'index';
      filePath = `src/content/docs/统计专业档案/${safeSchool}/${baseName}_补充_${timestamp}.md`;
      // 在 frontmatter 之后插入警告块
      const originalFileName = safeCollege ? `${safeCollege}.md` : 'index.md';
      const warningBlock = `\n> ⚠️ **[补充档案]** 此文件为对已有档案 \`${originalFileName}\` 的补充提交，请 Maintainer 手动将有效内容合并至主文件后删除本文件，切勿直接合并此 PR 而不检查原始档案！\n`;
      // 在 frontmatter 结束符 "---" 之后插入警告块
      finalMarkdownContent = markdownContent.replace(/^(---[\s\S]*?---\n)/, `$1${warningBlock}`);
    }

    const displayName = safeCollege ? `${safeSchool}-${safeCollege}` : safeSchool;
    const prTitlePrefix = isSupplementFlow ? '[补充]' : '[新增]';
    const branchName = `submission-${safeSchool}-${Date.now()}-${uniqueSuffix}`;

    // 4-6. 基于 main 创建新的投稿分支
    await octokit.git.createRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // 4-7. 将 Markdown 内容提交到新分支（utf-8 处理防止中文 Base64 乱码）
    await octokit.repos.createOrUpdateFileContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filePath,
      message: `feat: ${prTitlePrefix} ${displayName} 保研档案`,
      content: Buffer.from(finalMarkdownContent, 'utf-8').toString('base64'),
      branch: branchName,
    });

    const { data: prData } = await octokit.pulls.create({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      title: `📥 ${prTitlePrefix} 档案: ${displayName}`,
      head: branchName,
      base: 'main',
      body: [
        '## 📋 自动生成的档案提交',
        '',
        `**提交类型：** ${prTitlePrefix}`,
        `**投稿院校：** ${universityName}`,
        ...(collegeName ? [`**投稿学院：** ${collegeName}`] : []),
        `**文件路径：** \`${filePath}\``,
        `**提交分支：** \`${branchName}\``,
        `**投稿署名：** ${authorName || '匿名'}`,
        ...(authorEmail ? [`**联系邮箱：** ${authorEmail}`] : []),
        '',
        '> 由用户通过网页端表单自动生成，已通过 Turnstile 人机验证。',
        '> **请 Maintainer 检查数据合规性后再 Merge。**',
      ].join('\n'),
    });

    // 4-7. 成功！返回 200 + PR 链接，前端展示"查看 PR"按钮
    return {
      success: true,
      prUrl: prData.html_url,
      prNumber: prData.number,
      message: 'Pull Request 创建成功，感谢你的贡献！等待维护者审核。',
    };
  };

  try {
    // ⚡ 核心容灾设计：业务逻辑 vs 超时哨兵，谁先完成谁赢
    const result = await Promise.race([
      mainTask(),
                                      createTimeoutPromise(TIMEOUT_MS),
    ]);

    return res.status(200).json(result);

  } catch (error) {
    if (error.code === 'TIMEOUT') {
      // 超时：前端接收 504 后，应立即触发 MarkdownSerializer 本地下载容灾
      console.error('[Timeout] GitHub API 响应超时');
      return res.status(504).json({
        error: '请求超时，服务端未能及时响应',
        fallback: true, // 前端用此字段识别是否触发本地下载容灾
        message: '请将以下 Markdown 内容手动保存，并通过 GitHub 直接提交。',
      });
    }

    // GitHub API 或其他运行时错误：返回 502，前端同样触发容灾
    console.error('[GitHub API] 调用失败:', error.status, error.message);
    return res.status(502).json({
      error: '服务端或 GitHub API 处理失败',
      fallback: true, // 前端容灾触发标志
      details: error.message,
    });
  }
}
