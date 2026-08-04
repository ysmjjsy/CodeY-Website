---
title: 什么是 CodeY
description: CodeY 是帮助你完成任务并交付结果的 AI 工作伙伴。
---

CodeY 是帮助你完成任务并交付结果的 AI 工作伙伴。你可以把目标、文件、链接或项目上下文交给它；CodeY 会在授权范围内使用当前可用能力，推进任务、检查结果并清楚交付。

CodeY 采用本地优先的执行方式。任务由本地守护进程持久化运行，权限显式受控；同一套运行时既服务桌面端，也通过 SDK 服务你的应用。

:::caution[开发阶段]
CodeY 正处于 `0.3.x` 活跃开发阶段。安装包和版本记录通过 [GitHub Releases](https://github.com/ysmjjsy/CodeY-Releases/releases) 发布。稳定版本发布前，接口和存储格式可能发生变化。
:::

## 两个入口

- **CodeY Desktop**：面向项目的桌面工作空间，用于发起、检查和管理 CodeY 任务。
- **CodeY Agent Runtime**：通过统一的本地协议，将同一套持久化 Agent Harness 提供给 TypeScript、Python 和 Rust 应用。

React UI 不执行 Agent 工作。它通过 Tauri 将命令发送给本地守护进程。任务执行、恢复、调度、权限、记忆、工具和 Agent 编排均由守护进程负责。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 持久化任务 | 任务状态和事件写入日志，UI 可以重新连接，守护进程重启后可以恢复任务 |
| 可检查的工作台 | 在同一条任务时间线中查看计划、进度、命令、文件变更、产物和权限决策 |
| 受控执行 | 安全、标准、完全访问和自定义运行设置，由权限、沙箱、工作区和网络策略约束 |
| 可扩展能力 | 内置工具、MCP Server、Skill、Plugin、浏览器自动化和经过授权的电脑操作 |
| Agent 编排 | 子 Agent、Agent 团队、后台 Agent 和持久化定时任务 |
| 本地运行时 SDK | TypeScript、Python 和 Rust 应用复用同一运行时，不依赖 Tauri |
| 跨平台桌面端 | 发布配置覆盖 macOS、Windows 和 Linux；原生电脑操作能力因平台而异 |
| 双语界面 | 内置简体中文和英文，支持浅色、深色和跟随系统主题 |

## 下一步

- [快速开始](/docs/getting-started/)：下载安装包，或从源码运行 CodeY
- [架构](/docs/architecture/)：理解守护进程、任务存储与 Harness 的职责边界
- [Agent Runtime SDK](/docs/sdk/overview/)：在你的应用中复用同一套运行时
