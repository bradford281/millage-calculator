variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short project name used in resource names."
  type        = string
  default     = "millage-calculator"
}

variable "environment" {
  description = "Environment label used in naming and tagging."
  type        = string
  default     = "prod"
}

variable "site_content_path" {
  description = "Path to the built frontend assets directory (Vite dist output)."
  type        = string
  default     = "../../dist"
}

variable "domain_names" {
  description = "Optional custom domains for CloudFront (for example: [\"calc.example.com\"])."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "Optional ACM certificate ARN in us-east-1 for custom domains. Leave null to use CloudFront default domain/cert."
  type        = string
  default     = null
}

variable "create_route53_records" {
  description = "Whether Terraform should create Route53 alias records for domain_names."
  type        = bool
  default     = false
}

variable "route53_zone_id" {
  description = "Hosted zone ID for Route53 records when create_route53_records is true."
  type        = string
  default     = null
}

variable "tags" {
  description = "Additional tags to apply to resources."
  type        = map(string)
  default     = {}
}

variable "force_destroy_bucket" {
  description = "Whether to allow bucket deletion even when it contains objects."
  type        = bool
  default     = false
}
