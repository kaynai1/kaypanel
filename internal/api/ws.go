package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"kaypanel/internal/node"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  32 * 1024,
	WriteBufferSize: 32 * 1024,
	CheckOrigin:     sameOrigin,
}

type wsWriter struct {
	ws *websocket.Conn
}

func (w wsWriter) Write(p []byte) (int, error) {
	if err := w.ws.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

type termMsg struct {
	Type string `json:"type"`
	Data string `json:"data"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) wsTerm(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("node")
	n, ok := s.mgr.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	fail := func(msg string) {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m"+msg+"\x1b[0m\r\n"))
	}
	client, err := n.Client()
	if err != nil {
		fail("连接失败: " + err.Error())
		return
	}
	sess, err := client.NewSession()
	if err != nil {
		fail(err.Error())
		return
	}
	defer sess.Close()
	stdinR, stdinW := io.Pipe()
	defer stdinW.Close()
	sess.Stdin = stdinR
	if err := sess.RequestPty("xterm-256color", 32, 120, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		fail("申请伪终端失败: " + err.Error())
		return
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		fail(err.Error())
		return
	}
	if err := sess.Shell(); err != nil {
		fail("启动 shell 失败: " + err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, "打开终端", n.Config().Name)

	var writeMu sync.Mutex
	go func() {
		buf := make([]byte, 32*1024)
		for {
			nr, rerr := stdout.Read(buf)
			if nr > 0 {
				chunk := append([]byte(nil), buf[:nr]...)
				writeMu.Lock()
				werr := ws.WriteMessage(websocket.BinaryMessage, chunk)
				writeMu.Unlock()
				if werr != nil {
					break
				}
			}
			if rerr != nil {
				break
			}
		}
		writeMu.Lock()
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n[终端已断开]\r\n"))
		writeMu.Unlock()
		_ = ws.Close()
	}()

	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var msg termMsg
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if _, err := stdinW.Write([]byte(msg.Data)); err != nil {
				return
			}
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 && msg.Cols < 1000 && msg.Rows < 1000 {
				_ = sess.WindowChange(msg.Rows, msg.Cols)
			}
		}
	}
}

func (s *Server) wsLogs(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("node")
	n, ok := s.mgr.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在")
		return
	}
	cid := r.URL.Query().Get("id")
	if !node.ValidContainerRef(cid) {
		writeErr(w, http.StatusBadRequest, "容器标识不合法")
		return
	}
	tail := 300
	if v := r.URL.Query().Get("tail"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 10 && n <= 5000 {
			tail = n
		}
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	fail := func(msg string) {
		_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m"+msg+"\x1b[0m\r\n"))
	}
	client, err := n.Client()
	if err != nil {
		fail("连接失败: " + err.Error())
		return
	}
	sess, err := client.NewSession()
	if err != nil {
		fail(err.Error())
		return
	}
	defer sess.Close()
	inner := fmt.Sprintf("docker logs --tail %d -f %s 2>&1", tail, cid)
	cmd, stdin := n.Wrap(inner)
	if stdin != "" {
		sess.Stdin = strings.NewReader(stdin)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		fail(err.Error())
		return
	}
	if err := sess.Start(cmd); err != nil {
		fail("启动日志失败: " + err.Error())
		return
	}
	go func() {
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				_ = sess.Close()
				return
			}
		}
	}()
	_, _ = io.Copy(wsWriter{ws: ws}, stdout)
	_ = ws.WriteMessage(websocket.TextMessage, []byte("\r\n[日志流已结束]\r\n"))
}
