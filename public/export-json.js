/**
 * export-json.js
 * 为已归档文档页面（统计专业档案）注入「导出 JSON」按钮。
 * 按钮放置在右侧「On This Page」栏目下方，点击后将页面内容解析为 JSON 并复制到剪贴板。
 * JSON 不显示，仅复制。同时适配移动端。
 */
(function () {
  'use strict';

  // ─── 仅在具体的归档文档页运行，排除 index 主页 ─────────────────────
  function isArchivePage() {
    var path = window.location.pathname;
    try {
      path = decodeURIComponent(path);
    } catch (_) {}

    // 如果根本不在这个专业目录下，直接返回 false
    if (!path.includes('/统计专业档案/')) {
      return false;
    }

    // 格式化路径：去掉末尾可能存在的斜杠 "/" 或 "index.html"
    var normalizedPath = path.replace(/\/index\.html$/, '').replace(/\/$/, '');

    // 如果去掉末尾的斜杠后，路径恰好是以 "/统计专业档案" 结尾，
    // 说明当前处于该专业的 index 主页，不需要显示按钮
    if (normalizedPath.endsWith('/统计专业档案')) {
      return false;
    }

    // 只有在具体的院校子页面（例如 /统计专业档案/北京大学/）才会返回 true
    return true;
  }

  // ─── 工具函数：提取列表项中 <strong> 后的文本 ────────────────
  function getStrongKey(li) {
    var strong = li.querySelector(':scope > strong');
    return strong ? strong.textContent.trim() : '';
  }

  function getTextAfterStrong(li) {
    var strong = li.querySelector(':scope > strong');
    if (!strong) return '';
    var parts = [];
    var node = strong.nextSibling;
    while (node) {
      if (node.nodeType === 3 /* TEXT_NODE */) {
        var t = node.textContent.trim();
        if (t) parts.push(t);
      }
      node = node.nextSibling;
    }
    return parts.join('').trim();
  }

  /** 从列表项中提取所有直接子 <a> 的 href（过滤非 http URL）*/
  function getLinksFromLi(li) {
    var links = [];
    li.querySelectorAll(':scope > a').forEach(function (a) {
      if (/^https?:\/\//.test(a.href)) {
        links.push(a.href);
      }
    });
    return links;
  }

  /** 从列表项中提取所有直接子 <a>，返回 { title, url } 对象数组 */
  function getOtherDocsFromLi(li) {
    var docs = [];
    li.querySelectorAll(':scope > a').forEach(function (a) {
      if (/^https?:\/\//.test(a.href)) {
        docs.push({ title: a.textContent.trim(), url: a.href });
      }
    });
    return docs;
  }

  /**
   * 某些 Markdown 渲染器（如 Astro/markdown-it 中的缩进列表）会将嵌套列表项
   * 渲染为父 <li> 的内联子节点（而非嵌套 <ul>），格式类似：
   *   <li><strong>夏令营：</strong>\n* <strong>往年发布时间：</strong> 6月上旬\n* ...</li>
   * 此函数将这些内联子项解析为 { key, text, links } 对象数组。
   */
  function parseInlineLiSubItems(li) {
    var subItems = [];
    var strongs = Array.from(li.querySelectorAll(':scope > strong'));
    // 跳过第一个 strong（父级标签，如"夏令营："）
    for (var i = 1; i < strongs.length; i++) {
      var keyStrong = strongs[i];
      var keyText = keyStrong.textContent.trim();
      var textParts = [];
      var links = [];

      var node = keyStrong.nextSibling;
      while (node) {
        if (node.nodeName === 'STRONG') break; // 遇到下一个子键则停止
        if (node.nodeType === 3 /* TEXT_NODE */) {
          // 清理文本：去除 markdown 列表标记残留（首部 "* " 和尾部 "\n*"）
          var t = node.textContent.replace(/^\s*\*?\s*|\s*\n\s*\*?\s*$/g, '').trim();
          if (t) textParts.push(t);
        } else if (node.nodeName === 'A' && /^https?:\/\//.test(node.href)) {
          links.push(node.href);
        }
        node = node.nextSibling;
      }
      subItems.push({ key: keyText, text: textParts.join('').trim(), links: links });
    }
    return subItems;
  }

  // ─── 各节解析函数 ─────────────────────────────────────────────
  function parseBasicInfoList(ul, basicInfo) {
    ul.querySelectorAll(':scope > li').forEach(function (li) {
      var key = getStrongKey(li);
      var val = getTextAfterStrong(li);
      if (key.includes('招生学院')) basicInfo.college = val;
      else if (key.includes('招生方向')) basicInfo.track = val;
      else if (key.includes('学制与学位') || key.includes('学位')) basicInfo.degree = val;
      else if (key.includes('学校名称')) basicInfo.school = val;
      else if (key.includes('学制长度')) basicInfo.length = val;
    });
  }

  function parseTimelineList(ul, timeline) {
    ul.querySelectorAll(':scope > li').forEach(function (li) {
      var key = getStrongKey(li);
      if (key.includes('官网') || key.includes('网址') || key.includes('网站') || key.includes('官网地址')) {
        var a = li.querySelector(':scope > a');
        if (a && /^https?:\/\//.test(a.href)) timeline.website = a.href;
      } else if (key.includes('夏令营')) {
        var summerUl = li.querySelector(':scope > ul');
        if (summerUl) {
          // 标准嵌套列表格式
          summerUl.querySelectorAll(':scope > li').forEach(function (subLi) {
            var subKey = getStrongKey(subLi);
            if (subKey.includes('发布')) timeline.summer.publish = getTextAfterStrong(subLi);
            else if (subKey.includes('截止')) timeline.summer.deadline = getTextAfterStrong(subLi);
            else if (subKey.includes('通知') || subKey.includes('链接')) timeline.summer.notices = getLinksFromLi(subLi);
          });
        } else {
          // 内联格式（markdown-it 将缩进列表项渲染为父节点的内联内容）
          parseInlineLiSubItems(li).forEach(function (sub) {
            if (sub.key.includes('发布')) timeline.summer.publish = sub.text;
            else if (sub.key.includes('截止')) timeline.summer.deadline = sub.text;
            else if (sub.key.includes('通知') || sub.key.includes('链接')) timeline.summer.notices = sub.links;
          });
        }
      } else if (key.includes('预推免')) {
        var prePushUl = li.querySelector(':scope > ul');
        if (prePushUl) {
          prePushUl.querySelectorAll(':scope > li').forEach(function (subLi) {
            var subKey = getStrongKey(subLi);
            if (subKey.includes('发布')) timeline.prePush.publish = getTextAfterStrong(subLi);
            else if (subKey.includes('通知') || subKey.includes('链接')) timeline.prePush.notices = getLinksFromLi(subLi);
          });
        } else {
          parseInlineLiSubItems(li).forEach(function (sub) {
            if (sub.key.includes('发布')) timeline.prePush.publish = sub.text;
            else if (sub.key.includes('通知') || sub.key.includes('链接')) timeline.prePush.notices = sub.links;
          });
        }
      } else if (key.includes('其他') || key.includes('关键文件')) {
        timeline.otherDocs = getOtherDocsFromLi(li);
      }
    });
  }

  function parseAssessmentList(ul, assessment) {
    ul.querySelectorAll(':scope > li').forEach(function (li) {
      var key = getStrongKey(li);
      if (key.includes('招生规模') || key.includes('招生人数')) {
        assessment.enrollment = getTextAfterStrong(li);
      } else if (key.includes('考核形式')) {
        assessment.format = getTextAfterStrong(li);
      } else if (key.includes('笔试') || key.includes('专业课范围')) {
        assessment.writtenScope = getTextAfterStrong(li);
      } else if (key.includes('背景门槛')) {
        assessment.bar = getTextAfterStrong(li);
      } else if (key.includes('面试偏好')) {
        assessment.interviewPreference = getTextAfterStrong(li);
      } else if (key.includes('综合经验贴')) {
        assessment.experienceLinks = getLinksFromLi(li);
      } else if (key.includes('名单贴')) {
        assessment.admissionListLinks = getLinksFromLi(li);
      } else if (key.includes('面试经验贴')) {
        assessment.interviewLinks = getLinksFromLi(li);
      } else if (key.includes('真题')) {
        assessment.examLinks = getLinksFromLi(li);
      }
    });
  }

  function parseMiscList(ul, misc) {
    ul.querySelectorAll(':scope > li').forEach(function (li) {
      var links = getLinksFromLi(li);
      misc.notesLinks = misc.notesLinks.concat(links);
    });
  }

  // ─── 主解析函数 ───────────────────────────────────────────────
  function parseArchivePageToJson() {
    var article = document.querySelector('.sl-markdown-content');
    if (!article) return null;

    var result = {
      basicInfo: { school: '', college: '', track: '', degree: '', length: '' },
      timeline: {
        website: '',
        summer: { publish: '', deadline: '', notices: [] },
        prePush: { publish: '', notices: [] },
        otherDocs: [],
      },
      assessments: [],
      misc: { notesLinks: [] },
    };

    var currentSection = '';
    var currentAssessmentIndex = -1;

    var children = Array.from(article.children);
    for (var i = 0; i < children.length; i++) {
      var el = children[i];

      // Starlight wraps headings in <div class="sl-heading-wrapper level-hN">
      var headingEl = null;
      var headingTag = null;
      if (el.tagName === 'DIV' && el.classList.contains('sl-heading-wrapper')) {
        if (el.classList.contains('level-h2')) {
          headingEl = el.querySelector('h2');
          headingTag = 'H2';
        } else if (el.classList.contains('level-h3')) {
          headingEl = el.querySelector('h3');
          headingTag = 'H3';
        }
      } else if (el.tagName === 'H2') {
        headingEl = el;
        headingTag = 'H2';
      } else if (el.tagName === 'H3') {
        headingEl = el;
        headingTag = 'H3';
      }

      if (headingEl && headingTag === 'H2') {
        var h2text = headingEl.textContent.trim();
        if (h2text.includes('基础信息')) {
          currentSection = 'basic';
        } else if (h2text.includes('时间轴') || h2text.includes('通知归档')) {
          currentSection = 'timeline';
        } else if (h2text.includes('考核要求') || h2text.includes('备考')) {
          currentSection = 'assessment';
        } else if (h2text.includes('其他碎碎念') || h2text.includes('避雷')) {
          currentSection = 'misc';
        }
      } else if (headingEl && headingTag === 'H3' && currentSection === 'assessment') {
        var h3text = headingEl.textContent.trim();
        // 从 "方向N：【方向名称】" 中提取方向名称；若无【】格式则去除 "方向N：" 前缀
        var nameMatch = h3text.match(/【(.+?)】/);
        var name = nameMatch ? nameMatch[1] : h3text.replace(/^方向\d+[：:]\s*/, '');
        result.assessments.push({
          name: name,
          enrollment: '',
          format: '',
          writtenScope: '',
          bar: '',
          interviewPreference: '',
          experienceLinks: [],
          admissionListLinks: [],
          interviewLinks: [],
          examLinks: [],
        });
        currentAssessmentIndex = result.assessments.length - 1;
      } else if (el.tagName === 'UL') {
        if (currentSection === 'basic') {
          parseBasicInfoList(el, result.basicInfo);
        } else if (currentSection === 'timeline') {
          parseTimelineList(el, result.timeline);
        } else if (currentSection === 'assessment' && currentAssessmentIndex >= 0) {
          parseAssessmentList(el, result.assessments[currentAssessmentIndex]);
        } else if (currentSection === 'misc') {
          parseMiscList(el, result.misc);
        }
      }
    }

    // 若 otherDocs 为空数组，则不输出该字段（保持与 serializeToJson 一致）
    if (result.timeline.otherDocs.length === 0) {
      delete result.timeline.otherDocs;
    }

    return result;
  }

  // ─── 复制到剪贴板 ─────────────────────────────────────────────
  function copyText(text, onSuccess, onFail) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(function () {
        fallbackCopy(text, onSuccess, onFail);
      });
    } else {
      fallbackCopy(text, onSuccess, onFail);
    }
  }

  function fallbackCopy(text, onSuccess, onFail) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
      onSuccess();
    } catch (_) {
      if (onFail) onFail();
    }
    document.body.removeChild(ta);
  }

  // ─── 创建导出组件 ─────────────────────────────────────────────
  function createExportWidget(extraClass) {
    var wrapper = document.createElement('div');
    wrapper.className = 'export-json-widget' + (extraClass ? ' ' + extraClass : '');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'export-json-btn';
    btn.textContent = '导出 JSON';

    var hint = document.createElement('span');
    hint.className = 'export-json-hint';
    hint.textContent = '复制后可粘贴到「参与贡献」板块进行修改投稿';

    btn.addEventListener('click', function () {
      var data = parseArchivePageToJson();
      if (!data) {
        // eslint-disable-next-line no-alert
        window.alert('无法解析页面内容，请确认当前页面是归档文档。');
        return;
      }
      var json = JSON.stringify(data, null, 2);
      copyText(
        json,
        function () {
          btn.textContent = '✅ 已复制 JSON';
          btn.classList.add('export-json-btn--copied');
          setTimeout(function () {
            btn.textContent = '导出 JSON';
            btn.classList.remove('export-json-btn--copied');
          }, 2000);
        },
        function () {
          // eslint-disable-next-line no-alert
          window.alert('复制失败，请检查浏览器权限。');
        }
      );
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(hint);
    return wrapper;
  }

  // ─── 创建移动端 TOC 内紧凑导出按钮 ───────────────────────────────
  function createTocExportBtn() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'export-json-btn export-json-btn--toc export-json-btn--mobile-corner';
    btn.textContent = '导出 JSON';

    btn.addEventListener('click', function (e) {
      e.stopPropagation(); // 防止事件冒泡
      e.preventDefault();  // 防止默认行为

      var data = parseArchivePageToJson();
      if (!data) {
        // eslint-disable-next-line no-alert
        window.alert('无法解析页面内容，请确认当前页面是归档文档。');
        return;
      }
      var json = JSON.stringify(data, null, 2);
      copyText(
        json,
        function () {
          btn.textContent = '✅ 已复制';
          btn.classList.add('export-json-btn--copied');
          showTocCopyToast();
          setTimeout(function () {
            btn.textContent = '导出 JSON';
            btn.classList.remove('export-json-btn--copied');
          }, 2000);
        },
        function () {
          // eslint-disable-next-line no-alert
          window.alert('复制失败，请检查浏览器权限。');
        }
      );
    });

    return btn;
  }

  // ─── 显示复制成功提示 ─────────────────────────────────────────
  function showTocCopyToast() {
    // 与 CSS .export-json-toast { transition: opacity 0.2s ease } 保持一致
    var TOAST_FADE_DURATION = 300;

    var existing = document.querySelector('.export-json-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'export-json-toast';
    toast.textContent = '✅ 复制成功！可粘贴到「参与贡献」板块';
    // 直接用内联样式覆盖，确保在移动端底部居中显示
    toast.style.position = 'fixed';
    toast.style.bottom = '15%';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    toast.style.color = '#fff';
    toast.style.padding = '10px 16px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.zIndex = '9999';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    toast.style.pointerEvents = 'none';

    document.body.appendChild(toast);

    // 触发渐显动画
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
    });

    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () { toast.remove(); }, TOAST_FADE_DURATION);
    }, 2500);
  }

  // ─── 注入按钮 ─────────────────────────────────────────────────
  function injectExportWidget() {
    if (!isArchivePage()) return;

    // 桌面端：幂等检查与注入
    if (!document.querySelector('.export-json-widget--desktop')) {
      var toc = document.querySelector('starlight-toc');
      if (toc) {
        var desktopWidget = createExportWidget('export-json-widget--desktop');
        toc.insertAdjacentElement('afterend', desktopWidget);
      }
    }

    // 移动端：注入到 summary（On this page 行）的最右侧
    if (!document.querySelector('.export-json-btn--mobile-corner')) {
      var mobileTocContainer = document.querySelector('mobile-starlight-toc');
      var mobileNav = mobileTocContainer ? mobileTocContainer.querySelector('nav') : null;
      var mobileSummary = mobileNav ? mobileNav.querySelector('details > summary') : null;

      if (mobileSummary) {
        var mobileBtn = createTocExportBtn();
        // CSS 的 margin-inline-start: auto 已处理靠右对齐，无需内联样式
        mobileSummary.appendChild(mobileBtn);
      }
    }
  }

  // ─── 执行时机 ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectExportWidget);
  } else {
    injectExportWidget();
  }

  // 兼容 Astro View Transitions（页面切换后重新注入）
  document.addEventListener('astro:page-load', injectExportWidget);
})();
