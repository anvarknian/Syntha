package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultAPIURL     = "http://localhost:8080"
	defaultTimeoutSec = 30
)

type scenarioSuccess struct {
	ScenarioID string `json:"scenario_id"`
	Seed       int64  `json:"seed"`
	CreatedAt  string `json:"created_at"`
}

type apiError struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeoutSec*time.Second)
	defer cancel()

	var err error
	switch os.Args[1] {
	case "world":
		err = runWorld(ctx, os.Args[2:])
	case "browsers":
		err = runBrowsers(ctx, os.Args[2:])
	case "eval":
		err = runEval(ctx, os.Args[2:])
	case "help", "-h", "--help":
		printUsage()
		return
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Print(`syntha CLI

Usage:
  syntha world create <company> [--api-url URL] [--json]
  syntha browsers start [--target-url URL] [--run-id ID] [--json]
  syntha eval run <scenario-file> [--api-url URL] [--replay-file PATH] [--delay-ms N] [--continue-on-error] [--json]

Examples:
  syntha world create acme-corp
  syntha browsers start --target-url https://example.com
  syntha eval run data/scenarios/support-agent.yaml --replay-file data/replays/test-replay.jsonl
`)
}

func runWorld(ctx context.Context, args []string) error {
	if len(args) < 1 || args[0] != "create" {
		return errors.New("usage: syntha world create <company> [--api-url URL] [--json]")
	}

	fs := flag.NewFlagSet("world create", flag.ContinueOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "simulation API base URL")
	jsonOut := fs.Bool("json", false, "print machine-readable JSON")
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	remaining := fs.Args()
	if len(remaining) < 1 {
		return errors.New("company name is required")
	}
	company := strings.Join(remaining, " ")
	scenarioBody := buildWorldScenario(company)

	resp, raw, err := postScenario(ctx, *apiURL, []byte(scenarioBody))
	if err != nil {
		return err
	}

	if *jsonOut {
		printJSON(map[string]any{
			"command":     "world.create",
			"company":     company,
			"api_url":     strings.TrimRight(*apiURL, "/"),
			"scenario":    resp,
			"status_code": 201,
		})
		return nil
	}

	fmt.Printf("Scenario created for %q\n", company)
	fmt.Printf("scenario_id=%s seed=%d created_at=%s\n", resp.ScenarioID, resp.Seed, resp.CreatedAt)
	fmt.Printf("raw_response=%s\n", strings.TrimSpace(string(raw)))
	return nil
}

func runBrowsers(ctx context.Context, args []string) error {
	if len(args) < 1 || args[0] != "start" {
		return errors.New("usage: syntha browsers start [--target-url URL] [--run-id ID] [--json]")
	}

	fs := flag.NewFlagSet("browsers start", flag.ContinueOnError)
	targetURL := fs.String("target-url", "about:blank", "target URL for browser worker")
	runID := fs.String("run-id", "", "optional browser worker run id")
	jsonOut := fs.Bool("json", false, "print machine-readable JSON")
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	repoRoot, err := findRepoRoot(cwd)
	if err != nil {
		return err
	}
	scriptPath := filepath.Join(repoRoot, "apps", "browser-worker", "run_playwright.js")
	if _, err := os.Stat(scriptPath); err != nil {
		return fmt.Errorf("browser worker script not found at %s: %w", scriptPath, err)
	}

	cmd := exec.CommandContext(ctx, "node", scriptPath)
	cmd.Dir = filepath.Join(repoRoot, "apps", "browser-worker")
	cmd.Env = append(os.Environ(), "PLAYWRIGHT_TARGET_URL="+*targetURL)
	if *runID != "" {
		cmd.Env = append(cmd.Env, "BROWSER_WORKER_RUN_ID="+*runID)
	}

	var output bytes.Buffer
	cmd.Stdout = io.MultiWriter(os.Stdout, &output)
	cmd.Stderr = io.MultiWriter(os.Stderr, &output)

	startedAt := time.Now().UTC()
	err = cmd.Run()
	completedAt := time.Now().UTC()
	if err != nil {
		return fmt.Errorf("browser worker failed: %w", err)
	}

	if *jsonOut {
		printJSON(map[string]any{
			"command":      "browsers.start",
			"target_url":   *targetURL,
			"started_at":   startedAt.Format(time.RFC3339Nano),
			"completed_at": completedAt.Format(time.RFC3339Nano),
			"output":       strings.TrimSpace(output.String()),
		})
		return nil
	}

	fmt.Printf("Browser worker run completed target=%s\n", *targetURL)
	return nil
}

