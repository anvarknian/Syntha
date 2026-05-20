# Syntha Terraform

This module applies the Kubernetes base with `kubectl apply -k`.

```bash
cd infrastructure/terraform
terraform init
terraform apply
```

Optional target context:

```bash
terraform apply -var='kubectl_context=my-cluster'
```

The Terraform layer intentionally stays thin for now: cluster creation is provider-specific, while the portable Syntha runtime surface lives in `infrastructure/kubernetes/base`.
