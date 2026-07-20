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

# NOTE: there is deliberately no google_vpc_access_connector here.
#
# Cloud Run reaches this VPC through Direct VPC egress (see modules/service), attaching
# straight to the subnet above. The older Serverless VPC Access connector would put a
# managed instance group of proxy VMs in the path, which costs roughly $20/month per
# environment, adds a hop, and forces the subnet to be exactly /28.
#
# It also failed repeatedly here: a connector that errors during creation leaves its VMs
# holding the subnet, so the subnet can no longer be modified or destroyed until the
# half-built connector is manually deleted. Direct egress has no such appliance to strand.

# Reserved range that Google's service producers (Cloud SQL, Memorystore) peer into.
# The address is pinned (see variable docs) so it can never overlap the subnet above.
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
# Downstream modules depend on this so Cloud SQL / Redis are never created before the
# peering exists — without it the first apply fails with an unhelpful IP allocation error.
output "private_vpc_connection" {
  value = google_service_networking_connection.private_vpc_connection.id
}
