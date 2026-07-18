terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Separate state file per environment. This is the line that keeps a staging apply from
  # ever touching production resources — see ../production/main.tf for the other prefix.
  backend "gcs" {
    bucket = "feature-flag-service-tfstate"
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

  # Distinct CIDR per environment so the two VPCs can coexist in one project.
  subnet_cidr     = "10.10.0.0/24"
  db_tier         = "db-f1-micro"
  redis_memory_gb = 1
  min_instances   = 0 # scale to zero — staging traffic doesn't justify a warm instance
  max_instances   = 4

  eval_latency_threshold_ms = 500
}

output "service_url" { value = module.env.service_url }
output "artifact_registry" { value = module.env.artifact_registry }
