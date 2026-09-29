# Agent Note: 上游厂商基础 URL 允许明文 HTTP

Status: implemented

## Problem

后台"添加厂商"表单的基础 URL 只接受 HTTPS，唯一的例外是 `127.0.0.1` / `localhost` /
`::1` 三个回环主机名。校验在两处独立实现，规则相同：`cloud/models.rs` 的
`validate_provider` 决定能否保存，`lib.rs` 的 `validate_upstream_discovery_url` 决定
能否"测试并获取模型"。表单提示文案把这个限制写死成
"生产环境必须使用 HTTPS，本地调试可使用 localhost"。

这条规则在真实部署里挡住的不是攻击者，而是管理员自己的内网网关。典型场景是把上游指向
同一内网里的 OpenAI 兼容服务（new-api、one-api、自建 vLLM/Ollama 网关等），地址形如
`http://180.76.244.225:18987/v1`。这类服务通常只在内网或安全组后面监听，不配证书；
即使配了，也是自签证书，反而需要额外的信任链配置。结果是管理员有能力、有权限、也有
明确意图接入自己的网关，却被表单拒绝，而且提示只说明"生产环境必须 HTTPS"，没有给出
任何绕过路径。

更麻烦的是失败点不一致：发现接口先拦一道，保存接口再拦一道，两处任一命中都报
`cloud_invalid_request`，但文案不同（`provider URL must use HTTPS unless it targets
localhost` 对 `Invalid upstream provider`），排查时看不出是同一个原因。

## Decision

删除方案（scheme）白名单之外的 HTTPS 强制要求，改为在一处共享判定，两处调用。

新增 `cloud/provider_catalog.rs` 的 `upstream_base_url_is_allowed`：

```rust
pub fn upstream_base_url_is_allowed(base_url: &str) -> bool {
    url::Url::parse(base_url.trim()).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some_and(|host| !host.is_empty())
    })
}
```

`validate_provider`（保存）与 `validate_upstream_discovery_url`（探测）都改为调用它，
回环主机名的特例随之删除——`http` 现在一律通过，特例不再承载任何语义。`cloud/mod.rs`
把它与其它 `provider_catalog` helper 一起以 `pub(crate)` 导出。

保留的约束只有两条，且都与传输安全无关，而是防止非法端点进入网关：scheme 必须是
`http` 或 `https`（`file:`、`ftp:`、`ws:` 一律拒绝），且必须解析出非空 host（所以
`180.76.244.225:18987/v1` 这种缺 scheme 的串和相对路径仍然存不进去）。这两条挡住了
`upstream_operation_url` 会拼出的畸形 URL，是 `GatewayError::InvalidUpstreamUrl` 之前
的第一道闸。

表单文案改为陈述能力而不是陈述禁令，`zh` / `en` 同步，并新增
`baseUrlPlaceholder` 让占位符也走 i18n（此前占位符是模板里的硬编码字面量，与
`src/AGENTS.md` 的"UI 字符串必须走 `src/i18n/`"冲突）。

## Alternatives considered

- **保留 HTTPS 强制，只把例外从回环扩展到整个私网段（RFC 1918）。** 这是最贴近原意图的
  改法：内网明文可接受，公网明文仍被拒绝，安全边界从"主机是不是本机"放宽到"地址是不是
  内网"。被否决是因为判定不可靠且会误导：判断私网要看解析后的 IP，而配置里写的是域名，
  服务端拿到域名时并不知道它解析到哪里——一个 `gateway.internal` 可能指向 `10.0.0.7`，
  也可能指向公网。要做对就必须在保存时解析 DNS 并把结果固化，这既引入一次阻塞解析，又会
  在 DNS 变更后与现实脱节。更关键的是它没有解决用户的问题：地址仍然可能是公网 IP 上的
  明文端口（截图里的 `180.76.244.225` 就是公网地址），改完照样被拒。

