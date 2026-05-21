package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

func TestSimulationWorkflowCompletes(t *testing.T) {
	t.Setenv("FAKE_GMAIL_URL", "http://fake-gmail:3001")
	t.Setenv("FAKE_SLACK_URL", "http://fake-slack:3002")
	t.Setenv("FAKE_JIRA_URL", "http://fake-jira:3003")
	t.Setenv("FAKE_SALESFORCE_URL", "http://fake-salesforce:3004")

	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(SimulationWorkflow)
	env.RegisterActivity(ValidateScenarioActivity)
	env.RegisterActivity(BuildExecutionPlanActivity)
	env.RegisterActivity(RunPreflightChecksActivity)
	env.RegisterActivity(RunReplayValidationActivity)
	env.RegisterActivity(AnalyzeReplayCoverageActivity)
	env.RegisterActivity(EvaluateRunRiskActivity)

	req := SimulationRequest{
		ScenarioID: "scenario-123",
		ReplayFile: sampleReplayPath(t),
		AgentID:    "agent-1",
		RunID:      "run-sample",
	}
	env.ExecuteWorkflow(SimulationWorkflow, req)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result SimulationResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "scenario-123", result.ScenarioID)
	require.Equal(t, "run-sample", result.RunID)
	require.True(t, result.ReplayValidated)
	require.Equal(t, "completed", result.Status.Stage)
	require.Equal(t, 100, result.Status.Progress)
	require.Equal(t, "low", result.Risk.Level)
	require.GreaterOrEqual(t, result.Coverage.TotalEvents, 2)
	require.Contains(t, result.Plan.Targets, "browser-worker")
}

func TestSimulationWorkflowRejectsMissingRunID(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(SimulationWorkflow)
	env.RegisterActivity(ValidateScenarioActivity)
	env.RegisterActivity(BuildExecutionPlanActivity)
	env.RegisterActivity(RunPreflightChecksActivity)
	env.RegisterActivity(RunReplayValidationActivity)
	env.RegisterActivity(AnalyzeReplayCoverageActivity)
	env.RegisterActivity(EvaluateRunRiskActivity)

	req := SimulationRequest{
		ScenarioID: "scenario-123",
		ReplayFile: sampleReplayPath(t),
	}
	env.ExecuteWorkflow(SimulationWorkflow, req)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
}

func TestRunReplayValidationActivityValid(t *testing.T) {
	summary, err := RunReplayValidationActivity(context.Background(), SimulationRequest{
		ReplayFile: sampleReplayPath(t),
		RunID:      "run-sample",
	})
	require.NoError(t, err)
	require.True(t, summary.Valid)
	require.Equal(t, "run-sample", summary.RunID)
	require.Equal(t, 2, summary.EventCount)
}

func TestRunReplayValidationActivityChecksumMismatch(t *testing.T) {
	srcPath := sampleReplayPath(t)
	raw, err := os.ReadFile(srcPath)
	require.NoError(t, err)

	lines := splitNonEmptyLines(string(raw))
	require.GreaterOrEqual(t, len(lines), 1)

	var first map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(lines[0]), &first))
	first["checksum"] = "0000000000000000000000000000000000000000000000000000000000000000"
	rewritten, err := json.Marshal(first)
	require.NoError(t, err)
	lines[0] = string(rewritten)

	tmpDir := t.TempDir()
	badReplayPath := filepath.Join(tmpDir, "bad-replay.jsonl")
	require.NoError(t, os.WriteFile(badReplayPath, []byte(joinLines(lines)), 0o644))

	_, err = RunReplayValidationActivity(context.Background(), SimulationRequest{
		ReplayFile: badReplayPath,
		RunID:      "run-sample",
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "checksum mismatch")
}

func TestBuildExecutionPlanActivityInfersTargets(t *testing.T) {
	plan, err := BuildExecutionPlanActivity(context.Background(), SimulationRequest{
		ScenarioBody: "Route a customer case through Jira and Salesforce before notifying Slack",
		ReplayFile:   sampleReplayPath(t),
		RunID:        "run-sample",
	})
	require.NoError(t, err)
	require.Equal(t, "run-sample", plan.RunID)
	require.Contains(t, plan.Targets, "browser-worker")
	require.Contains(t, plan.Targets, "fake-jira")
	require.Contains(t, plan.Targets, "fake-salesforce")
	require.Contains(t, plan.Targets, "fake-slack")
}

func TestAnalyzeReplayCoverageActivityClassifiesDomains(t *testing.T) {
	coverage, err := AnalyzeReplayCoverageActivity(context.Background(), SimulationRequest{
		ReplayFile: sampleReplayPath(t),
	})
	require.NoError(t, err)
	require.Equal(t, 2, coverage.TotalEvents)
	require.Equal(t, 2, coverage.UniqueKinds)
	require.Equal(t, 1, coverage.DomainCount["browser"])
	require.Equal(t, 1, coverage.DomainCount["saas"])
	require.Equal(t, 0, coverage.DomainCount["unknown"])
}

func TestEvaluateRunRiskActivityEscalatesWithWarnings(t *testing.T) {
	risk, err := EvaluateRunRiskActivity(context.Background(), RiskAssessmentInput{
		Preflight: PreflightSummary{
			Warnings: []string{"missing URL for target fake-jira"},
		},
		Replay: ReplayValidation{
			EventCount: 1,
			Valid:      true,
		},
		Coverage: ReplayCoverage{
			UniqueKinds: 1,
			DomainCount: map[string]int{"unknown": 1},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "high", risk.Level)
	require.NotEmpty(t, risk.Reasons)
}

func sampleReplayPath(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	require.NoError(t, err)
	path := filepath.Join(wd, "..", "..", "data", "replays", "test-replay.jsonl")
	_, err = os.Stat(path)
	require.NoError(t, err)
	return path
}

func splitNonEmptyLines(s string) []string {
	raw := strings.Split(s, "\n")
	out := make([]string, 0, len(raw))
	for _, line := range raw {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		out = append(out, line)
	}
	return out
}

func joinLines(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n") + "\n"
}
