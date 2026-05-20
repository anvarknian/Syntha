package eventbus

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalAdapterWritesFile(t *testing.T) {
	dir := filepath.Join(os.TempDir(), "syntha-tests-events")
	_ = os.RemoveAll(dir)
	a := NewLocalAdapter(dir)
	ev := Event{Kind: "test", Payload: map[string]interface{}{"hello": "world"}}
	if err := a.Publish(context.Background(), ev); err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	if len(files) == 0 {
		t.Fatalf("no files written to %s", dir)
	}
}
