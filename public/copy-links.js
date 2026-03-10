/**
 * copy-links.js
 * 全局脚本：为文章内每个外链自动插入"复制"按钮。
 * 通过 Starlight head 注入，无需修改任何 Markdown 文件。
 */
(function () {
  'use strict';

  function addCopyButtons() {
    // 首页（splash 模板）不添加复制按钮
    if (document.querySelector('[data-has-hero]')) return;

    // 仅在文章正文区域操作，避免污染导航栏、侧边栏等
    var article = document.querySelector('.sl-markdown-content');
    if (!article) return;

    var links = article.querySelectorAll(
      'a[href^="http://"], a[href^="https://"]'
    );

    links.forEach(function (link) {
      // 幂等处理：已添加过则跳过
      if (link.dataset.copyBtnAdded) return;
      link.dataset.copyBtnAdded = 'true';

      var btn = document.createElement('button');
      btn.className = 'copy-link-btn';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', '复制链接');
      btn.setAttribute('title', '复制链接地址');
      btn.textContent = '复制';

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();

        var url = link.href;

        function onSuccess() {
          btn.textContent = '已复制 ✓';
          btn.classList.add('copy-link-btn--copied');
          setTimeout(function () {
            btn.textContent = '复制';
            btn.classList.remove('copy-link-btn--copied');
          }, 1500);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(onSuccess).catch(function () {
            fallbackCopy(url, onSuccess);
          });
        } else {
          fallbackCopy(url, onSuccess);
        }
      });

      link.insertAdjacentElement('afterend', btn);
    });
  }

  function fallbackCopy(text, callback) {
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
      callback();
    } catch (_) {
      // 无法复制时静默失败
    }
    document.body.removeChild(ta);
  }

  // 普通页面加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addCopyButtons);
  } else {
    addCopyButtons();
  }

  // 兼容 Astro View Transitions（页面切换后重新运行）
  document.addEventListener('astro:page-load', addCopyButtons);
})();
