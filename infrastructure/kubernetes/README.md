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
- `syntha-orchestrator` Temporal worker deployment
- Redis, Redpanda, ClickHouse, and OpenTelemetry collector

Temporal itself is expected to run as a platform dependency at `temporal-frontend.temporal:7233`; the worker target can be changed through the `syntha-config` ConfigMap.
