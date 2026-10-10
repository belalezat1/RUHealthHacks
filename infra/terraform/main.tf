# Conditional integration with organizer-provided resources. No VPC, IAM, RDS, or
# identity resources are fabricated before workshop discovery is complete.
resource "aws_ecs_express_gateway_service" "api" {
  service_name            = var.service_name
  cluster                 = var.cluster
  execution_role_arn      = var.execution_role_arn
  infrastructure_role_arn = var.infrastructure_role_arn
  task_role_arn           = var.task_role_arn
  cpu                     = "512"
  memory                  = "1024"
  health_check_path       = "/ready"
  wait_for_steady_state   = true

  primary_container {
    image          = var.backend_image
    container_port = 8000
    dynamic "environment" {
      for_each = {
        APP_ENV               = "production"
        AUTH_MODE             = "cognito"
        AWS_REGION            = var.aws_region
        COGNITO_USER_POOL_ID  = var.cognito_user_pool_id
        COGNITO_APP_CLIENT_ID = var.cognito_app_client_id
        CORS_ORIGINS          = jsonencode([var.frontend_origin])
        JEV_MODE              = var.jev_mode
        JEV_MODEL             = var.jev_model
        DEMO_POLICY_PATH      = "/app/config/demo_policies.json"
        DATASETS_BUCKET       = var.datasets_bucket
      }
      content {
        name  = environment.key
        value = environment.value
      }
    }
    secret {
      name       = "DATABASE_URL"
      value_from = var.database_url_secret_arn
    }
    dynamic "secret" {
      for_each = var.jev_mode == "live" ? [var.typesafe_key_secret_arn] : []
      content {
        name       = "TYPESAFE_API_KEY"
        value_from = secret.value
      }
    }
    aws_logs_configuration {
      log_group         = var.log_group_name
      log_stream_prefix = "api"
    }
  }
  network_configuration {
    subnets = var.approved_public_subnet_ids
  }
  scaling_target {
    min_task_count            = 1
    max_task_count            = 2
    auto_scaling_metric       = "AVERAGE_CPU"
    auto_scaling_target_value = 70
  }
  lifecycle {
    precondition {
      condition     = var.workshop_permissions_verified && var.migration_verified
      error_message = "Verify workshop permissions and successfully run the release migration task before applying."
    }
    precondition {
      condition     = startswith(var.frontend_origin, "https://")
      error_message = "Hosted frontend must use authenticated HTTPS."
    }
    precondition {
      condition     = var.jev_mode != "live" || var.typesafe_key_secret_arn != ""
      error_message = "Live mode requires a confirmed sponsor/project key in Secrets Manager."
    }
  }
}

output "service_arn" {
  value = aws_ecs_express_gateway_service.api.service_arn
}

output "ingress_paths" {
  value = aws_ecs_express_gateway_service.api.ingress_paths
}
