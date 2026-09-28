#!/usr/bin/env bash
# =============================================================================
# 自动申请 Cloudflare Origin Certificate
#
#   ./deploy/fetch-origin-cert.sh              # 证书不存在或即将过期时才申请
#   ./deploy/fetch-origin-cert.sh --force      # 强制重新申请
#
# 私钥在本机生成，只把 CSR 发给 Cloudflare，私钥不出服务器。
# 证书默认 15 年有效（5475 天）。
#
# 需要的凭据（二选一，优先环境变量）：
#   CLOUDFLARE_API_TOKEN    推荐。权限：Zone → SSL and Certificates → Edit
#                           （Cloudflare 正把 Edit 改称 Write，二者是同一权限）
#                           另需 Zone → Zone → Read（用于自动查 zone id）
#   或写入 deploy/.cloudflare-token 文件（已被 .gitignore 忽略）
#
# 注意：不要用 Origin CA Key（X-Auth-User-Service-Key）。
# Cloudflare 已弃用它，2026-09-30 起停止服务。
# =============================================================================

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="${CODEY_DEPLOY_PROJECT_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
readonly CERT_DIR="${SCRIPT_DIR}/certs"
readonly CERT_FILE="${CERT_DIR}/codey.pem"
readonly KEY_FILE="${CERT_DIR}/codey.key"
readonly TOKEN_FILE="${SCRIPT_DIR}/.cloudflare-token"
# 可用 CLOUDFLARE_API_BASE 覆盖，便于对 mock 接口做集成测试
readonly API_BASE="${CLOUDFLARE_API_BASE:-https://api.cloudflare.com/client/v4}"

VALIDITY=5475
FORCE=0
DOMAIN=""

log()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m警告: %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m错误: %s\033[0m\n' "$*" >&2; exit 1; }

while (( $# > 0 )); do
  case "$1" in
    --force)    FORCE=1; shift ;;
    --domain)   DOMAIN="${2:-}"; shift 2 ;;
    --validity) VALIDITY="${2:-}"; shift 2 ;;
    -h|--help)  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)          die "未知参数: $1" ;;
  esac
done

# ---------- 依赖检查 ----------
command -v curl    >/dev/null 2>&1 || die "缺少 curl"
command -v openssl >/dev/null 2>&1 || die "缺少 openssl"

if command -v jq >/dev/null 2>&1; then
  JSON_TOOL=jq
elif command -v python3 >/dev/null 2>&1; then
  JSON_TOOL=python3
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL=node
else
  die "需要 jq、python3 或 node 之一用于解析 JSON"
fi

# ---------- 读取 API Token ----------
API_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "${API_TOKEN}" && -f "${TOKEN_FILE}" ]]; then
  API_TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"
fi
[[ -n "${API_TOKEN}" ]] || die "未提供 CLOUDFLARE_API_TOKEN（可写入 ${TOKEN_FILE}）"

# ---------- 确定域名 ----------
if [[ -z "${DOMAIN}" && -f "${PROJECT_DIR}/.env" ]]; then
  origin="$(grep -E '^CODEY_WEBSITE_ORIGIN=' "${PROJECT_DIR}/.env" | head -1 | cut -d= -f2- || true)"
  if [[ -n "${origin}" ]]; then
    DOMAIN="$(printf '%s' "${origin}" | sed -E 's#^https?://##; s#/.*$##; s#:[0-9]+$##')"
  fi
fi
[[ -n "${DOMAIN}" ]] || die "无法确定域名：请在 .env 设置 CODEY_WEBSITE_ORIGIN 或使用 --domain"
[[ "${DOMAIN}" == *.* ]] || die "域名格式不正确: ${DOMAIN}"

# ---------- 已有证书是否需要跳过 ----------
if (( FORCE == 0 )) && [[ -f "${CERT_FILE}" && -f "${KEY_FILE}" ]]; then
  if openssl x509 -in "${CERT_FILE}" -noout -checkend $((30 * 86400)) >/dev/null 2>&1; then
    printf '证书仍然有效（30 天内不会过期），跳过申请。\n'
    printf '  如需重新申请：%s --force\n' "${BASH_SOURCE[0]}"
    openssl x509 -in "${CERT_FILE}" -noout -subject -enddate 2>/dev/null | sed 's/^/  /'
    exit 0
  fi
  warn "现有证书将在 30 天内过期，重新申请"
fi

mkdir -p "${CERT_DIR}"
chmod 700 "${CERT_DIR}"

# ---------- 查询 zone id ----------
# Cloudflare 的 zone 名通常是注册域名的最后两段；对多段后缀
# （如 .co.uk）会查不到，此时需要用 --zone-id 或改用主域名。
apex="$(printf '%s' "${DOMAIN}" | awk -F. '{ if (NF>=2) print $(NF-1)"."$NF; else print $0 }')"

log "查询 zone: ${apex}"
zones_response="$(curl --silent --show-error --fail-with-body \
  --max-time 30 \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H 'Content-Type: application/json' \
  "${API_BASE}/zones?name=${apex}&status=active" 2>&1)" \
  || die "查询 zone 失败: ${zones_response}"

case "${JSON_TOOL}" in
  jq)      ZONE_ID="$(printf '%s' "${zones_response}" | jq -r '.result[0].id // empty')" ;;
  python3) ZONE_ID="$(printf '%s' "${zones_response}" | python3 -c 'import json,sys; r=json.load(sys.stdin).get("result") or []; print(r[0]["id"] if r else "")')" ;;
  node)    ZONE_ID="$(printf '%s' "${zones_response}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).result)||[];console.log(r.length?r[0].id:"")})')" ;;
esac

