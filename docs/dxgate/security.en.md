# Security

## Client authentication

Authentication is declared directly in `DxgateService.spec.policies`; there is no separate Policy CRD:

```yaml
spec:
  policies:
    auth:
      header: x-client-key
      secretRef:
        name: client-credentials
        key: api-key
```

The request header must exactly match the Secret value. A failure returns `401` and increments `dxgate_policy_denied_total`.

## Provider credentials

LLM credentials are also same-namespace Secret references:

```yaml
spec:
  ai:
    provider:
      openai: {}
      credential:
        name: provider-credentials
        key: api-key
```

The Secret value never enters the Kubernetes CRD, RDS, or `/debug/config`. `dubbod` sends only `{namespace,name,key}`; dxgate reads the value with the gateway ServiceAccount and keeps it in memory. A managed gateway gets only same-namespace `secrets/get`, and cross-namespace references are rejected.

## Auth Files Management (Credentials Vault)

For subscription tokens (ChatGPT / Claude / Codex OAuth token files) and API Key credentials, dxgate provides a dedicated credentials management console:

- **Provider Filter Tabs**: Filter by Codex, Claude, Antigravity, xAI, Kimi, and OpenAI;
- **20-Block Health Bar**: Tracks the last 20 request probes (success/failure) for instant health visibility;
- **Diagnostic Banners**: Automatically highlights `unauthorized` or 429 Cooldown states with quick token refresh triggers;
- **Full Credential Lifecycle**: Supports model aliasing, dynamic token refresh, encrypted export, and enable/disable toggles.

## Policies

One `policies` block applies to every HTTPRoute that references the `DxgateService`. It supports:

- API-key authentication;
- request-rate and LLM token budgets;
- timeout, retry, and maximum body size;
- request and response header transforms.

`dubbod` validates policy at admission and compile time; the data plane consumes only the compiled result.

## Transport and container

- A managed Gateway can use Dubbo mutual TLS to in-mesh Services.
- dxgate runs as UID/GID `65532`, with a read-only root filesystem and no capabilities.
- The business Service does not expose the admin port, and `/debug/*` never returns Secret values.
- xDS is the only routing configuration source; the data plane watches no private CRDs.
