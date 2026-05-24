package store

import (
	"regexp"
	"strings"
)

var sensitiveTextPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b(bearer)\s+[a-z0-9._~+/=-]{8,}`),
	regexp.MustCompile(`(?i)\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*['"]?[^'",\s;}{]+`),
	regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{8,}\b`),
	regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9_]{8,}\b`),
	regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9-]{8,}\b`),
}

func RedactSensitiveText(value string) string {
	if value == "" {
		return value
	}
	redacted := value
	for _, pattern := range sensitiveTextPatterns {
		redacted = pattern.ReplaceAllStringFunc(redacted, func(match string) string {
			lower := strings.ToLower(match)
			switch {
			case strings.HasPrefix(lower, "bearer "):
				return "Bearer [REDACTED]"
			case strings.Contains(match, "="):
				return match[:strings.Index(match, "=")+1] + "[REDACTED]"
			case strings.Contains(match, ":"):
				return match[:strings.Index(match, ":")+1] + "[REDACTED]"
			default:
				return "[REDACTED]"
			}
		})
	}
	return redacted
}

func SanitizeForTrace(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		return RedactSensitiveText(typed)
	case []string:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			items = append(items, RedactSensitiveText(item))
		}
		return items
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, SanitizeForTrace(item))
		}
		return items
	case map[string]string:
		result := map[string]string{}
		for key, item := range typed {
			if SensitiveKey(key) {
				result[key] = "[REDACTED]"
				continue
			}
			result[key] = RedactSensitiveText(item)
		}
		return result
	case map[string]any:
		result := map[string]any{}
		for key, item := range typed {
			if SensitiveKey(key) {
				result[key] = "[REDACTED]"
				continue
			}
			result[key] = SanitizeForTrace(item)
		}
		return result
	default:
		return typed
	}
}

func SensitiveKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	for _, marker := range []string{"api_key", "apikey", "authorization", "bearer", "token", "secret", "password", "node_secret", "worker_token", "telegram_bot_token", "model_api_key", "private_key"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}
