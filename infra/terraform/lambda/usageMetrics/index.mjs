import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const tableName = process.env.TABLE_NAME

const jsonHeaders = {
  'content-type': 'application/json',
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }
}

function buildMetricKey() {
  const today = new Date().toISOString().slice(0, 10)
  return `estimate_calculated#${today}`
}

export async function handler(event) {
  if (!tableName) {
    return response(500, { error: 'Server misconfiguration.' })
  }

  const method = event.requestContext?.http?.method

  if (method === 'GET') {
    const todayItem = await ddbClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { metric_key: buildMetricKey() },
      }),
    )

    const allRows = await ddbClient.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: 'total_count',
      }),
    )

    const allTimeCount = (allRows.Items ?? []).reduce((total, row) => {
      return total + Number(row.total_count ?? 0)
    }, 0)

    const todayCount = Number(todayItem.Item?.total_count ?? 0)
    return response(200, { todayCount, allTimeCount })
  }

  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed.' })
  }

  let payload
  try {
    payload = event.body ? JSON.parse(event.body) : {}
  } catch {
    return response(400, { error: 'Invalid JSON payload.' })
  }

  if (payload.event !== 'estimate_calculated') {
    return response(400, { error: 'Unsupported event.' })
  }

  const hasMatchedAddress = Boolean(payload.hasMatchedAddress)
  const hasParcelId = Boolean(payload.hasParcelId)
  const nowIso = new Date().toISOString()

  await ddbClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { metric_key: buildMetricKey() },
      UpdateExpression:
        'SET updated_at = :updatedAt ADD total_count :one, matched_address_count :matched, parcel_id_count :parcel',
      ExpressionAttributeValues: {
        ':updatedAt': nowIso,
        ':one': 1,
        ':matched': hasMatchedAddress ? 1 : 0,
        ':parcel': hasParcelId ? 1 : 0,
      },
    }),
  )

  return response(202, { ok: true })
}
