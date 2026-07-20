terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    prefix = "terraform/state/shared"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "app_name" {
  type    = string
  default = "feature-flag-service"
}

resource "google_artifact_registry_repository" "main" {
  location      = var.region
  repository_id = var.app_name
  description   = "Feature Flag Service container images (shared across environments)"
  format        = "DOCKER"
}

output "registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}"
}
