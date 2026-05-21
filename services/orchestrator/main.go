package main

import (
	"log"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	hostPort := os.Getenv("TEMPORAL_ADDRESS")
	if hostPort == "" {
		hostPort = "temporal:7233"
	}
	taskQueue := os.Getenv("TEMPORAL_TASK_QUEUE")
	if taskQueue == "" {
		taskQueue = DefaultTaskQueue
	}

	c, err := client.Dial(client.Options{HostPort: hostPort})
	if err != nil {
		log.Fatalf("temporal dial failed: %v", err)
	}
	defer c.Close()

	w := worker.New(c, taskQueue, worker.Options{})
	w.RegisterWorkflow(SimulationWorkflow)
	w.RegisterActivity(ValidateScenarioActivity)
	w.RegisterActivity(BuildExecutionPlanActivity)
	w.RegisterActivity(RunPreflightChecksActivity)
	w.RegisterActivity(RunReplayValidationActivity)
	w.RegisterActivity(AnalyzeReplayCoverageActivity)
	w.RegisterActivity(EvaluateRunRiskActivity)

	log.Printf("syntha-orchestrator listening on task queue %q via %s", taskQueue, hostPort)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatalf("temporal worker exited: %v", err)
	}
}
