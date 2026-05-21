# Syntha Kubernetes

Render the base manifests:

```bash
kubectl kustomize infrastructure/kubernetes/base
```

Apply to the current cluster context:

```bash
kubectl apply -k infrastructure/kubernetes/base
```

The base includes:

- `syntha-api` deployment and service
- `syntha-dashboard` deployment, service, HPA, and disruption budget
- `browser-worker` deployment with HPA and disruption budget
- `fake-gmail` deployment and service
- `fake-slack` deployment and service
- `fake-jira` deployment and service
- `fake-salesforce` deployment and service
- `syntha-orchestrator` Temporal worker deployment
- Redis, Redpanda, ClickHouse, and OpenTelemetry collector
- Runtime hardening defaults:
  - non-root pods/containers for first-party workloads
  - `RuntimeDefault` seccomp profile
  - `allowPrivilegeEscalation: false`
  - dropped Linux capabilities
  - read-only root filesystems with scoped writable `emptyDir` mounts (`/data`, `/tmp`, `/dev/shm` as required)
- NetworkPolicy enforcement:
  - default deny ingress and egress in namespace `syntha`
  - explicit allow-rules for DNS, internal platform traffic, browser-worker web egress, and Temporal worker egress to `temporal-frontend.temporal:7233`

Temporal itself is expected to run as a platform dependency at `temporal-frontend.temporal:7233`; the worker target can be changed through the `syntha-config` ConfigMap.
