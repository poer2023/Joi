package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	macoptions "github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewDesktopApp()
	err := wails.Run(&options.App{
		Title:            "Joi",
		Width:            1280,
		Height:           860,
		BackgroundColour: options.NewRGB(251, 251, 249),
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		Mac: &macoptions.Options{
			TitleBar: macoptions.TitleBarHiddenInset(),
		},
		OnStartup:  app.Startup,
		OnShutdown: app.Shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
