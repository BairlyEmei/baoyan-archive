import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: '保研信息开源档案库',
      components: {
        Footer: './src/components/CustomFooter.astro',
        Head: './src/components/CustomHead.astro',
      },
      customCss: [
        './src/styles/sidebar-fixes.css',
        './src/styles/copy-link-btn.css',
        './src/styles/export-json-btn.css',
        './src/styles/homepage.css',
      ],
      head: [
        {
          tag: 'script',
          attrs: { src: '/copy-links.js', defer: true },
        },
        {
          tag: 'script',
          attrs: { src: '/export-json.js', defer: true },
        },
        {
          tag: 'script',
          attrs: { src: '/scroll-restore.js', defer: true },
        },
        {
          tag: 'script',
          content: `
(function() {
  var PLACEHOLDER = '搜索高校名称、专业或关键词...';
  function applyPlaceholder() {
    var inputs = document.querySelectorAll('input[type="search"], input[type="text"]');
    inputs.forEach(function(el) {
      if (!el.placeholder || el.placeholder === 'Search') {
        el.placeholder = PLACEHOLDER;
      }
    });
  }
  document.addEventListener('DOMContentLoaded', function() {
    applyPlaceholder();
    // Watch for the search dialog being opened and set placeholder once it appears
    var observer = new MutationObserver(function() {
      applyPlaceholder();
      // Disconnect once a search input with the correct placeholder is present
      if (document.querySelector('input[placeholder="' + PLACEHOLDER + '"]')) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
`,
        },
      ],
      sidebar: [
        {
          label: '首页',
          link: '/',
        },
        {
          label: '参与贡献',
          link: '/contribute',
        },
        {
          label: '统计专业档案',
          // 这里的自动生成配置非常关键，它会自动读取我们之前创建的目录
          autogenerate: { directory: '统计专业档案' },
        },
      ],
    }),
    react(),
  ],
});
