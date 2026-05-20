package eventbus

import "time"

type Event struct {
	ID        string                 `json:"id"`
	Timestamp time.Time              `json:"timestamp"`
	Kind      string                 `json:"kind"`
	Seed      int64                  `json:"seed"`
	Payload   map[string]interface{} `json:"payload"`
	Metadata  map[string]string      `json:"metadata"`
}
