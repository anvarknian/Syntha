package security

import (
	"reflect"
	"testing"
)

func TestScrubString(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "no PII",
			input:    "Hello world!",
			expected: "Hello world!",
		},
		{
			name:     "long email",
			input:    "Contact me at user123@example.com today.",
			expected: "Contact me at XXXXX23@example.com today.",
		},
		{
			name:     "short email",
			input:    "Send to ab@example.com",
			expected: "Send to [REDACTED]@example.com",
		},
		{
			name:     "credit card 16 digits",
			input:    "My card is 1234 5678 1234 5678.",
			expected: "My card is [REDACTED_CCN].",
		},
		{
			name:     "credit card 13 digits",
			input:    "Card: 1234567890123",
			expected: "Card: [REDACTED_CCN]",
		},
		{
			name:     "mixed PII",
			input:    "User john.doe@example.com paid with 4111 1111 1111 1111",
			expected: "User XXXXXXoe@example.com paid with [REDACTED_CCN]",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ScrubString(tc.input)
			if got != tc.expected {
				t.Errorf("ScrubString(%q) = %q; want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestScrub(t *testing.T) {
	input := map[string]interface{}{
		"message": "Hello test@example.com",
		"details": map[string]interface{}{
			"cc": "1234 5678 1234 5678",
		},
		"tags": []interface{}{
			"tag1",
			"tag2@example.com",
		},
		"count": 42,
	}

	expected := map[string]interface{}{
		"message": "Hello XXst@example.com",
		"details": map[string]interface{}{
			"cc": "[REDACTED_CCN]",
		},
		"tags": []interface{}{
			"tag1",
			"XXg2@example.com",
		},
		"count": 42,
	}

	got := Scrub(input)

	if !reflect.DeepEqual(got, expected) {
		t.Errorf("Scrub() did not match expected output.\nGot:  %#v\nWant: %#v", got, expected)
	}
}

func TestScrubWithPolicyDenyKeys(t *testing.T) {
	input := map[string]interface{}{
		"email": "user@example.com",
		"body":  "secret message",
	}
	got := ScrubWithPolicy(input, ExportPolicy{
		AllowRawPII: false,
		DenyKeys:    []string{"body"},
	}).(map[string]interface{})

	if got["body"] != "[REDACTED]" {
		t.Fatalf("expected body redacted, got %v", got["body"])
	}
	if got["email"] == "user@example.com" {
		t.Fatalf("expected email to be scrubbed, got %v", got["email"])
	}
}

func TestScrubWithPolicyAllowRawPII(t *testing.T) {
	input := map[string]interface{}{
		"email": "user@example.com",
	}
	got := ScrubWithPolicy(input, ExportPolicy{
		AllowRawPII: true,
	}).(map[string]interface{})
	if got["email"] != "user@example.com" {
		t.Fatalf("expected raw email preserved, got %v", got["email"])
	}
}
