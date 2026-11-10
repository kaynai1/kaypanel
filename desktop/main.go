//go:build windows

package main

import (
	"context"
	"errors"
	"log"
	"math"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"kaypanel/internal/app"
	"kaypanel/web"
)

var version = "dev"

var (
	user32dll                    = windows.NewLazySystemDLL("user32.dll")
	kernel32dll                  = windows.NewLazySystemDLL("kernel32.dll")
	shell32dll                   = windows.NewLazySystemDLL("shell32.dll")
	gdi32dll                     = windows.NewLazySystemDLL("gdi32.dll")
	procGetWindowLongPtr         = user32dll.NewProc("GetWindowLongPtrW")
	procSetWindowLongPtr         = user32dll.NewProc("SetWindowLongPtrW")
	procSetWindowPos             = user32dll.NewProc("SetWindowPos")
	procShowWindow               = user32dll.NewProc("ShowWindow")
	procIsZoomed                 = user32dll.NewProc("IsZoomed")
	procIsIconic                 = user32dll.NewProc("IsIconic")
	procReleaseCapture           = user32dll.NewProc("ReleaseCapture")
	procGetCursorPos             = user32dll.NewProc("GetCursorPos")
	procSendMessage              = user32dll.NewProc("SendMessageW")
	procPostMessage              = user32dll.NewProc("PostMessageW")
	procCallWindowProc           = user32dll.NewProc("CallWindowProcW")
	procDefWindowProc            = user32dll.NewProc("DefWindowProcW")
	procMonitorFromWindow        = user32dll.NewProc("MonitorFromWindow")
	procGetMonitorInfo           = user32dll.NewProc("GetMonitorInfoW")
	procGetDpiForWindow          = user32dll.NewProc("GetDpiForWindow")
	procAdjustWindowRectExForDpi = user32dll.NewProc("AdjustWindowRectExForDpi")
	procGetWindowRect            = user32dll.NewProc("GetWindowRect")
	procSetForegroundWindow      = user32dll.NewProc("SetForegroundWindow")
	procLoadImageW               = user32dll.NewProc("LoadImageW")
	procGetSystemMetrics         = user32dll.NewProc("GetSystemMetrics")
	procCreatePopupMenu          = user32dll.NewProc("CreatePopupMenu")
	procAppendMenuW              = user32dll.NewProc("AppendMenuW")
	procTrackPopupMenu           = user32dll.NewProc("TrackPopupMenu")
	procSetMenuDefaultItem       = user32dll.NewProc("SetMenuDefaultItem")
	procDestroyMenu              = user32dll.NewProc("DestroyMenu")
	procShellNotifyIcon          = shell32dll.NewProc("Shell_NotifyIconW")
	procCreateIconIndirect       = user32dll.NewProc("CreateIconIndirect")
	procDestroyIcon              = user32dll.NewProc("DestroyIcon")
	procCreateCompatibleDC       = gdi32dll.NewProc("CreateCompatibleDC")
	procCreateDIBSection         = gdi32dll.NewProc("CreateDIBSection")
	procCreateBitmap             = gdi32dll.NewProc("CreateBitmap")
	procDeleteObject             = gdi32dll.NewProc("DeleteObject")
	procDeleteDC                 = gdi32dll.NewProc("DeleteDC")
	procGetModuleHandle          = kernel32dll.NewProc("GetModuleHandleW")
	procCreateEventW             = kernel32dll.NewProc("CreateEventW")
	procOpenEventW               = kernel32dll.NewProc("OpenEventW")
	procSetEvent                 = kernel32dll.NewProc("SetEvent")
	procCloseHandle              = kernel32dll.NewProc("CloseHandle")
	procWaitForSingleObject      = kernel32dll.NewProc("WaitForSingleObject")
)

