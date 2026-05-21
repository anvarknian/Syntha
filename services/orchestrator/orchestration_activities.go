package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

type ExecutionPlan struct {
	RunID         string   `json:"run_id"`
	ReplayFile    string   `json:"replay_file"`
	ScenarioID    string   `json:"scenario_id"`
	Targets       []string `json:"targets"`
	ExpectedKinds []string `json:"expected_kinds"`
	PlannedAt     string   `json:"planned_at"`
}

type PreflightSummary struct {
	ReplayFile string            `json:"replay_file"`
	CheckedAt  string            `json:"checked_at"`
	TargetURLs map[string]string `json:"target_urls"`
	Warnings   []string          `json:"warnings"`
}

type ReplayCoverage struct {
	TotalEvents int            `json:"total_events"`
	UniqueKinds int            `json:"unique_kinds"`
	DomainCount map[string]int `json:"domain_count"`
	KindCount   map[string]int `json:"kind_count"`
}

type RiskAssessmentInput struct {
	Preflight PreflightSummary `json:"preflight"`
	Replay    ReplayValidation `json:"replay"`
	Coverage  ReplayCoverage   `json:"coverage"`
}

type RiskAssessment struct {
	Level   string   `json:"level"`
	Reasons []string `json:"reasons"`
}

func BuildExecutionPlanActivity(ctx context.Context, req SimulationRequest) (ExecutionPlan, error) {
	if req.RunID == "" {
		return ExecutionPlan{}, errors.New("run_id is required")
	}
	if req.ReplayFile == "" {
		return ExecutionPlan{}, errors.New("replay_file is required")
	}

	targetSet := map[string]struct{}{
		"browser-worker": {},
	}
	kindCounts, err := summarizeReplayKinds(ctx, req.ReplayFile)
	if err != nil {
		return ExecutionPlan{}, err
	}
	for kind := range kindCounts {
		switch classifyReplayKindDomain(kind) {
		case "saas":
			if strings.Contains(kind, "slack") || strings.Contains(kind, "channel") {
				targetSet["fake-slack"] = struct{}{}
			}
			if strings.Contains(kind, "email") || strings.Contains(kind, "gmail") {
				targetSet["fake-gmail"] = struct{}{}
			}
			if strings.Contains(kind, "jira") {
				targetSet["fake-jira"] = struct{}{}
			}
			if strings.Contains(kind, "salesforce") || strings.Contains(kind, "case") {
				targetSet["fake-salesforce"] = struct{}{}
			}
		case "browser":
			targetSet["browser-worker"] = struct{}{}
		}
	}

	addScenarioTargets(targetSet, strings.ToLower(req.ScenarioBody))
	targets := sortedKeys(targetSet)
	expectedKinds := sortedKeys(kindCounts)

	return ExecutionPlan{
		RunID:         req.RunID,
		ReplayFile:    req.ReplayFile,
		ScenarioID:    req.ScenarioID,
		Targets:       targets,
		ExpectedKinds: expectedKinds,
		PlannedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func addScenarioTargets(targetSet map[string]struct{}, scenario string) {
	if scenario == "" {
		return
	}
	if strings.Contains(scenario, "slack") {
		targetSet["fake-slack"] = struct{}{}
	}
	if strings.Contains(scenario, "gmail") || strings.Contains(scenario, "email") {
		targetSet["fake-gmail"] = struct{}{}
	}
	if strings.Contains(scenario, "jira") {
		targetSet["fake-jira"] = struct{}{}
	}
	if strings.Contains(scenario, "salesforce") || strings.Contains(scenario, "case") {
		targetSet["fake-salesforce"] = struct{}{}
	}
}

func RunPreflightChecksActivity(_ context.Context, plan ExecutionPlan) (PreflightSummary, error) {
	if plan.RunID == "" {
		return PreflightSummary{}, errors.New("plan.run_id is required")
	}
	if plan.ReplayFile == "" {
		return PreflightSummary{}, errors.New("plan.replay_file is required")
	}
	if _, err := os.Stat(plan.ReplayFile); err != nil {
		return PreflightSummary{}, fmt.Errorf("replay file is not accessible: %w", err)
	}

	urlVars := map[string]string{
		"browser-worker":  os.Getenv("BROWSER_WORKER_URL"),
		"fake-gmail":      os.Getenv("FAKE_GMAIL_URL"),
		"fake-slack":      os.Getenv("FAKE_SLACK_URL"),
		"fake-jira":       os.Getenv("FAKE_JIRA_URL"),
		"fake-salesforce": os.Getenv("FAKE_SALESFORCE_URL"),
		"api":             os.Getenv("SYNTHA_API_URL"),
	}
	targetURLs := map[string]string{}
	warnings := make([]string, 0)
	for _, target := range plan.Targets {
		raw, ok := urlVars[target]
		if !ok || strings.TrimSpace(raw) == "" {
			if target == "browser-worker" {
				continue
			}
			warnings = append(warnings, fmt.Sprintf("missing URL for target %s", target))
			continue
		}
		parsed, err := url.Parse(raw)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return PreflightSummary{}, fmt.Errorf("invalid URL for target %s: %q", target, raw)
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return PreflightSummary{}, fmt.Errorf("unsupported URL scheme for target %s: %q", target, raw)
		}
		targetURLs[target] = raw
	}

	return PreflightSummary{
		ReplayFile: plan.ReplayFile,
		CheckedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		TargetURLs: targetURLs,
		Warnings:   warnings,
	}, nil
}

func AnalyzeReplayCoverageActivity(ctx context.Context, req SimulationRequest) (ReplayCoverage, error) {
	if req.ReplayFile == "" {
		return ReplayCoverage{}, errors.New("replay_file is required")
	}
	kindCounts, err := summarizeReplayKinds(ctx, req.ReplayFile)
	if err != nil {
		return ReplayCoverage{}, err
	}

	domainCount := map[string]int{
		"browser": 0,
		"saas":    0,
		"api":     0,
		"unknown": 0,
	}
	total := 0
	for kind, count := range kindCounts {
		total += count
		domainCount[classifyReplayKindDomain(kind)] += count
	}

	return ReplayCoverage{
		TotalEvents: total,
		UniqueKinds: len(kindCounts),
		DomainCount: domainCount,
		KindCount:   kindCounts,
	}, nil
}

func EvaluateRunRiskActivity(_ context.Context, in RiskAssessmentInput) (RiskAssessment, error) {
	if !in.Replay.Valid {
		return RiskAssessment{Level: "high", Reasons: []string{"replay validation did not complete"}}, nil
	}

	reasons := make([]string, 0)
	level := "low"

	if len(in.Preflight.Warnings) > 0 {
		level = "medium"
		reasons = append(reasons, fmt.Sprintf("preflight emitted %d warning(s)", len(in.Preflight.Warnings)))
	}
	if in.Coverage.UniqueKinds < 2 {
		if level == "low" {
			level = "medium"
		}
		reasons = append(reasons, "low event-kind diversity in replay")
	}
	if in.Coverage.DomainCount["unknown"] > 0 {
		if level == "low" {
			level = "medium"
		}
		reasons = append(reasons, "replay contains unknown event domains")
	}
	if in.Replay.EventCount < 2 {
		level = "high"
		reasons = append(reasons, "insufficient replay coverage (fewer than 2 events)")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "no elevated replay or preflight risks detected")
	}
	sort.Strings(reasons)
	return RiskAssessment{Level: level, Reasons: reasons}, nil
}

func classifyReplayKindDomain(kind string) string {
	k := strings.ToLower(kind)
	switch {
	case strings.Contains(k, "playwright") || strings.Contains(k, "browser") || strings.Contains(k, "dom"):
		return "browser"
	case strings.Contains(k, "scenario") || strings.Contains(k, "api"):
		return "api"
	case strings.Contains(k, "gmail"),
		strings.Contains(k, "email"),
		strings.Contains(k, "slack"),
		strings.Contains(k, "channel"),
		strings.Contains(k, "jira"),
		strings.Contains(k, "salesforce"),
		strings.Contains(k, "case"):
		return "saas"
	default:
		return "unknown"
	}
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
