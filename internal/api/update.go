package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	releaseAPI    = "https://api.github.com/repos/kaynai1/kaypanel/releases/latest"
	releasePage   = "https://github.com/kaynai1/kaypanel/releases/latest"
	updateMaxSize = 200 << 20
)

var updateHTTP = &http.Client{Timeout: 10 * time.Minute}

type updateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	Tag       string `json:"tag"`
	Name      string `json:"name"`
	Notes     string `json:"notes"`
	Published string `json:"published_at"`
	Size      int64  `json:"size"`
	AssetName string `json:"asset_name"`
	AssetURL  string `json:"-"`
	HTMLURL   string `json:"html_url"`
	Desktop   bool   `json:"desktop"`
	CheckedAt int64  `json:"checked_at"`
}

type ghRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Assets      []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
		Size int64  `json:"size"`
		URL  string `json:"url"`
	} `json:"assets"`
}

func versionParts(v string) []int {
	v = strings.TrimSpace(strings.ToLower(v))
	v = strings.TrimPrefix(v, "v")
	if i := strings.IndexAny(v, "-+ "); i >= 0 {
		v = v[:i]
	}
	if v == "" {
		return []int{0}
	}
	parts := strings.Split(v, ".")
	out := make([]int, len(parts))
	for i, p := range parts {
		out[i], _ = strconv.Atoi(p)
	}
	return out
}

func versionLess(a, b string) bool {
	pa, pb := versionParts(a), versionParts(b)
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			return x < y
		}
	}
	return false
}

func sanitizeNotes(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "http://") || strings.Contains(lower, "https://") || strings.Contains(lower, "full changelog") {
			continue
		}
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func (s *Server) fetchLatestRelease(ctx context.Context) (updateInfo, error) {
	info := updateInfo{Current: s.version, HTMLURL: releasePage, Desktop: s.desktopToken != ""}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPI, nil)
	if err != nil {
		return info, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "KayPanel/"+s.version)
	res, err := updateHTTP.Do(req)
	if err != nil {
		return info, fmt.Errorf("无法连接 GitHub：%v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode != http.StatusOK {
		return info, fmt.Errorf("GitHub 返回 HTTP %d，可能触发访问频率限制，请稍后再试", res.StatusCode)
	}
	var rel ghRelease
	if err := json.Unmarshal(raw, &rel); err != nil {
		return info, fmt.Errorf("无法解析 Release 信息: %v", err)
	}
	if rel.TagName == "" {
		return info, fmt.Errorf("Release 信息不完整")
	}
	info.Tag = rel.TagName
	info.Latest = strings.TrimPrefix(rel.TagName, "v")
	info.Name = strings.TrimSpace(rel.Name)
	if info.Name == "" {
		info.Name = "KayPanel " + rel.TagName
	}
	info.Notes = sanitizeNotes(rel.Body)
	if r := []rune(info.Notes); len(r) > 3000 {
		info.Notes = string(r[:3000]) + "…"
	}
	info.Published = rel.PublishedAt
	if rel.HTMLURL != "" {
		info.HTMLURL = rel.HTMLURL
	}
	for _, a := range rel.Assets {
		lower := strings.ToLower(a.Name)
		if strings.HasSuffix(lower, ".exe") && strings.Contains(lower, "setup") {
			info.AssetName = a.Name
			info.AssetURL = a.URL
			info.Size = a.Size
			break
		}
	}
	if info.AssetURL == "" {
		return info, fmt.Errorf("该版本还没有发布 Windows 安装包")
	}
	info.Available = versionLess(s.version, info.Latest)
	info.CheckedAt = time.Now().Unix()
	return info, nil
}

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("force") == "1"
	s.updMu.Lock()
	cached := s.updCache
	cachedAt := s.updCacheAt
	s.updMu.Unlock()
	if !force && cached.Latest != "" && time.Since(cachedAt) < 10*time.Minute {
		cached.Current = s.version
		cached.Desktop = s.desktopToken != ""
		writeJSON(w, http.StatusOK, cached)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	info, err := s.fetchLatestRelease(ctx)
	cancel()
	if err != nil {
		writeErr(w, http.StatusBadGateway, "检查更新失败："+err.Error())
		return
	}
	s.updMu.Lock()
	s.updCache = info
	s.updCacheAt = time.Now()
	s.updMu.Unlock()
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) updateAsset(ctx context.Context) (updateInfo, error) {
	s.updMu.Lock()
	info := s.updCache
	cachedAt := s.updCacheAt
	s.updMu.Unlock()
	if info.AssetURL != "" && time.Since(cachedAt) < 30*time.Minute {
		info.Current = s.version
		info.Desktop = s.desktopToken != ""
		return info, nil
	}
	info, err := s.fetchLatestRelease(ctx)
	if err != nil {
		return info, err
	}
	s.updMu.Lock()
	s.updCache = info
	s.updCacheAt = time.Now()
	s.updMu.Unlock()
	return info, nil
}

