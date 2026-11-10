package api

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/pkg/sftp"
)

func (s *Server) handleChanges(w http.ResponseWriter, r *http.Request) {
	if s.changes == nil {
		writeJSON(w, http.StatusOK, map[string]any{"changes": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"changes": s.changes.List()})
}

func (s *Server) handleChangeGet(w http.ResponseWriter, r *http.Request) {
	if s.changes == nil {
		writeErr(w, http.StatusNotFound, "记录不存在")
		return
	}
	it, before, after, ok := s.changes.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, http.StatusNotFound, "记录不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": it, "before": before, "after": after})
}

func writeRemoteFile(sf *sftp.Client, target, content string) error {
	tmp := target + ".kptmp"
	fh, err := sf.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY)
	if err != nil {
		return err
	}
	_, werr := fh.Write([]byte(content))
	cerr := fh.Close()
	if werr != nil || cerr != nil {
		_ = sf.Remove(tmp)
		return fmt.Errorf("写入失败")
	}
	if err := sf.PosixRename(tmp, target); err != nil {
		_ = sf.Remove(target)
		if err := sf.Rename(tmp, target); err != nil {
			_ = sf.Remove(tmp)
			return err
		}
	}
	return nil
}

func (s *Server) handleChangeRollback(w http.ResponseWriter, r *http.Request) {
	if s.changes == nil {
		writeErr(w, http.StatusNotFound, "记录不存在")
		return
	}
	id := r.PathValue("id")
	it, before, _, ok := s.changes.Get(id)
	if !ok {
		writeErr(w, http.StatusNotFound, "记录不存在")
		return
	}
	if it.RolledBack {
		writeErr(w, http.StatusBadRequest, "该变更已回滚过")
		return
	}
	if !it.Restorable || before == "" {
		writeErr(w, http.StatusBadRequest, "该变更没有可回滚的旧版本")
		return
	}
	n, ok := s.mgr.Get(it.NodeID)
	if !ok {
		writeErr(w, http.StatusNotFound, "节点不存在，无法回滚")
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
	var target string
	switch it.Kind {
	case "stack":
		base := path.Clean(stacksBase(n))
		t := path.Clean(it.Target)
		if base == "/" || !strings.HasPrefix(t, base+"/") || strings.Contains(t, "/../") {
			writeErr(w, http.StatusBadRequest, "目标路径已不在应用目录内，无法回滚")
			return
		}
		target = t
	case "file":
		root := fileRoot(n)
		p := cleanRemotePath(root, it.Target)
		if p == "" || p == root {
			writeErr(w, http.StatusBadRequest, "目标路径不合法")
			return
		}
		real, err := resolveWritable(sf, root, p)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		target = real
	default:
		writeErr(w, http.StatusBadRequest, "该记录不支持回滚")
		return
	}
	if err := writeRemoteFile(sf, target, before); err != nil {
		client.ResetSFTP()
		writeErr(w, http.StatusBadGateway, "回滚失败: "+err.Error())
		return
	}
	s.changes.MarkRolledBack(id)
	s.audit.Add("admin", it.NodeID, "回滚变更", it.Kind+" "+it.Target)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
