import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '../../src/workflows/engine.js';
import { Tracer } from '../../src/tracing/tracer.js';


describe('WorkflowEngine', () => {
  it('should_executeStepsInOrder_when_linearWorkflow', async () => {
    const engine = new WorkflowEngine({
      id: 'linear',
      start: 'step1',
      steps: {
        step1: async (context) => ({
          state: { count: (context.state as any).count + 1 },
          nextStepId: 'step2',
        }),
        step2: async (context) => ({
          output: (context.state as any).count + 1,
          done: true,
        }),
      },
    });

    const result = await engine.run({ count: 0 });

    expect(result.status).toBe('completed');
    expect(result.output).toBe(2);
    expect(result.steps).toHaveLength(2);
  });

  it('should_routeToErrorStep_when_stepThrows', async () => {
    const engine = new WorkflowEngine({
      id: 'error-handler',
      start: 'start',
      onErrorStepId: 'error',
      steps: {
        start: async () => {
          throw new Error('boom');
        },
        error: async () => ({
          output: 'recovered',
          done: true,
        }),
      },
    });

    const result = await engine.run({});

    expect(result.status).toBe('completed');
    expect(result.output).toBe('recovered');
    expect(result.steps[0].status).toBe('error');
  });

  it('should_stopWhen_maxStepsExceeded', async () => {
    const engine = new WorkflowEngine(
      {
        id: 'loop',
        start: 'loop',
        steps: {
          loop: async () => ({ nextStepId: 'loop' }),
        },
      },
      { maxSteps: 2 }
    );

    const result = await engine.run({});

    expect(result.status).toBe('max_steps_exceeded');
  });

  it('should_createTracingSpans_when_tracerProvided', async () => {
    const tracer = new Tracer({ enabled: true, sampleRate: 1 });
    const engine = new WorkflowEngine(
      {
        id: 'traceable',
        start: 'step1',
        steps: {
          step1: async () => ({ done: true }),
        },
      },
      { tracer }
    );

    const result = await engine.run({});
    expect(result.status).toBe('completed');

    const spans = tracer.getSpans();
    const spanNames = spans.map((span) => span.name);
    expect(spanNames).toContain('workflow.run');
    expect(spanNames).toContain('workflow.step:step1');
  });
});
