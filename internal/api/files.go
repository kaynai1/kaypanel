package api

import (
	"bytes"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/pkg/sftp"

	"kaypanel/internal/node"
)

var errOutsideRoot = fmt.Errorf("路径超出允许范围")

type fileEntry struct {
	Name    string `json:"name"`
	IsDir   bool   `json:"is_dir"`
	IsLink  bool   `json:"is_link"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"mod_time"`
}

func fileRoot(n *node.Node) string {
	r := n.Config().FileRoot
	if r == "" {
		return "/"
	}
	return r
}

func cleanRemotePath(root, p string) string {
	if root == "" {
		root = "/"
	}
	root = path.Clean(root)
	if p == "" {
		p = root
	}
	if !strings.HasPrefix(p, "/") {
		p = path.Join(root, p)
	}
	p = path.Clean(p)
	if root != "/" && p != root && !strings.HasPrefix(p, root+"/") {
		return ""
	}
	return p
}

func withinRoot(root, real string) bool {
	if root == "/" {
		return true
	}
	return real == root || strings.HasPrefix(real, root+"/")
}

func resolveExisting(sf *sftp.Client, root, p string) (string, error) {
	cp := cleanRemotePath(root, p)
	if cp == "" {
		return "", errOutsideRoot
	}
	real, err := sf.RealPath(cp)
	if err != nil {
		return "", err
	}
	real = path.Clean(real)
	rr := path.Clean(root)
	if rr != "/" {
		if r2, err := sf.RealPath(rr); err == nil {
			rr = path.Clean(r2)
		}
		if !withinRoot(rr, real) && !withinRoot(path.Clean(root), real) {
			return "", errOutsideRoot
		}
	}
	return real, nil
}

func resolveWritable(sf *sftp.Client, root, p string) (string, error) {
	cp := cleanRemotePath(root, p)
	if cp == "" {
		return "", errOutsideRoot
	}
	if _, err := sf.Lstat(cp); err == nil {
		return resolveExisting(sf, root, cp)
	}
	parent, err := resolveExisting(sf, root, path.Dir(cp))
	if err != nil {
		return "", err
	}
	name := path.Base(cp)
	if name == "" || name == "." || name == ".." || name == "/" {
		return "", fmt.Errorf("文件名不合法")
	}
	return path.Join(parent, name), nil
}

func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	root := fileRoot(n)
	p := cleanRemotePath(root, r.URL.Query().Get("path"))
	if p == "" {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	real, err := resolveExisting(sf, root, p)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "打开目录失败: "+err.Error())
		return
	}
	infos, err := sf.ReadDir(real)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "读取目录失败: "+err.Error())
		return
	}
	entries := make([]fileEntry, 0, len(infos))
	for _, fi := range infos {
		if fi.Name() == "." || fi.Name() == ".." {
			continue
		}
		entries = append(entries, fileEntry{
			Name:    fi.Name(),
			IsDir:   fi.IsDir(),
			IsLink:  fi.Mode()&os.ModeSymlink != 0,
			Size:    fi.Size(),
			Mode:    fi.Mode().String(),
			ModTime: fi.ModTime().Unix(),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    p,
		"root":    root,
		"entries": entries,
	})
}

func (s *Server) handleFileDownload(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	root := fileRoot(n)
	p := cleanRemotePath(root, r.URL.Query().Get("path"))
	if p == "" || p == root {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	real, err := resolveExisting(sf, root, p)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st, err := sf.Stat(real)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if st.IsDir() {
		writeErr(w, http.StatusBadRequest, "不能下载目录")
		return
	}
	fh, err := sf.Open(real)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	defer fh.Close()
	name := path.Base(p)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.Copy(w, fh)
}

func (s *Server) handleFileUpload(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	root := fileRoot(n)
	dir := cleanRemotePath(root, r.URL.Query().Get("path"))
	if dir == "" {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	realDir, err := resolveExisting(sf, root, dir)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	st, err := sf.Stat(realDir)
	if err != nil || !st.IsDir() {
		writeErr(w, http.StatusBadRequest, "目标不是目录")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 20<<30)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "上传请求格式错误")
		return
	}
	var uploaded []string
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			client.ResetSFTP()
			writeErr(w, http.StatusBadRequest, "读取上传内容失败: "+err.Error())
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}
		name := path.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		if name == "" || name == "." || name == ".." {
			part.Close()
			continue
		}
		target := path.Join(realDir, name)
		tmp := target + ".kptmp"
		fh, err := sf.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY)
		if err != nil {
			part.Close()
			client.ResetSFTP()
			writeErr(w, http.StatusBadGateway, "创建文件失败: "+err.Error())
			return
		}
		_, cpErr := io.Copy(fh, part)
		closeErr := fh.Close()
		part.Close()
		if cpErr != nil || closeErr != nil {
			_ = sf.Remove(tmp)
			client.ResetSFTP()
			writeErr(w, http.StatusBadGateway, "上传中断")
			return
		}
		if err := sf.PosixRename(tmp, target); err != nil {
			_ = sf.Remove(target)
			if err := sf.Rename(tmp, target); err != nil {
				_ = sf.Remove(tmp)
				client.ResetSFTP()
				writeErr(w, http.StatusBadGateway, "保存文件失败: "+err.Error())
				return
			}
		}
		uploaded = append(uploaded, name)
		s.audit.Add("admin", n.Config().ID, "上传文件", path.Join(dir, name))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "uploaded": uploaded})
}

