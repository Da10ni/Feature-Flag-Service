variable "name_prefix" { type = string }
variable "short_prefix" {
  type        = string
  description = "Abbreviated prefix — the VPC connector name is capped at 25 characters."
  validation {
    condition     = length("${var.short_prefix}-con") <= 25
    error_message = "VPC connector name '<short_prefix>-con' must be 25 characters or fewer."
  }
}
variable "region" { type = string }
variable "subnet_cidr" {
  type        = string
  description = "Must not overlap with other environments sharing this project."
}

# Cloud Run is serverless and has no VPC presence of its own; the connector is what lets it
# reach Cloud SQL and Memorystore over private IP, so neither has to be exposed publicly.
resource "google_compute_network" "main" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  name          = "${var.name_prefix}-subnet"
  ip_cidr_range = var.subnet_cidr
  region        = var.region
  network       = google_compute_network.main.id
}

resource "google_vpc_access_connector" "connector" {
  # Capped at 25 chars by GCP, so this uses the short prefix rather than name_prefix.
  name   = "${var.short_prefix}-con"
  region = var.region
  subnet {
    name = google_compute_subnetwork.main.name
  }
  min_throughput = 200
  max_throughput = 1000
}

# Reserved range that Google's service producers (Cloud SQL, Memorystore) peer into.
resource "google_compute_global_address" "private_ip_range" {
  name          = "${var.name_prefix}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

output "network_id" { value = google_compute_network.main.id }
output "connector_id" { value = google_vpc_access_connector.connector.id }
# Downstream modules depend on this so Cloud SQL / Redis are never created before the
# peering exists — without it the first apply fails with an unhelpful IP allocation error.
output "private_vpc_connection" {
  value = google_service_networking_connection.private_vpc_connection.id
}
