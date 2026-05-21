let sdk = null

function maybeStartOtel() {
  let NodeSDK
  let getNodeAutoInstrumentations
  try {
    ;({ NodeSDK } = require('@opentelemetry/sdk-node'))
    ;({ getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node'))
  } catch (err) {
    console.warn('OTel SDK packages missing; fake-jira running without instrumentation')
    return
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318/v1/traces'
  const options = {
    instrumentations: [getNodeAutoInstrumentations()],
  }

  try {
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
    options.traceExporter = new OTLPTraceExporter({ url: endpoint })
  } catch (err) {
    console.warn('OTLP trace exporter missing; fake-jira running without trace export')
  }

  sdk = new NodeSDK(options)
  const startResult = sdk.start()
  if (startResult && typeof startResult.then === 'function') {
    startResult.then(() => {
      console.log('OTel Node SDK started (fake-jira)')
    }).catch(err => {
      console.error('Failed to start fake-jira OTel SDK', err)
    })
  } else {
    console.log('OTel Node SDK started (fake-jira)')
  }
}

async function shutdownOtel() {
  if (!sdk) return
  try {
    await sdk.shutdown()
  } catch (err) {
    console.error('Error shutting down fake-jira OTel SDK', err)
  }
}

maybeStartOtel()
process.on('SIGINT', () => shutdownOtel().finally(() => process.exit(130)))
process.on('SIGTERM', () => shutdownOtel().finally(() => process.exit(143)))
