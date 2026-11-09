# KayPanel

轻量级多服务器管理面板：一个二进制文件，通过 SSH 统一管理多台 Linux 主机，无需在目标机器上安装任何 Agent。

## 功能

- **系统监控**：CPU / 内存 / 磁盘 / 负载 / 网络速率 / 温度 / 进程 Top，3 秒采样，历史曲线
- **Docker 容器**：列表、启动/停止/重启/暂停/删除、实时日志、镜像清理、资源占用
- **Compose 应用**：内置模板一键部署，在线编辑 Compose 文件，启动/停止/更新/删除
- **文件管理**：浏览、上传、下载、新建、重命名、递归删除、在线编辑文本（SFTP）
- **Web 终端**：基于 PTY 的完整终端，支持窗口自适应
- **多节点**：SSH 密钥或密码登录，首次连接 TOFU 校验主机指纹，支持 sudo
- **安全**：bcrypt 管理员密码、HMAC 签名会话、CSRF 校验、登录限流、操作审计日志

界面为中文深色主题，顶部页签布局，适配桌面与移动端。

## 快速开始

### 方式一：下载二进制

从 [Releases](https://github.com/kaynai1/kaypanel/releases) 下载对应平台的文件，直接运行：

```bash
KAYPANEL_PASSWORD='你的管理密码' ./kaypanel -listen :8899
```

不设置 `KAYPANEL_PASSWORD` 时，首次启动会生成随机密码并打印在日志中。配置文件默认位于 `data/config.yaml`。

### 方式二：Docker

```bash
docker load < kaypanel-image-amd64.tar.gz
docker compose up -d
```

访问 `http://服务器IP:8899`。数据保存在 `./data` 目录。

> 面板通过 SSH 管理节点，容器内需要能访问目标机器的 22 端口。管理本机时，节点地址填 `host.docker.internal`（Linux 下可加 `extra_hosts: ["host.docker.internal:host-gateway"]`）或宿主机内网 IP。

### 方式三：源码构建

```bash
go build -o kaypanel .
./kaypanel -listen :8899
```

## 添加节点

登录后进入「设置」→「添加节点」，填写地址、SSH 端口、用户名与密钥/密码。首次连接会显示主机指纹，确认后固定保存；后续指纹变化将拒绝连接。

- 文件根目录：面板可访问的目录，默认 `/`
- 应用目录：Compose 应用存放位置，默认 `~/kaypanel/stacks`
- sudo：需要执行 Docker 等特权命令时开启（建议使用密钥 + 免密 sudo，或单独填写 sudo 密码）

## 配置

| 环境变量 | 说明 |
| --- | --- |
| `KAYPANEL_PASSWORD` | 首次初始化时设置管理员密码 |
| `KAYPANEL_LISTEN` | 监听地址，默认 `:8080`（可用 `-listen` 覆盖） |

命令行参数：`-config` 指定配置文件，`-listen` 指定监听地址，`-version` 输出版本。

## 安全建议

- 面板仅监听内网，或放在反向代理 / SSH 隧道之后，不要直接暴露到公网
- 使用强密码，并定期轮换
- SSH 节点建议使用专用密钥并限制权限
- 审计日志位于 `data/audit.log`

## 许可

MIT
