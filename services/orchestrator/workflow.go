package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const DefaultTaskQueue = "syntha-simulation"

type SimulationRequest struct {
	ScenarioID   string `json:"scenario_id"`
	ScenarioBody string `json:"scenario_body"`
	ReplayFile   string `json:"replay_file"`
	AgentID      string `json:"agent_id"`
	RunID        string `json:"run_id"`
}

type SimulationResult struct {
	ScenarioID      string           `json:"scenario_id"`
	RunID           string           `json:"run_id"`
	ReplayValidated bool             `json:"replay_validated"`
	Plan            ExecutionPlan    `json:"plan"`
	Preflight       PreflightSummary `json:"preflight"`
	Coverage        ReplayCoverage   `json:"coverage"`
	Risk            RiskAssessment   `json:"risk"`
	Status          SimulationStatus `json:"status"`
	StartedAt       time.Time        `json:"started_at"`
	CompletedAt     time.Time        `json:"completed_at"`
}

type ReplayValidation struct {
	ReplayFile string `json:"replay_file"`
	RunID      string `json:"run_id"`
	EventCount int    `json:"event_count"`
	Valid      bool   `json:"valid"`
}

type SimulationStatus struct {
	Stage      string    `json:"stage"`
	Progress   int       `json:"progress"`
	StartedAt  time.Time `json:"started_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	ScenarioID string    `json:"scenario_id"`
	RunID      string    `json:"run_id"`
}

func SimulationWorkflow(ctx workflow.Context, req SimulationRequest) (SimulationResult, error) {
	startedAt := workflow.Now(ctx)
	status := SimulationStatus{
		Stage:     "initializing",
		Progress:  5,
		StartedAt: startedAt,
		UpdatedAt: startedAt,
		RunID:     req.RunID,
	}

	if err := workflow.SetQueryHandler(ctx, "simulation_status", func() (SimulationStatus, error) {
		return status, nil
	}); err != nil {
		return SimulationResult{}, fmt.Errorf("register simulation_status query: %w", err)
	}

	updateStatus := func(stage string, progress int, scenarioID string) {
		status.Stage = stage
		status.Progress = progress
		status.UpdatedAt = workflow.Now(ctx)
		status.ScenarioID = scenarioID
	}

	defaultOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    15 * time.Second,
			MaximumAttempts:    3,
		},
	}
	fastOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 45 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    500 * time.Millisecond,
			BackoffCoefficient: 2,
			MaximumInterval:    5 * time.Second,
			MaximumAttempts:    2,
		},
	}

	updateStatus("validating_scenario", 15, "")
	var scenarioID string
	if err := workflow.ExecuteActivity(workflow.WithActivityOptions(ctx, fastOptions), ValidateScenarioActivity, req).Get(ctx, &scenarioID); err != nil {
		return SimulationResult{}, err
	}
	updateStatus("planning_execution", 30, scenarioID)

	var plan ExecutionPlan
	if err := workflow.ExecuteActivity(workflow.WithActivityOptions(ctx, fastOptions), BuildExecutionPlanActivity, req).Get(ctx, &plan); err != nil {
		return SimulationResult{}, err
	}

	updateStatus("running_preflight", 45, scenarioID)
	var preflight PreflightSummary
	if err := workflow.ExecuteActivity(workflow.WithActivityOptions(ctx, fastOptions), RunPreflightChecksActivity, plan).Get(ctx, &preflight); err != nil {
		return SimulationResult{}, err
	}

	updateStatus("replay_and_coverage_validation", 65, scenarioID)
	validationCtx := workflow.WithActivityOptions(ctx, defaultOptions)
	replayFuture := workflow.ExecuteActivity(validationCtx, RunReplayValidationActivity, req)
	coverageFuture := workflow.ExecuteActivity(validationCtx, AnalyzeReplayCoverageActivity, req)

	var replay ReplayValidation
	if err := replayFuture.Get(ctx, &replay); err != nil {
		return SimulationResult{}, err
	}

	var coverage ReplayCoverage
	if err := coverageFuture.Get(ctx, &coverage); err != nil {
		return SimulationResult{}, err
	}

	updateStatus("risk_assessment", 85, scenarioID)
	var risk RiskAssessment
	if err := workflow.ExecuteActivity(workflow.WithActivityOptions(ctx, fastOptions), EvaluateRunRiskActivity, RiskAssessmentInput{
		Preflight: preflight,
		Replay:    replay,
		Coverage:  coverage,
	}).Get(ctx, &risk); err != nil {
		return SimulationResult{}, err
	}

	updateStatus("completed", 100, scenarioID)
	return SimulationResult{
		ScenarioID:      scenarioID,
		RunID:           req.RunID,
		ReplayValidated: replay.Valid,
		Plan:            plan,
		Preflight:       preflight,
		Coverage:        coverage,
		Risk:            risk,
		Status:          status,
		StartedAt:       startedAt,
		CompletedAt:     workflow.Now(ctx),
	}, nil
}

func ValidateScenarioActivity(ctx context.Context, req SimulationRequest) (string, error) {
	if req.ScenarioID == "" && req.ScenarioBody == "" {
		return "", errors.New("scenario_id or scenario_body is required")
	}
	if req.RunID == "" {
		return "", errors.New("run_id is required")
	}
	if req.ScenarioID != "" {
		return req.ScenarioID, nil
	}
	return fmt.Sprintf("scenario-%d", time.Now().UTC().UnixNano()), nil
}

func RunReplayValidationActivity(ctx context.Context, req SimulationRequest) (ReplayValidation, error) {
	if req.ReplayFile == "" {
		return ReplayValidation{}, errors.New("replay_file is required")
	}
	summary, err := validateReplayFile(ctx, req.ReplayFile)
	if err != nil {
		return ReplayValidation{}, err
	}
	if req.RunID != "" && summary.RunID != req.RunID {
		return ReplayValidation{}, fmt.Errorf("run_id mismatch: request=%s replay=%s", req.RunID, summary.RunID)
	}
	return ReplayValidation{
		ReplayFile: req.ReplayFile,
		RunID:      summary.RunID,
		EventCount: summary.EventCount,
		Valid:      true,
	}, nil
}
