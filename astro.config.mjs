import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: '保研信息开源档案库',
      customCss: [
        './src/styles/sidebar-fixes.css',
        './src/styles/copy-link-btn.css',
      ],
      head: [
        {
          tag: 'script',
          attrs: { src: '/copy-links.js', defer: true },
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