const (
	gwlStyle        = -16
	gwlExStyle      = -20
	gwlWndProc      = -4
	wsCaption       = 0x00C00000
	wsThickFrame    = 0x00040000
	wsExToolWindow  = 0x00000080
	wsExAppWindow   = 0x00040000
	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoZOrder     = 0x0004
	swpNoActivate   = 0x0010
	swpFrameChanged = 0x0020
	swpShowWindow   = 0x0040
	swMinimize      = 6
	swMaximize      = 3
	swRestore       = 9
	wmClose         = 0x0010
	wmSize          = 0x0005
	wmNCLButtonDown = 0x00A1
	wmGetMinMaxInfo = 0x0024
	wmNull          = 0x0000
	htCaption       = 2
	monitorNearest  = 2
	swHide          = 0
	swShow          = 5

	trayMsg       = 0x8000 + 1
	showWindowMsg = 0x8000 + 2
	wmLButtonUp   = 0x0202
	wmLButtonDbl  = 0x0203
	wmRButtonUp   = 0x0205

	trayIconID  = 1
	menuShow    = 1
	menuExit    = 2
	menuWidget  = 3
	nimAdd      = 0x00000000
	nimModify   = 0x00000001
	nimDelete   = 0x00000002
	nifMessage  = 0x00000001
	nifIcon     = 0x00000002
	nifTip      = 0x00000004
	nifInfo     = 0x00000010
	niiInfo     = 0x00000001
	imageIcon   = 1
	lrShared    = 0x00008000
	smCxSmIcon  = 49
	smCySmIcon  = 50
	tpmRightBtn = 0x0002
	tpmReturn   = 0x0100
	mfString    = 0x00000000
	mfSeparator = 0x00000800
)

type point struct {
	X, Y int32
}

type winRect struct {
	Left, Top, Right, Bottom int32
}

var (
	hwndTopmost    = ^uintptr(0)
	hwndNotTopmost = ^uintptr(1)
)

type minMaxInfo struct {
	PtReserved     point
	PtMaxSize      point
	PtMaxPosition  point
	PtMinTrackSize point
	PtMaxTrackSize point
}

type monitorInfo struct {
	CbSize    uint32
	RcMonitor winRect
	RcWork    winRect
	DwFlags   uint32
}

type notifyIconData struct {
	CbSize           uint32
	HWnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         windows.GUID
	HBalloonIcon     uintptr
}

type bitmapInfoHeader struct {
	BiSize          uint32
	BiWidth         int32
	BiHeight        int32
	BiPlanes        uint16
	BiBitCount      uint16
	BiCompression   uint32
	BiSizeImage     uint32
	BiXPelsPerMeter int32
	BiYPelsPerMeter int32
	BiClrUsed       uint32
	BiClrImportant  uint32
}

type iconInfo struct {
	FIcon    int32
	XHotspot uint32
	YHotspot uint32
	HbmMask  uintptr
	HbmColor uintptr
}

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
		if !signalExisting() {
			messageBox("KayPanel 已在运行", "KayPanel 已经打开，请在任务栏中切换窗口。")
		}
		return
	}
	defer release()
	createShowEvent()
	if showEvent != 0 {
		defer procCloseHandle.Call(showEvent)
	}

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
	appURL = inst.URL

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
	mainWeb = w
	makeFrameless(w)
	subclassWindow(w)
	bindWindow(w)
	hwnd := uintptr(w.Window())
	addTray(hwnd)
	defer removeTray()
	watchShowEvent(hwnd)
	w.Navigate(authURL)
	w.Run()
}

func ptrIndex(i int) uintptr {
	return uintptr(i)
}

func makeFrameless(w webview2.WebView) {
	hwnd := uintptr(w.Window())
	if hwnd == 0 {
		return
	}
	style, _, _ := procGetWindowLongPtr.Call(hwnd, ptrIndex(gwlStyle))
	style &^= wsCaption
	procSetWindowLongPtr.Call(hwnd, ptrIndex(gwlStyle), style)
	procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0,
		swpNoMove|swpNoSize|swpNoZOrder|swpNoActivate|swpFrameChanged)
	procSendMessage.Call(hwnd, wmSize, 0, 0)
}

var (
	prevWndProc  uintptr
	trayAdded    bool
	balloonShown bool
	trayNid      notifyIconData
	trayLevelIcon uintptr
	trayLevel     string
	trayTipText   string
	showEvent     uintptr

	mainWeb         webview2.WebView
	appURL          string
	widgetOn        bool
	widgetMax       bool
	widgetPrev      winRect
	widgetPrevStyle uintptr
)