func (s *Server) handleUpdateDownload(w http.ResponseWriter, r *http.Request) {
	if s.desktopToken == "" {
		writeErr(w, http.StatusBadRequest, "网页版请在 GitHub Releases 下载安装包")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	info, err := s.updateAsset(ctx)
	cancel()
	if err != nil {
		writeErr(w, http.StatusBadGateway, "获取更新信息失败："+err.Error())
		return
	}
	if !info.Available {
		writeErr(w, http.StatusConflict, "当前已经是最新版本")
		return
	}
	dir := filepath.Join(s.store.Dir(), "updates")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		writeErr(w, http.StatusInternalServerError, "无法创建下载目录")
		return
	}
	name := filepath.Base(info.AssetName)
	dest := filepath.Join(dir, name)
	if st, err := os.Stat(dest); err == nil && st.Mode().IsRegular() && (info.Size <= 0 || st.Size() == info.Size) {
		writeJSON(w, http.StatusOK, map[string]any{"path": dest, "size": st.Size(), "name": name})
		return
	}
	dlCtx, dlCancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer dlCancel()
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, info.AssetURL, nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "下载地址无效")
		return
	}
	req.Header.Set("Accept", "application/octet-stream")
	req.Header.Set("User-Agent", "KayPanel/"+s.version)
	res, err := updateHTTP.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "下载安装包失败："+err.Error())
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("下载安装包失败：HTTP %d", res.StatusCode))
		return
	}
	tmp := dest + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "无法写入安装包")
		return
	}
	n, copyErr := io.Copy(f, io.LimitReader(res.Body, updateMaxSize+1))
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(tmp)
		writeErr(w, http.StatusBadGateway, "下载中断，请重试")
		return
	}
	if n > updateMaxSize {
		os.Remove(tmp)
		writeErr(w, http.StatusBadGateway, "安装包体积异常")
		return
	}
	if info.Size > 0 && n != info.Size {
		os.Remove(tmp)
		writeErr(w, http.StatusBadGateway, "安装包不完整，请重试")
		return
	}
	if err := os.Rename(tmp, dest); err != nil {
		os.Remove(tmp)
		writeErr(w, http.StatusInternalServerError, "保存安装包失败")
		return
	}
	s.audit.Add("admin", "", "下载更新", name)
	writeJSON(w, http.StatusOK, map[string]any{"path": dest, "size": n, "name": name})
}

func (s *Server) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if s.desktopToken == "" {
		writeErr(w, http.StatusBadRequest, "只有桌面版可以在应用内安装更新")
		return
	}
	var in struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "参数错误")
		return
	}
	dir, err := filepath.Abs(filepath.Join(s.store.Dir(), "updates"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "无法定位更新目录")
		return
	}
	abs, err := filepath.Abs(strings.TrimSpace(in.Path))
	if err != nil || !strings.HasPrefix(strings.ToLower(abs), strings.ToLower(dir+string(os.PathSeparator))) {
		writeErr(w, http.StatusBadRequest, "安装包路径不合法")
		return
	}
	if !strings.HasSuffix(strings.ToLower(abs), ".exe") {
		writeErr(w, http.StatusBadRequest, "安装包路径不合法")
		return
	}
	st, err := os.Stat(abs)
	if err != nil || st.IsDir() || st.Size() < 1<<20 {
		writeErr(w, http.StatusBadRequest, "安装包不存在或不完整，请重新下载")
		return
	}
	s.audit.Add("admin", "", "安装更新", filepath.Base(abs))
	cmd := exec.Command(abs, "/SILENT", "/CLOSEAPPLICATIONS", "/NORESTARTAPPLICATIONS")
	if err := cmd.Start(); err != nil {
		writeErr(w, http.StatusInternalServerError, "无法启动安装程序："+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	go func() {
		time.Sleep(700 * time.Millisecond)
		os.Exit(0)
	}()
}
