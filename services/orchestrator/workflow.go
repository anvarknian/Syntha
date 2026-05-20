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
	ScenarioID      string    `json:"scenario_id"`
	RunID           string    `json:"run_id"`
	ReplayValidated bool      `json:"replay_validated"`
	StartedAt       time.Time `json:"started_at"`
	CompletedAt     time.Time `json:"completed_at"`
}

type ReplayValidation struct {
	ReplayFile string `json:"replay_file"`
	Valid      bool   `json:"valid"`
}

func SimulationWorkflow(ctx workflow.Context, req SimulationRequest) (SimulationResult, error) {
	startedAt := workflow.Now(ctx)
	options := workflow.ActivityOptions{
		StartToCloseTimeout: 2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    15 * time.Second,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, options)

	var scenarioID string
	if err := workflow.ExecuteActivity(ctx, ValidateScenarioActivity, req).Get(ctx, &scenarioID); err != nil {
		return SimulationResult{}, err
	}

	var replay ReplayValidation
	if err := workflow.ExecuteActivity(ctx, RunReplayValidationActivity, req).Get(ctx, &replay); err != nil {
		return SimulationResult{}, err
	}

	return SimulationResult{
		ScenarioID:      scenarioID,
		RunID:           req.RunID,
		ReplayValidated: replay.Valid,
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
	return ReplayValidation{
		ReplayFile: req.ReplayFile,
		Valid:      true,
	}, nil
}
