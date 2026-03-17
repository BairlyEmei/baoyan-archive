<div align="center">

# 📚 保研信息开源档案库（统计学专版）

**开源 · 透明 · 可验证的保研信息协作平台**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://stat-archive.bairly.me)
[![Built with Astro](https://img.shields.io/badge/Built%20with-Astro-ff5d01?logo=astro&logoColor=white)](https://astro.build)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/BairlyEmei/baoyan-archive/pulls)

🌐 **在线访问：[stat-archive.bairly.me](https://stat-archive.bairly.me)**

</div>

---

## 📖 项目简介

**保研信息开源档案库（统计学专版）** 是一个由保研人共同维护的高质量、开源协作平台。本项目专为统计学及相关专业（应用统计、数据科学、生物统计等）服务，旨在打破保研信息壁垒，通过标准化的数据模型构建极低维护成本、高信息密度的前沿档案库。

系统收录并结构化整理了各高校的保研关键信息，包括：
- 🗓️ **官方时间轴与通知归档**：夏令营/预推免的发布与截止时间戳，并对链接实施强制校验。
- 📋 **考核要求与备考攻略**：笔试范围、面试偏好与背景门槛，精准隔离同一学院下不同项目的细则。
- 💬 **主观经验与评价**：就读体验、导师评价等一手非结构化经验信息。

所有数据完全开源，版本可溯源，信息可验证。

> ⚠️ **注意**：本项目所有信息仅供参考，不对申请结果负责。使用、贡献前请仔细阅读 [免责声明 (Disclaimer)](./DISCLAIMER.md)。

---

## ✨ 核心特色

| 特色 | 说明 |
|------|------|
| 🤖 **AI 零门槛协作** | 引入「AI 数据提取 + 可视化表单微调」工作流。借助大模型提取文本，前端自动解析为双向绑定表单，无需懂代码即可贡献。 |
| 📄 **高密度数据模型** | 所有档案遵循统一的四层结构规范。复杂的考核细则映射为可动态增删的卡片组，消除信息歧义。 |
| 🔍 **单一事实来源** | 所有数据托管于 GitHub，作为单一事实来源 (SSOT)。通过自动化 PR 机制确保主分支数据的绝对准确性。 |
| ⚡ **极速与低耗** | 基于 Astro + Starlight 静态生成，结合 Vercel Serverless Functions 部署，全球 CDN 分发，彻底消除传统服务器运维成本。 |

---

## 🗂️ 已收录院校

目前档案库垂直聚焦于统计学类专业，已收录以下院校（持续更新中）：
- 中国人民大学 · 统计学院（直博 / 硕博连读 / 应用统计专硕 / 流行病与卫生统计学硕士）
- *(更多院校档案欢迎社区贡献……)*

---

## 🚀 如何参与贡献

我们为零代码基础的用户设计了创新的免账号众包工作流：

1. **获取预设 Prompt**：前往网站[贡献页面](https://stat-archive.bairly.me/contribute)，一键复制预设的提示词与 JSON Schema 模板。
2. **AI 数据清洗**：将 Prompt 与您的经验帖发送给联网大模型（推荐 Kimi / Gemini / DeepSeek 等），AI 将自动提取并生成结构化 JSON。
3. **可视化校对与提交**：将生成的 JSON 输入本站。前端 `JsonParser` 会自动拦截预检并映射至图形化表单。您只需人工核对微调，确认无误后点击提交，系统会将其逆向序列化为 Markdown 并自动创建 PR。



> **严格的审核机制**：所有 API 提交均通过 `octokit` 转化为 Pull Request。经过 GitHub Actions 自动化预检（Markdown Lint 与死链排查）后，由核心维护者 Review 并合并至 `main` 分支。

---

## 🛠️ 技术栈与防滥用机制

本项目前端展示、交互组件与后端 API 的职责严格分离。

| 层级 | 技术方案 |
|------|------|
| **前端框架** | [Astro](https://astro.build) + [Starlight](https://starlight.astro.build) |
| **交互组件** | React + `react-hook-form`（负责复杂表单状态管理） |
| **数据校验** | [Ajv](https://ajv.js.org)（执行严格的 JSON Schema 校验） |
| **后端 API** | Vercel Serverless Functions（纯 Node.js/Edge 规避冷启动） |
| **GitHub 集成** | `@octokit/rest` + 细粒度 PAT（权限严格收敛） |
| **安全防护** | 严格的 CORS 白名单 + Turnstile 验证码 + Vercel Edge IP 限流 |
| **托管与 CI/CD** | Vercel + GitHub Actions |

---

## 📁 目录架构

```text
baoyan-archive/
├── .github/workflows/          # GitHub Actions 自动化 CI/CD 脚本
├── api/
│   └── submit_pr.js            # 核心网关：接收 Markdown 文本，创建分支并提交 PR
├── src/
│   ├── components/             # 独立前端交互组件库
│   │   ├── SubmitForm.jsx      # 投稿主容器（集成 Prompt、JSON 录入与表单渲染）
│   │   ├── JsonParser.js       # 数据清洗模块：处理冗余标记并执行 Ajv 校验
│   │   └── MarkdownSerializer.js # 序列化工具：将表单 State 转化为标准 Markdown
│   └── content/docs/
│       ├── index.mdx           # 站点首页
│       ├── contribute.mdx      # 贡献者交互入口
│       ├── template.md         # 标准数据档案 Markdown 模板
│       └── 统计专业档案/         # 📂 核心数据存储区 (SSOT)
│           └── 中国人民大学统计学院.md
├── astro.config.mjs            # Astro 全局配置
├── vercel.json                 # Vercel 部署配置
└── package.json

```

---

## 🔧 本地开发

```bash
# 克隆仓库
git clone [https://github.com/BairlyEmei/baoyan-archive.git](https://github.com/BairlyEmei/baoyan-archive.git)
cd baoyan-archive

# 安装依赖
npm install

# 启动开发服务器
npm run dev

```

访问 `http://localhost:4321` 查看本地预览。

---

## 📜 许可证

本项目采用 [MIT License](https://www.google.com/search?q=./LICENSE) 开源。数据内容由社区贡献者共同维护，转载请注明来源。
