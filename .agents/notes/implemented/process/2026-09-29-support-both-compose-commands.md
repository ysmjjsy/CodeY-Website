# Agent Note: 部署脚本同时支持 docker compose 与 docker-compose

Status: implemented

## Problem

`deploy/docker-deploy.sh` 硬编码了 `docker compose` 这一种写法，并且在启动时用
`docker compose version` 判定环境。在没有安装 Compose v2 插件的服务器上，这条命令
直接失败，脚本报"未找到 docker compose 插件"并退出——即使机器上装着可用的
`docker-compose`。

这个失败方式把两种不同的情况混为一谈：真正缺 Compose，以及 Compose 存在但命令名
不同。第二种在现实里很常见：Debian/Ubuntu 的 `docker-compose` 是独立的 Python 包，
RHEL 系和部分云厂商镜像用它作为默认安装形态，一些从旧版本升级上来的机器两者并存。
用户看到的提示让他去装插件，而问题只是命令名。

同时，`docker-compose` 这个名字底下可能藏着两个语义完全不同的东西：

- **v2 独立二进制**（Go 写的，`docker-compose` 单文件）——与插件功能等价。
- **v1 的 Python 实现**（`docker-compose` 1.x）——**已停止维护**，且读不懂本项目的
  `docker-compose.yml`：该文件是 Compose Specification，没有 `version:` 顶层键，并使用
  了 `depends_on.condition: service_healthy`。v1 会报解析错误，或更糟——把它能认的
  部分静默接受，然后忽略 `condition`，导致 caddy 在 app 就绪前启动并返回 502。

所以"支持两种命令"不能只是把 `docker compose` 替换成 `docker-compose`：必须区分
v2 与 v1，对 v1 给出明确结论而不是让它去撞 compose 的解析错误。

## Decision

新增 `deploy/compose-command.sh`，提供 `codey_resolve_compose` 函数，把探测结果放进
`COMPOSE` 数组；`docker-deploy.sh` 与 `fetch-origin-cert.sh` 都 source 它。

探测顺序：

1. `CODEY_DEPLOY_COMPOSE` 环境变量——显式覆盖，按空格拆分成命令 + 参数。
2. `docker compose version` 成功 → `(docker compose)`，**优先于** `docker-compose`。
3. `docker-compose version` 成功 → `(docker-compose)`。
4. 都不行 → 报错并给出 Debian/RHEL 的安装命令。

拿到候选后读一次 `version` 输出，匹配 `version\s+v?1\.` 即判定为 v1，打印升级指引后
返回失败。**只判断版本号字符串，不代替 compose 做配置解析**——解析是 compose 的职责，
这里要防的是 v1 把 `condition` 静默忽略这一类问题，前提是先把版本认出来。

两个调用方对失败的处置刻意不同，这是本设计的要点：

- `docker-deploy.sh`：`codey_resolve_compose || exit 1`。没有 Compose 就无法部署，
  必须中止。
- `fetch-origin-cert.sh`：`codey_resolve_compose 2>/dev/null || COMPOSE=(docker compose)`。
  这个脚本只申请证书，结尾打印一句"下一步运行什么"；Compose 缺失不该让证书申请失败。
  因此 `codey_resolve_compose` 用**返回 1 + stderr 诊断**，而不是像本仓库既有的 `die()`
  那样 `exit`。

`fetch-origin-cert.sh` 结尾的提示与 `docker-deploy.sh` 成功/失败时打印的
`logs -f app` 提示，都改为使用探测到的命令，不再硬编码。

命令用数组而非字符串保存：`"${COMPOSE[@]}" build` 保证 `docker compose` 以两个 argv
传给 exec，不会因引号处理被当成一个含空格的程序名。

## Alternatives considered

- **只把脚本里的 `docker compose` 改成 `docker-compose`。** 改动最小，一行 sed 就能
  完成，且立刻让"只有 docker-compose 的机器"能跑。被否决是因为它把兼容做成了替换：
  在只有 v2 插件的机器上（也就是本仓库文档一直假设的环境）会反过来坏掉，而 v1 会被
  放进来——那正是最危险的分支，`condition: service_healthy` 被忽略后表现为偶发 502，
  而不是一条能读懂的报错。

- **要求统一使用 `docker compose`，让用户自己装插件。** 这是最简单的支持矩阵：一种
  命令，一条文档，没有探测逻辑和分支。被否决是因为它把仓库的便利性建立在用户的运维
  约束上：本项目的部署目标已经跑着 Docker 和若干既有服务，机器上装的是哪种 Compose
  不由这个仓库决定；而 `docker-compose` 是 Debian/Ubuntu 官方仓库里 Compose 的默认
  包名，用户很可能根本没意识到自己装的是 v1。把它写成前置条件，等于把一个已知会踩的
  坑留给部署当天。

