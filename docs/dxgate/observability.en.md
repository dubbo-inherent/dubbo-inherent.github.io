# Observability

Metrics, logs, and traces all come out of the admin port or standard output — no extra sidecar. The admin port defaults to `0.0.0.0:15021` and stays separate from the data port so it can be kept inside the cluster.

## Admin port

| Path | Purpose |
| --- | --- |
| `/healthz` | Liveness probe, returns build info |
| `/readyz` | Readiness probe, with `revision`, per-source versions, and conflicts |
| `/metrics` | Prometheus metrics |
| `/debug/config` | The full runtime configuration currently in effect |
| `/debug/cost` | API USD + ChatGPT credits ledger |
| `/debug/routes` | Route view |
| `/debug/clusters` | Cluster and endpoint view |
| `/debug/backends` | Agent backend view |
| `/debug/policies` | Policy view, including what each policy is attached to |
| `/debug/sources` | Who owns each resource, and the version each source last reported |
| `/ui` | Built-in admin interface |

When a change seems not to have landed, start at `/readyz`: `revision` rises on every applied delta, `source_versions` shows what each source last reported, and `conflicts` lists unresolved references. To find out which side a resource came from, read `/debug/sources`.

## Metrics

Unlabelled global counters:

| Metric | Type | Meaning |
| --- | --- | --- |
| `dxgate_ready` | gauge | Whether runtime configuration has been accepted |
| `dxgate_config_conflicts` | gauge | Unresolved references in the merged configuration |
| `dxgate_requests_total` | counter | Requests observed |
| `dxgate_agent_requests_total` | counter | Of those, agent-protocol requests |
| `dxgate_policy_denied_total` | counter | Requests denied by policy |
| `dxgate_upstream_failures_total` | counter | Upstream failures |

HTTP gateway traffic is broken down by route and cluster, labelled `namespace`, `gateway`, `route`, `cluster`, `method`, `status_code`:

| Metric | Type |
| --- | --- |
| `dxgate_http_route_requests_total` | counter |
| `dxgate_http_route_failures_total` | counter |
| `dxgate_http_route_latency_ms` | histogram |

Agent traffic is broken down by route and backend, labelled `protocol`, `route`, `backend`:

| Metric | Type |
| --- | --- |
| `dxgate_agent_route_requests_total` | counter |
| `dxgate_agent_route_failures_total` | counter |
| `dxgate_agent_route_latency_ms` | histogram |

Point the scrape config at the admin port:

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

## Access logs

Access logging is enabled by default and writes to standard output. Managed gateways normally use the [Telemetry API](../tasks/observability/logs/logs.md); the control plane translates it into these environment variables:

| Variable | Values | Default |
| --- | --- | --- |
| `DXGATE_ACCESS_LOG` | `false` / `0` / `no` / `off` disable; anything else enables | enabled |
| `DXGATE_ACCESS_LOG_FORMAT` | `json` or `text` | `text` |
| `DXGATE_ACCESS_LOG_MODE` | `SERVER`, `CLIENT`, or `CLIENT_AND_SERVER` | `CLIENT_AND_SERVER` |
| `DXGATE_ACCESS_LOG_FILTER` | Access-log filter expression | None |
| `DXGATE_ACCESS_LOG_TAGS` | Static-tag JSON object | None |
| `DXGATE_OTEL_LOGS_ENDPOINT` | OTLP/gRPC logs endpoint | Falls back to `DXGATE_OTEL_ENDPOINT` |

The JSON format is one object per line with a fixed set of fields:

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

`trace_id` and `span_id` come from the same context as the traces below, so a log line leads straight to its trace. With the `otel` provider, the same request is also exported as an OTLP LogRecord containing these request fields and the static Telemetry tags.

## Tracing

The gateway propagates `traceparent` per W3C Trace Context: it continues an incoming context or starts a new one. Setting an OTLP endpoint turns on export:

| Flag | Variable | Default |
| --- | --- | --- |
| `--otel-endpoint` | `DXGATE_OTEL_ENDPOINT` | None; no export |
| `--otel-service-name` | `DXGATE_OTEL_SERVICE_NAME` | `dxgate` |
| `--otel-sampling-percentage` | `DXGATE_OTEL_SAMPLING_PERCENTAGE` | `100` |
| `--otel-tags` | `DXGATE_OTEL_TAGS` | None, a JSON object |

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

`--otel-tags` takes a JSON object and attaches its entries as resource attributes on every exported span. In production, lower the sampling rate and switch logs to `json` for your collector.

Set these in the Deployment when installing.

## Quota Management & Quota Windows Timeline

For the three distinct compute pool architectures, dxgate provides a **three-track quota ledger engine** and **Quota Windows Timeline Gantt Chart**:

### 1. Three-Track Compute Pool Quota Views

| Compute Pool Type | Core Metric | Observability Representation | Protection & Failover Rules |
| :--- | :--- | :--- | :--- |
| **Self-Hosted Compute (`self-hosted`)** | **GPU Concurrency** & **Queue Latency** | **Concurrency Gauge & Queue Depth**<br/>e.g., `38 / 64 Concurrency (59.4%)`, P95 `42ms` | Triggers `onQueueFull` overflow to Tier 2 when hardware is saturated. |
| **Subscription Pool (`subscription`)** | **Credits / Periodic %** & **Reset Timestamp** | **Quota Progress Bar + Timeline Gantt**<br/>e.g., `1% · 09/21 Reset`, 30d / 5h rolling bar | Automatic cooldown on 429/depletion with seamless rotation. |
| **Cloud API Pool (`api-key`)** | **Real-time Cost (USD)** & **RPM/TPM Limits** | **Real-time USD Ledger + Rate Watermark**<br/>e.g., `$23.85 used today`, `3,000 / 250,000 TPM` | Exact token cost tracking with circuit-breaking on budget exhaustion. |

### 2. Quota Windows Timeline

The UI timeline supports **Weekly** and **5-Hour Rolling Window** views, allowing teams to visualize staggered reset schedules and prevent simultaneous rate-limiting across pooled accounts.
