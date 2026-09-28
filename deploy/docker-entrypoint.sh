#!/bin/sh
# =============================================================================
# 容器入口脚本
#
# 解决的问题：Docker 在 Linux 上创建不存在的 bind mount 宿主目录时属主是
# root，而应用以 uid 1000 (node) 运行，导致无法写入 /data —— 表现为启动时报
# 权限错误，或 entitlement 签名密钥生成失败。
#
# 以 root 启动 → 修正数据目录属主 → 用 gosu 降权到 node 执行真正的命令。
# 已经以非 root 运行时直接透传，不做任何特权操作。
# =============================================================================
set -eu

DATA_ROOT="${CODEY_MARKET_DATA_ROOT:-/data}"

if [ "$(id -u)" = "0" ]; then
	mkdir -p "$DATA_ROOT"

	# 只在属主不是 node 时修改，避免每次启动都递归 chown 大目录
	current_owner="$(stat -c '%u' "$DATA_ROOT" 2>/dev/null || echo '')"
	if [ "$current_owner" != "1000" ]; then
		chown -R node:node "$DATA_ROOT"
	fi

	exec gosu node "$@"
fi

exec "$@"
