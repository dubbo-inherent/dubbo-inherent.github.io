# Unified DxgateService API

`DxgateService` is the single mesh API for dxgate's non-standard application protocols:

```text
apiVersion: networking.dubbo.apache.org/v1alpha3
kind: DxgateService
```

One object selects exactly one of `spec.ai`, `spec.mcp`, or `spec.a2a`. Ordinary HTTP backends do not create a `DxgateService`; they keep referencing a Kubernetes `Service` directly.

## LLM (Multi-Account Pool & Protocol Gateway)

The OpenAI client format can uniformly route to self-hosted clusters, OpenAI, or Anthropic. Credentials are same-namespace Secret references only.

The LLM module natively supports three account pool types (Self-Hosted compute `self-hosted`, monthly subscriptions `subscription`, and pay-as-you-go `api-key`):
- **Default Flat Scheduling**: When `priority` is omitted, all accounts in the pool use weighted round-robin based on `weight`; 429 or outages trigger automatic failover.
- **Custom Priority**: Only when the user explicitly configures `priority: 1, 2...`, the gateway routes strictly in numerical order for primary/backup tiering.

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
        # LLM unified multi-account pool
        pool:
          # --- 1. Self-hosted private compute (Optional) ---
          - id: vllm-deepseek-r1
            type: self-hosted
            weight: 100
            endpoint: http://vllm-cluster.ai-infra.svc:8000/v1
            maxConcurrency: 64

          # --- 2. Team monthly subscription (Auto OAuth refresh) ---
          - id: codex-team-sub
            type: subscription
            weight: 100
            credentialRef:
              name: oauth-codex-team
              key: token.json

          # --- 3. Official PAYG API Key ---
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
      sessionAffinity: true             # Lock session to maximize upstream Prompt Cache hits
    cooldown:
      onRateLimit: 300s                 # Auto-cooldown for 5m on 429 with failover
      onQueueFull: 30s                  # Cooldown for 30s on self-hosted queue saturation
      autoRefreshOAuth: true            # Background auto-refresh for subscription OAuth tokens
    timeout: 30s
    retry:
      attempts: 2
      statusCodes: [502, 503, 504]
```

## MCP

One object can federate multiple MCP Services:

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

Prefer `backendRef` for an in-cluster Agent; use `host` for an external Agent:

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

Core Services and DxgateServices both use `backendRefs`, but one rule cannot mix the two kinds:

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

The repository's no-paid-key `samples/ai-mesh` example covers ordinary `/users` and `/orders`, OpenAI, Anthropic, MCP, and A2A.

Complete resources and calls by scenario: [ordinary Kubernetes Services](http-service.md), [LLM Services](llm.md), [MCP Services](mcp.md), and [A2A Services](a2a.md).
