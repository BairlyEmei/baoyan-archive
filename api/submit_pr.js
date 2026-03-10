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
  // 2. 请求体解析与字段空值校验
  // ----------------------------------------------------------
  const { markdownContent, universityName, turnstileToken, authorName, authorEmail } = req.body;

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

    const owner = 'BairlyEmei';
    const repo = 'baoyan-archive';

    // 4-2. 生成安全文件路径与动态唯一分支名
    //      格式：submission-{大学名}-{时间戳}-{nanoid(8)}
    //      nanoid(8) 提供额外随机性，彻底消除高并发下的分支名碰撞风险
    const safeName = universityName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
    const uniqueSuffix = nanoid(8); // 例：V1St8X3Z
    const branchName = `submission-${safeName}-${Date.now()}-${uniqueSuffix}`;
    const filePath = `src/content/docs/统计专业档案/${safeName}.md`;

    // 4-3. 获取 main 分支最新 commit SHA（作为新分支的起点）
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/main',
    });
    const baseSha = refData.object.sha;

    // 4-4. 基于 main 创建新的投稿分支
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // 4-5. 将 Markdown 内容提交到新分支（utf-8 处理防止中文 Base64 乱码）
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `feat: 新增/更新 ${safeName} 保研档案`,
      content: Buffer.from(markdownContent, 'utf-8').toString('base64'),
                                                   branch: branchName,
    });

    const { data: prData } = await octokit.pulls.create({
      owner,
      repo,
      title: `📥 档案提交: ${safeName}`,
      head: branchName,
      base: 'main',
      body: [
        '## 📋 自动生成的档案提交',
        '',
        `**投稿院校：** ${universityName}`,
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
