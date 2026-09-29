#!/usr/bin/env bash
# =============================================================================
# CodeY 官网 Docker 一键部署脚本
#
#   ./deploy/docker-deploy.sh
#
# 首次运行会检查 .env 与证书，然后构建并启动容器。
# 后续运行等价于更新：拉取代码 → 重建镜像 → 滚动重启。
# =============================================================================

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="${CODEY_DEPLOY_PROJECT_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
readonly DOMAIN="${CODEY_DEPLOY_DOMAIN:-codey.ysmjjsy.com}"
readonly HEALTHCHECK_URL="${CODEY_DEPLOY_HEALTHCHECK_URL:-http://127.0.0.1:4321/}"
readonly BRANCH="${CODEY_DEPLOY_BRANCH:-main}"
readonly CERT_DIR="${PROJECT_DIR}/deploy/certs"

cd "${PROJECT_DIR}"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m警告: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31m错误: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未找到 docker"

# ---------- 0. 选择 Compose 命令 ----------
# 同时支持 `docker compose` 与 `docker-compose`，见 compose-command.sh。
# shellcheck source=deploy/compose-command.sh
source "${SCRIPT_DIR}/compose-command.sh"
codey_resolve_compose || exit 1

log "使用 Compose 命令: ${COMPOSE[*]}"

# ---------- 1. 环境文件 ----------
if [[ ! -f .env ]]; then
  if [[ -f .env.docker.example ]]; then
    cp .env.docker.example .env
    chmod 600 .env
    die "已生成 .env，请填写真实配置后重新运行（至少设置 CODEY_WEBSITE_ORIGIN、CODEY_DATABASE_URL、CODEY_CLOUD_SECRET_KEY、CODEY_MARKET_ADMIN_PASSWORD）"
  fi
  die "缺少 .env"
fi

grep -qE '^CODEY_WEBSITE_ORIGIN=https://' .env \
  || warn "CODEY_WEBSITE_ORIGIN 不是 https，生产环境会导致 Cookie 不带 Secure 且写操作 Origin 校验失败"

if grep -qE '^CODEY_CLOUD_SECRET_KEY=\s*$' .env; then
  warn "CODEY_CLOUD_SECRET_KEY 为空：服务可启动，但管理员保存模型 API Key 会失败。生成方式：openssl rand -base64 32"
fi

if grep -qE '^CODEY_MARKET_ADMIN_PASSWORD=\s*$' .env; then
  die "CODEY_MARKET_ADMIN_PASSWORD 不能为空（必须 10-128 字节）"
fi

# 提前拦截长度不足的管理员密码：服务端会拒绝启动
admin_pw="$(grep -E '^CODEY_MARKET_ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2-)"
if (( ${#admin_pw} < 10 )); then
  die "CODEY_MARKET_ADMIN_PASSWORD 只有 ${#admin_pw} 字节，服务要求 10-128 字节"
fi

# ---------- 2. TLS 证书 ----------
mkdir -p "${CERT_DIR}"
if [[ ! -f "${CERT_DIR}/codey.pem" || ! -f "${CERT_DIR}/codey.key" ]]; then
  # 有凭据就自动申请 Cloudflare Origin Certificate，免去手工下载
  if [[ -n "${CLOUDFLARE_API_TOKEN:-}" || -f "${SCRIPT_DIR}/.cloudflare-token" ]]; then
    log "自动申请 Cloudflare Origin Certificate"
    "${SCRIPT_DIR}/fetch-origin-cert.sh" || die "自动申请证书失败"
  else
    warn "未找到 ${CERT_DIR}/codey.pem 与 codey.key"
    warn "两种做法："
    warn "  A. 自动申请（推荐）：提供 CLOUDFLARE_API_TOKEN 后重新运行本脚本。"
    warn "     Token 权限需含 Zone → SSL and Certificates → Edit（界面可能显示为 Write）"
    warn "     以及 Zone → Zone → Read"
    warn "  B. 手工下载：Cloudflare 后台 SSL/TLS → Origin Server → Create Certificate，"
    warn "     证书存为 deploy/certs/codey.pem、私钥存为 deploy/certs/codey.key"
    warn "也可改用 deploy/Caddyfile 里的 'tls internal'（Cloudflare 模式需设为 Full）。"
    read -r -p "已放好证书，继续？[y/N] " reply
    [[ "${reply}" =~ ^[Yy]$ ]] || die "已中止"
  fi
fi

# ---------- 3. 拉取代码 ----------
if [[ -d .git ]]; then
  log "更新代码"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "工作区有未提交改动，跳过 git pull"
  else
    current_branch="$(git branch --show-current)"
    if [[ "${current_branch}" == "${BRANCH}" ]]; then
      git pull --ff-only origin "${BRANCH}"
    else
      warn "当前分支是 ${current_branch}，期望 ${BRANCH}，跳过 git pull"
    fi
  fi
else
  warn "不是 Git 仓库，跳过代码更新"
fi

# ---------- 4. 构建并启动 ----------
log "构建镜像"
"${COMPOSE[@]}" build

log "启动容器"
"${COMPOSE[@]}" up -d --remove-orphans

# ---------- 5. 健康检查 ----------
log "等待服务就绪"
for attempt in $(seq 1 60); do
  if curl --fail --silent --max-time 5 "${HEALTHCHECK_URL}" >/dev/null 2>&1; then
    log "部署成功"
    printf '  本机入口: %s\n' "${HEALTHCHECK_URL}"
    printf '  公开地址: https://%s/\n' "${DOMAIN}"
    printf '  查看日志: %s logs -f app\n' "${COMPOSE[*]}"
    exit 0
  fi
  sleep 2
done

printf '\n容器状态:\n' >&2
"${COMPOSE[@]}" ps >&2
printf '\n应用日志（末尾 50 行）:\n' >&2
"${COMPOSE[@]}" logs --tail 50 app >&2
die "健康检查失败: ${HEALTHCHECK_URL}"