type pathReq struct {
	Path string `json:"path"`
}

func (s *Server) handleFileMkdir(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	var req pathReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	p := cleanRemotePath(fileRoot(n), req.Path)
	if p == "" || p == fileRoot(n) {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	real, err := resolveWritable(sf, fileRoot(n), p)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := sf.Mkdir(real); err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "创建失败: "+err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, "新建文件夹", p)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type renameReq struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func (s *Server) handleFileRename(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	var req renameReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	root := fileRoot(n)
	from := cleanRemotePath(root, req.From)
	to := cleanRemotePath(root, req.To)
	if from == "" || to == "" || from == root || to == root {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	realFrom, err := resolveExisting(sf, root, from)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	realTo, err := resolveWritable(sf, root, to)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := sf.Rename(realFrom, realTo); err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "重命名失败: "+err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, "重命名", from+" -> "+to)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type deleteReq struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

func (s *Server) handleFileDelete(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	var req deleteReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	root := fileRoot(n)
	p := cleanRemotePath(root, req.Path)
	if p == "" || p == root {
		writeErr(w, http.StatusBadRequest, "不能删除根目录")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	real, err := resolveExisting(sf, root, p)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := sf.Lstat(real)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if st.IsDir() {
		if req.Recursive {
			err = removeTree(sf, real)
		} else {
			err = sftpRemoveDir(sf, real)
		}
	} else {
		err = sf.Remove(real)
	}
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "删除失败: "+err.Error())
		return
	}
	s.audit.Add("admin", n.Config().ID, "删除文件", p)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleFileRead(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	root := fileRoot(n)
	p := cleanRemotePath(root, r.URL.Query().Get("path"))
	if p == "" {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	real, err := resolveExisting(sf, root, p)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	st, err := sf.Stat(real)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if st.IsDir() {
		writeErr(w, http.StatusBadRequest, "不能编辑目录")
		return
	}
	if st.Size() > 2<<20 {
		writeErr(w, http.StatusBadRequest, "文件超过 2MB，请下载后编辑")
		return
	}
	fh, err := sf.Open(real)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	defer fh.Close()
	b, err := io.ReadAll(io.LimitReader(fh, 2<<20))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if bytes.IndexByte(b, 0) >= 0 || !utf8.Valid(b) {
		writeErr(w, http.StatusBadRequest, "二进制文件不支持在线编辑")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":     p,
		"content":  string(b),
		"size":     st.Size(),
		"mod_time": st.ModTime().Unix(),
	})
}

type textWriteReq struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (s *Server) handleFileWrite(w http.ResponseWriter, r *http.Request) {
	n, ok := s.node(w, r)
	if !ok {
		return
	}
	var req textWriteReq
	if err := readJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if len(req.Content) > 2<<20 {
		writeErr(w, http.StatusBadRequest, "文件超过 2MB，请下载后编辑")
		return
	}
	root := fileRoot(n)
	p := cleanRemotePath(root, req.Path)
	if p == "" || p == root {
		writeErr(w, http.StatusBadRequest, "路径不合法")
		return
	}
	client, err := n.Client()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	sf, err := client.SFTP()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	real, err := resolveWritable(sf, root, p)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	before := ""
	if st, serr := sf.Stat(real); serr == nil && !st.IsDir() && st.Size() <= 2<<20 {
		if fh, oerr := sf.Open(real); oerr == nil {
			if b, rerr := io.ReadAll(io.LimitReader(fh, 2<<20)); rerr == nil {
				before = string(b)
			}
			fh.Close()
		}
	}
	tmp := real + ".kptmp"
	fh, err := sf.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY)
	if err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "写入失败: "+err.Error())
		return
	}
	_, werr := fh.Write([]byte(req.Content))
	cerr := fh.Close()
	if werr != nil || cerr != nil {
		_ = sf.Remove(tmp)
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "写入失败")
		return
	}
	if err := sf.PosixRename(tmp, real); err != nil {
		_ = sf.Remove(real)
		if err := sf.Rename(tmp, real); err != nil {
			_ = sf.Remove(tmp)
			client.ResetSFTP()
			writeErr(w, http.StatusBadGateway, "保存失败: "+err.Error())
			return
		}
	}
	if s.changes != nil {
		cfg := n.Config()
		s.changes.Add("file", cfg.ID, cfg.Name, p, "文件 "+p, before, req.Content)
	}
	s.audit.Add("admin", n.Config().ID, "编辑文件", p)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func sftpRemoveDir(sf *sftp.Client, p string) error {
	return sf.RemoveDirectory(p)
}

func removeTree(sf *sftp.Client, p string) error {
	st, err := sf.Lstat(p)
	if err != nil {
		return err
	}
	if !st.IsDir() {
		return sf.Remove(p)
	}
	entries, err := sf.ReadDir(p)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := removeTree(sf, path.Join(p, e.Name())); err != nil {
			return err
		}
	}
	return sf.RemoveDirectory(p)
}