func runEval(ctx context.Context, args []string) error {
	if len(args) < 1 || args[0] != "run" {
		return errors.New("usage: syntha eval run <scenario-file> [--api-url URL] [--replay-file PATH] [--delay-ms N] [--continue-on-error] [--json]")
	}

	fs := flag.NewFlagSet("eval run", flag.ContinueOnError)
	apiURL := fs.String("api-url", defaultAPIURL, "simulation API base URL")
	replayFile := fs.String("replay-file", "", "optional replay JSONL file to validate")
	delayMS := fs.Int("delay-ms", 100, "replay delay in milliseconds")
	continueOnErr := fs.Bool("continue-on-error", false, "continue replay when an event fails")
	jsonOut := fs.Bool("json", false, "print machine-readable JSON")
	fs.SetOutput(io.Discard)
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	remaining := fs.Args()
	if len(remaining) < 1 {
		return errors.New("scenario file is required")
	}

	scenarioPath := remaining[0]
	body, err := os.ReadFile(scenarioPath)
	if err != nil {
		return fmt.Errorf("read scenario file: %w", err)
	}

	scenarioResp, raw, err := postScenario(ctx, *apiURL, body)
	if err != nil {
		return err
	}

	result := map[string]any{
		"command":       "eval.run",
		"scenario_file": scenarioPath,
		"api_url":       strings.TrimRight(*apiURL, "/"),
		"scenario":      scenarioResp,
		"api_response":  json.RawMessage(raw),
	}

	if *replayFile != "" {
		replayOutput, replayErr := runReplayValidation(ctx, *replayFile, *delayMS, *continueOnErr)
		result["replay_file"] = *replayFile
		result["replay_output"] = replayOutput
		if replayErr != nil {
			result["replay_error"] = replayErr.Error()
			printJSON(result)
			return replayErr
		}
	}

	if *jsonOut {
		printJSON(result)
		return nil
	}

	fmt.Printf("Eval scenario submitted from %s\n", scenarioPath)
	fmt.Printf("scenario_id=%s seed=%d created_at=%s\n", scenarioResp.ScenarioID, scenarioResp.Seed, scenarioResp.CreatedAt)
	if *replayFile != "" {
		fmt.Printf("Replay validation completed: %s\n", *replayFile)
	}
	return nil
}

func runReplayValidation(ctx context.Context, replayFile string, delayMS int, continueOnErr bool) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	repoRoot, err := findRepoRoot(cwd)
	if err != nil {
		return "", err
	}
	runnerPath := filepath.Join(repoRoot, "services", "replay-engine", "runner.js")
	if _, err := os.Stat(runnerPath); err != nil {
		return "", fmt.Errorf("replay runner script not found at %s: %w", runnerPath, err)
	}

	args := []string{runnerPath, replayFile, fmt.Sprintf("--delay-ms=%d", delayMS)}
	if continueOnErr {
		args = append(args, "--continue-on-error")
	}

	cmd := exec.CommandContext(ctx, "node", args...)
	cmd.Dir = repoRoot
	var output bytes.Buffer
	cmd.Stdout = io.MultiWriter(os.Stdout, &output)
	cmd.Stderr = io.MultiWriter(os.Stderr, &output)
	if err := cmd.Run(); err != nil {
		return strings.TrimSpace(output.String()), fmt.Errorf("replay validation failed: %w", err)
	}
	return strings.TrimSpace(output.String()), nil
}

func postScenario(ctx context.Context, apiURL string, payload []byte) (scenarioSuccess, []byte, error) {
	endpoint := strings.TrimRight(apiURL, "/") + "/scenario"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return scenarioSuccess{}, nil, err
	}
	req.Header.Set("Content-Type", "application/x-yaml")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return scenarioSuccess{}, nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return scenarioSuccess{}, nil, err
	}

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var parsedErr apiError
		if err := json.Unmarshal(raw, &parsedErr); err == nil && parsedErr.Error.Code != "" {
			return scenarioSuccess{}, raw, fmt.Errorf("API %d: %s (%s)", resp.StatusCode, parsedErr.Error.Message, parsedErr.Error.Code)
		}
		return scenarioSuccess{}, raw, fmt.Errorf("API %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var parsed scenarioSuccess
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return scenarioSuccess{}, raw, fmt.Errorf("decode API response: %w", err)
	}
	if parsed.ScenarioID == "" {
		return scenarioSuccess{}, raw, errors.New("API response missing scenario_id")
	}
	return parsed, raw, nil
}

func buildWorldScenario(company string) string {
	return fmt.Sprintf(`world:
  company: %s
  employees: 500
  tools:
    - Slack
    - Gmail
    - Jira
scenario:
  objective: "Synthetic world bootstrap"
  constraints:
    - no_human_help: true
    - pii_leakage: forbidden
`, company)
}

func findRepoRoot(start string) (string, error) {
	curr := start
	for {
		candidate := filepath.Join(curr, "apps", "browser-worker", "run_playwright.js")
		if _, err := os.Stat(candidate); err == nil {
			return curr, nil
		}
		next := filepath.Dir(curr)
		if next == curr {
			break
		}
		curr = next
	}
	return "", errors.New("could not locate Syntha repository root")
}

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}
