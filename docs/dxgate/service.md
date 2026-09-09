# 统一 DxgateService API

`DxgateService` 是 dxgate 非标准应用协议的唯一网格 API：

```text
apiVersion: networking.dubbo.apache.org/v1alpha3
kind: DxgateService
```

一个对象只能选择 `spec.ai`、`spec.mcp`、`spec.a2a` 之一。普通 HTTP 后端不创建 `DxgateService`，继续直接引用 Kubernetes `Service`。

## LLM (多账号池与协议网关)

OpenAI 客户端格式可以统一路由到自建集群、OpenAI 或 Anthropic。凭据只写同命名空间 Secret 引用。

LLM 模块原生支持三大账号池（自建算力 `self-hosted`、包月订阅 `subscription`、按量付费 `api-key`）：
- **默认平权调度**：未配置 `priority` 时，池内所有账号按 `weight` 平权加权轮询；遇到 429 或故障时自动故障转移。
- **自定义优先级**：仅当用户显式配置 `priority: 1, 2...` 时，网关严格按数字顺序执行主备/分层溢出调度。

```yaml
apiVersion: networking.dubbo.apache.org/v1alpha3
kind: DxgateService
metadata:
  name: chat
  namespace: dubbo-system
spec:
  ai:
    provider:
      openai:
        # LLM 统一多账号池
        pool:
          # --- 1. 自建私有算力 (按需配置) ---
          - id: vllm-deepseek-r1
            type: self-hosted
            weight: 100
            endpoint: http://vllm-cluster.ai-infra.svc:8000/v1
            maxConcurrency: 64

          # --- 2. 团队包月订阅 (OAuth 自动刷新) ---
          - id: codex-team-sub
            type: subscription
            weight: 100
            credentialRef:
              name: oauth-codex-team
              key: token.json

          # --- 3. 官方按量 API Key ---
          - id: openai-official-key
            type: api-key
            weight: 50
            credentialRef:
              name: openai-secret
              key: token

        models: [gpt-5, claude-sonnet-4, deepseek-r1]
        routes:
          /v1/chat/completions: COMPLETIONS
          /v1/responses: RESPONSES

  policies:
    scheduling:
      sessionAffinity: true             # 开启会话粘滞，最大化 Prompt Cache 命中率
    cooldown:
      onRateLimit: 300s                 # 遇到 429 自动冷却 5 分钟并故障转移
      onQueueFull: 30s                  # 自建节点队列满冷却 30 秒
      autoRefreshOAuth: true            # 自动续期订阅 OAuth Token
    timeout: 30s
    retry:
      attempts: 2
      statusCodes: [502, 503, 504]
```

## MCP

一个对象可以联合多个 MCP Service：

```yaml
apiVersion: networking.dubbo.apache.org/v1alpha3
kind: DxgateService
metadata:
  name: tools
spec:
  mcp:
    targets:
      - name: search
        static:
          backendRef: {name: search-mcp}
          port: 8080
        tools: [search]
      - name: calendar
        static:
          backendRef: {name: calendar-mcp}
          port: 8080
        tools: [calendar]
```

## A2A

集群内 Agent 优先使用 `backendRef`；外部 Agent 可以改用 `host`：

```yaml
apiVersion: networking.dubbo.apache.org/v1alpha3
kind: DxgateService
metadata:
  name: planner
spec:
  a2a:
    backendRef: {name: planner-agent}
    port: 8080
    path: /a2a
    agent: planner
```

## HTTPRoute

普通 Service 和 DxgateService 都使用 `backendRefs`，但一个 rule 不能混用两种类型：

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: chat
spec:
  parentRefs:
    - name: public
  rules:
    - matches:
        - path: {type: PathPrefix, value: /anthropic}
      filters:
        - type: URLRewrite
          urlRewrite:
            path:
              type: ReplacePrefixMatch
              replacePrefixMatch: /v1
      backendRefs:
        - group: networking.dubbo.apache.org
          kind: DxgateService
          name: chat
```

完整的无付费 key 样例位于仓库 `samples/ai-mesh`，覆盖普通 `/users`、`/orders`、OpenAI、Anthropic、MCP 与 A2A。

按场景查看完整资源与调用：[普通 Kubernetes Service](http-service.md)、[LLM Service](llm.md)、[MCP Service](mcp.md)、[A2A Service](a2a.md)。
