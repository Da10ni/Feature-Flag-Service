variable "name_prefix" { type = string }
variable "region" { type = string }
variable "environment" { type = string }
variable "network_id" { type = string }
variable "private_vpc_connection" { type = string }
variable "db_tier" { type = string }
variable "redis_memory_gb" { type = number }

locals {
  is_production = var.environment == "production"
}

# --- Cloud SQL (PostgreSQL) -------------------------------------------------------------
# Chosen over self-managed Postgres for automated backups, patching and failover. REGIONAL
# in production gives a synchronous standby in a second zone; staging stays ZONAL to keep
# the bill down, since a staging outage costs nothing but time.
resource "google_sql_database_instance" "main" {
  name                = "${var.name_prefix}-postgres"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = local.is_production

  settings {
    tier              = var.db_tier
    availability_type = local.is_production ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = local.is_production
    }

    # No public IP: the only route in is the VPC, via the Cloud Run connector.
    ip_configuration {
      ipv4_enabled    = false
      private_network = var.network_id
    }
  }

  depends_on = [var.private_vpc_connection]
}

resource "google_sql_database" "database" {
  name     = "featureflags"
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

resource "google_sql_user" "user" {
  name     = "appuser"
  instance = google_sql_database_instance.main.name
  password = random_password.db_password.result
}

# --- Memorystore (Redis) ----------------------------------------------------------------
# Caches evaluated flag results. STANDARD_HA in production so a node failure doesn't dump
# the whole cache onto Postgres at once; BASIC is fine for staging.
resource "google_redis_instance" "main" {
  name               = "${var.name_prefix}-redis"
  tier               = local.is_production ? "STANDARD_HA" : "BASIC"
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = var.network_id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  redis_version      = "REDIS_7_0"
  display_name       = "${var.name_prefix} cache"

  depends_on = [var.private_vpc_connection]
}

# --- Secrets ----------------------------------------------------------------------------
# The generated DB password is never written to a tfvars file or a plain env var; Cloud Run
# reads it from Secret Manager at start-up via secret_key_ref.
resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.name_prefix}-db-password"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}

# Guards tenant registration on a publicly reachable service. Generated here rather than
# supplied so the plaintext never leaves GCP.
resource "random_password" "admin_api_key" {
  length  = 40
  special = false
}

resource "google_secret_manager_secret" "admin_api_key" {
  secret_id = "${var.name_prefix}-admin-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "admin_api_key" {
  secret      = google_secret_manager_secret.admin_api_key.id
  secret_data = random_password.admin_api_key.result
}

output "db_private_ip" { value = google_sql_database_instance.main.private_ip_address }
output "redis_host" { value = google_redis_instance.main.host }
output "redis_port" { value = google_redis_instance.main.port }
output "db_password_secret_id" { value = google_secret_manager_secret.db_password.secret_id }
output "db_password_secret_name" { value = google_secret_manager_secret.db_password.id }
output "admin_key_secret_id" { value = google_secret_manager_secret.admin_api_key.secret_id }
output "admin_key_secret_name" { value = google_secret_manager_secret.admin_api_key.id }