- **做一层 `docker-compose` → `docker compose` 的 shell 别名或 wrapper 脚本。** 用户
  敲哪个都能用，脚本里则完全不用改。被否决是因为它治不了 v1：别名改变的是命令名，
  不是实现，v1 仍然读不懂 Compose Specification。而且别名只在该用户的交互式 shell 里
  生效，systemd、cron 或其他用户执行时又不一致，属于把问题从代码推给环境。

- **不检测 v1，让 compose 自己报错。** 少写一段版本判断，且"工具自己会报错"在多数
  情况下成立。被否决是因为 v1 对本文件的失败**不保证是硬失败**：`depends_on` 的
  `condition` 长格式在 v1 下会被忽略而非报错，部署"成功"但 caddy 早于 app 启动。
  这种失败只在首次部署时偶发为 502，排查成本远高于一段 `if`。

## Consequences

- **收益**：`docker compose` 与 v2 的 `docker-compose` 都能直接跑，不需要用户改 PATH
  或装别名。装的是 v1 时，得到的是明确的升级指引，而不是 compose 的解析报错或静默
  忽略 `condition` 造成的 502。
- **收益**：探测逻辑只有一份（`compose-command.sh`），两个脚本共用。以后再加部署脚本
  时不会再各自实现一遍，也不会出现两个脚本对同一台机器得出不同结论的情况。
- **收益**：`CODEY_DEPLOY_COMPOSE` 提供了覆盖手段，脚本自动选错时不必改代码。
- **代价**：`deploy/` 下多了一个必须与调用方一同存在的文件。`docker-deploy.sh` 与
  `fetch-origin-cert.sh` 现在依赖 `compose-command.sh` 位于同一目录；如果有人只复制
  其中一个脚本到别处执行，`source` 会失败。这是新增的、此前不存在的耦合。
- **代价**：v1 的判定基于 `version` 输出里是否出现 `1.`。若某个 v2 版本的输出格式
  变化，或用户用的是被重命名/包装过的二进制，判定可能失效。届时失败方向是"放行"，
  由 compose 自己报错，不会造成误拒。
- **代价**：仍然要求 Compose v2，只是接受两种命令名。真正让 v1 跑起来需要给
  `docker-compose.yml` 加回 `version: "2.4"` 并放弃 `condition: service_healthy`，
  那是降低部署正确性去迁就已停止维护的工具，不在本次范围内。
- **代价**：`fetch-origin-cert.sh` 在无 Compose 环境下会打印 `docker compose ...`
  作为兜底提示，可能与用户实际可用的命令名不符。该分支只在既没有插件也没有
  `docker-compose` 时出现，此时任何一种写法都用不了，提示的价值仅在于指出下一步动作。

## Verification

- `bash -n` 对三个脚本均通过；用 macOS 自带的 bash 3.2 解析也通过（部署目标是 Linux，
  但脚本不应在开发机上因语法失败）。
- 用伪二进制覆盖六种环境组合，逐个断言选中的命令与失败行为：
  `docker compose` 插件优先、仅 `docker-compose`（v2）、`CODEY_DEPLOY_COMPOSE` 覆盖、
  仅 v1（必须中止并给出升级指引）、两者皆无、覆盖变量指向不存在的二进制。
- 直接跑 `docker-deploy.sh`（伪 docker/docker-compose/curl + 真实脚本），在"仅
  `docker-compose`"与"有插件"两种环境下断言实际执行的 argv 序列：
  `build`、`up -d --remove-orphans` 均由正确命令发出；结尾提示分别为
  `docker-compose logs -f app` 与 `docker compose logs -f app`。
- 健康检查失败分支用同一套伪二进制验证：`ps` 与 `logs --tail 50 app` 也走探测到的
  命令，不是硬编码。
- `fetch-origin-cert.sh` 对着自建 mock Cloudflare API（真签收到的 CSR）跑通三种环境：
  仅 `docker-compose` → 提示 `docker-compose up -d --force-recreate caddy`；有插件 →
  提示 `docker compose ...`；**完全没有 Compose → 证书照常签发，退出码 0，提示回退为
  `docker compose`**。最后一条是本次非 `exit` 设计的直接证据。
- `fetch-origin-cert.sh --help` 在既无 docker 也无 Compose 的环境下正常输出并返回 0：
  探测被放在唯一的使用点（结尾提示）之前，而不是脚本顶部，避免连帮助信息都要先调用
  Docker。
- `docker compose config` 在改动后的 `docker-compose.yml` 上通过（仅注释变化）；
  YAML 解析确认仍然没有 `version:` 顶层键。
- `pnpm check:agent-notes`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、
  `pnpm check:styles`、`pnpm check:scales` 全部通过。