[[ -n "${ZONE_ID}" ]] || die "未找到 zone ${apex}。
可能原因：
  1. API Token 缺少 Zone → Zone → Read 权限
  2. 域名不在当前账号下
  3. 顶级域名不是 ${apex}（多段后缀如 .co.uk 请手动指定）"

printf '  zone id: %s\n' "${ZONE_ID}"

# ---------- 本机生成私钥与 CSR ----------
log "生成本机私钥与 CSR（私钥不会离开服务器）"
openssl ecparam -genkey -name prime256v1 -noout -out "${KEY_FILE}.tmp" 2>/dev/null
openssl req -new -key "${KEY_FILE}.tmp" -out "${CERT_DIR}/codey.csr.tmp" \
  -subj "/CN=${DOMAIN}" 2>/dev/null

# ---------- 组装请求体 ----------
# 用 JSON 工具构造，确保 CSR 的换行被正确转义
case "${JSON_TOOL}" in
  jq)
    request_body="$(jq -n \
      --rawfile csr "${CERT_DIR}/codey.csr.tmp" \
      --arg host "${DOMAIN}" \
      --argjson validity "${VALIDITY}" \
      '{csr: $csr, hostnames: [$host], request_type: "origin-ecc", requested_validity: $validity}')"
    ;;
  python3)
    request_body="$(python3 -c '
import json,sys
with open(sys.argv[1]) as f: csr=f.read()
print(json.dumps({"csr":csr,"hostnames":[sys.argv[2]],"request_type":"origin-ecc","requested_validity":int(sys.argv[3])}))
' "${CERT_DIR}/codey.csr.tmp" "${DOMAIN}" "${VALIDITY}")"
    ;;
  node)
    request_body="$(node -e '
const fs=require("fs");
const csr=fs.readFileSync(process.argv[1],"utf8");
console.log(JSON.stringify({csr,hostnames:[process.argv[2]],request_type:"origin-ecc",requested_validity:parseInt(process.argv[3],10)}));
' "${CERT_DIR}/codey.csr.tmp" "${DOMAIN}" "${VALIDITY}")"
    ;;
esac

[[ -n "${request_body}" ]] || die "构造请求体失败"

# ---------- 申请证书 ----------
log "向 Cloudflare 申请 Origin Certificate（${DOMAIN}，${VALIDITY} 天）"
response="$(curl --silent --show-error \
  --max-time 60 \
  -X POST "${API_BASE}/certificates" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data "${request_body}" 2>&1)" \
  || die "调用 Cloudflare API 失败: ${response}"

case "${JSON_TOOL}" in
  jq)      CERT_PEM="$(printf '%s' "${response}" | jq -r '.result.certificate // empty')"
           API_ERROR="$(printf '%s' "${response}" | jq -r '.errors[0].message // empty')"
           API_OK="$(printf '%s' "${response}" | jq -r '.success')" ;;
  python3) CERT_PEM="$(printf '%s' "${response}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("result") or {}).get("certificate") or "")')"
           API_ERROR="$(printf '%s' "${response}" | python3 -c 'import json,sys; d=json.load(sys.stdin); e=d.get("errors") or []; print(e[0].get("message","") if e else "")')"
           API_OK="$(printf '%s' "${response}" | python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("success")).lower())')" ;;
  node)    CERT_PEM="$(printf '%s' "${response}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);console.log((d.result||{}).certificate||"")})')"
           API_ERROR="$(printf '%s' "${response}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);const e=d.errors||[];console.log(e.length?(e[0].message||""):"")})')"
           API_OK="$(printf '%s' "${response}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(String(JSON.parse(s).success))})')" ;;
esac

if [[ -z "${CERT_PEM}" || "${CERT_PEM}" == "null" ]]; then
  rm -f "${KEY_FILE}.tmp" "${CERT_DIR}/codey.csr.tmp"
  die "申请失败（success=${API_OK:-unknown}）：${API_ERROR:-未知错误}
常见原因：
  1. API Token 缺少 Zone → SSL and Certificates → Edit（界面可能显示为 Write）权限
  2. 域名不在该账号下
  3. 账号未开通 API Access"
fi

# ---------- 落盘 ----------
printf '%s\n' "${CERT_PEM}" > "${CERT_FILE}.tmp"
mv "${KEY_FILE}.tmp" "${KEY_FILE}"
mv "${CERT_FILE}.tmp" "${CERT_FILE}"
rm -f "${CERT_DIR}/codey.csr.tmp"

chmod 600 "${KEY_FILE}"
chmod 644 "${CERT_FILE}"

# ---------- 校验 ----------
log "校验证书"
openssl x509 -in "${CERT_FILE}" -noout -subject -issuer -enddate 2>&1 | sed 's/^/  /'

cert_mod="$(openssl x509 -in "${CERT_FILE}" -noout -modulus 2>/dev/null | openssl sha256 2>/dev/null || true)"
key_pub="$(openssl pkey -in "${KEY_FILE}" -pubout 2>/dev/null | openssl sha256 2>/dev/null || true)"

# 私钥与证书必须匹配：用公钥指纹比对
cert_pub="$(openssl x509 -in "${CERT_FILE}" -noout -pubkey 2>/dev/null | openssl sha256 2>/dev/null || true)"
if [[ -n "${cert_pub}" && "${cert_pub}" != "${key_pub}" ]]; then
  die "证书与私钥不匹配，请重新运行 --force"
fi

if openssl x509 -in "${CERT_FILE}" -noout -checkend 0 >/dev/null 2>&1; then
  log "完成"
  printf '  证书: %s\n' "${CERT_FILE}"
  printf '  私钥: %s\n' "${KEY_FILE}"
  printf '\n下一步: docker compose up -d --force-recreate caddy\n'
else
  die "证书已过期，请重新申请"
fi
