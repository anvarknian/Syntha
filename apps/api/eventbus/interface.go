package eventbus

import "context"

type Publisher interface {
	Publish(ctx context.Context, e Event) error
}

// Metrics hooks (optional) — consumers (e.g., main) may set these to record metrics
var (
	incRetryMetric    func(adapter string)
	incEventPublished func()
)

// SetMetricsHooks allows external packages to provide metric increment functions.
func SetMetricsHooks(retryFn func(adapter string), publishedFn func()) {
	incRetryMetric = retryFn
	incEventPublished = publishedFn
}
