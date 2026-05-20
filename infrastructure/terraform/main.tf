terraform {
  required_version = ">= 1.6.0"

  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

variable "kustomize_path" {
  type        = string
  description = "Path to the Syntha Kubernetes Kustomize base."
  default     = "../kubernetes/base"
}

variable "kubectl_context" {
  type        = string
  description = "Optional kubectl context to target. Leave empty to use the current context."
  default     = ""
}

locals {
  context_arg = var.kubectl_context == "" ? "" : "--context ${var.kubectl_context}"
}

resource "null_resource" "syntha_kubernetes_apply" {
  triggers = {
    kustomize_path  = var.kustomize_path
    kubectl_context = var.kubectl_context
  }

  provisioner "local-exec" {
    command = "kubectl ${local.context_arg} apply -k ${var.kustomize_path}"
  }
}

output "kustomize_path" {
  value = var.kustomize_path
}
