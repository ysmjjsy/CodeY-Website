export const locales = ['zh-CN', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'zh-CN'

export const ui = {
  'zh-CN': {
    'meta.title': 'CodeY — 本地 AI Agent 桌面工作台',
    'meta.description':
      '具备持久化执行、显式权限控制与可复用运行时的本地 AI Agent 桌面工作台。TypeScript、Python、Rust SDK 共用同一套本地运行时。',

    'nav.aria': '主导航',
    'nav.features': '核心能力',
    'nav.architecture': '架构',
    'nav.sdk': 'SDK',
    'nav.docs': '文档',
    'nav.market': '模板市场',
    'nav.github': 'GitHub 仓库',
    'nav.cta': '快速开始',
    'nav.menu.open': '打开菜单',
    'nav.menu.close': '关闭菜单',
    'nav.theme': '主题',
    'nav.theme.dark': '深色',
    'nav.theme.light': '浅色',
    'nav.theme.auto': '跟随系统',
    'nav.lang': '语言',
    'nav.lang.zh': '简体中文',
    'nav.lang.en': 'English',

    'hero.badge': 'v0.1.x Alpha · 活跃开发中',
    'hero.title.line1': '本地 AI Agent',
    'hero.title.line2': '桌面工作台',
    'hero.sub':
      '持久化执行、显式权限控制、可复用运行时。任务在本地守护进程中可靠运行，UI 随时断开重连，同一套 Agent Harness 通过 SDK 服务你的应用。',
    'hero.cta': '快速开始',
    'hero.meta': 'Apache-2.0 开源 · macOS / Windows / Linux · TypeScript / Python / Rust SDK',
    'hero.win.title': 'CodeY — 任务工作台',
    'hero.win.status': '守护进程已连接',
    'hero.win.task': '重构权限流恢复逻辑',
    'hero.win.running': '运行中',
    'hero.win.plan': '计划已生成 · 3 个步骤',
    'hero.win.pass': '通过',
    'hero.win.perm': '权限请求 · 写入',
    'hero.win.allow': '允许',
    'hero.win.deny': '拒绝',
    'hero.win.typing': '正在应用修复',

    'features.tag': '核心能力',
    'features.title': '为长时间运行的 Agent 任务而设计',
    'features.desc':
      '执行权在守护进程，不在 UI。任务状态先落盘再投影，断开、重启、恢复都不丢失现场。',
    'features.durable.title': '持久化任务',
    'features.durable.desc':
      '任务状态和事件写入日志，UI 可以重新连接，守护进程重启后可以恢复任务。外部工具调用带幂等标识，未知结局显式标记为待恢复。',
    'features.controlled.title': '受控执行',
    'features.controlled.desc':
      '权限、沙箱、工作区与网络策略约束每一次运行。敏感或不确定的操作可以暂停，等待明确批准。',
    'features.mode.safe': '安全',
    'features.mode.standard': '标准',
    'features.mode.full': '完全访问',
    'features.mode.custom': '自定义',
    'features.inspectable.title': '可检查的工作台',
    'features.inspectable.desc':
      '计划、进度、命令、文件变更、产物和权限决策，收敛在同一条任务时间线里。',
    'features.extensible.title': '可扩展能力',
    'features.extensible.desc':
      '内置工具、MCP Server、Skill、Plugin、浏览器自动化与经过授权的电脑操作。',
    'features.orchestration.title': 'Agent 编排',
    'features.orchestration.desc':
      '子 Agent、Agent 团队、后台 Agent 与持久化定时任务，全部由守护进程调度。',
    'features.sdk.title': '本地运行时 SDK',
    'features.sdk.desc':
      'TypeScript、Python、Rust 共用同一份 Schema 与同一条守护进程执行路径，不依赖 Tauri。',
    'features.desktop.title': '跨平台桌面端',
    'features.desktop.desc':
      '发布配置覆盖 macOS、Windows 与 Linux，原生电脑操作能力按平台提供。',
    'features.i18n.title': '双语界面',
    'features.i18n.desc': '内置简体中文与英文，支持浅色、深色和跟随系统主题。',

    'arch.tag': '架构',
    'arch.title': '守护进程是执行的唯一权威',
    'arch.desc':
      'React UI 只渲染状态和发送命令。任务执行、恢复、调度、权限、记忆与编排全部由本地守护进程负责，同一运行时也服务非 Tauri 应用。',
    'arch.aria':
      'CodeY 架构：客户端通过本地协议连接守护进程，守护进程持有任务存储并驱动 Agent Harness 能力层',
    'arch.ui': 'React 桌面 UI',
    'arch.ui.sub': 'Tauri 命令桥',
    'arch.ts': 'TypeScript SDK',
    'arch.py': 'Python SDK',
    'arch.rs': 'Rust 客户端',
    'arch.ipc': '本地 IPC · Agent Runtime 协议（Unix Socket / 命名管道）',
    'arch.daemon': 'CodeY 守护进程',
    'arch.daemon.sub': '任务生命周期 · 持久调度 · 权限 · 恢复 · 记忆 · 编排',
    'arch.store': 'SQLite 任务存储（WAL）',
    'arch.cap.models': '模型',
    'arch.cap.tools': '工具与执行',
    'arch.cap.ext': 'MCP · Skill · Plugin',
    'arch.cap.memory': '上下文与记忆',
    'arch.cap.agents': '子 Agent · 团队 · 后台',
    'arch.note1': 'UI 生命周期不构成执行权威，桌面端断开或重启不影响任务状态。',
    'arch.note2': '事件先持久化，客户端再投影为会话、进度、文件差异、产物与权限提示。',
    'arch.note3':
      '外部副作用不承诺 exactly-once，未知结局显式进入待恢复状态，而不是被静默吞掉。',

    'sdk.tag': 'Agent Runtime SDK',
    'sdk.title': '一套运行时，三种语言',
    'sdk.desc':
      'TypeScript、Python、Rust 客户端使用同一份语言无关 Schema 和同一条守护进程执行路径。',
    'sdk.point1':
      '`RunHandle.result()` 不需要消费事件迭代器，内部事件泵负责游标恢复与去重。',
    'sdk.point2': '密钥只在写入时提交，读取只返回元数据，永远不进入事件、日志或快照。',
    'sdk.point3': '运行时与 SDK 严格成对，清单校验目标、哈希与存储 Schema 范围后才启动。',
    'sdk.link': '阅读 SDK 文档',
    'sdk.tabs': 'SDK 语言',
    'sdk.comment.start': '启动或连接本地运行时',
    'sdk.comment.creds': '提供商配置与凭据只在守护进程内解析',
    'sdk.comment.def': '创建不可变的 AgentDefinition 修订并执行',
    'sdk.comment.rs': '连接本地 Agent Runtime 协议',

    'start.tag': '开始使用',
    'start.title': '四条命令，跑起来',
    'start.desc':
      'CodeY 处于 0.1.x 活跃开发阶段，暂未发布安装包，请从源码构建。`pnpm dev` 会先构建守护进程 sidecar 和原生运行时，再启动桌面应用。',
    'start.cta': '查看完整指南',
    'start.term': '构建命令',
    'start.comment': '# 首次启动后：打开项目目录 → 设置 → 模型 → 创建会话',

    'footer.desc':
      '具备持久化执行、显式权限控制与可复用运行时的本地 AI Agent 桌面工作台。',
    'footer.docs': '文档',
    'footer.docs.intro': '什么是 CodeY',
    'footer.docs.start': '快速开始',
    'footer.docs.arch': '架构',
    'footer.docs.sdk': 'Agent Runtime SDK',
    'footer.market': '模板市场',
    'footer.market.browse': '浏览模板',
    'footer.market.upload': '上传模板',
    'footer.community': '社区',
    'footer.community.contribute': '参与贡献',
    'footer.community.coc': '行为准则',
    'footer.more': '更多',
    'footer.more.support': '支持与安全策略',
    'footer.more.license': 'Apache-2.0 许可证',
    'footer.copy': '© 2026 CodeY contributors · Apache License 2.0',
  },
  en: {
    'meta.title': 'CodeY — Local AI Agent Desktop Workbench',
    'meta.description':
      'A local AI agent desktop workbench with durable execution, explicit permissions, and reusable runtimes. TypeScript, Python, and Rust SDKs share one local runtime.',

    'nav.aria': 'Primary',
    'nav.features': 'Features',
    'nav.architecture': 'Architecture',
    'nav.sdk': 'SDK',
    'nav.docs': 'Docs',
    'nav.market': 'Marketplace',
    'nav.github': 'GitHub repository',
    'nav.cta': 'Get started',
    'nav.menu.open': 'Open menu',
    'nav.menu.close': 'Close menu',
    'nav.theme': 'Theme',
    'nav.theme.dark': 'Dark',
    'nav.theme.light': 'Light',
    'nav.theme.auto': 'Auto',
    'nav.lang': 'Language',
    'nav.lang.zh': '简体中文',
    'nav.lang.en': 'English',

    'hero.badge': 'v0.1.x Alpha · Active development',
    'hero.title.line1': 'Local AI Agent',
    'hero.title.line2': 'Desktop Workbench',
    'hero.sub':
      'Durable execution, explicit permissions, reusable runtimes. Tasks run reliably in a local daemon, the UI can disconnect and reconnect anytime, and the same Agent Harness serves your apps through the SDK.',
    'hero.cta': 'Get started',
    'hero.meta': 'Apache-2.0 · macOS / Windows / Linux · TypeScript / Python / Rust SDK',
    'hero.win.title': 'CodeY — Task workbench',
    'hero.win.status': 'Daemon connected',
    'hero.win.task': 'Refactor permission-flow recovery',
    'hero.win.running': 'Running',
    'hero.win.plan': 'Plan ready · 3 steps',
    'hero.win.pass': 'Passed',
    'hero.win.perm': 'Permission request · write',
    'hero.win.allow': 'Allow',
    'hero.win.deny': 'Deny',
    'hero.win.typing': 'Applying fix',

    'features.tag': 'Features',
    'features.title': 'Built for long-running agent work',
    'features.desc':
      'Execution lives in the daemon, not the UI. Task state is persisted first, then projected — disconnect, restart, and recover without losing the scene.',
    'features.durable.title': 'Durable tasks',
    'features.durable.desc':
      'Task state and events are journaled so the UI can reconnect and the daemon can recover work after a restart. External tool calls carry idempotency identities; unknown outcomes are marked recovery-required.',
    'features.controlled.title': 'Controlled execution',
    'features.controlled.desc':
      'Permission, sandbox, workspace, and network policies constrain every run. Sensitive or uncertain operations can pause for explicit approval.',
    'features.mode.safe': 'Safe',
    'features.mode.standard': 'Standard',
    'features.mode.full': 'Full access',
    'features.mode.custom': 'Custom',
    'features.inspectable.title': 'Inspectable workbench',
    'features.inspectable.desc':
      'Plans, progress, commands, file changes, artifacts, and permission decisions converge on one task timeline.',
    'features.extensible.title': 'Extensible capabilities',
    'features.extensible.desc':
      'Built-in tools, MCP servers, skills, plugins, browser automation, and authorized computer control.',
    'features.orchestration.title': 'Agent orchestration',
    'features.orchestration.desc':
      'Subagents, agent teams, background agents, and durable scheduled tasks — all scheduled by the daemon.',
    'features.sdk.title': 'Local runtime SDK',
    'features.sdk.desc':
      'TypeScript, Python, and Rust share one schema and one daemon execution path, without depending on Tauri.',
    'features.desktop.title': 'Cross-platform desktop',
    'features.desktop.desc':
      'Release configs cover macOS, Windows, and Linux. Native computer-control capabilities are platform-specific.',
    'features.i18n.title': 'Bilingual UI',
    'features.i18n.desc':
      'Built-in Simplified Chinese and English, with light, dark, and system theme modes.',

    'arch.tag': 'Architecture',
    'arch.title': 'The daemon is the only execution authority',
    'arch.desc':
      'The React UI only renders state and sends commands. Task execution, recovery, scheduling, permissions, memory, and orchestration live in the local daemon — the same runtime also serves non-Tauri apps.',
    'arch.aria':
      'CodeY architecture: clients connect to the daemon over a local protocol; the daemon owns task storage and drives the Agent Harness capability layer',
    'arch.ui': 'React desktop UI',
    'arch.ui.sub': 'Tauri command bridge',
    'arch.ts': 'TypeScript SDK',
    'arch.py': 'Python SDK',
    'arch.rs': 'Rust client',
    'arch.ipc': 'Local IPC · Agent Runtime protocol (Unix socket / named pipe)',
    'arch.daemon': 'CodeY daemon',
    'arch.daemon.sub': 'Task lifecycle · durable scheduling · permissions · recovery · memory · orchestration',
    'arch.store': 'SQLite task store (WAL)',
    'arch.cap.models': 'Models',
    'arch.cap.tools': 'Tools & execution',
    'arch.cap.ext': 'MCP · Skill · Plugin',
    'arch.cap.memory': 'Context & memory',
    'arch.cap.agents': 'Subagents · teams · background',
    'arch.note1':
      'UI lifecycle is never execution authority — disconnecting or restarting the desktop does not change task state.',
    'arch.note2':
      'Events are persisted first, then projected by clients into sessions, progress, diffs, artifacts, and permission prompts.',
    'arch.note3':
      'External side effects are not exactly-once. Unknown outcomes enter recovery-required instead of being silently dropped.',

    'sdk.tag': 'Agent Runtime SDK',
    'sdk.title': 'One runtime, three languages',
    'sdk.desc':
      'TypeScript, Python, and Rust clients use the same language-neutral schema and the same daemon execution path.',
    'sdk.point1':
      '`RunHandle.result()` does not require consuming the event iterator — an internal pump owns cursor recovery and deduplication.',
    'sdk.point2':
      'Secrets are submitted only on write; reads return metadata and never enter events, logs, or snapshots.',
    'sdk.point3':
      'Runtime and SDK versions are exact pairs. Startup verifies targets, hashes, and storage schema range from the manifest.',
    'sdk.link': 'Read the SDK docs',
    'sdk.tabs': 'SDK languages',
    'sdk.comment.start': 'Start or connect to the local runtime',
    'sdk.comment.creds': 'Provider profiles and credentials resolve only inside the daemon',
    'sdk.comment.def': 'Create an immutable AgentDefinition revision and run',
    'sdk.comment.rs': 'Connect over the local Agent Runtime protocol',

    'start.tag': 'Get started',
    'start.title': 'Four commands to run',
    'start.desc':
      'CodeY is in active 0.1.x development with no packaged release yet — build from source. `pnpm dev` builds the daemon sidecar and native runtimes, then starts the desktop app.',
    'start.cta': 'Full setup guide',
    'start.term': 'Build commands',
    'start.comment': '# After first launch: open a project → Settings → Models → create a session',

    'footer.desc':
      'A local AI agent desktop workbench with durable execution, explicit permissions, and reusable runtimes.',
    'footer.docs': 'Docs',
    'footer.docs.intro': 'What is CodeY',
    'footer.docs.start': 'Getting started',
    'footer.docs.arch': 'Architecture',
    'footer.docs.sdk': 'Agent Runtime SDK',
    'footer.market': 'Marketplace',
    'footer.market.browse': 'Browse templates',
    'footer.market.upload': 'Upload a template',
    'footer.community': 'Community',
    'footer.community.contribute': 'Contributing',
    'footer.community.coc': 'Code of Conduct',
    'footer.more': 'More',
    'footer.more.support': 'Support & security',
    'footer.more.license': 'Apache-2.0 license',
    'footer.copy': '© 2026 CodeY contributors · Apache License 2.0',
  },
} as const

export type UiKey = keyof (typeof ui)['zh-CN']
