# 可观测性

指标、日志、链路追踪三样都从管理端口或标准输出出来，不需要额外的 sidecar。管理端口默认 `0.0.0.0:15021`，与业务端口分开，便于只在集群内暴露。

## 管理端口

| 路径 | 用途 |
| --- | --- |
| `/healthz` | 存活探针，返回构建信息 |
| `/readyz` | 就绪探针，附 `revision`、各来源版本与冲突项 |
| `/metrics` | Prometheus 指标 |
| `/debug/config` | 当前生效的完整运行时配置 |
| `/debug/cost` | API 美元 + ChatGPT credits 账本 |
| `/debug/routes` | 路由视图 |
| `/debug/clusters` | 集群与端点视图 |
| `/debug/backends` | 智能体后端视图 |
| `/debug/policies` | 策略视图，含每条策略的挂载点 |
| `/debug/sources` | 每个资源归谁所有，以及各来源最后上报的版本 |
| `/ui` | 内置管理界面 |

排查配置没生效时先看 `/readyz`：`revision` 每次生效递增，`source_versions` 是各来源最后上报的版本，`conflicts` 列出悬空引用。要确认某个资源来自哪一侧，看 `/debug/sources`。

## 指标

无标签的全局计数：

| 指标 | 类型 | 含义 |
| --- | --- | --- |
| `dxgate_ready` | gauge | 是否已接受运行时配置 |
| `dxgate_config_conflicts` | gauge | 当前未解析的引用冲突条数 |
| `dxgate_requests_total` | counter | 观察到的请求总数 |
| `dxgate_agent_requests_total` | counter | 其中智能体协议的请求数 |
| `dxgate_policy_denied_total` | counter | 被策略拒绝的请求数 |
| `dxgate_upstream_failures_total` | counter | 上游失败次数 |

HTTP 网关流量按路由与集群拆分，标签为 `namespace`、`gateway`、`route`、`cluster`、`method`、`status_code`：

| 指标 | 类型 |
| --- | --- |
| `dxgate_http_route_requests_total` | counter |
| `dxgate_http_route_failures_total` | counter |
| `dxgate_http_route_latency_ms` | histogram |

智能体流量按路由与后端拆分，标签为 `protocol`、`route`、`backend`：

| 指标 | 类型 |
| --- | --- |
| `dxgate_agent_route_requests_total` | counter |
| `dxgate_agent_route_failures_total` | counter |
| `dxgate_agent_route_latency_ms` | histogram |

抓取配置指向管理端口即可：

```yaml
scrape_configs:
  - job_name: dxgate
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: [dubbo-system]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
        regex: dxgate
        action: keep
      - source_labels: [__address__]
        regex: '(.+):\d+'
        replacement: '${1}:15021'
        target_label: __address__
```

## 访问日志

访问日志默认开启并写到标准输出。受管网关通常通过 [Telemetry API](../tasks/observability/logs/logs.md) 配置；控制面会把配置转换成下列环境变量：

| 环境变量 | 取值 | 默认 |
| --- | --- | --- |
| `DXGATE_ACCESS_LOG` | `false` / `0` / `no` / `off` 关闭，其余开启 | 开启 |
| `DXGATE_ACCESS_LOG_FORMAT` | `json` 或 `text` | `text` |
| `DXGATE_ACCESS_LOG_MODE` | `SERVER`、`CLIENT` 或 `CLIENT_AND_SERVER` | `CLIENT_AND_SERVER` |
| `DXGATE_ACCESS_LOG_FILTER` | 访问日志过滤表达式 | 无 |
| `DXGATE_ACCESS_LOG_TAGS` | 静态标签 JSON 对象 | 无 |
| `DXGATE_OTEL_LOGS_ENDPOINT` | OTLP/gRPC 日志端点 | 回退到 `DXGATE_OTEL_ENDPOINT` |

JSON 格式每条一行，字段固定：

```json
{
  "namespace": "dubbo-system",
  "gateway": "http-80",
  "route": "default",
  "cluster": "example-backend",
  "method": "GET",
  "host": "example.com",
  "path": "/details",
  "status_code": 200,
  "latency_ms": 12,
  "upstream": "10.1.2.3:8080",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7"
}
```

`trace_id` 与 `span_id` 与下面的链路追踪同源，便于从一条日志跳到对应的 trace。配置 `otel` provider 后，同一请求还会作为 OTLP LogRecord 导出，包含这些请求字段和 Telemetry 静态标签。

## 链路追踪

网关按 W3C Trace Context 传播 `traceparent`：上游带了就续接，没带就新建。设置 OTLP 端点后开始导出：

| 参数 | 环境变量 | 默认 |
| --- | --- | --- |
| `--otel-endpoint` | `DXGATE_OTEL_ENDPOINT` | 无，不导出 |
| `--otel-service-name` | `DXGATE_OTEL_SERVICE_NAME` | `dxgate` |
| `--otel-sampling-percentage` | `DXGATE_OTEL_SAMPLING_PERCENTAGE` | `100` |
| `--otel-tags` | `DXGATE_OTEL_TAGS` | 无，JSON 对象 |

```yaml
env:
  - name: DXGATE_OTEL_ENDPOINT
    value: http://otel-collector.observability.svc:4317
  - name: DXGATE_OTEL_SAMPLING_PERCENTAGE
    value: "10"
  - name: DXGATE_OTEL_TAGS
    value: '{"cluster":"prod","region":"cn-hangzhou"}'
  - name: DXGATE_ACCESS_LOG_FORMAT
    value: json
```

`--otel-tags` 收一个 JSON 对象，键值会作为资源属性附在所有导出的 span 上。生产环境建议把采样率调低，日志改成 `json` 交给采集器。

部署时把这些变量写进 Deployment 即可。

## 配额管理与时间线 (Quota Windows)

针对三种不同性质的算力池，dxgate 在可观测性面板中提供**三轨额度计量引擎**与**配额窗口甘特图（Quota Windows Timeline）**：

### 1. 三类算力池额度查看机制

| 算力池类型 | 核心指标 | 观测展示形态 | 调度与保护规则 |
| :--- | :--- | :--- | :--- |
| **自建私有算力 (`self-hosted`)** | **GPU 并发数** 与 **排队时延** | **并发仪表盘（Gauge）与排队深度**<br/>例：`38 / 64 Concurrency (59.4%)`，P95 `42ms` | 并发饱和或队列满时，触发 `onQueueFull` 降级/溢出至 Tier 2。 |
| **订阅型账号 (`subscription`)** | **Credits / 周期百分比** 与 **重置时间戳** | **配额进度条 + 窗口甘特图**<br/>例：`1% · 09/21 重置`，时间轴显示 30 天/5 小时窗口条 | 遇到 429 或配额耗尽时自动进入冷却，流量轮换至池内其他账号。 |
| **云端按量 API (`api-key`)** | **实时金额 (USD)** 与 **RPM/TPM 限额** | **实时美元账本 + 速率水位表**<br/>例：今日消耗 `$23.85`，当前速率 `3,000 / 250,000 TPM` | 精确记录单次 Prompt/Completion Token 费用，超预算触发熔断。 |

### 2. 配额窗口时间线 (Quota Windows Timeline)

在管理控制台中支持 **按周** 与 **5 小时滚动窗口** 双维度查看各订阅凭证的有效周期，直观呈现多账号错峰重置时间分布，避免团队在同一时间段遭遇大面积限流。
