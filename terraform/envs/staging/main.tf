terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    prefix = "terraform/state/staging"
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
  environment = "staging"
  image_tag   = var.image_tag
  alert_email = var.alert_email

  peering_address = "10.10.0.0"
  subnet_cidr     = "10.210.0.0/24"
  db_tier         = "db-f1-micro"
  redis_memory_gb = 1
  min_instances   = 0
  max_instances   = 4

  enable_custom_metric_alerts = var.enable_custom_metric_alerts
  eval_latency_threshold_ms   = 500
}

output "service_url" { value = module.env.service_url }
output "artifact_registry" { value = module.env.artifact_registry }
