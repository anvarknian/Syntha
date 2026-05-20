package main

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.temporal.io/sdk/testsuite"
)

func TestSimulationWorkflowCompletes(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(SimulationWorkflow)
	env.RegisterActivity(ValidateScenarioActivity)
	env.RegisterActivity(RunReplayValidationActivity)

	req := SimulationRequest{
		ScenarioID: "scenario-123",
		ReplayFile: "data/replays/test-replay.jsonl",
		AgentID:    "agent-1",
		RunID:      "run-123",
	}
	env.ExecuteWorkflow(SimulationWorkflow, req)

	require.True(t, env.IsWorkflowCompleted())
	require.NoError(t, env.GetWorkflowError())

	var result SimulationResult
	require.NoError(t, env.GetWorkflowResult(&result))
	require.Equal(t, "scenario-123", result.ScenarioID)
	require.Equal(t, "run-123", result.RunID)
	require.True(t, result.ReplayValidated)
}

func TestSimulationWorkflowRejectsMissingRunID(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflow(SimulationWorkflow)
	env.RegisterActivity(ValidateScenarioActivity)
	env.RegisterActivity(RunReplayValidationActivity)

	req := SimulationRequest{
		ScenarioID: "scenario-123",
		ReplayFile: "data/replays/test-replay.jsonl",
	}
	env.ExecuteWorkflow(SimulationWorkflow, req)

	require.True(t, env.IsWorkflowCompleted())
	require.Error(t, env.GetWorkflowError())
}
