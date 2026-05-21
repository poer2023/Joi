package api

import (
	"encoding/json"
	"net/http"
)

type Response struct {
	OK      bool         `json:"ok"`
	Data    any          `json:"data"`
	Error   *ErrorObject `json:"error"`
	TraceID string       `json:"trace_id"`
}

type ErrorObject struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details"`
}

func writeOK(w http.ResponseWriter, status int, data any, traceID string) {
	writeJSON(w, status, Response{
		OK:      true,
		Data:    data,
		Error:   nil,
		TraceID: traceID,
	})
}

func writeError(w http.ResponseWriter, status int, code string, message string, details any, traceID string) {
	writeJSON(w, status, Response{
		OK:   false,
		Data: nil,
		Error: &ErrorObject{
			Code:    code,
			Message: message,
			Details: details,
		},
		TraceID: traceID,
	})
}

func writeJSON(w http.ResponseWriter, status int, response Response) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}
