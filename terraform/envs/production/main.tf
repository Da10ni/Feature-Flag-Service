terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Distinct state prefix from staging — the two environments never share state.
  backend "gcs" {
    bucket = "feature-flag-service-tfstate"
    prefix = "terraform/state/production"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "env" {
  source = "../../modules/environment"

  project_id  = var.project_id
  region      = var.region
  app_name    = var.app_name
  environment = "production"
  image_tag   = var.image_tag
  alert_email = var.alert_email

  subnet_cidr     = "10.20.0.0/24"
  db_tier         = "db-custom-2-4096"
  redis_memory_gb = 2
  # Warm instances: flag evaluation is on the request path of every client app, so a cold
  # start would show up as a latency spike in someone else's product.
  min_instances = 2
  max_instances = 20

  eval_latency_threshold_ms = 250
}

output "service_url" { value = module.env.service_url }
output "artifact_registry" { value = module.env.artifact_registry }
output "admin_key_secret" { value = module.env.admin_key_secret }
