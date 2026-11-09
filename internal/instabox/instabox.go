package instabox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const baseURL = "https://api.instabox.sh"

type Machine struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

func call(ctx context.Context, method, path, apiKey string, body any) ([]byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 Instabox 失败: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(data))
		if msg == "" {
			msg = resp.Status
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("Instabox 返回 %d: %s", resp.StatusCode, msg)
	}
	return data, nil
}

// Wake resumes a machine paused by idle auto-pause; Instabox waits up to 45s.
func Wake(ctx context.Context, apiKey, machineID string) error {
	_, err := call(ctx, http.MethodPost, "/v1/machines/"+url.PathEscape(machineID)+"/wake", apiKey, map[string]any{})
	return err
}

func Lease(ctx context.Context, apiKey, machineID, taskID string, ttlSeconds int) error {
	path := "/v1/machines/" + url.PathEscape(machineID) + "/activity-leases/" + url.PathEscape(taskID)
	_, err := call(ctx, http.MethodPut, path, apiKey, map[string]int{"ttlSeconds": ttlSeconds})
	return err
}

func Machines(ctx context.Context, apiKey string) ([]Machine, error) {
	data, err := call(ctx, http.MethodGet, "/v1/machines", apiKey, nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		Machines []Machine `json:"machines"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("解析机器列表失败: %w", err)
	}
	return out.Machines, nil
}
