# Cost Control

After traffic hits dxgate, Cost Control writes three distinct ledgers: **Self-Hosted Throughput**, **Subscription Credits**, and **API USD**. No artificial exchange rates. Unknown models are not priced.

Access: `/ui` → Cost Control, or via the management endpoint `GET /debug/cost`.

---

## 1. Three-Track Cost Model

| Ledger Track | Account Pool | Metric Unit | Cost Attributes |
| :--- | :--- | :--- | :--- |
| **Self-Hosted Compute** | `self-hosted` | Concurrency / Token Throughput | **$0 Marginal Cost** (Tracks GPU load & queue latency) |
| **Monthly Subscriptions** | `subscription` | ChatGPT / Claude Credits | **Fixed Monthly** (Tracks period quota usage & reset dates) |
| **Cloud Commercial API** | `api-key` | Real USD (Tiered per Token) | **Pay-As-You-Go** (Calculates per-request USD ledger) |

---

## 2. Subscription Configuration (Codex / ChatGPT / Claude)

Uses OAuth credentials with background auto-refresh. Quotas are recorded whenever `usage` is returned:

```yaml
spec:
  ai:
    provider:
      openai:
        pool:
          - id: codex-sub-01
            type: subscription
            weight: 100
            credentialRef:
              name: oauth-codex-01
              key: token.json
```

Local Codex client configuration:

```toml
[model_providers.dxgate]
name = "dxgate"
base_url = "http://127.0.0.1:8080/v1"
wire_api = "chat"

[profiles.dxgate]
model = "gpt-5"
model_provider = "dxgate"
```

---

## 3. Pay-As-You-Go API Configuration

Inject API keys via Secret, clients connect via `/v1`:

```bash
kubectl -n dubbo-system create secret generic openai-secret \
  --from-literal=Authorization="$OPENAI_API_KEY"
```

```yaml
spec:
  ai:
    provider:
      openai:
        pool:
          - id: openai-official
            type: api-key
            weight: 100
            credentialRef:
              name: openai-secret
              key: Authorization
```

---

## 4. Self-Hosted Compute Configuration

In-cluster vLLM / SGLang / Ollama clusters with $0 API fees, monitoring GPU throughput and concurrency limits:

```yaml
spec:
  ai:
    provider:
      openai:
        pool:
          - id: vllm-deepseek-r1
            type: self-hosted
            weight: 100
            endpoint: http://vllm-service.ai-infra.svc:8000/v1
            maxConcurrency: 64
```

See [LLM Services](llm.md) for full multi-account pooling and priority routing details.
