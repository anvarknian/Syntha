package security

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
)

var (
	emailRE = regexp.MustCompile(`([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+)`)
	ccRE    = regexp.MustCompile(`\b(?:\d[ -]*?){13,16}\b`)
)

type ExportPolicy struct {
	AllowRawPII bool
	DenyKeys    []string
}

var (
	defaultPolicyOnce sync.Once
	defaultPolicy     ExportPolicy
)

func DefaultExportPolicy() ExportPolicy {
	defaultPolicyOnce.Do(func() {
		defaultPolicy = ExportPolicy{
			AllowRawPII: envTrue("EXPORT_ALLOW_RAW_PII"),
			DenyKeys:    parseDenyKeys(os.Getenv("EXPORT_DENY_KEYS")),
		}
	})
	return defaultPolicy
}

func envTrue(key string) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	return v == "1" || v == "true" || v == "yes"
}

func parseDenyKeys(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		p := strings.TrimSpace(strings.ToLower(part))
		if p != "" {
			out = append(out, p)
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// ScrubString redacts emails and credit-card-like number sequences from a string.
func ScrubString(s string) string {
	// redact credit card numbers
	s = ccRE.ReplaceAllString(s, "[REDACTED_CCN]")
	// redact email local part
	s = emailRE.ReplaceAllStringFunc(s, func(m string) string {
		parts := emailRE.FindStringSubmatch(m)
		if len(parts) < 3 {
			return "[REDACTED_EMAIL]"
		}
		local := parts[1]
		domain := parts[2]
		if len(local) <= 2 {
			return "[REDACTED]@" + domain
		}
		return strings.Repeat("X", len(local)-2) + local[len(local)-2:] + "@" + domain
	})
	return s
}

// Scrub recursively walks payloads and scrubs strings.
func Scrub(v interface{}) interface{} {
	return ScrubWithPolicy(v, DefaultExportPolicy())
}

// ScrubWithPolicy recursively scrubs payloads using explicit export controls.
func ScrubWithPolicy(v interface{}, policy ExportPolicy) interface{} {
	switch x := v.(type) {
	case string:
		if policy.AllowRawPII {
			return x
		}
		return ScrubString(x)
	case map[string]interface{}:
		for k, val := range x {
			if denied(k, policy.DenyKeys) {
				x[k] = "[REDACTED]"
				continue
			}
			x[k] = ScrubWithPolicy(val, policy)
		}
		return x
	case []interface{}:
		for i, val := range x {
			x[i] = ScrubWithPolicy(val, policy)
		}
		return x
	default:
		return v
	}
}

func denied(key string, denyKeys []string) bool {
	if len(denyKeys) == 0 {
		return false
	}
	return slices.Contains(denyKeys, strings.ToLower(key))
}
