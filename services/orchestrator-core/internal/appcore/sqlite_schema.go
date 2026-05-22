package appcore

import _ "embed"

//go:embed sqlite_schema.sql
var embeddedSQLiteSchema string
