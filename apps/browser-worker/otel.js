let sdk = null

function maybeStartOtel() {
  let NodeSDK
  let getNodeAutoInstrumentations
  try {
    ;({ NodeSDK } = require('@opentelemetry/sdk-node'))
    ;({ getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node'))
  } catch (err) {
    console.warn('OTel SDK packages missing; running without instrumentation')
    return
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318/v1/traces'
  const sdkOptions = {
    instrumentations: [getNodeAutoInstrumentations()],
  }

  try {
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http')
    sdkOptions.traceExporter = new OTLPTraceExporter({ url: endpoint })
  } catch (err) {
    console.warn('OTLP trace exporter missing; running without trace export')
  }

  sdk = new NodeSDK(sdkOptions)
  const startResult = sdk.start()
  if (startResult && typeof startResult.then === 'function') {
    startResult.then(() => {
      console.log('OTel Node SDK started')
    }).catch(err => {
      console.error('Failed to start OTel SDK', err)
    })
  } else {
    console.log('OTel Node SDK started')
  }
}

async function shutdownOtel() {
  if (!sdk) return
  try {
    await sdk.shutdown()
  } catch (err) {
    console.error('Error shutting down OTel SDK', err)
  }
}

maybeStartOtel()
process.on('SIGINT', () => shutdownOtel().finally(() => process.exit(130)))
process.on('SIGTERM', () => shutdownOtel().finally(() => process.exit(143)))
