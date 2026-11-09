package web

import "embed"

//go:embed index.html assets manifest.webmanifest sw.js
var Assets embed.FS
