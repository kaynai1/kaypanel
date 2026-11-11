# KayPanel

轻量级多服务器管理面板：一个二进制文件，通过 SSH 统一管理多台 Linux 主机，无需在目标机器上安装任何 Agent。提供 Windows 桌面版安装包，也可以部署为网页服务。

## 功能

- **系统监控**：CPU / 内存 / 磁盘 / 负载 / 网络速率 / 温度 / 进程 Top，3 秒采样，历史曲线
- **监控大屏**：全屏深色大屏模式，环形仪表 + 实时曲线，适合挂在电视或副屏上长期展示
- **告警推送**：CPU / 内存 / 磁盘越线自动推送企业微信、钉钉、飞书、Bark、Server酱、PushPlus、ntfy、Gotify、Telegram、Slack、Discord 或自定义 Webhook，也可同时发送 SMTP 邮件（QQ 邮箱、CyberPanel 等），恢复时再通知；支持每日早报
- **历史落盘**：最近 120 个监控采样点（约 6 分钟）保存到 `data/history.json`，面板重启后曲线不丢
- **Docker 容器**：列表、启动/停止/重启/暂停/删除、实时日志、镜像清理、资源占用
- **容器一键更新**：拉取最新镜像并按原配置重建容器，Compose 容器自动走 `docker compose pull && up -d`，失败自动回滚
- **AI 运维助手**：接入任意 OpenAI 兼容接口，结合实时指标、进程与容器信息回答问题，只读不执行命令
- **Compose 应用**：内置模板一键部署，在线编辑 Compose 文件，启动/停止/更新/删除
- **文件管理**：浏览、上传、下载、新建、重命名、递归删除、在线编辑文本（SFTP）
- **Web 终端**：基于 PTY 的完整终端，支持窗口自适应
- **多节点**：SSH 密钥或密码登录，首次连接 TOFU 校验主机指纹，支持 sudo
- **Instabox 自动唤醒**：面板运行期间定期续租防止空闲休眠，机器已休眠时自动调用官方接口唤醒并重连
- **虚拟主机（仅文件）**：通过 SFTP 连接只有文件权限的共享虚拟主机，提供文件管理；不提供系统监控、容器与终端
- **PWA**：手机浏览器打开面板后可「添加到主屏幕」，像 App 一样全屏使用
- **安全**：bcrypt 管理员密码、HMAC 签名会话、CSRF 校验、登录限流、操作审计日志；Webhook、SMTP 密码与 AI Key 只保存在本机配置中，接口返回时脱敏

界面为中文浅色主题：左侧分组导航、顶部节点切换、右侧快捷操作栏，适配桌面与移动端。

## 快速开始

### 方式一：Windows 桌面版（推荐）

从 [Releases](https://github.com/kaynai1/kaypanel/releases) 下载 `KayPanel-Setup-*.exe`，双击安装后从桌面或开始菜单启动。桌面版内嵌 WebView2，启动即自动登录，数据保存在 `%APPDATA%\KayPanel`，无需浏览器、无需命令行。

### 方式二：下载二进制

从 [Releases](https://github.com/kaynai1/kaypanel/releases) 下载对应平台的文件，直接运行：

```bash
KAYPANEL_PASSWORD='你的管理密码' ./kaypanel -listen :8899
```

不设置 `KAYPANEL_PASSWORD` 时，首次启动会生成随机密码并打印在日志中。配置文件默认位于 `data/config.yaml`。

### 方式三：Docker

```bash
docker load < kaypanel-image-amd64.tar.gz
docker compose up -d
```

访问 `http://服务器IP:8899`。数据保存在 `./data` 目录。

> 面板通过 SSH 管理节点，容器内需要能访问目标机器的 22 端口。管理本机时，节点地址填 `host.docker.internal`（Linux 下可加 `extra_hosts: ["host.docker.internal:host-gateway"]`）或宿主机内网 IP。

### 方式四：源码构建

```bash
go build -o kaypanel .
./kaypanel -listen :8899
```

## 添加节点

登录后进入「设置」→「添加节点」，填写地址、SSH 端口、用户名与密钥/密码。认证方式支持私钥、密码，以及无需凭据的「无认证」（如 Instabox 这类只认用户名的 Token 主机）；负载均衡主机指纹会变化时，可勾选「跳过主机指纹校验」。首次连接会显示主机指纹，确认后固定保存；后续指纹变化将拒绝连接。

没有 SSH 命令权限的共享虚拟主机，添加节点时选择「虚拟主机（仅文件）」，填写 SFTP 地址、用户名、密码（或密钥）与文件根目录。连接后只启用「文件」页；SFTP 端口通常是 22，主机商可能要求启用 SSH/SFTP 访问。

Instabox 机器若勾选「Instabox 自动唤醒」，需填写 [dashboard.instabox.sh](https://dashboard.instabox.sh/dashboard/api-keys) 创建的 API Key（需读写权限）和机器 ID；可点「读取机器列表」从账号中选择机器。面板会每 5 分钟续租一次活动租约，节点掉线时自动调用唤醒接口。

添加节点页支持**识别本机 SSH**：自动读取当前电脑（桌面版）或面板所在服务器（网页版）的 `~/.ssh/config`、`known_hosts` 和私钥，选择条目即可填入地址、用户和私钥，无需手工粘贴。私钥仅在保存时由本机读取，不会显示在页面中。

- 文件根目录：面板可访问的目录，默认 `/`
- 应用目录：Compose 应用存放位置，默认 `~/kaypanel/stacks`
- sudo：需要执行 Docker 等特权命令时开启（建议使用密钥 + 免密 sudo，或单独填写 sudo 密码）

## 配置

| 环境变量 | 说明 |
| --- | --- |
| `KAYPANEL_PASSWORD` | 首次初始化时设置管理员密码 |

命令行参数：`-config` 指定配置文件，`-listen` 指定监听地址，`-version` 输出版本。

## 安全建议

- 面板仅监听内网，或放在反向代理 / SSH 隧道之后，不要直接暴露到公网
- 使用强密码，并定期轮换
- SSH 节点建议使用专用密钥并限制权限
- 审计日志位于 `data/audit.log`

## 许可

MIT
