variable "aws_region" { type = string }
variable "service_name" {
  type    = string
  default = "sevaro-command-center"
}
variable "cluster" { type = string }
variable "execution_role_arn" { type = string }
variable "infrastructure_role_arn" { type = string }
variable "task_role_arn" { type = string }
variable "backend_image" {
  type        = string
  description = "Existing ECR image tagged by Git commit, or immutable digest."
}
variable "approved_public_subnet_ids" {
  type = list(string)
  validation {
    condition     = length(var.approved_public_subnet_ids) >= 2
    error_message = "Supply at least two organizer-approved public subnets in the RDS VPC."
  }
}
variable "database_url_secret_arn" { type = string }
variable "cognito_user_pool_id" { type = string }
variable "cognito_app_client_id" { type = string }
variable "frontend_origin" { type = string }
variable "datasets_bucket" { type = string }
variable "log_group_name" { type = string }
variable "jev_mode" {
  type    = string
  default = "off"
  validation {
    condition     = contains(["off", "mock", "live"], var.jev_mode)
    error_message = "Jev mode must be off, mock, or live."
  }
}
variable "jev_model" {
  type    = string
  default = "jev-latest"
}
variable "typesafe_key_secret_arn" {
  type    = string
  default = ""
}
variable "workshop_permissions_verified" {
  type    = bool
  default = false
}
variable "migration_verified" {
  type    = bool
  default = false
}
