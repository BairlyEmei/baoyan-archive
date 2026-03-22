/**
 * Split text by newline only.  Each line is treated as one link entry.
 * Pipe characters (|) are intentionally NOT used as separators so that
 * users can freely paste share text that contains | without it being
 * broken into two spurious entries.
 */
function smartSplitLinks(text) {
    return text.split('\n').map((s) => s.trim()).filter(Boolean);
}

function normalizeLinks(rawText) {
    if (!rawText) {
        return [];
    }

    // Only keep items that actually contain a URL.  This discards trailing
    // boilerplate lines from mobile Xiaohongshu share text such as
    // "复制后打开【小红书】查看笔记！" that do not hold a real link.
    return smartSplitLinks(String(rawText)).filter((item) => /https?:\/\//.test(item));
}

/**
 * Decode common HTML entities inside a URL string (e.g. &amp; → &).
 * Uses a single-pass replacement to avoid double-decoding chained entities.
 */
function decodeHtmlEntities(str) {
    const map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    return str.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => map[m] ?? m);
}

/**
 * Given a single entry (after trim), extract the URL and any anchor label
 * that precedes it in the text.
 *
 * Returns { url, label }:
 *   - url   – the raw URL extracted (or the whole item if no URL pattern found)
 *   - label – text before the URL, or null when the default "链接X" label should be used
 */
function extractLinkParts(item) {
    // Handle markdown link format: [label](url) – detect this first to avoid
    // mangling the bracket/paren characters as part of the label.
    const mdLinkMatch = /^\[([^\]]+)\]\((https?:\/\/[^\s)]*)\)/.exec(item);
    if (mdLinkMatch) {
        const label = mdLinkMatch[1].trim() || null;
        const url = decodeHtmlEntities(mdLinkMatch[2]);
        return { url, label };
    }

    // Stop at whitespace or CJK/fullwidth characters so trailing Chinese text
    // (e.g. "点击查看") is not absorbed into the URL.
    const urlPattern = /https?:\/\/[^\s\u3000-\u9fff\uff00-\uffef]+/;
    const match = urlPattern.exec(item);

    if (!match) {
        // No recognisable URL – treat the whole item as the URL (legacy behaviour)
        return { url: item, label: null };
    }

    const url = decodeHtmlEntities(match[0]);
    const textBefore = item.slice(0, match.index).trim();

    if (textBefore) {
        // Try to extract a clean label from Xiaohongshu PC share text.
        // Expected format: "N 【post-title - author | 小红书 - platform-name】 emoji ..."
        // Group 1 = post title (before the first " - author" or " | 小红书" inside 【...】).
        const xhsMatch = /^\d*\s*【([^|】]+?)(?:\s*[-–]\s*[^|】]+)?(?:\s*\|[^】]+)?】/.exec(textBefore);
        if (xhsMatch) {
            return { url, label: xhsMatch[1].trim() };
        }
        // There is meaningful text before the URL – use it as the anchor label;
        // any trailing text after the URL is intentionally dropped.
        return { url, label: textBefore };
    }

    // No text before the URL (pure link or URL-first entry) → default label
    return { url, label: null };
}

function linksToInline(rawText) {
    const links = normalizeLinks(rawText);
    if (links.length === 0) {
        return '（留空）';
    }

    return links
        .map((item, idx) => {
            const { url, label } = extractLinkParts(item);
            const displayLabel = label || `链接${idx + 1}`;
            return `[${displayLabel}](${url})`;
        })
        .join(' | ');
}

function otherDocsToLine(otherDocs = []) {
    if (!otherDocs.length) {
        return '（留空）';
    }

    return otherDocs
        .filter((doc) => doc && (doc.title || doc.url))
        .map((doc) => {
            const title = doc.title?.trim() || '未命名文件';
            const url = doc.url?.trim() || '#';
            return `[${title}](${url})`;
        })
        .join('、');
}

function escapeYamlText(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, ' ')
        .trim();
}

function buildFrontmatter(formData) {
    const school = formData?.basicInfo?.school?.trim() || '未命名院校';
    const track = formData?.basicInfo?.track?.trim() || '统计专业档案';
    const college = formData?.basicInfo?.college?.trim() || '未知学院';
    const title = `${school} - ${college}`;
    const description = `${school}${college}${track}信息归档`;

    return `---\n` +
        `title: "${escapeYamlText(title)}"\n` +
        `description: "${escapeYamlText(description)}"\n` +
        `---`;
}

