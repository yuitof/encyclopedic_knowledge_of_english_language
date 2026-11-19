terraform {
  required_version = ">= 1.7.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "5.29.0"
    }
  }
}

provider "cloudflare" {}

variable "account_id" {
  type        = string
  description = "Cloudflare account ID for the isolated Access application."
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.account_id))
    error_message = "Account ID must be a 32-character lowercase hexadecimal ID."
  }
}

variable "worker_id" {
  type        = string
  description = "Stable ID of the existing, disabled service-bridge-workers Worker."
  validation {
    condition     = can(regex("^[a-f0-9]{32}$", var.worker_id))
    error_message = "Worker ID must be the 32-character stable ID, such as the script tag."
  }
}

resource "cloudflare_zero_trust_access_service_token" "diagnostics" {
  account_id = var.account_id
  name       = "service-bridge-workers-diagnostics"
  duration   = "168h"

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_zero_trust_access_application" "diagnostics" {
  account_id           = var.account_id
  name                 = "service-bridge-workers-diagnostics"
  type                 = "self_hosted"
  app_launcher_visible = false

  destinations = [{
    type      = "worker"
    worker_id = var.worker_id
  }]

  policies = [{
    name       = "Only the diagnostics service token"
    precedence = 1
    decision   = "non_identity"
    include = [{
      service_token = {
        token_id = cloudflare_zero_trust_access_service_token.diagnostics.id
      }
    }]
  }]
}

output "service_token_client_id" {
  value     = cloudflare_zero_trust_access_service_token.diagnostics.client_id
  sensitive = true
}

output "service_token_client_secret" {
  value     = cloudflare_zero_trust_access_service_token.diagnostics.client_secret
  sensitive = true
}
