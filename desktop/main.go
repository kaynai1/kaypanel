//go:build windows

package main

import (
	"context"
	"errors"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"kaypanel/internal/app"
	"kaypanel/web"
)

var version = "dev"

func init() {
	user32 := windows.NewLazySystemDLL("user32.dll")
	if err := user32.NewProc("SetProcessDpiAwarenessContext").Find(); err == nil {
		_, _, _ = user32.NewProc("SetProcessDpiAwarenessContext").Call(^uintptr(3))
	} else {
		_, _, _ = user32.NewProc("SetProcessDPIAware").Call()
	}
}

func main() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		messageBox("KayPanel 启动失败", "无法定位用户配置目录: "+err.Error())
		return
	}
	dataDir := filepath.Join(configDir, "KayPanel")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		messageBox("KayPanel 启动失败", "无法创建数据目录: "+err.Error())
		return
	}
	if f, err := os.OpenFile(filepath.Join(dataDir, "desktop.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil {
		log.SetOutput(f)
		defer f.Close()
	}

	release, ok := singleInstance()
	if !ok {
		messageBox("KayPanel 已在运行", "KayPanel 已经打开，请在任务栏中切换窗口。")
		return
	}
	defer release()

	inst, err := app.Start(app.Options{
		ConfigPath: filepath.Join(dataDir, "config.yaml"),
		Listen:     "127.0.0.1:0",
		Version:    version,
		Web:        web.Assets,
		Desktop:    true,
	})
	if err != nil {
		messageBox("KayPanel 启动失败", err.Error())
		return
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		inst.Shutdown(ctx)
	}()

	authURL := inst.URL + "/api/desktop/login?token=" + url.QueryEscape(inst.DesktopToken)
	cacheDir, _ := os.UserCacheDir()
	dataPath := filepath.Join(cacheDir, "KayPanel", "WebView2")

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  "KayPanel " + version + " · 服务器管理",
			Width:  1280,
			Height: 840,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		if err := runEdgeFallback(authURL); err != nil {
			messageBox("无法打开界面", "未检测到 WebView2 运行时，且未能启动 Microsoft Edge。\n\n请安装 Microsoft Edge WebView2 运行时后重试。\n\n"+err.Error())
		}
		return
	}
	defer w.Destroy()
	w.Navigate(authURL)
	w.Run()
}

func singleInstance() (func(), bool) {
	name, err := windows.UTF16PtrFromString(`Local\KayPanelDesktop`)
	if err != nil {
		return func() {}, true
	}
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("CreateMutexW")
	h, _, callErr := proc.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return func() {}, true
	}
	if errno, ok := callErr.(syscall.Errno); ok && errno == windows.ERROR_ALREADY_EXISTS {
		_ = windows.CloseHandle(windows.Handle(h))
		return nil, false
	}
	return func() { _ = windows.CloseHandle(windows.Handle(h)) }, true
}

func runEdgeFallback(u string) error {
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
	}
	edge := ""
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			edge = p
			break
		}
	}
	if edge == "" {
		return errors.New("未找到 Microsoft Edge")
	}
	cacheDir, _ := os.UserCacheDir()
	profile := filepath.Join(cacheDir, "KayPanel", "EdgeProfile")
	_ = os.MkdirAll(profile, 0o700)
	cmd := exec.Command(edge,
		"--app="+u,
		"--user-data-dir="+profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--window-size=1280,840",
	)
	return cmd.Run()
}

func messageBox(title, text string) {
	user32 := windows.NewLazySystemDLL("user32.dll")
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString(title)
	_, _, _ = user32.NewProc("MessageBoxW").Call(0,
		uintptr(unsafe.Pointer(t)),
		uintptr(unsafe.Pointer(c)),
		0x10,
	)
}
