package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"kaypanel/internal/api"
	"kaypanel/internal/audit"
	"kaypanel/internal/config"
	"kaypanel/internal/node"
)

//go:embed all:web
var webFS embed.FS

var version = "dev"

func main() {
	configPath := flag.String("config", "data/config.yaml", "配置文件路径")
	listen := flag.String("listen", "", "监听地址，覆盖配置文件")
	showVersion := flag.Bool("version", false, "显示版本")
	flag.Parse()
	if *showVersion {
		fmt.Printf("kaypanel %s\n", version)
		return
	}

	store, initialPassword, err := config.Open(*configPath)
	if err != nil {
		log.Fatalf("初始化失败: %v", err)
	}
	if initialPassword != "" {
		log.Printf("==============================================")
		log.Printf(" 首次启动，管理员密码: %s", initialPassword)
		log.Printf(" 登录后请在「设置」中修改密码")
		log.Printf("==============================================")
	}

	auditLog, err := audit.Open(filepath.Join(filepath.Dir(*configPath), "audit.log"))
	if err != nil {
		log.Fatalf("打开审计日志失败: %v", err)
	}

	mgr := node.NewManager(store)
	mgr.Start()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("加载前端资源失败: %v", err)
	}

	srv := api.New(store, mgr, auditLog, http.FS(sub), version)
	addr := store.Listen()
	if *listen != "" {
		addr = *listen
	}
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	go func() {
		log.Printf("KayPanel %s listening on %s", version, addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("HTTP 服务异常: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
	mgr.Stop()
	log.Println("已退出")
}
