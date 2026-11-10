package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"time"

	"kaypanel/internal/alert"
	"kaypanel/internal/api"
	"kaypanel/internal/audit"
	"kaypanel/internal/changes"
	"kaypanel/internal/config"
	"kaypanel/internal/insight"
	"kaypanel/internal/node"
	"kaypanel/internal/probe"
)

type Options struct {
	ConfigPath string
	Listen     string
	Version    string
	Web        fs.FS
	Desktop    bool
}

type Instance struct {
	Store           *config.Store
	Manager         *node.Manager
	Addr            string
	URL             string
	InitialPassword string
	DesktopToken    string

	alertCancel context.CancelFunc
	probeCancel context.CancelFunc
	httpSrv     *http.Server
}

func Start(opts Options) (*Instance, error) {
	store, initialPassword, err := config.Open(opts.ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("初始化失败: %w", err)
	}
	auditLog, err := audit.Open(filepath.Join(filepath.Dir(opts.ConfigPath), "audit.log"))
	if err != nil {
		return nil, fmt.Errorf("打开审计日志失败: %w", err)
	}

	mgr := node.NewManager(store, store.Dir())
	mgr.Start()
	alertCtx, alertCancel := context.WithCancel(context.Background())
	alert.New(store, mgr).Start(alertCtx)

	probeMgr := probe.New(store.Dir())
	probeCtx, probeCancel := context.WithCancel(context.Background())
	probeMgr.Start(probeCtx)
	changeLog := changes.New(store.Dir())
	insightStore := insight.New(store.Dir())
	srv := api.New(store, mgr, auditLog, http.FS(opts.Web), opts.Version, probeMgr, changeLog, insightStore)
	inst := &Instance{Store: store, Manager: mgr, InitialPassword: initialPassword, alertCancel: alertCancel, probeCancel: probeCancel}
	if opts.Desktop {
		inst.DesktopToken = config.RandomHex(24)
		srv.EnableDesktop(inst.DesktopToken)
	}

	addr := store.Listen()
	if opts.Listen != "" {
		addr = opts.Listen
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		alertCancel()
		probeCancel()
		mgr.Stop()
		return nil, fmt.Errorf("监听 %s 失败: %w", addr, err)
	}

	inst.httpSrv = &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	inst.Addr = ln.Addr().String()
	inst.URL = publicURL(inst.Addr)
	go func() {
		if err := inst.httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("HTTP 服务异常: %v", err)
		}
	}()
	return inst, nil
}

func publicURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func (i *Instance) Shutdown(ctx context.Context) {
	if i.alertCancel != nil {
		i.alertCancel()
	}
	if i.probeCancel != nil {
		i.probeCancel()
	}
	if i.httpSrv != nil {
		_ = i.httpSrv.Shutdown(ctx)
	}
	if i.Manager != nil {
		i.Manager.Stop()
	}
}
