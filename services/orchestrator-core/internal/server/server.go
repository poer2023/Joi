package server

import (
	"log/slog"
	"net/http"

	"github.com/hao/agent-os/services/orchestrator-core/internal/api"
	"github.com/hao/agent-os/services/orchestrator-core/internal/appcore"
)

func NewHTTPServer(core *appcore.AppCore, logger *slog.Logger, addr string) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           api.NewRouter(core, logger),
		ReadHeaderTimeout: defaultReadHeaderTimeout,
	}
}
