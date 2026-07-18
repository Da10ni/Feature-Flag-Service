/**
 * Resources shared by every environment. Applied once, before either env root.
 *
 * Artifact Registry lives here rather than per-environment so that the image validated in
 * staging is bit-for-bit the image promoted to production. A per-environment registry would
 * force a rebuild between the two, and a rebuild is a different artifact — which defeats the
 * point of having a staging environment at all.
 */
terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "feature-flag-service-tfstate"
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
