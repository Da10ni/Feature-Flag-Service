output "cloud_run_url" {
  description = "The public URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.main.uri
}

output "db_private_ip" {
  description = "Cloud SQL private IP"
  value       = google_sql_database_instance.main.private_ip_address
  sensitive   = true
}

output "redis_host" {
  description = "Redis private IP"
  value       = google_redis_instance.main.host
  sensitive   = true
}

output "artifact_registry_url" {
  description = "Artifact Registry Docker repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${var.app_name}"
}
