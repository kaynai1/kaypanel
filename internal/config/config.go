package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/crypto/bcrypt"
	"gopkg.in/yaml.v3"
)

type Node struct {
	ID           string `yaml:"id" json:"id"`
	Name         string `yaml:"name" json:"name"`
	Addr         string `yaml:"addr" json:"addr"`
	User         string `yaml:"user" json:"user"`
	AuthType     string `yaml:"auth_type" json:"auth_type"`
	PrivateKey   string `yaml:"private_key,omitempty" json:"-"`
	Password     string `yaml:"password,omitempty" json:"-"`
	Sudo         bool   `yaml:"sudo" json:"sudo"`
	SudoPassword string `yaml:"sudo_password,omitempty" json:"-"`
	FileRoot     string `yaml:"file_root" json:"file_root"`
	StacksDir    string `yaml:"stacks_dir" json:"stacks_dir"`
	HostKey      string `yaml:"host_key,omitempty" json:"host_key"`
	SkipHostKey  bool   `yaml:"skip_host_key,omitempty" json:"skip_host_key"`
	CreatedAt    string `yaml:"created_at,omitempty" json:"created_at"`
}

type Settings struct {
	CPUAlert  int `yaml:"cpu_alert" json:"cpu_alert"`
	MemAlert  int `yaml:"mem_alert" json:"mem_alert"`
	DiskAlert int `yaml:"disk_alert" json:"disk_alert"`
}

type Config struct {
	Listen        string   `yaml:"listen"`
	PasswordHash  string   `yaml:"password_hash"`
	SessionSecret string   `yaml:"session_secret"`
	Nodes         []Node   `yaml:"nodes"`
	Settings      Settings `yaml:"settings"`
}

type Store struct {
	mu   sync.RWMutex
	path string
	cfg  Config
}

func Open(path string) (*Store, string, error) {
	s := &Store{path: path}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, "", err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, "", err
		}
		pw := os.Getenv("KAYPANEL_PASSWORD")
		if pw == "" {
			pw = RandomPassword(14)
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
		if err != nil {
			return nil, "", err
		}
		s.cfg = Config{
			Listen:        ":8080",
			PasswordHash:  string(hash),
			SessionSecret: RandomHex(32),
			Settings:      Settings{CPUAlert: 90, MemAlert: 90, DiskAlert: 90},
		}
		if err := s.saveLocked(); err != nil {
			return nil, "", err
		}
		return s, pw, nil
	}
	if err := yaml.Unmarshal(b, &s.cfg); err != nil {
		return nil, "", fmt.Errorf("解析配置失败: %w", err)
	}
	changed := false
	if s.cfg.Listen == "" {
		s.cfg.Listen = ":8080"
		changed = true
	}
	if s.cfg.SessionSecret == "" {
		s.cfg.SessionSecret = RandomHex(32)
		changed = true
	}
	if s.cfg.Settings.CPUAlert == 0 {
		s.cfg.Settings.CPUAlert = 90
		changed = true
	}
	if s.cfg.Settings.MemAlert == 0 {
		s.cfg.Settings.MemAlert = 90
		changed = true
	}
	if s.cfg.Settings.DiskAlert == 0 {
		s.cfg.Settings.DiskAlert = 90
		changed = true
	}
	if changed {
		if err := s.saveLocked(); err != nil {
			return nil, "", err
		}
	}
	return s, "", nil
}

func (s *Store) Listen() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg.Listen
}

func (s *Store) SessionSecret() []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return []byte(s.cfg.SessionSecret)
}

func (s *Store) CheckPassword(pw string) bool {
	s.mu.RLock()
	hash := s.cfg.PasswordHash
	s.mu.RUnlock()
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func (s *Store) SetPassword(pw string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.PasswordHash = string(hash)
	return s.saveLocked()
}

func (s *Store) Settings() Settings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg.Settings
}

func (s *Store) SetSettings(v Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Settings = v
	return s.saveLocked()
}

func (s *Store) Nodes() []Node {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Node, len(s.cfg.Nodes))
	copy(out, s.cfg.Nodes)
	return out
}

func (s *Store) SetNodes(nodes []Node) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg.Nodes = nodes
	return s.saveLocked()
}

func (s *Store) SetNodeHostKey(id, fp string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.cfg.Nodes {
		if s.cfg.Nodes[i].ID == id {
			if s.cfg.Nodes[i].HostKey == fp {
				return
			}
			s.cfg.Nodes[i].HostKey = fp
			_ = s.saveLocked()
			return
		}
	}
}

func (s *Store) saveLocked() error {
	b, err := yaml.Marshal(&s.cfg)
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func RandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", os.Getpid())
	}
	return hex.EncodeToString(b)
}

func RandomPassword(n int) string {
	const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return RandomHex(8)
	}
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return string(b)
}
