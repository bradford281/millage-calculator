output "bucket_name" {
  description = "S3 bucket name hosting static assets."
  value       = aws_s3_bucket.site.bucket
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID."
  value       = aws_cloudfront_distribution.site.id
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name for the deployed site."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "site_url" {
  description = "Primary URL for the deployed site."
  value = length(var.domain_names) > 0 ? "https://${var.domain_names[0]}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "usage_metrics_endpoint" {
  description = "Anonymous usage metrics API endpoint (POST estimate events)."
  value       = var.enable_usage_metrics ? "${aws_apigatewayv2_api.usage_metrics[0].api_endpoint}/events" : null
}

output "usage_metrics_table_name" {
  description = "DynamoDB table name storing anonymous usage counts."
  value       = var.enable_usage_metrics ? aws_dynamodb_table.usage_metrics[0].name : null
}
