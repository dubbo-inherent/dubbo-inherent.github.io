# 成本控制

流量经过 dxgate 后，Cost Control 分别记录三类独立账本：**自建算力吞吐量**、**订阅 Credits** 与 **API 美元**。不发明虚拟汇率，未知模型不计价。

查阅路径：`/ui` → Cost Control，或通过管理接口 `GET /debug/cost`。

---

## 1. 三轨并行成本模型

| 账本轨道 | 对应账号池 | 计费单位 | 成本属性 |
| :--- | :--- | :--- | :--- |
| **自建私有算力** | `self-hosted` | 并发数 / Token 吞吐率 | **$0 边际成本** (记录算力负载与排队时延) |
| **包月订阅池** | `subscription` | ChatGPT / Claude Credits | **固定包月** (记录周期配额消耗与重置时间) |
| **云端商业 API** | `api-key` | 真实美元 USD (按 Token 阶梯) | **按量付费** (精确到单次调用 USD 账单) |

---

## 2. 订阅版配置（Codex / ChatGPT / Claude）

使用 OAuth 凭据，支持由网关后台协程自动刷新 Token。有 `usage` 自动计算 Credits：

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

本地 Codex 客户端配置：

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

## 3. API 按量付费配置

Provider Secret 注入 API key，客户端访问网关 `/v1`：

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

## 4. 自建私有算力配置

内网 vLLM / SGLang / Ollama 集群，零 API 费用，仅追踪 GPU 吞吐与并发饱和度：

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

完整的多账号池协同与优先级调度见 [LLM Service](llm.md)。
