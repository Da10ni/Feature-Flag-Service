variable "name_prefix" { type = string }
variable "service_name" { type = string }
variable "project_id" { type = string }
variable "service_url" { type = string }
variable "alert_email" { type = string }
variable "eval_latency_threshold_ms" {
  type        = number
  description = "p95 flag-evaluation latency that should page."
}

variable "enable_custom_metric_alerts" {
  type        = bool
  default     = false
  description = <<-EOT
    Create alert policies that reference the application's own Prometheus metrics.

    Off by default because of a bootstrap ordering constraint, not because the alert is
    optional. Cloud Monitoring validates an alert's query at creation time and rejects it
    with "Could not find a metric named ..." if the metric descriptor does not yet exist.
    That descriptor is only created once the service has served real traffic and the
    Managed Prometheus sidecar has exported it — so on a brand-new project this alert
    cannot be created in the same apply that creates the service.

    Enable on a second apply, after the service has taken traffic:
      terraform apply -var="enable_custom_metric_alerts=true"

    The error-rate and uptime alerts below have no such constraint: they use Cloud Run's
    built-in metrics, which exist from the moment the service does.
  EOT
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  display_name = "${var.name_prefix} - Email"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

locals {
  channels = var.alert_email == "" ? [] : [google_monitoring_notification_channel.email[0].id]
}

# --- Alert: error rate > 5% over 5 minutes ----------------------------------------------
# MQL rather than a threshold condition because the requirement is a RATIO (5xx / all).
# A plain threshold on 5xx/sec would page during harmless low-traffic blips and stay quiet
# during a real outage at low volume.
resource "google_monitoring_alert_policy" "error_rate" {
  display_name = "${var.name_prefix} - Error Rate > 5%"
  combiner     = "OR"

  conditions {
    display_name = "5xx ratio > 5% over 5 minutes"
    condition_monitoring_query_language {
      duration = "300s"
      query    = <<-EOT
        fetch cloud_run_revision
        | metric 'run.googleapis.com/request_count'
        | filter resource.service_name == '${var.service_name}'
        | align rate(5m)
        | { t_5xx:  filter metric.response_code_class == '5xx' | group_by [], sum(value.request_count)
          ; t_all:  group_by [], sum(value.request_count) }
        | ratio
        | condition ratio > 0.05
      EOT
      trigger { count = 1 }
    }
  }

  notification_channels = local.channels
  alert_strategy { auto_close = "604800s" }
}

# --- Alert: flag evaluation latency ------------------------------------------------------
# Alerts on the application's own histogram (via Managed Prometheus), not Cloud Run's
# request latency — the spec asks specifically for evaluation latency, and request latency
# would hide a slow evaluation behind fast health checks and CRUD calls.
resource "google_monitoring_alert_policy" "eval_latency" {
  count        = var.enable_custom_metric_alerts ? 1 : 0
  display_name = "${var.name_prefix} - Flag Evaluation p95 Latency"
  combiner     = "OR"

  conditions {
    display_name = "Evaluation p95 > ${var.eval_latency_threshold_ms}ms"
    condition_monitoring_query_language {
      duration = "300s"
      query    = <<-EOT
        fetch prometheus_target
        | metric 'prometheus.googleapis.com/flag_evaluation_duration_seconds/histogram'
        | align delta(5m)
        | every 60s
        | group_by [], [value_percentile: percentile(value.histogram, 95)]
        | condition value_percentile > ${var.eval_latency_threshold_ms / 1000}
      EOT
      trigger { count = 1 }
    }
  }

  notification_channels = local.channels
  alert_strategy { auto_close = "604800s" }
}

# --- Uptime check + health alert ---------------------------------------------------------
resource "google_monitoring_uptime_check_config" "health" {
  display_name = "${var.name_prefix} - Health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/api/v1/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = replace(replace(var.service_url, "https://", ""), "/", "")
    }
  }
}

resource "google_monitoring_alert_policy" "health_check" {
  display_name = "${var.name_prefix} - Health Check Failing"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failed"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.health.uptime_check_id}\""
      duration        = "120s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
      }
    }
  }

  notification_channels = local.channels
  alert_strategy { auto_close = "604800s" }
}

# --- Dashboard ---------------------------------------------------------------------------
# The four metrics the spec calls out, plus instance count for capacity context.
resource "google_monitoring_dashboard" "main" {
  dashboard_json = jsonencode({
    displayName = "${var.name_prefix} - Overview"
    gridLayout = {
      columns = 2
      widgets = [
        {
          title = "Evaluations/sec by tenant"
          xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = {
            filter      = "metric.type=\"prometheus.googleapis.com/flag_evaluations_total/counter\""
            aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.tenant"] }
          } } }] }
        },
        {
          title = "Flag evaluation latency p95"
          xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = {
            filter      = "metric.type=\"prometheus.googleapis.com/flag_evaluation_duration_seconds/histogram\""
            aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
          } } }] }
        },
        {
          title = "Cache hit / miss"
          xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = {
            filter      = "metric.type=\"prometheus.googleapis.com/flag_evaluation_cache_total/counter\""
            aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.result"] }
          } } }] }
        },
        {
          title = "Error rate by response class"
          xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = {
            filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\" AND metric.type=\"run.googleapis.com/request_count\""
            aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_RATE", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.response_code_class"] }
          } } }] }
        },
        {
          title = "Request latency p95 (Cloud Run)"
          xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = {
            filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\" AND metric.type=\"run.googleapis.com/request_latencies\""
            aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_PERCENTILE_95" }
          } } }] }
        },
        {
          title = "Container instance count"
          xyChart = { dataSets = [{ timeSeriesQuery = { timeSeriesFilter = {
            filter      = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\" AND metric.type=\"run.googleapis.com/container/instance_count\""
            aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" }
          } } }] }
        }
      ]
    }
  })
}