// Maximizing a caption-less thick-frame window covers the taskbar, so clamp
// the maximized geometry to the monitor work area. The same subclass carries
// tray callbacks, close-to-tray and the single-instance wake-up message.
func subclassWindow(w webview2.WebView) {
	hwnd := uintptr(w.Window())
	if hwnd == 0 {
		return
	}
	cb := syscall.NewCallback(func(h, msg, wp, lp uintptr) uintptr {
		switch msg {
		case wmGetMinMaxInfo:
			clampMaximize(h, lp)
		case trayMsg:
			handleTray(h, lp)
			return 0
		case showWindowMsg:
			showMainFromTray(h)
			return 0
		}
		if prevWndProc == 0 {
			r, _, _ := procDefWindowProc.Call(h, msg, wp, lp)
			return r
		}
		r, _, _ := procCallWindowProc.Call(prevWndProc, h, msg, wp, lp)
		return r
	})
	prevWndProc, _, _ = procSetWindowLongPtr.Call(hwnd, ptrIndex(gwlWndProc), cb)
}

func addTray(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	hinst, _, _ := procGetModuleHandle.Call(0)
	cx, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := procGetSystemMetrics.Call(smCySmIcon)
	hIcon, _, _ := procLoadImageW.Call(hinst, trayIconID, imageIcon, cx, cy, lrShared)
	if hIcon == 0 {
		hIcon, _, _ = procLoadImageW.Call(0, 32512, imageIcon, cx, cy, lrShared)
	}
	trayNid = notifyIconData{
		CbSize:           uint32(unsafe.Sizeof(notifyIconData{})),
		HWnd:             hwnd,
		UID:              trayIconID,
		UFlags:           nifMessage | nifIcon | nifTip,
		UCallbackMessage: trayMsg,
		HIcon:            hIcon,
	}
	copy(trayNid.SzTip[:], windows.StringToUTF16("KayPanel "+version+" · 服务器管理"))
	ok, _, _ := procShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&trayNid)))
	trayAdded = ok != 0
}

func removeTray() {
	if trayLevelIcon != 0 {
		procDestroyIcon.Call(trayLevelIcon)
		trayLevelIcon = 0
	}
	if !trayAdded {
		return
	}
	procShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&trayNid)))
	trayAdded = false
}

func trayColor(level string) [3]byte {
	switch level {
	case "ok":
		return [3]byte{34, 197, 94}
	case "warn":
		return [3]byte{245, 158, 11}
	case "crit":
		return [3]byte{239, 68, 68}
	default:
		return [3]byte{148, 163, 184}
	}
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// makeDotIcon renders a small status LED: colored disc with a white rim so it
// stays legible on both light and dark taskbars. Pixels are premultiplied BGRA.
func makeDotIcon(level string) uintptr {
	cx, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := procGetSystemMetrics.Call(smCySmIcon)
	w, h := int(cx), int(cy)
	if w < 12 || w > 64 {
		w = 16
	}
	if h < 12 || h > 64 {
		h = w
	}
	hdc, _, _ := procCreateCompatibleDC.Call(0)
	if hdc == 0 {
		return 0
	}
	defer procDeleteDC.Call(hdc)

	bi := bitmapInfoHeader{
		BiSize:        uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		BiWidth:       int32(w),
		BiHeight:      int32(-h),
		BiPlanes:      1,
		BiBitCount:    32,
		BiCompression: 0,
	}
	var bits unsafe.Pointer
	hbm, _, _ := procCreateDIBSection.Call(hdc, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if hbm == 0 || bits == nil {
		return 0
	}
	defer procDeleteObject.Call(hbm)

	fill := trayColor(level)
	pix := unsafe.Slice((*byte)(bits), w*h*4)
	radius := math.Min(float64(w), float64(h))/2 - 1.2
	cx0 := float64(w) / 2
	cy0 := float64(h) / 2
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			dx := float64(x) + 0.5 - cx0
			dy := float64(y) + 0.5 - cy0
			d := math.Sqrt(dx*dx + dy*dy)
			disc := clamp01(radius - 1.1 - d + 0.5)
			ring := clamp01(radius-d+0.5) - disc
			i := (y*w + x) * 4
			pix[i] = byte(float64(fill[2])*disc + 255*ring)
			pix[i+1] = byte(float64(fill[1])*disc + 255*ring)
			pix[i+2] = byte(float64(fill[0])*disc + 255*ring)
			pix[i+3] = byte((disc + ring) * 255)
		}
	}

	stride := (w + 15) / 16 * 2
	mask := make([]byte, stride*h)
	hMask, _, _ := procCreateBitmap.Call(uintptr(w), uintptr(h), 1, 1, uintptr(unsafe.Pointer(&mask[0])))
	if hMask == 0 {
		return 0
	}
	defer procDeleteObject.Call(hMask)
	ii := iconInfo{FIcon: 1, HbmMask: hMask, HbmColor: hbm}
	hIcon, _, _ := procCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	return hIcon
}

