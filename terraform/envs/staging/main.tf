terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Separate state PREFIX per environment. This is the line that keeps a staging apply from
  # ever touching production resources — see ../production/main.tf for the other prefix.
  #
  # The bucket is deliberately not hardcoded: GCS bucket names are globally unique across
  # all of Google Cloud, so a literal name here would mean only one person on earth could
  # ever run this configuration. Supply it at init instead:
  #
  #   terraform init -backend-config="bucket=$PROJECT_ID-tfstate"
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

  # Address plan, distinct per environment so the two VPCs can coexist in one project.
  #
  #   peering_address  10.10.0.0/16   -> Cloud SQL + Memorystore (Google-managed)
  #   subnet_cidr      10.210.0.0/24  -> Cloud Run, via Direct VPC egress
  #
  # The subnet deliberately sits far outside the peering /16. They originally read
  # 10.10.0.0/16 and 10.10.0.0/24, where the second is wholly inside the first — GCP
  # rejects that, but only when creating the subnet, which is after Cloud SQL has already
  # been provisioned against the peering range.
  peering_address = "10.10.0.0"
  subnet_cidr     = "10.210.0.0/24"
  db_tier         = "db-f1-micro"
  redis_memory_gb = 1
  min_instances   = 0 # scale to zero — staging traffic doesn't justify a warm instance
  max_instances   = 4

  enable_custom_metric_alerts = var.enable_custom_metric_alerts
  eval_latency_threshold_ms   = 500
}

output "service_url" { value = module.env.service_url }
output "artifact_registry" { value = module.env.artifact_registry }
