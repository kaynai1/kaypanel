package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

var client = &http.Client{Timeout: 120 * time.Second}
var modelClient = &http.Client{Timeout: 20 * time.Second}

func endpoint(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	return base + "/chat/completions"
}

func Chat(ctx context.Context, base, key, model string, messages []Message) (string, error) {
	return ChatTokens(ctx, base, key, model, messages, 1500)
}

func ChatTokens(ctx context.Context, base, key, model string, messages []Message, maxTokens int) (string, error) {
	if strings.TrimSpace(base) == "" || strings.TrimSpace(key) == "" || strings.TrimSpace(model) == "" {
		return "", fmt.Errorf("AI 助手尚未配置，请先在设置中填写 Base URL、模型和 API Key")
	}
	if maxTokens <= 0 {
		maxTokens = 1500
	}
	body, err := json.Marshal(map[string]any{
		"model":       model,
		"messages":    messages,
		"temperature": 0.3,
		"max_tokens":  maxTokens,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint(base), bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 AI 服务失败: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("AI 服务返回 HTTP %d: %s", res.StatusCode, snippet(raw))
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("无法解析 AI 响应: %v", err)
	}
	if out.Error != nil && out.Error.Message != "" {
		return "", fmt.Errorf("%s", out.Error.Message)
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("AI 返回内容为空")
	}
	return strings.TrimSpace(out.Choices[0].Message.Content), nil
}

func modelsEndpoint(base string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if strings.HasSuffix(base, "/chat/completions") {
		base = strings.TrimSuffix(base, "/chat/completions")
	}
	return base + "/models"
}

func Models(ctx context.Context, base, key string) ([]string, error) {
	if strings.TrimSpace(base) == "" {
		return nil, fmt.Errorf("请先填写 Base URL")
	}
	if strings.TrimSpace(key) == "" {
		return nil, fmt.Errorf("请先填写 API Key")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsEndpoint(base), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")
	res, err := modelClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求模型列表失败: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("模型列表返回 HTTP %d: %s", res.StatusCode, snippet(raw))
	}
	var out struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
		Models []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("无法解析模型列表: %v", err)
	}
	seen := map[string]bool{}
	list := make([]string, 0, len(out.Data)+len(out.Models))
	add := func(v string) {
		v = strings.TrimSpace(v)
		if v != "" && !seen[v] {
			seen[v] = true
			list = append(list, v)
		}
	}
	for _, m := range out.Data {
		if m.ID != "" {
			add(m.ID)
		} else {
			add(m.Name)
		}
	}
	for _, m := range out.Models {
		if m.ID != "" {
			add(m.ID)
		} else {
			add(m.Name)
		}
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("接口未返回模型列表")
	}
	sort.Strings(list)
	return list, nil
}

func snippet(b []byte) string {
	s := strings.TrimSpace(string(b))
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}