func trayTipUTF16(s string) []uint16 {
	u := windows.StringToUTF16(s)
	if len(u) > 120 {
		u = u[:120]
		for len(u) > 0 && u[len(u)-1] >= 0xD800 && u[len(u)-1] <= 0xDBFF {
			u = u[:len(u)-1]
		}
	}
	return u
}

func setTrayLevel(level, tip string) {
	switch level {
	case "ok", "warn", "crit":
	default:
		level = "unknown"
	}
	tip = strings.TrimSpace(tip)
	if level == trayLevel && tip == trayTipText {
		return
	}
	trayLevel, trayTipText = level, tip
	if !trayAdded {
		return
	}
	icon := makeDotIcon(level)
	if icon == 0 {
		return
	}
	nid := trayNid
	nid.HIcon = icon
	nid.UFlags = nifIcon | nifTip
	nid.SzTip = [128]uint16{}
	copy(nid.SzTip[:], trayTipUTF16("KayPanel "+version+" · "+tip))
	if ok, _, _ := procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&nid))); ok != 0 {
		if trayLevelIcon != 0 {
			procDestroyIcon.Call(trayLevelIcon)
		}
		trayLevelIcon = icon
	} else {
		procDestroyIcon.Call(icon)
	}
}

func notifyHidden() {
	if balloonShown || !trayAdded {
		return
	}
	balloonShown = true
	nid := trayNid
	nid.UFlags = nifInfo
	nid.UVersion = 4000
	nid.DwInfoFlags = niiInfo
	copy(nid.SzInfoTitle[:], windows.StringToUTF16("KayPanel 仍在运行"))
	copy(nid.SzInfo[:], windows.StringToUTF16("窗口已收起到系统托盘，单击托盘图标可重新打开。"))
	procShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&nid)))
}

func handleTray(hwnd, lp uintptr) {
	switch uint32(lp) & 0xffff {
	case wmLButtonUp, wmLButtonDbl:
		showMainFromTray(hwnd)
	case wmRButtonUp:
		showTrayMenu(hwnd)
	}
}

func showMainFromTray(hwnd uintptr) {
	wasWidget := widgetOn
	showMain(hwnd)
	if wasWidget {
		navigateWidgetOut()
	}
}

func navigateWidgetOut() {
	if mainWeb != nil && appURL != "" {
		mainWeb.Navigate(appURL + "/#/overview")
	}
}

func showTrayMenu(hwnd uintptr) {
	menu, _, _ := procCreatePopupMenu.Call()
	if menu == 0 {
		return
	}
	openText, _ := windows.UTF16PtrFromString("打开 KayPanel")
	widgetText, _ := windows.UTF16PtrFromString("悬浮挂件")
	exitText, _ := windows.UTF16PtrFromString("退出")
	procAppendMenuW.Call(menu, mfString, menuShow, uintptr(unsafe.Pointer(openText)))
	procSetMenuDefaultItem.Call(menu, menuShow, 0)
	procAppendMenuW.Call(menu, mfString, menuWidget, uintptr(unsafe.Pointer(widgetText)))
	procAppendMenuW.Call(menu, mfSeparator, 0, 0)
	procAppendMenuW.Call(menu, mfString, menuExit, uintptr(unsafe.Pointer(exitText)))
	procSetForegroundWindow.Call(hwnd)
	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	cmd, _, _ := procTrackPopupMenu.Call(menu, tpmReturn|tpmRightBtn, uintptr(pt.X), uintptr(pt.Y), 0, hwnd, 0)
	procDestroyMenu.Call(menu)
	procPostMessage.Call(hwnd, wmNull, 0, 0)
	switch cmd {
	case menuShow:
		showMainFromTray(hwnd)
	case menuWidget:
		enterWidgetMode(hwnd)
		if mainWeb != nil && appURL != "" {
			mainWeb.Navigate(appURL + "/#/widget")
		}
	case menuExit:
		procPostMessage.Call(hwnd, wmClose, 0, 0)
	}
}