export function serializeToMarkdown(formData, authorName) {
    const basicInfo = formData?.basicInfo || {};
    const timeline = formData?.timeline || {};
    const summer = timeline.summer || {};
    const prePush = timeline.prePush || {};
    const assessments = formData?.assessments || [];
    const misc = formData?.misc || {};
    const frontmatter = buildFrontmatter(formData);

    const section3 = assessments.length
        ? assessments
            .map(
                (item, idx) => `### 方向${idx + 1}：【${item.name || '未命名方向'}】
* **预计招生规模：** ${item.enrollment || '（留空）'}
* **考核形式：** ${item.format || '（留空）'}
* **笔试/专业课范围：** ${item.writtenScope || '（留空）'}
* **背景门槛 (Bar)：** ${item.bar || '（留空）'}
* **面试偏好：** ${item.interviewPreference || '（留空）'}
* **综合经验贴（夏令营/预推免）：** ${linksToInline(item.experienceLinks)}
* **优营/预推免名单贴：** ${linksToInline(item.admissionListLinks)}
* **面试经验贴：** ${linksToInline(item.interviewLinks)}
* **真题分享贴：** ${linksToInline(item.examLinks)}`
            )
            .join('\n\n')
        : '### 方向A：【请补充方向名称】\n* **预计招生规模：** （留空）';

    const attribution = authorName?.trim()
        ? `\n\n---\n\n<small>信息收集与整理：${authorName.trim()}</small>`
        : '';

    return `${frontmatter}

## 1. 基础信息速览
* **招生学院：** ${basicInfo.college || '（留空）'}
* **招生方向：** ${basicInfo.track || '（留空）'}
* **学制与学位：** ${basicInfo.degree || '（留空）'}
* **学校名称：** ${basicInfo.school || '（留空）'}
* **学制长度：** ${basicInfo.length || '（留空）'}

## 2. 官方时间轴与通知归档
* **研究生院/学院官网地址：** ${timeline.website ? `[链接](${timeline.website})` : '（留空）'}
* **夏令营：**
		* **往年发布时间：** ${summer.publish || '（留空）'}
		* **往年截止时间：** ${summer.deadline || '（留空）'}
		* **官方通知链接：** ${linksToInline(summer.notices)}
* **预推免：**
		* **往年发布时间：** ${prePush.publish || '（留空）'}
		* **官方通知链接：** ${linksToInline(prePush.notices)}
* **其他关键文件：** ${otherDocsToLine(timeline.otherDocs || [])}

## 3. 考核要求与备考攻略
${section3}

## 4. 其他碎碎念与避雷贴
* **就读体验/导师风评/吐槽贴：** ${linksToInline(misc.notesLinks)}${attribution}`;
}

export function toLineSeparatedText(value) {
    if (Array.isArray(value)) {
        return value.join('\n');
    }

    return value || '';
}

/**
 * Convert the current form state to a structured JSON object suitable for
 * archiving or re-importing via the JSON input area.  Link fields (which are
 * stored as newline-separated strings in form state) are converted to URL
 * arrays, and an optional attribution (署名) field is included.
 */
export function serializeToJson(formData, authorName) {
    const timeline = formData?.timeline || {};
    const summer = timeline.summer || {};
    const prePush = timeline.prePush || {};

    const toLinkArray = (raw) =>
        normalizeLinks(raw)
            .map((item) => {
                const { url, label } = extractLinkParts(item);
                if (!/^https?:\/\//.test(url)) return null;
                return label ? `[${label}](${url})` : url;
            })
            .filter(Boolean);

    const otherDocs = (timeline.otherDocs || [])
        .filter((doc) => doc && (doc.title || doc.url))
        .map((doc) => ({ title: doc.title?.trim() || '', url: doc.url?.trim() || '' }));

    const assessments = (formData?.assessments || []).map((item) => ({
        name: item.name || '',
        enrollment: item.enrollment || '',
        format: item.format || '',
        writtenScope: item.writtenScope || '',
        bar: item.bar || '',
        interviewPreference: item.interviewPreference || '',
        experienceLinks: toLinkArray(item.experienceLinks),
        admissionListLinks: toLinkArray(item.admissionListLinks),
        interviewLinks: toLinkArray(item.interviewLinks),
        examLinks: toLinkArray(item.examLinks),
    }));

    const obj = {
        basicInfo: {
            school: formData?.basicInfo?.school || '',
            college: formData?.basicInfo?.college || '',
            track: formData?.basicInfo?.track || '',
            degree: formData?.basicInfo?.degree || '',
            length: formData?.basicInfo?.length || '',
        },
        timeline: {
            website: timeline.website || '',
            summer: {
                publish: summer.publish || '',
                deadline: summer.deadline || '',
                notices: toLinkArray(summer.notices),
            },
            prePush: {
                publish: prePush.publish || '',
                notices: toLinkArray(prePush.notices),
            },
            ...(otherDocs.length ? { otherDocs } : {}),
        },
        assessments,
        misc: {
            notesLinks: toLinkArray(formData?.misc?.notesLinks),
        },
        attribution: authorName?.trim() || '匿名',
    };

    return JSON.stringify(obj, null, 2);
}
