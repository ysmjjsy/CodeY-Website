// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  integrations: [
    starlight({
      title: 'CodeY',
      description:
        '具备持久化执行、显式权限控制与可复用运行时的本地 AI Agent 桌面工作台。',
      defaultLocale: 'root',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      logo: { src: './src/assets/logo.png', alt: 'CodeY' },
      favicon: '/favicon.png',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ysmjjsy/CodeY' },
      ],
      sidebar: [
        {
          label: '开始',
          items: [
            { label: '什么是 CodeY', slug: 'docs/intro' },
            { label: '快速开始', slug: 'docs/getting-started' },
          ],
        },
        {
          label: '核心概念',
          items: [
            { label: '架构', slug: 'docs/architecture' },
            { label: '受控执行与安全', slug: 'docs/security' },
          ],
        },
        {
          label: 'Agent Runtime SDK',
          items: [
            { label: 'SDK 概览', slug: 'docs/sdk/overview' },
            { label: 'Agent 定义与会话', slug: 'docs/sdk/agent-definitions' },
            { label: '运行时与恢复', slug: 'docs/sdk/runtime-and-recovery' },
            { label: '扩展、工具与交互', slug: 'docs/sdk/extensions' },
            { label: '错误与排查', slug: 'docs/sdk/errors' },
            { label: '公共 API 覆盖', slug: 'docs/sdk/public-api' },
          ],
        },
        {
          label: '社区',
          items: [
            { label: '参与贡献', slug: 'docs/contributing' },
            { label: '支持与安全策略', slug: 'docs/support' },
          ],
        },
      ],
      customCss: [
        '@fontsource-variable/space-grotesk',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/starlight.css',
      ],
    }),
  ],
})