func showMain(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	if widgetOn {
		exitWidgetMode(hwnd)
	}
	if z, _, _ := procIsIconic.Call(hwnd); z != 0 {
		procShowWindow.Call(hwnd, swRestore)
	} else {
		procShowWindow.Call(hwnd, swShow)
	}
	procSetForegroundWindow.Call(hwnd)
}

func enterWidgetMode(hwnd uintptr) {
	if hwnd == 0 || widgetOn {
		return
	}
	widgetMax = false
	if z, _, _ := procIsZoomed.Call(hwnd); z != 0 {
		widgetMax = true
		procShowWindow.Call(hwnd, swRestore)
	}
	if z, _, _ := procIsIconic.Call(hwnd); z != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&widgetPrev)))
	// A thick frame keeps a ~7px non-client band that shows the window's white
	// class background around the dark widget; drop it so the page fills the
	// whole topmost window while the widget is active.
	style, _, _ := procGetWindowLongPtr.Call(hwnd, ptrIndex(gwlStyle))
	widgetPrevStyle = style
	procSetWindowLongPtr.Call(hwnd, ptrIndex(gwlStyle), style&^wsThickFrame)
	ex, _, _ := procGetWindowLongPtr.Call(hwnd, ptrIndex(gwlExStyle))
	ex |= wsExToolWindow
	ex &^= wsExAppWindow
	procSetWindowLongPtr.Call(hwnd, ptrIndex(gwlExStyle), ex)

	dpi, _, _ := procGetDpiForWindow.Call(hwnd)
	if dpi == 0 {
		dpi = 96
	}
	scale := float64(dpi) / 96
	wpx := int64(360 * scale)
	hpx := int64(548 * scale)
	margin := int64(24 * scale)
	var x, y int64 = 80, 80
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	hmon, _, _ := procMonitorFromWindow.Call(hwnd, monitorNearest)
	if hmon != 0 {
		if ok, _, _ := procGetMonitorInfo.Call(hmon, uintptr(unsafe.Pointer(&mi))); ok != 0 {
			x = int64(mi.RcWork.Right) - wpx - margin
			y = int64(mi.RcWork.Top) + margin
		}
	}
	procSetWindowPos.Call(hwnd, hwndTopmost, uintptr(x), uintptr(y), uintptr(wpx), uintptr(hpx),
		swpShowWindow|swpFrameChanged)
	widgetOn = true
}

func exitWidgetMode(hwnd uintptr) {
	if hwnd == 0 || !widgetOn {
		return
	}
	ex, _, _ := procGetWindowLongPtr.Call(hwnd, ptrIndex(gwlExStyle))
	ex &^= wsExToolWindow
	ex |= wsExAppWindow
	procSetWindowLongPtr.Call(hwnd, ptrIndex(gwlExStyle), ex)
	if widgetPrevStyle != 0 {
		procSetWindowLongPtr.Call(hwnd, ptrIndex(gwlStyle), widgetPrevStyle)
		widgetPrevStyle = 0
	}

	w := int64(widgetPrev.Right - widgetPrev.Left)
	h := int64(widgetPrev.Bottom - widgetPrev.Top)
	if w <= 0 || h <= 0 {
		w, h = 1280, 840
	}
	procSetWindowPos.Call(hwnd, hwndNotTopmost,
		uintptr(int64(widgetPrev.Left)), uintptr(int64(widgetPrev.Top)),
		uintptr(w), uintptr(h), swpShowWindow|swpFrameChanged)
	if widgetMax {
		procShowWindow.Call(hwnd, swMaximize)
	}
	widgetOn = false
}

