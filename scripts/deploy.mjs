import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const thisFile = fileURLToPath(import.meta.url)
const scriptsDir = path.dirname(thisFile)
const projectRoot = path.resolve(scriptsDir, '..')
const terraformDir = path.join(projectRoot, 'infra', 'terraform')
const shouldWaitForInvalidation = process.argv.includes('--wait-invalidation')

function runCommand(command, args, options = {}) {
  const display = [command, ...args].join(' ')
  console.log(`\n> ${display}`)

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? projectRoot,
    shell: options.shell ?? false,
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function captureCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: options.cwd ?? projectRoot,
    shell: options.shell ?? false,
    encoding: 'utf8',
  })

  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.stderr.write(result.stderr || '')
    process.exit(result.status ?? 1)
  }

  return (result.stdout || '').trim()
}

function parseJsonOutput(label, raw) {
  try {
    return JSON.parse(raw)
  } catch {
    console.error(`Could not parse JSON output for ${label}.`)
    process.exit(1)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForInvalidation(distributionId, invalidationId) {
  const timeoutAt = Date.now() + 15 * 60 * 1000

  while (Date.now() < timeoutAt) {
    const raw = captureCommand(
      'aws',
      [
        'cloudfront',
        'get-invalidation',
        '--distribution-id',
        distributionId,
        '--id',
        invalidationId,
        '--output',
        'json',
      ],
    )

    const payload = parseJsonOutput('aws cloudfront get-invalidation', raw)
    const status = payload?.Invalidation?.Status

    console.log(`Invalidation status: ${status ?? 'Unknown'}`)

    if (status === 'Completed') {
      return
    }

    await delay(5000)
  }

  console.error('Timed out waiting for CloudFront invalidation to complete.')
  process.exit(1)
}

async function main() {
  runCommand('npm', ['run', 'build'], { shell: process.platform === 'win32' })
  runCommand('terraform', ['apply', '-auto-approve', '-no-color'], { cwd: terraformDir })

  const distributionId = captureCommand('terraform', ['output', '-raw', 'cloudfront_distribution_id'], {
    cwd: terraformDir,
  })

  if (!distributionId) {
    console.error('Could not read cloudfront_distribution_id from Terraform outputs.')
    process.exit(1)
  }

  const invalidationRaw = captureCommand('aws', [
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    distributionId,
    '--paths',
    '/*',
    '--output',
    'json',
  ])

  const invalidationPayload = parseJsonOutput('aws cloudfront create-invalidation', invalidationRaw)
  const invalidationId = invalidationPayload?.Invalidation?.Id

  if (!invalidationId || typeof invalidationId !== 'string') {
    console.error('Could not read CloudFront invalidation ID.')
    process.exit(1)
  }

  console.log(`Created invalidation: ${invalidationId}`)

  if (shouldWaitForInvalidation) {
    console.log('Waiting for CloudFront invalidation to complete...')
    await waitForInvalidation(distributionId, invalidationId)
  }

  const siteUrl = captureCommand('terraform', ['output', '-raw', 'site_url'], { cwd: terraformDir })

  console.log('\nDeploy complete.')
  if (siteUrl) {
    console.log(`Live URL: ${siteUrl}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
