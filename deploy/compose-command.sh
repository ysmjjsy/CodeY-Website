#!/usr/bin/env bash
# =============================================================================
# Compose 命令探测（被 deploy/ 下的脚本 source，不直接执行）
#
# 同时支持两种写法，按可用性自动选择：
#   docker compose      Docker Compose v2 插件（推荐，随 Docker Engine 安装）
#   docker-compose      独立二进制。可能是 v2，也可能是已停止维护的 Python v1
#
# 用法：
#   source "${SCRIPT_DIR}/compose-command.sh"
#   codey_resolve_compose || exit 1
#   "${COMPOSE[@]}" build
#
# codey_resolve_compose 失败时把诊断写到 stderr 并返回 1，**不退出调用方**：
# 有的调用方（如 fetch-origin-cert.sh）只是想打印一句提示，Compose 缺失不该
# 让整个脚本失败。
#
# 可通过环境变量强制指定：
#   CODEY_DEPLOY_COMPOSE=docker-compose ./deploy/docker-deploy.sh
# =============================================================================

# 探测结果：命令及其参数，例如 (docker compose) 或 (docker-compose)
COMPOSE=()

codey_resolve_compose() {
  COMPOSE=()

  if [[ -n "${CODEY_DEPLOY_COMPOSE:-}" ]]; then
    read -r -a COMPOSE <<<"${CODEY_DEPLOY_COMPOSE}"
    if ! command -v "${COMPOSE[0]}" >/dev/null 2>&1; then
      printf '错误: CODEY_DEPLOY_COMPOSE=%s 在 PATH 中不存在\n' "${CODEY_DEPLOY_COMPOSE}" >&2
      COMPOSE=()
      return 1
    fi
  elif docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    cat >&2 <<'EOF'
错误: 未找到可用的 Compose：'docker compose' 插件与 'docker-compose' 均不可用。

请安装 Compose v2 插件：
  apt-get install docker-compose-plugin        # Debian / Ubuntu
  dnf install docker-compose-plugin            # RHEL / Fedora
其余发行版见 https://docs.docker.com/compose/install/linux/
EOF
    return 1
  fi

  # v1 是已停止维护的 Python 实现，且读不懂本项目的 docker-compose.yml：该文件是
  # Compose Specification（没有 version 顶层键），并使用了
  # depends_on.condition: service_healthy。让 v1 去解析只会得到一句难懂的报错，
  # 所以在这里提前给出结论。只判断版本号，不代替 compose 做解析。
  local version_line
  version_line="$("${COMPOSE[@]}" version 2>/dev/null | head -1 || true)"
  if [[ "${version_line}" =~ version[[:space:]]+v?1\. ]]; then
    cat >&2 <<EOF
错误: 检测到 Docker Compose v1（${version_line}）。
v1 已停止维护，且无法解析本项目的 docker-compose.yml（Compose Specification）。

请升级到 v2：
  apt-get install docker-compose-plugin        # Debian / Ubuntu
  dnf install docker-compose-plugin            # RHEL / Fedora
或参考 https://docs.docker.com/compose/install/linux/
EOF
    COMPOSE=()
    return 1
  fi

  return 0
}
