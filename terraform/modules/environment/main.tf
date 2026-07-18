# Composition module: one complete, self-contained environment.
#
# Both env roots (envs/staging, envs/production) instantiate this with different inputs, so
# the two environments are guaranteed to have identical shape and differ only in the values
# that should differ — size, scaling, CIDR, alert thresholds. Adding a resource here adds it
# to every environment, which is what stops staging and production drifting apart.

variable "project_id" { type = string }
variable "region" { type = string }
variable "app_name" { type = string }
variable "environment" { type = string }
variable "image_tag" { type = string }
variable "alert_email" { type = string }
variable "subnet_cidr" { type = string }
variable "db_tier" { type = string }
variable "redis_memory_gb" { type = number }
variable "min_instances" { type = number }
variable "max_instances" { type = number }
variable "eval_latency_threshold_ms" { type = number }

# Two GCP resources have name limits far below what "<app_name>-<environment>-*" produces:
# service account account_id is capped at 30 chars and VPC connector name at 25. With
# app_name = "feature-flag-service" the long prefix is already 28-31 chars, so those two
# resources get this abbreviated prefix instead. Everything else keeps the readable name.
variable "short_name" {
  type        = string
  default     = "ffs"
  description = "Abbreviated app_name, used only where GCP name limits forbid the full prefix."
  validation {
    # Longest suffix is "-con" (4). VPC connector cap of 25 is the binding constraint;
    # keeping the whole short_prefix under 21 satisfies the service account cap of 30 too.
    condition     = length(var.short_name) <= 12
    error_message = "short_name must be 12 characters or fewer to keep derived names within GCP limits."
  }
}

locals {
  # Every resource carries the environment in its name, so staging and production can
  # coexist in a single GCP project without colliding.
  name_prefix  = "${var.app_name}-${var.environment}"
  service_name = "${var.app_name}-${var.environment}"

  # e.g. "ffs-stg" / "ffs-prod" — max 17 chars, so "-con" and "-sa" both stay legal.
  env_short    = { development = "dev", staging = "stg", production = "prod" }[var.environment]
  short_prefix = "${var.short_name}-${local.env_short}"

  # Artifact Registry is shared across environments (see terraform/shared) so the exact
  # image validated in staging is the one promoted to production — never a rebuild.
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}/${var.app_name}:${var.image_tag}"
}

module "network" {
  source       = "../network"
  name_prefix  = local.name_prefix
  short_prefix = local.short_prefix
  region       = var.region
  subnet_cidr  = var.subnet_cidr
}

module "data" {
  source                 = "../data"
  name_prefix            = local.name_prefix
  region                 = var.region
  environment            = var.environment
  network_id             = module.network.network_id
  private_vpc_connection = module.network.private_vpc_connection
  db_tier                = var.db_tier
  redis_memory_gb        = var.redis_memory_gb
}

module "service" {
  source       = "../service"
  name_prefix  = local.name_prefix
  short_prefix = local.short_prefix
  service_name = local.service_name
  project_id   = var.project_id
  region       = var.region
  environment  = var.environment
  image        = local.image

  connector_id = module.network.connector_id
  db_host      = module.data.db_private_ip
  redis_host   = module.data.redis_host
  redis_port   = module.data.redis_port

  db_password_secret_id   = module.data.db_password_secret_id
  db_password_secret_name = module.data.db_password_secret_name
  admin_key_secret_id     = module.data.admin_key_secret_id
  admin_key_secret_name   = module.data.admin_key_secret_name

  min_instances = var.min_instances
  max_instances = var.max_instances
}

module "observability" {
  source                    = "../observability"
  name_prefix               = local.name_prefix
  service_name              = local.service_name
  project_id                = var.project_id
  service_url               = module.service.url
  alert_email               = var.alert_email
  eval_latency_threshold_ms = var.eval_latency_threshold_ms
}

output "service_url" { value = module.service.url }
output "service_name" { value = local.service_name }
output "artifact_registry" { value = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}" }
output "db_private_ip" {
  value     = module.data.db_private_ip
  sensitive = true
}
output "admin_key_secret" {
  value       = module.data.admin_key_secret_id
  description = "Read the value with: gcloud secrets versions access latest --secret=<id>"
}
