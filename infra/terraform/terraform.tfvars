aws_region            = "us-east-1"
project_name          = "millage-calculator"
environment           = "prod"
site_content_path     = "../../dist"

domain_names            = ["libraryrenewal.hpcan.org"]
acm_certificate_arn     = "arn:aws:acm:us-east-1:519404403314:certificate/4bbed6e8-e452-4a77-9e63-b88a84573077"
create_route53_records  = false
route53_zone_id         = null
