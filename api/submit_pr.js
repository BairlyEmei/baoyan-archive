// api/submit_pr.js
import { Octokit } from "@octokit/rest";

// 允许跨域的安全域名白名单
const ALLOWED_ORIGINS = ['http://localhost:4321', 'https://你的生产域名.com'];

export default async function handler(req, res) {
  // 1. 严格的安全防护：CORS 预检与拦截
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. 核心数据解析与安全校验
  const { markdownContent, universityName, turnstileToken } = req.body;

  if (!markdownContent || !universityName) {
    return res.status(400).json({ error: '缺少核心提交数据' });
  }

  // TODO: 在这里接入 Turnstile Token 的服务端验签逻辑，拦截恶意脚本发包

  try {
    // 3. 鉴权：使用配置在 Vercel 环境变量中的细粒度 PAT (不可硬编码)
    const octokit = new Octokit({
      auth: process.env.GITHUB_PAT
    });

    const owner = 'bairlyemei';
    const repo = 'baoyan-archive';
    
    // 生成安全的文件路径和分支名
    const safeName = universityName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '');
    const branchName = `submission-${safeName}-${Date.now()}`;
    const filePath = `src/content/docs/统计专业档案/${safeName}.md`;

    // 4. 获取主分支最新的 commit SHA
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/main',
    });
    const baseSha = refData.object.sha;

    // 5. 创建新分支
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // 6. 提交文件到新分支
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `feat: 新增/更新 ${safeName} 保研档案`,
      content: Buffer.from(markdownContent).toString('base64'),
      branch: branchName,
    });

    // 7. 自动化创建 PR 供核心团队审核
    const { data: prData } = await octokit.pulls.create({
      owner,
      repo,
      title: `📥 档案提交: ${safeName}`,
      head: branchName,
      base: 'main',
      body: `由用户通过网页端表单自动生成的档案提交。\n\n**请 Maintainer 检查数据合规性后 Merge。**`,
    });

    return res.status(200).json({ 
      success: true, 
      prUrl: prData.html_url,
      message: 'Pull Request 创建成功，等待审核' 
    });

  } catch (error) {
    console.error('GitHub API 调用失败:', error);
    // 触发前端的容灾策略：返回 500 状态码，前端接管并提供 Markdown 本地下载
    return res.status(500).json({ error: '服务端处理失败', details: error.message });
  }
}
