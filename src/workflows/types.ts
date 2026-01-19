/**
 * Workflow engine types
 */

import type { Span } from '../tracing/tracer.js';

export interface WorkflowStepExecution {
  stepId: string;
  status: 'ok' | 'error';
  startedAt: number;
  endedAt: number;
  error?: string;
}

export interface WorkflowStepResult<TState = Record<string, unknown>, TResult = unknown> {
  nextStepId?: string;
  output?: TResult;
  state?: Partial<TState>;
  done?: boolean;
  metadata?: Record<string, unknown>;
}

export interface WorkflowContext<TState = Record<string, unknown>, TResult = unknown> {
  state: TState;
  stepId: string;
  stepIndex: number;
  steps: WorkflowStepExecution[];
  parentSpan?: Span;
}

export type WorkflowStep<TState = Record<string, unknown>, TResult = unknown> = (
  context: WorkflowContext<TState, TResult>
) => Promise<WorkflowStepResult<TState, TResult>>;

export interface WorkflowDefinition<TState = Record<string, unknown>, TResult = unknown> {
  id: string;
  start: string;
  steps: Record<string, WorkflowStep<TState, TResult>>;
  onErrorStepId?: string;
  maxSteps?: number;
}

export interface WorkflowRunResult<TState = Record<string, unknown>, TResult = unknown> {
  status: 'completed' | 'failed' | 'max_steps_exceeded';
  output?: TResult;
  state: TState;
  steps: WorkflowStepExecution[];
  error?: Error;
}

export interface WorkflowEngineOptions {
  tracer?: {
    startSpan: (name: string, attributes?: Record<string, unknown>) => Span;
  };
  maxSteps?: number;
}
