data "archive_file" "usage_metrics_lambda" {
  count       = var.enable_usage_metrics ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/lambda/usageMetrics/index.mjs"
  output_path = "${path.module}/.terraform/usage-metrics-lambda.zip"
}

resource "aws_dynamodb_table" "usage_metrics" {
  count        = var.enable_usage_metrics ? 1 : 0
  name         = "${local.name_prefix}-usage-metrics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "metric_key"

  attribute {
    name = "metric_key"
    type = "S"
  }

  tags = local.default_tags
}

resource "aws_iam_role" "usage_metrics_lambda" {
  count = var.enable_usage_metrics ? 1 : 0
  name  = "${local.name_prefix}-usage-metrics-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.default_tags
}

resource "aws_iam_role_policy" "usage_metrics_lambda" {
  count = var.enable_usage_metrics ? 1 : 0
  name  = "${local.name_prefix}-usage-metrics-lambda-policy"
  role  = aws_iam_role.usage_metrics_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem"
        ]
        Resource = aws_dynamodb_table.usage_metrics[0].arn
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "usage_metrics_lambda" {
  count             = var.enable_usage_metrics ? 1 : 0
  name              = "/aws/lambda/${local.name_prefix}-usage-metrics"
  retention_in_days = var.usage_metrics_log_retention_days

  tags = local.default_tags
}

resource "aws_lambda_function" "usage_metrics" {
  count            = var.enable_usage_metrics ? 1 : 0
  function_name    = "${local.name_prefix}-usage-metrics"
  role             = aws_iam_role.usage_metrics_lambda[0].arn
  filename         = data.archive_file.usage_metrics_lambda[0].output_path
  source_code_hash = data.archive_file.usage_metrics_lambda[0].output_base64sha256
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  timeout          = 6

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.usage_metrics[0].name
    }
  }

  depends_on = [
    aws_iam_role_policy.usage_metrics_lambda,
    aws_cloudwatch_log_group.usage_metrics_lambda,
  ]

  tags = local.default_tags
}

resource "aws_apigatewayv2_api" "usage_metrics" {
  count         = var.enable_usage_metrics ? 1 : 0
  name          = "${local.name_prefix}-usage-metrics"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["content-type"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = var.usage_metrics_allowed_origins
    max_age       = 300
  }

  tags = local.default_tags
}

resource "aws_apigatewayv2_integration" "usage_metrics" {
  count = var.enable_usage_metrics ? 1 : 0

  api_id                 = aws_apigatewayv2_api.usage_metrics[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.usage_metrics[0].invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "usage_metrics_events" {
  count = var.enable_usage_metrics ? 1 : 0

  api_id    = aws_apigatewayv2_api.usage_metrics[0].id
  route_key = "POST /events"
  target    = "integrations/${aws_apigatewayv2_integration.usage_metrics[0].id}"
}

resource "aws_apigatewayv2_route" "usage_metrics_events_read" {
  count = var.enable_usage_metrics ? 1 : 0

  api_id    = aws_apigatewayv2_api.usage_metrics[0].id
  route_key = "GET /events"
  target    = "integrations/${aws_apigatewayv2_integration.usage_metrics[0].id}"
}

resource "aws_apigatewayv2_stage" "usage_metrics" {
  count = var.enable_usage_metrics ? 1 : 0

  api_id      = aws_apigatewayv2_api.usage_metrics[0].id
  name        = "$default"
  auto_deploy = true

  tags = local.default_tags
}

resource "aws_lambda_permission" "usage_metrics_api" {
  count = var.enable_usage_metrics ? 1 : 0

  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.usage_metrics[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.usage_metrics[0].execution_arn}/*/*"
}
