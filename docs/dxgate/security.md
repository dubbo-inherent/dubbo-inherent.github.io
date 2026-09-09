# 安全

## 调用方认证

认证直接声明在 `DxgateService.spec.policies`，不再创建独立 Policy CRD：

```yaml
spec:
  policies:
    auth:
      header: x-client-key
      secretRef:
        name: client-credentials
        key: api-key
```

请求头必须与 Secret 值完全一致。认证失败返回 `401`，并计入 `dxgate_policy_denied_total`。

## 提供方凭据

LLM 凭据也只引用同命名空间 Secret：

```yaml
spec:
  ai:
    provider:
      openai: {}
      credential:
        name: provider-credentials
        key: api-key
```

Secret 值不进入 Kubernetes CRD、RDS 或 `/debug/config`。`dubbod` 只下发 `{namespace,name,key}`；dxgate 以网关 ServiceAccount 读取值并保存在内存。托管网关只获得自己命名空间的 `secrets/get`，跨命名空间引用被拒绝。

## 认证文件管理 (Auth Files Vault)

针对订阅型（ChatGPT / Claude / Codex OAuth Token 文件）及 API Key 凭证，dxgate 提供专用的认证文件管理控制台：

- **提供方分类筛选**：支持按 Codex、Claude、Antigravity、xAI、Kimi 等提供方标签聚合；
- **健康探测方块（20-Block Health Bar）**：记录最近 20 次请求的成功/失败状态，直观反映上游连通率；
- **异常诊断横幅**：自动捕获 `unauthorized`、429 Cooldown 等状态并提供一键刷新/重新认证入口；
- **凭证全生命周期操作**：支持模型映射、动态刷新 Token、加密下载、参数设置与一键启用/停用开关。

## 策略

同一个 `policies` 对所有引用该 `DxgateService` 的 HTTPRoute 生效，支持：

- API key 认证；
- 请求速率与 LLM Token 预算；
- 超时、重试与最大请求体；
- 请求和响应头增删。

策略校验在 `dubbod` admission 与编译阶段执行，数据面只消费已编译结果。

## 传输与容器

- 托管 Gateway 可使用 Dubbo mutual TLS 连接网格内 Service；
- dxgate 容器使用 UID/GID `65532`、只读根文件系统并丢弃全部 capability；
- 管理端口不由业务 Service 暴露；`/debug/*` 不返回 Secret 值；
- xDS 是路由配置的唯一来源，数据面不 watch 私有 CRD。
