variable "name_prefix" { type = string }
variable "region" { type = string }
variable "subnet_cidr" {
  type        = string
  description = <<-EOT
    Subnet that Cloud Run attaches to via Direct VPC egress. Must not overlap peering_address/16.

    Sized /24 rather than the /28 a Serverless VPC Access connector would demand: with direct
    egress each running instance consumes an address from this subnet, so the range has to
    accommodate max_instance_count plus headroom for revision overlap during a deploy.
  EOT
}
variable "peering_address" {
  type        = string
  description = <<-EOT
    Start address of the /16 reserved for Google service producers (Cloud SQL, Memorystore).

    Set explicitly rather than letting GCP auto-allocate. Auto-allocation picks an arbitrary
    free /16, and on the first deploy here it chose 10.10.0.0/16 — which silently contained
    the 10.10.0.0/24 subnet, so subnet creation failed with "conflicts with reserved IP range"
    only AFTER Cloud SQL had already been built against the peering. Pinning it makes the
    address space deterministic and reviewable instead of a race against whatever GCP picks.
  EOT
}

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

resource "google_compute_global_address" "private_ip_range" {
  name          = "${var.name_prefix}-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = var.peering_address
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}

output "network_id" { value = google_compute_network.main.id }
output "subnetwork_id" { value = google_compute_subnetwork.main.id }
output "private_vpc_connection" {
  value = google_service_networking_connection.private_vpc_connection.id
}
