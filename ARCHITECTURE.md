# 保研信息开源档案库 (统计学专版) - 全栈架构与技术设计文档

## 一、 项目定位与架构目标
本项目旨在构建一个专为统计学及相关专业服务的高质量、开源保研信息协作平台。系统设计围绕以下核心目标展开：

* **极低运维成本：** 采用 Serverless 架构，依托纯静态站点与无服务器函数（Serverless Functions），彻底消除传统云服务器的配置与数据库维护负担。
* **按需扩展性 (YAGNI 原则)：** 当前目录结构垂直聚焦于“统计学类”专业，不预设冗余的跨专业框架，以保证信息密度。架构设计保持松耦合，为未来的横向学科扩展保留空间。
* **标准化众包协作 (免账号 & 人在回路)：** 引入“AI 数据提取 + 可视化表单微调”的创新协作流。平台提供标准 JSON Schema 与预设 Prompt，借助外部大语言模型（LLM）提取非结构化文本后，前端解析并渲染为**双向绑定的动态表单**。用户可通过图形化界面逐项核对与修改，彻底抹平 Markdown 语法与代码层面的贡献门槛。
* **数据版本控制与审核机制：** 所有外部提交均通过 API 转化为 GitHub Pull Request (PR)。前端负责将表单状态序列化为标准 Markdown。核心维护团队保留最终 Merge 权限，确保 `main` 分支数据的绝对准确性与格式一致性。
* **高可维护性与组件化：** 采用现代化的 Astro 框架重构，替代传统静态生成器。将复杂的表单校验与状态管理逻辑封装为独立的 React/Vue 组件，实现内容与逻辑的彻底解耦，解决代码维护痛点。

## 二、 技术选型 (基于 Vercel Monorepo 架构)

* **前端静态渲染：** Astro + Starlight (Astro 官方文档主题，提供极致的首屏加载速度与现代化的 MDX 组件开发体验)。
* **前端交互逻辑：** 在 Astro 中集成 React，利用 `react-hook-form` 处理复杂表单状态。融合 JSON 容错解析、Ajv 强校验、动态表单映射（State 驱动）与 Markdown 逆向序列化逻辑，确保核心交互模块的高内聚。
* **后端 API 服务：** Vercel Serverless Functions。采用纯 Node.js 或 Edge Functions 环境以规避冷启动延迟，封装鉴权 Token 并利用 `octokit` 实例调用 GitHub API 自动化创建 PR。
* **数据存储与版本控制：** GitHub 仓库作为单一事实来源 (Single Source of Truth, SSOT)。
* **托管与 CI/CD 流水线：** Vercel (负责静态构建与 API 边缘部署) 结合 GitHub Actions (负责自动化合规预检与死链排查)。

## 三、 项目目录结构
项目采用扁平化、模块化设计，前端展示、交互组件与后端 API 的职责严格分离：

├── .github/workflows/          # GitHub Actions 自动化 CI/CD 脚本
├── astro.config.mjs            # Astro 全局配置 (集成 Starlight 主题及 React 渲染器)
├── package.json                # 前端框架与交互组件依赖声明
├── api/                        # 后端接口目录 (Vercel Serverless Functions)
│   ├── package.json            # 后端运行依赖 (如 octokit)
│   └── submit_pr.js            # 核心网关：接收 Markdown 文本，创建分支并提交 PR
└── src/
    ├── components/             # 独立前端交互组件库 (核心逻辑区)
    │   ├── SubmitForm.jsx      # 投稿主容器 (集成 Prompt 复制、JSON 录入与动态表单渲染)
    │   ├── JsonParser.js       # 数据清洗模块：处理 AI 冗余标记并执行 Ajv Schema 校验
    │   └── MarkdownSerializer.js # 序列化工具：将表单 State 逆向转化为标准 Markdown
    ├── content/docs/           # 前端内容目录 (Starlight 渲染源)
        ├── index.mdx           # 站点首页
        ├── template.md         # 标准数据档案 Markdown 模板
        ├── contribute.mdx      # 贡献者交互入口 (<SubmitForm client:load /> 挂载点)
        └── 统计专业档案/         # 核心数据存储区 (SSOT)
            ├── 中国人民大学统计学院.md 
            └── 北京大学.md     

## 四、 核心数据模型 (Data Schema) 设计
系统的数据录入与最终的 Markdown 渲染，均严格遵循以下四层结构规范：

1. **基础信息速览 (Basic Info)：** 包含招生学院、方向、学制等强类型、枚举型字段。
2. **官方时间轴与通知归档 (Timeline & Links)：** 记录夏令营/预推免的发布与截止时间戳，并对 URL 字段实施强制正则校验。
3. **考核要求与备考攻略 (Assessment & Prep)：** **采用动态数组 (Array) 结构**。在前端映射为可动态增删的卡片组。用于精准隔离同一学院下不同项目（如：直博/硕博连读/应统专硕）的招生规模、机试门槛与笔试范围，消除信息歧义。
4. **主观经验与评价 (Miscellaneous)：** 收集就读体验、导师评价等非结构化经验信息。

## 五、 核心协作工作流与自动化 (Workflow & CI/CD)

1. **AI 预填与 Prompt 引导 (零门槛接入)：** 用户在 `contribute.mdx` 获取预设的 JSON Schema 模板与 Prompt，交由外部大模型（如 Kimi/DeepSeek）处理。AI 将用户的自然语言经验帖解析为结构化 JSON。
2. **JSON 容错解析与拦截预检：** 用户将生成的 JSON 输入系统。前端 `JsonParser` 组件利用正则自动清洗 ```json 等冗余 Markdown 标记，并执行 Ajv 校验。如遇字段约束冲突（如类型不匹配），UI 层予以精准高亮阻断，防止脏数据注入。
3. **双向绑定动态表单 (可视化校对)：** 解析合规的 JSON 即时映射至可视化表单控件。复杂的层级数据（如考核细则）渲染为独立卡片。用户在此阶段完成最终的审阅、微调与补全，无需接触底层代码。
4. **逆向序列化与 API 提交：** 用户确认无误后发起提交。`MarkdownSerializer` 将表单 State 严格按照 `template.md` 规范拼接为 Markdown 文本流。随后附带 Turnstile 验证码 token 向 `/api/submit_pr` 发起 POST 请求。
    * *容灾策略：* 若遇网络异常或 API 超时，前端将拦截路由跳转，并提供生成的 Markdown 文件供用户一键下载至本地。
5. **GitHub Actions 自动化预检 (Pre-Merge Check)：**
    * API 成功通过 `octokit` 创建 PR 后，触发仓库配置的 GitHub Actions 流水线。
    * 执行 Markdown Lint 与 Broken Link Checker。未通过预检的 PR 将被 CI 机器人自动打回并评论修正建议。
6. **代码合并与自动发布：** 核心维护者对 PR 的数据真实性与评价合规性进行 Review。Merge 至 `main` 分支后，触发 Vercel 自动构建，静态资源将秒级分发至全球 CDN。

## 六、 安全与防滥用控制规范

* **密钥隔离与权限最小化：** 严禁使用全局权限 Token。强制采用 GitHub Fine-grained PAT 注入 Vercel 环境变量，权限严格收敛至目标仓库的 `Contents (Read/Write)` 和 `Pull Requests (Read/Write)`。
* **接口安全防护：** 实施严格的 CORS 白名单策略。配合后端 Turnstile 验证码验签与 Vercel Edge IP Rate Limiting，有效防御恶意脚本批量并发请求，保护 GitHub Actions 免费额度。
