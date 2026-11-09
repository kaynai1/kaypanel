package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"kaypanel/internal/app"
	"kaypanel/web"
)

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

	inst, err := app.Start(app.Options{
		ConfigPath: *configPath,
		Listen:     *listen,
		Version:    version,
		Web:        web.Assets,
	})
	if err != nil {
		log.Fatal(err)
	}
	if inst.InitialPassword != "" {
		log.Printf("==============================================")
		log.Printf(" 首次启动，管理员密码: %s", inst.InitialPassword)
		log.Printf(" 登录后请在「设置」中修改密码")
		log.Printf("==============================================")
	}
	log.Printf("KayPanel %s listening on %s", version, inst.Addr)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	inst.Shutdown(ctx)
	log.Println("已退出")
}
