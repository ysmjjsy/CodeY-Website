#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="${CODEY_DEPLOY_PROJECT_DIR:-$(cd -- "${SCRIPT_DIR}/.." && pwd)}"
readonly REMOTE="${CODEY_DEPLOY_REMOTE:-origin}"
readonly BRANCH="${CODEY_DEPLOY_BRANCH:-main}"
readonly SERVICE="${CODEY_DEPLOY_SERVICE:-codey-website}"
readonly HEALTHCHECK_URL="${CODEY_DEPLOY_HEALTHCHECK_URL:-http://127.0.0.1:4321/}"
readonly HEALTHCHECK_ATTEMPTS="${CODEY_DEPLOY_HEALTHCHECK_ATTEMPTS:-30}"

previous_revision=""

on_error() {
  local exit_code=$?
  printf '\nDeployment failed at line %s.\n' "${BASH_LINENO[0]}" >&2
  if [[ -n "${previous_revision}" ]]; then
    printf 'Previous Git revision: %s\n' "${previous_revision}" >&2
  fi
  exit "${exit_code}"
}

trap on_error ERR

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    return 1
  fi
}

restart_service() {
  if (( EUID == 0 )); then
    systemctl restart "${SERVICE}"
  else
    sudo systemctl restart "${SERVICE}"
  fi
}

show_service_logs() {
  if (( EUID == 0 )); then
    journalctl -u "${SERVICE}" -n 50 --no-pager || true
  else
    sudo journalctl -u "${SERVICE}" -n 50 --no-pager || true
  fi
}

wait_until_healthy() {
  local attempt
  for ((attempt = 1; attempt <= HEALTHCHECK_ATTEMPTS; attempt += 1)); do
    if curl --fail --silent --show-error --max-time 5 "${HEALTHCHECK_URL}" >/dev/null; then
      return 0
    fi
    sleep 1
  done

  printf 'Health check failed: %s\n' "${HEALTHCHECK_URL}" >&2
  show_service_logs
  return 1
}

require_command git
require_command pnpm
require_command cargo
require_command curl
require_command systemctl
if (( EUID != 0 )); then
  require_command sudo
fi

if [[ ! "${HEALTHCHECK_ATTEMPTS}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'CODEY_DEPLOY_HEALTHCHECK_ATTEMPTS must be a positive integer.\n' >&2
  exit 1
fi

if [[ ! "${SERVICE}" =~ ^[A-Za-z0-9_.@-]+$ ]]; then
  printf 'Invalid systemd service name: %s\n' "${SERVICE}" >&2
  exit 1
fi

cd "${PROJECT_DIR}"

if [[ "$(git rev-parse --show-toplevel)" != "${PROJECT_DIR}" ]]; then
  printf 'Not a Git repository root: %s\n' "${PROJECT_DIR}" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf 'Tracked files contain local changes. Commit or stash them before deployment.\n' >&2
  git status --short >&2
  exit 1
fi

if [[ "$(git branch --show-current)" != "${BRANCH}" ]]; then
  printf 'Expected branch %s, current branch is %s.\n' \
    "${BRANCH}" "$(git branch --show-current)" >&2
  exit 1
fi

previous_revision="$(git rev-parse HEAD)"

printf 'Updating %s from %s/%s...\n' "${PROJECT_DIR}" "${REMOTE}" "${BRANCH}"
git pull --ff-only "${REMOTE}" "${BRANCH}"

printf 'Installing dependencies...\n'
pnpm install --frozen-lockfile

printf 'Building website and Market Server...\n'
pnpm build

printf 'Restarting %s...\n' "${SERVICE}"
restart_service

printf 'Checking %s...\n' "${HEALTHCHECK_URL}"
wait_until_healthy

printf 'Deployment succeeded: %s -> %s\n' \
  "${previous_revision:0:12}" "$(git rev-parse --short=12 HEAD)"
