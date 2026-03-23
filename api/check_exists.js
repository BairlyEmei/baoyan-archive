// api/check_exists.js
import { Octokit } from "@octokit/rest";

// ============================================================
// 动态跨域白名单（与 submit_pr.js 保持一致）
// ============================================================
const ALLOWED_ORIGINS = [
  'http://localhost:4321',
  'http://localhost:3000',
  'https://baoyan-archive.vercel.app',
  'https://stat-archive.bairly.me',
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

const REPO_OWNER = 'BairlyEmei';
const REPO_NAME = 'baoyan-archive';

// ============================================================
// 主处理函数
// ============================================================
export default async function handler(req, res) {
  // ----------------------------------------------------------
  // 1. CORS 预检
  // ----------------------------------------------------------
  const origin = req.headers.origin;

  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    return res.status(403).json({ error: 'CORS policy violation: Origin not allowed' });
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ----------------------------------------------------------
  // 2. 解析查询参数
  // ----------------------------------------------------------
  const { school, college } = req.query;

  if (!school) {
    return res.status(400).json({ error: '缺少必填参数 school' });
  }

  const safeSchool = school.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '');
  const safeCollege = college ? college.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, '') : null;
  const filePath = safeCollege
    ? `src/content/docs/统计专业档案/${safeSchool}/${safeCollege}.md`
    : `src/content/docs/统计专业档案/${safeSchool}/index.md`;

  // ----------------------------------------------------------
  // 3. 查询 GitHub 仓库中的文件是否存在
  //    网络异常时降级返回 exists: false，不阻塞正常提交流程
  // ----------------------------------------------------------
  try {
    const octokit = new Octokit({
      auth: process.env.GITHUB_PAT,
    });

    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filePath,
      ref: 'main',
    });

    // 文件存在，解码内容并返回
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return res.status(200).json({ exists: true, content });
  } catch (e) {
    if (e.status === 404) {
      return res.status(200).json({ exists: false });
    }
    // 网络异常或其他错误：降级为不检查
    console.error('[check_exists] GitHub API error:', e.message);
    return res.status(200).json({ exists: false });
  }
}