- **保持现状，让管理员改用 HTTPS 反向代理。** 这是安全上最保守的答案，也是最容易论证的：
  明文 HTTP 会让上游 API 密钥和会话内容在链路上裸奔，加一层 Caddy/nginx 自签或内网 CA
  是最佳实践，成本也不过是几行配置。被否决是因为它把成本转移给了错误的角色，且没有给出
  强制的手段：管理员本来就能在服务器上直接 `curl` 这个地址，官网只是记录一个字符串，
  它既不建立也不终结这条链路。真要强制 TLS，正确的位置是管理员自己的网络策略。在表单里
  拒绝，只是让管理员绕过官网、直接改数据库，留下一个和 UI 不一致的状态。

- **只放宽探测接口，保存仍然要求 HTTPS。** 这样至少能"测试并获取模型"，能立刻看到上游
  可用，只是存不下来。被否决是因为它让流程走到一半才失败：用户测通了、看到模型列表了，
  点保存才被拒绝，而那时提示是 `Invalid upstream provider`，比一开始就拒绝更难理解。
  两处校验必须同进同退，否则规则就不再是一条规则。

## Consequences

- **收益**：自建网关、内网部署、单板机等没有证书的 OpenAI 兼容服务可以直接在后台接入，
  不需要额外的反向代理层。截图里的 `http://180.76.244.225:18987/v1` 现在可以保存。
- **收益**：方案校验从两处重复实现收敛到 `upstream_base_url_is_allowed` 一处。以后调整
  端点规则只改一个函数，两个调用点自动一致，不会再出现"探测报的错和保存报的错不一样"。
- **代价**：网关会向 `http://` 上游发送带 `Authorization` 头的请求，上游 API 密钥以明文
  经过中间链路。官网侧不做任何提示或降级，只在表单 hint 里建议公网服务用 HTTPS。这是
  有意接受的：这条链路本就在管理员自己的网络里，官网无法验证也无法保护它。
- **代价**：`http` 与内网地址现在与 `https` 走完全相同的代码路径，如果将来要按"是否公网"
  做差异化处理（例如限制并发、记录审计日志），需要重新引入判定，而那时仍然会碰到上面
  提到的 DNS 解析问题。
- **代价**：`validate_upstream_discovery_url` 的报错文案从
  `provider URL must use HTTPS unless it targets localhost` 变成
  `provider URL must be an absolute HTTP or HTTPS address with a host`。这个字符串是
  API 契约的一部分，桌面端不消费它（上游地址不下发给客户端），但外部脚本可能匹配过。

## Verification

- `cargo test -p codey-market-server` —— 57 项通过（新增 3 项）。
- `cloud::provider_catalog::tests::upstream_base_url_accepts_plain_http_and_rejects_other_schemes`
  覆盖 6 个接受样例（含截图中的公网 HTTP 地址、私网地址、内网域名）与 8 个拒绝样例
  （空串、缺 scheme、`ftp:`、`file:`、`ws:`、`http://`、非法串）。
- `cloud::models::tests::custom_provider_accepts_a_plain_http_base_url` 走真实
  `CloudStore::upsert_upstream_provider`：HTTP 地址保存成功并回读，`ftp:` 地址返回
  `InvalidUpstreamProvider`。
- `tests::discovery_url_validation_accepts_plain_http_on_a_public_host` 直接断言
  handler 侧校验，拒绝路径的 error code 为 `cloud_invalid_request`。
- `cargo fmt -p codey-market-server -- --check` 与
  `cargo clippy -p codey-market-server --all-targets` 均无新增告警。
- `pnpm typecheck`、`pnpm check:astro`、`pnpm lint`、`pnpm test`、`pnpm check:styles`、
  `pnpm check:scales` 全部通过。
- 已知且与本次改动无关：`pnpm check:brand` 在改动前后均失败（`--accent` 与桌面端
  `--primary` 不一致），属既有的跨仓 token 漂移。