func createShowEvent() {
	name, err := windows.UTF16PtrFromString(`Local\KayPanelShow`)
	if err != nil {
		return
	}
	h, _, _ := procCreateEventW.Call(0, 0, 0, uintptr(unsafe.Pointer(name)))
	showEvent = h
}

func signalExisting() bool {
	name, err := windows.UTF16PtrFromString(`Local\KayPanelShow`)
	if err != nil {
		return false
	}
	h, _, _ := procOpenEventW.Call(0x0002, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 {
		return false
	}
	procSetEvent.Call(h)
	procCloseHandle.Call(h)
	return true
}

func watchShowEvent(hwnd uintptr) {
	if showEvent == 0 {
		return
	}
	go func() {
		for {
			if r, _, _ := procWaitForSingleObject.Call(showEvent, 0xFFFFFFFF); r != 0 {
				return
			}
			procPostMessage.Call(hwnd, showWindowMsg, 0, 0)
		}
	}()
}

func clampMaximize(hwnd, lp uintptr) {
	if lp == 0 {
		return
	}
	mmi := (*minMaxInfo)(unsafe.Pointer(lp))
	hmon, _, _ := procMonitorFromWindow.Call(hwnd, monitorNearest)
	if hmon == 0 {
		return
	}
	var mi monitorInfo
	mi.CbSize = uint32(unsafe.Sizeof(mi))
	if ok, _, _ := procGetMonitorInfo.Call(hmon, uintptr(unsafe.Pointer(&mi))); ok == 0 {
		return
	}
	style, _, _ := procGetWindowLongPtr.Call(hwnd, ptrIndex(gwlStyle))
	exStyle, _, _ := procGetWindowLongPtr.Call(hwnd, ptrIndex(gwlExStyle))
	dpi, _, _ := procGetDpiForWindow.Call(hwnd)
	if dpi == 0 {
		dpi = 96
	}
	var fr winRect
	if ok, _, _ := procAdjustWindowRectExForDpi.Call(
		uintptr(unsafe.Pointer(&fr)), style, 0, exStyle, dpi); ok == 0 {
		return
	}
	mmi.PtMaxPosition.X = mi.RcWork.Left - mi.RcMonitor.Left + fr.Left
	mmi.PtMaxPosition.Y = mi.RcWork.Top - mi.RcMonitor.Top + fr.Top
	mmi.PtMaxSize.X = (mi.RcWork.Right - mi.RcWork.Left) + fr.Right - fr.Left
	mmi.PtMaxSize.Y = (mi.RcWork.Bottom - mi.RcWork.Top) + fr.Bottom - fr.Top
}

func bindWindow(w webview2.WebView) {
	hwnd := uintptr(w.Window())
	_ = w.Bind("kaypanelWindow", func(action string) string {
		switch action {
		case "min":
			procShowWindow.Call(hwnd, swMinimize)
		case "max":
			if z, _, _ := procIsZoomed.Call(hwnd); z != 0 {
				procShowWindow.Call(hwnd, swRestore)
				return "restore"
			}
			procShowWindow.Call(hwnd, swMaximize)
			return "max"
		case "close":
			if trayAdded {
				procShowWindow.Call(hwnd, swHide)
				notifyHidden()
			} else {
				procPostMessage.Call(hwnd, wmClose, 0, 0)
			}
		}
		return ""
	})
	_ = w.Bind("kaypanelDrag", func() string {
		var pt struct{ X, Y int32 }
		procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
		lp := uintptr(uint16(pt.X)) | uintptr(uint16(pt.Y))<<16
		procReleaseCapture.Call()
		procSendMessage.Call(hwnd, wmNCLButtonDown, htCaption, lp)
		return ""
	})
	_ = w.Bind("kaypanelWidget", func(action string) string {
		switch action {
		case "enter":
			enterWidgetMode(hwnd)
		case "open":
			showMain(hwnd)
		}
		return ""
	})
	_ = w.Bind("kaypanelTray", func(level, tip string) string {
		setTrayLevel(level, tip)
		return ""
	})
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
