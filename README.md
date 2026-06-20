# Hazel Park Library Millage Calculator

Simple React + TypeScript app for showing what a proposed library millage means for a resident using taxable value.

## What it does

- Lets users enter a property address and request parcel lookup.
- Pulls taxable value from a configured parcel API endpoint.
- Shows current vs proposed tax and the difference by year and month.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in project root with the Oakland County, Michigan parcel endpoint:

```bash
VITE_OAKLAND_PARCEL_API_URL=https://gisservices.oakgov.com/arcgis/rest/services/Enterprise/EnterpriseOpenParcelDataMapService/MapServer/1
```

The app queries this ArcGIS layer by `SITEADDRESS` and reads `TAXABLEVALUE` (fallback `ASSESSEDVALUE`).

3. Start development server:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Deploy To AWS With Terraform

This repo includes Terraform in [infra/terraform/main.tf](infra/terraform/main.tf) to host the site with:

- S3 (private bucket)
- CloudFront (public CDN)
- Origin Access Control (CloudFront -> S3)
- Optional Route53 alias records for custom domains

### 1. Build the app

```bash
npm run build
```

### 2. Configure Terraform variables

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

If you want a custom domain, set `domain_names`, `acm_certificate_arn` (in us-east-1), and optionally Route53 settings.

### 3. Deploy

```bash
terraform init
terraform plan
terraform apply
```

Or run the full build + apply + CloudFront invalidation flow from project root:

```bash
npm run deploy
```

To wait until CloudFront invalidation is fully completed before exit:

```bash
npm run deploy:wait
```

### 4. Get the URL

Terraform outputs include:

- `site_url`
- `cloudfront_domain_name`

### Notes

- AWS credentials must be configured in your shell before running Terraform.
- The default `site_content_path` is `../../dist` (Vite build output).
- When you rebuild the app, rerun `terraform apply` to upload changed assets.
- `npm run deploy` automatically builds, applies Terraform, and invalidates CloudFront.
- `npm run deploy:wait` does the same and waits for invalidation status `Completed`.
