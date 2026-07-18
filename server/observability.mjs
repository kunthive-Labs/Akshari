export function createErrorReporter() {
  const webhook = process.env.ERROR_WEBHOOK_URL
  return async function report(error, request) {
    const event = {
      timestamp: new Date().toISOString(),
      requestId: request.id,
      method: request.method,
      route: request.routeOptions?.url,
      statusCode: error.statusCode ?? 500,
      message: error.message,
    }
    request.log.error(event, 'Unhandled application error')
    if (!webhook) return
    try {
      await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `Fontscape API error: ${event.message}`, event }), signal: AbortSignal.timeout(2500) })
    } catch (reportingError) {
      request.log.warn({ err: reportingError, requestId: request.id }, 'Error webhook delivery failed')
    }
  }
}
