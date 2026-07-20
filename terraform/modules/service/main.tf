variable "name_prefix" { type = string }
variable "short_prefix" {
  type        = string
  description = "Abbreviated prefix — service account account_id is capped at 30 characters."
  validation {
    condition     = length("${var.short_prefix}-sa") >= 6 && length("${var.short_prefix}-sa") <= 30
    error_message = "Service account id '<short_prefix>-sa' must be between 6 and 30 characters."
  }
}
variable "service_name" { type = string }
variable "project_id" { type = string }
variable "region" { type = string }
variable "environment" { type = string }
variable "image" { type = string }
variable "network_id" { type = string }
variable "subnetwork_id" { type = string }
variable "db_host" { type = string }
variable "redis_host" { type = string }
variable "redis_port" { type = number }
variable "db_password_secret_id" { type = string }
variable "db_password_secret_name" { type = string }
variable "admin_key_secret_id" { type = string }
variable "admin_key_secret_name" { type = string }
variable "min_instances" { type = number }
variable "max_instances" { type = number }

locals {
  is_production = var.environment == "production"
}

resource "google_service_account" "run" {
  account_id   = "${var.short_prefix}-sa"
  display_name = "${var.name_prefix} Cloud Run"
}

resource "google_project_iam_member" "sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "db_password" {
  secret_id = var.db_password_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_key" {
  secret_id = var.admin_key_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_project_iam_member" "metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_cloud_run_v2_service" "main" {
  name     = var.service_name
  location = var.region

  template {
    service_account = google_service_account.run.email

    annotations = {
      "run.googleapis.com/gmp-config" = jsonencode({
        scrape_configs = [{
          job_name        = var.service_name
          scrape_interval = "30s"
          metrics_path    = "/api/v1/metrics"
          static_configs  = [{ targets = ["localhost:3000"] }]
        }]
      })
    }

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      network_interfaces {
        network    = var.network_id
        subnetwork = var.subnetwork_id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      name  = "app"
      image = var.image

      ports { container_port = 3000 }

      resources {
        limits = {
          cpu    = local.is_production ? "2" : "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = var.environment
      }
      env {
        name  = "DB_HOST"
        value = var.db_host
      }
      env {
        name  = "DB_PORT"
        value = "5432"
      }
      env {
        name  = "DB_USER"
        value = "appuser"
      }
      env {
        name  = "DB_NAME"
        value = "featureflags"
      }
      env {
        name  = "DB_SSL"
        value = "true"
      }
      env {
        name  = "REDIS_HOST"
        value = var.redis_host
      }
      env {
        name  = "REDIS_PORT"
        value = tostring(var.redis_port)
      }

      env {
        name = "DB_PASSWORD"
        value_source {
          secret_key_ref {
            secret  = var.db_password_secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "ADMIN_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.admin_key_secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/v1/health"
          port = 3000
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/api/v1/health"
          port = 3000
        }
        initial_delay_seconds = 30
        period_seconds        = 10
        failure_threshold     = 3
      }
    }

    containers {
      name  = "collector"
      image = "us-docker.pkg.dev/cloud-ops-agents-artifacts/cloud-run-gmp-sidecar/cloud-run-gmp-sidecar:1.1.1"
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      traffic,
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  location = google_cloud_run_v2_service.main.location
  name     = google_cloud_run_v2_service.main.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "url" { value = google_cloud_run_v2_service.main.uri }
output "service_account_email" { value = google_service_account.run.email }
