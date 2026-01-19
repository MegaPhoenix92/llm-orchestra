/**
 * Workflow engine
 */

import type { Tracer } from '../tracing/tracer.js';
import type {
  WorkflowContext,
  WorkflowDefinition,
  WorkflowEngineOptions,
  WorkflowRunResult,
  WorkflowStepExecution,
} from './types.js';

const DEFAULT_MAX_STEPS = 100;

export class WorkflowEngine<TState = Record<string, unknown>, TResult = unknown> {
  private definition: WorkflowDefinition<TState, TResult>;
  private tracer?: Tracer;
  private maxSteps: number;

  constructor(definition: WorkflowDefinition<TState, TResult>, options?: WorkflowEngineOptions) {
    this.definition = definition;
    this.tracer = options?.tracer as Tracer | undefined;
    this.maxSteps = options?.maxSteps ?? definition.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  async run(initialState: TState): Promise<WorkflowRunResult<TState, TResult>> {
    let state = { ...initialState };
    let stepId = this.definition.start;
    let output: TResult | undefined;
    let error: Error | undefined;
    let status: WorkflowRunResult<TState, TResult>['status'] = 'completed';
    const steps: WorkflowStepExecution[] = [];

    const runSpan = this.tracer?.startSpan('workflow.run', {
      'workflow.id': this.definition.id,
    });

    for (let stepIndex = 0; stepIndex < this.maxSteps; stepIndex++) {
      const step = this.definition.steps[stepId];
      if (!step) {
        error = new Error(`Unknown workflow step: ${stepId}`);
        status = 'failed';
        break;
      }

      const stepSpan = runSpan?.startChild(`workflow.step:${stepId}`, {
        'workflow.step': stepId,
        'workflow.step_index': stepIndex,
      });

      const startedAt = Date.now();
      try {
        const context: WorkflowContext<TState, TResult> = {
          state,
          stepId,
          stepIndex,
          steps,
          parentSpan: runSpan,
        };
        const result = await step(context);

        if (result?.state) {
          state = { ...state, ...result.state };
        }
        if (result?.output !== undefined) {
          output = result.output;
        }

        steps.push({
          stepId,
          status: 'ok',
          startedAt,
          endedAt: Date.now(),
        });

        stepSpan?.setStatus('ok');
        if (result?.metadata) {
          stepSpan?.setAttributes(result.metadata);
        }

        if (result?.done) {
          status = 'completed';
          break;
        }

        if (!result?.nextStepId) {
          throw new Error(`Step ${stepId} did not provide nextStepId or done`);
        }

        stepId = result.nextStepId;
      } catch (err) {
        const caught = err as Error;
        steps.push({
          stepId,
          status: 'error',
          startedAt,
          endedAt: Date.now(),
          error: caught.message,
        });

        stepSpan?.recordException(caught);
        stepSpan?.setStatus('error');

        error = caught;

        if (this.definition.onErrorStepId && stepId !== this.definition.onErrorStepId) {
          stepId = this.definition.onErrorStepId;
          continue;
        }

        status = 'failed';
        break;
      } finally {
        stepSpan?.end();
      }
    }

    if (steps.length >= this.maxSteps && status === 'completed') {
      status = 'max_steps_exceeded';
      error = new Error(`Max steps (${this.maxSteps}) exceeded`);
    }

    runSpan?.setAttributes({
      'workflow.status': status,
      'workflow.steps.count': steps.length,
    });
    runSpan?.setStatus(status === 'completed' ? 'ok' : 'error');
    runSpan?.end();

    return {
      status,
      output,
      state,
      steps,
      error: status === 'completed' ? undefined : error,
    };
  }
}
