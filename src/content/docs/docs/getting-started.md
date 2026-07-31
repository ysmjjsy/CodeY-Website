---
title: 快速开始
description: 下载 CodeY 安装包，或从源码构建并运行桌面端。
---

## 下载安装包

最新的 macOS、Windows 和 Linux 安装包由 [GitHub Releases](https://github.com/ysmjjsy/CodeY/releases) 提供。官网[下载页](/download/)会读取最新公开版本，并按平台显示可用安装包。

如果发布页尚无安装包，或当前版本没有适合你的平台和架构，请使用下面的源码构建方式。

以下步骤覆盖环境要求、开发运行、生产构建和常用校验命令。

## 环境要求

- Node.js `24.12.0`
- pnpm `11.7.0`
- Rust `1.96` 或更高版本
- 当前系统对应的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)

参与原生电脑操作相关开发还需要：

- macOS 14 或更高版本与 Swift 6（`apps/computer-use-macos`）
- .NET 8 与 Windows 10.0.22621 SDK（`apps/computer-use-windows`）

## 从源码运行

```sh
git clone https://github.com/ysmjjsy/CodeY.git
cd CodeY
pnpm install
pnpm dev
```

`pnpm dev` 会先构建守护进程 sidecar 和原生电脑操作运行时，再启动 Tauri 开发应用。

首次启动后：

1. 打开一个项目目录。
2. 在 **设置 → 模型** 中配置模型服务。
3. 在首屏描述目标，开始第一个任务。

## 生产构建

```sh
pnpm build
```

生产构建会打包桌面前端、守护进程 sidecar、浏览器运行时，以及当前平台支持的原生电脑操作运行时。

## 开发与校验

按改动范围选择检查命令：

```sh
pnpm check:frontend:fast  # 前端类型检查、Lint 和单元测试
pnpm check:rust:fast      # Rust 格式检查和聚焦的契约测试
pnpm check:quick          # 策略检查及前端、Rust 快速检查
pnpm check                # 完整的 CI 级校验
```

CI 会检查架构边界，包括守护进程对 Agent 能力的所有权、工具网络代理、生成协议一致性、前端设计 Token，以及授权和编排生产路径中不存在 Fake 实现。

提交改动前请阅读[参与贡献](/docs/contributing/)。
