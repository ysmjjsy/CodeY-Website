// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  vite: {
    server: {
      proxy: {
        '/api/market/v1': process.env.CODEY_MARKET_UPSTREAM || 'http://127.0.0.1:8787',
        '/api/cloud/v1': process.env.CODEY_MARKET_UPSTREAM || 'http://127.0.0.1:8787',
        '/.well-known/codey-market.json':
          process.env.CODEY_MARKET_UPSTREAM || 'http://127.0.0.1:8787',
        '/.well-known/codey-cloud.json':
          process.env.CODEY_MARKET_UPSTREAM || 'http://127.0.0.1:8787',
      },
    },
  },
  integrations: [
    starlight({
      title: 'CodeY',
      description:
        'An AI work partner that helps you complete tasks and deliver results with local-first execution, recoverable tasks, and explicit permissions.',
      defaultLocale: 'root',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
        en: { label: 'English', lang: 'en' },
      },
      logo: { src: './src/assets/logo.png', alt: 'CodeY' },
      favicon: '/favicon.png',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/ysmjjsy/CodeY' },
      ],
      sidebar: [
        {
          label: '开始',
          translations: { en: 'Start' },
          items: [
            {
              label: '什么是 CodeY',
              translations: { en: 'What is CodeY' },
              slug: 'docs/intro',
            },
            {
              label: '快速开始',
              translations: { en: 'Getting started' },
              slug: 'docs/getting-started',
            },
          ],
        },
        {
          label: '核心概念',
          translations: { en: 'Concepts' },
          items: [
            {
              label: '架构',
              translations: { en: 'Architecture' },
              slug: 'docs/architecture',
            },
            {
              label: '受控执行与安全',
              translations: { en: 'Controlled execution & security' },
              slug: 'docs/security',
            },
          ],
        },
        {
          label: 'Agent Runtime SDK',
          translations: { en: 'Agent Runtime SDK' },
          items: [
            {
              label: 'SDK 概览',
              translations: { en: 'SDK overview' },
              slug: 'docs/sdk/overview',
            },
            {
              label: 'Agent 定义与会话',
              translations: { en: 'Agent definitions & sessions' },
              slug: 'docs/sdk/agent-definitions',
            },
            {
              label: '运行时与恢复',
              translations: { en: 'Runtime & recovery' },
              slug: 'docs/sdk/runtime-and-recovery',
            },
            {
              label: '扩展、工具与交互',
              translations: { en: 'Extensions, tools & interaction' },
              slug: 'docs/sdk/extensions',
            },
            {
              label: '错误与排查',
              translations: { en: 'Errors & troubleshooting' },
              slug: 'docs/sdk/errors',
            },
            {
              label: '公共 API 覆盖',
              translations: { en: 'Public API coverage' },
              slug: 'docs/sdk/public-api',
            },
          ],
        },
        {
          label: '社区',
          translations: { en: 'Community' },
          items: [
            {
              label: '参与贡献',
              translations: { en: 'Contributing' },
              slug: 'docs/contributing',
            },
            {
              label: '支持与安全策略',
              translations: { en: 'Support & security' },
              slug: 'docs/support',
            },
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
