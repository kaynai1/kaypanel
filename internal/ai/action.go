package ai

import (
	"encoding/json"
	"regexp"
	"strings"
)

// Action is an operation proposed by the model. It is only a proposal: the
// panel decides whether the type/target is allowed and builds the command.
type Action struct {
	Type   string `json:"type"`
	Target string `json:"target,omitempty"`
	Reason string `json:"reason,omitempty"`
}

var (
	actionsTagRe = regexp.MustCompile(`(?s)<actions>\s*(.*?)\s*</actions>`)
	fenceRe      = regexp.MustCompile("(?s)```[A-Za-z0-9_-]*\\s*\\n?(.*?)```")
	emptyFenceRe = regexp.MustCompile("(?s)```[A-Za-z0-9_-]*\\s*```")
)

// ParseActions removes the action block from the model reply and returns the
// parsed proposals. Both <actions>[...]</actions> and a fenced JSON object
// {"actions":[...]} are accepted; anything that does not parse is ignored.
func ParseActions(reply string) (string, []Action) {
	clean := reply
	var actions []Action
	if m := actionsTagRe.FindStringSubmatch(clean); len(m) == 2 {
		actions = decodeActions(m[1])
		clean = actionsTagRe.ReplaceAllStringFunc(clean, func(string) string { return "" })
	} else {
		clean = fenceRe.ReplaceAllStringFunc(clean, func(block string) string {
			if actions != nil {
				return block
			}
			body := fenceRe.FindStringSubmatch(block)[1]
			list := decodeActions(body)
			if len(list) == 0 {
				return block
			}
			actions = list
			return ""
		})
	}
	clean = emptyFenceRe.ReplaceAllString(clean, "")
	return strings.TrimSpace(clean), actions
}

func decodeActions(body string) []Action {
	body = strings.TrimSpace(body)
	if body == "" {
		return nil
	}
	var wrapped struct {
		Actions []Action `json:"actions"`
	}
	if json.Unmarshal([]byte(body), &wrapped) == nil && len(wrapped.Actions) > 0 {
		return wrapped.Actions
	}
	var list []Action
	if json.Unmarshal([]byte(body), &list) == nil && len(list) > 0 {
		return list
	}
	return nil
}

// NormalizeActions keeps only known, syntactically valid proposals.
func NormalizeActions(in []Action, validTarget func(string) bool) []Action {
	out := make([]Action, 0, len(in))
	for _, a := range in {
		a.Type = strings.TrimSpace(a.Type)
		a.Target = strings.TrimSpace(a.Target)
		a.Reason = strings.TrimSpace(a.Reason)
		switch a.Type {
		case "container_restart", "container_logs":
			if a.Target == "" || (validTarget != nil && !validTarget(a.Target)) {
				continue
			}
		case "disk_usage", "disk_clean":
			a.Target = ""
		default:
			continue
		}
		if r := []rune(a.Reason); len(r) > 120 {
			a.Reason = string(r[:120]) + "…"
		}
		out = append(out, a)
		if len(out) == 3 {
			break
		}
	}
	return out
}
