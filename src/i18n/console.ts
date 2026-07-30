import type { Locale } from './ui'

const copy = {
  'zh-CN': {
    title: 'CodeY 控制台',
    personal: '个人中心',
    administration: '平台管理',
    profile: '个人信息',
    templates: '模板管理',
    users: '用户管理',
    reviews: '模板审核',
    models: '模型管理',
    plans: '套餐管理',
    topups: '积分包管理',
    roleAdmin: '管理员',
    roleUser: '用户',
    roleGuest: '未登录',
  },
  en: {
    title: 'CodeY Console',
    personal: 'Personal',
    administration: 'Administration',
    profile: 'Personal information',
    templates: 'Template management',
    users: 'User management',
    reviews: 'Template review',
    models: 'Model management',
    plans: 'Plan management',
    topups: 'Credit packs',
    roleAdmin: 'Administrator',
    roleUser: 'User',
    roleGuest: 'Signed out',
  },
} as const

export function consoleCopy(locale: Locale) {
  return copy[locale]
}
