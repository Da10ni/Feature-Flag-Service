variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all regional resources"
  type        = string
  default     = "us-central1"
}

variable "app_name" {
  description = "Base name. Every resource is named <app_name>-<environment>-*"
  type        = string
  default     = "feature-flag-service"
}

variable "image_tag" {
  description = "Container image tag to deploy. CI overrides this per deploy."
  type        = string
  default     = "latest"
}

variable "alert_email" {
  description = "Address that receives Cloud Monitoring alerts. Empty disables alerting."
  type        = string
  default     = ""
}

variable "enable_custom_metric_alerts" {
  description = "Create alerts on the app's own Prometheus metrics. Enable on a second apply, after the service has served traffic (see modules/observability)."
  type        = bool
  default     = false
}
