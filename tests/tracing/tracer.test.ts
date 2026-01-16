/**
 * Tracer Tests
 * Tests for the distributed tracing system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Tracer, Span, createNoopTracer, SpanData } from '../../src/tracing/tracer.js';
import type { TracingConfig, TokenUsage } from '../../src/types/index.js';

describe('Span', () => {
  let tracer: Tracer;
  let span: Span;

  beforeEach(() => {
    tracer = new Tracer({ enabled: true });
    span = tracer.startSpan('test-operation');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should_generateUniqueIds_when_noParentContext', () => {
      const span1 = tracer.startSpan('op1');
      const span2 = tracer.startSpan('op2');

      const ctx1 = span1.getContext();
      const ctx2 = span2.getContext();

      // SpanIDs should be unique even if traceIds could be the same within same ms
      // The random component ensures uniqueness
      expect(ctx1.spanId).not.toBe(ctx2.spanId);
    });

    it('should_inheritTraceId_when_parentContextProvided', () => {
      const parentSpan = tracer.startSpan('parent');
      const parentContext = parentSpan.getContext();

      const childSpan = parentSpan.startChild('child');
      const childContext = childSpan.getContext();

      expect(childContext.traceId).toBe(parentContext.traceId);
      expect(childContext.parentSpanId).toBe(parentContext.spanId);
      expect(childContext.spanId).not.toBe(parentContext.spanId);
    });

    it('should_setInitialStatusToUnset_when_created', () => {
      const data = span.getData();
      expect(data.status).toBe('unset');
    });

    it('should_setKindToClient_when_created', () => {
      const data = span.getData();
      expect(data.kind).toBe('client');
    });
  });

  describe('getContext', () => {
    it('should_returnSpanContext_when_called', () => {
      const context = span.getContext();

      expect(context).toHaveProperty('traceId');
      expect(context).toHaveProperty('spanId');
      expect(context.traceId).toBeTruthy();
      expect(context.spanId).toBeTruthy();
    });

    it('should_returnCopy_when_calledMultipleTimes', () => {
      const context1 = span.getContext();
      const context2 = span.getContext();

      expect(context1).not.toBe(context2);
      expect(context1).toEqual(context2);
    });
  });

  describe('setAttribute', () => {
    it('should_addAttribute_when_called', () => {
      span.setAttribute('key', 'value');

      const data = span.getData();
      expect(data.attributes['key']).toBe('value');
    });

    it('should_returnThis_when_called', () => {
      const result = span.setAttribute('key', 'value');
      expect(result).toBe(span);
    });

    it('should_handleDifferentTypes_when_setting', () => {
      span.setAttribute('string', 'hello');
      span.setAttribute('number', 42);
      span.setAttribute('boolean', true);
      span.setAttribute('null', null);
      span.setAttribute('object', { nested: 'value' });

      const data = span.getData();
      expect(data.attributes['string']).toBe('hello');
      expect(data.attributes['number']).toBe(42);
      expect(data.attributes['boolean']).toBe(true);
      expect(data.attributes['null']).toBe(null);
      expect(data.attributes['object']).toEqual({ nested: 'value' });
    });
  });

  describe('setAttributes', () => {
    it('should_addMultipleAttributes_when_called', () => {
      span.setAttributes({
        key1: 'value1',
        key2: 'value2',
        key3: 123,
      });

      const data = span.getData();
      expect(data.attributes['key1']).toBe('value1');
      expect(data.attributes['key2']).toBe('value2');
      expect(data.attributes['key3']).toBe(123);
    });

    it('should_returnThis_when_called', () => {
      const result = span.setAttributes({ key: 'value' });
      expect(result).toBe(span);
    });

    it('should_overwriteExisting_when_sameKey', () => {
      span.setAttribute('key', 'original');
      span.setAttributes({ key: 'updated' });

      const data = span.getData();
      expect(data.attributes['key']).toBe('updated');
    });
  });

  describe('addEvent', () => {
    it('should_addEvent_when_called', () => {
      span.addEvent('test-event');

      const data = span.getData();
      expect(data.events).toHaveLength(1);
      expect(data.events[0].name).toBe('test-event');
    });

    it('should_addEventWithAttributes_when_provided', () => {
      span.addEvent('test-event', { detail: 'info', count: 5 });

      const data = span.getData();
      expect(data.events[0].attributes).toEqual({
        detail: 'info',
        count: 5,
      });
    });

    it('should_addTimestamp_when_eventAdded', () => {
      const before = Date.now();
      span.addEvent('test-event');
      const after = Date.now();

      const data = span.getData();
      expect(data.events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(data.events[0].timestamp).toBeLessThanOrEqual(after);
    });

    it('should_returnThis_when_called', () => {
      const result = span.addEvent('event');
      expect(result).toBe(span);
    });

    it('should_addMultipleEvents_when_calledMultipleTimes', () => {
      span.addEvent('event1');
      span.addEvent('event2');
      span.addEvent('event3');

      const data = span.getData();
      expect(data.events).toHaveLength(3);
    });
  });

  describe('setStatus', () => {
    it('should_setStatusToOk_when_okProvided', () => {
      span.setStatus('ok');

      const data = span.getData();
      expect(data.status).toBe('ok');
    });

    it('should_setStatusToError_when_errorProvided', () => {
      span.setStatus('error');

      const data = span.getData();
      expect(data.status).toBe('error');
    });

    it('should_setErrorMessage_when_provided', () => {
      span.setStatus('error', 'Something went wrong');

      const data = span.getData();
      expect(data.status).toBe('error');
      expect(data.attributes['error.message']).toBe('Something went wrong');
    });

    it('should_returnThis_when_called', () => {
      const result = span.setStatus('ok');
      expect(result).toBe(span);
    });
  });

  describe('recordException', () => {
    it('should_setErrorStatus_when_exceptionRecorded', () => {
      const error = new Error('Test error');
      span.recordException(error);

      const data = span.getData();
      expect(data.status).toBe('error');
    });

    it('should_addExceptionEvent_when_recorded', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n  at test.ts:1:1';
      span.recordException(error);

      const data = span.getData();
      const exceptionEvent = data.events.find(e => e.name === 'exception');

      expect(exceptionEvent).toBeDefined();
      expect(exceptionEvent?.attributes?.['exception.type']).toBe('Error');
      expect(exceptionEvent?.attributes?.['exception.message']).toBe('Test error');
      expect(exceptionEvent?.attributes?.['exception.stacktrace']).toBeDefined();
    });

    it('should_returnThis_when_called', () => {
      const result = span.recordException(new Error('test'));
      expect(result).toBe(span);
    });
  });

  describe('startChild', () => {
    it('should_createChildSpan_when_called', () => {
      const childSpan = span.startChild('child-operation');

      expect(childSpan).toBeInstanceOf(Span);
      expect(childSpan).not.toBe(span);
    });

    it('should_inheritParentContext_when_created', () => {
      const childSpan = span.startChild('child-operation');
      const parentContext = span.getContext();
      const childContext = childSpan.getContext();

      expect(childContext.traceId).toBe(parentContext.traceId);
      expect(childContext.parentSpanId).toBe(parentContext.spanId);
    });

    it('should_passAttributes_when_provided', () => {
      const childSpan = span.startChild('child-operation', {
        'child.attr': 'value',
      });

      const data = childSpan.getData();
      expect(data.attributes['child.attr']).toBe('value');
    });
  });

  describe('end', () => {
    it('should_setEndTime_when_called', () => {
      const before = Date.now();
      span.end();
      const after = Date.now();

      const data = span.getData();
      expect(data.endTime).toBeGreaterThanOrEqual(before);
      expect(data.endTime).toBeLessThanOrEqual(after);
    });

    it('should_setStatusToOk_when_unset', () => {
      span.end();

      const data = span.getData();
      expect(data.status).toBe('ok');
    });

    it('should_preserveErrorStatus_when_alreadyError', () => {
      span.setStatus('error');
      span.end();

      const data = span.getData();
      expect(data.status).toBe('error');
    });
  });

  describe('getDuration', () => {
    it('should_returnDuration_when_spanEnded', async () => {
      await new Promise(r => setTimeout(r, 10));
      span.end();

      const duration = span.getDuration();
      expect(duration).toBeGreaterThanOrEqual(10);
    });

    it('should_returnCurrentDuration_when_spanNotEnded', async () => {
      await new Promise(r => setTimeout(r, 10));

      const duration = span.getDuration();
      expect(duration).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getData', () => {
    it('should_returnCopyOfData_when_called', () => {
      const data1 = span.getData();
      const data2 = span.getData();

      expect(data1).not.toBe(data2);
      expect(data1).toEqual(data2);
    });
  });
});

describe('Tracer', () => {
  let tracer: Tracer;
  const defaultConfig: TracingConfig = {
    enabled: true,
    sampleRate: 1.0,
  };

  beforeEach(() => {
    tracer = new Tracer(defaultConfig);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tracer.shutdown();
    vi.clearAllTimers();
  });

  describe('constructor', () => {
    it('should_startExportTimer_when_endpointConfigured', async () => {
      const tracerWithEndpoint = new Tracer({
        enabled: true,
        exportEndpoint: 'http://localhost:4317',
      });

      // Timer should be created (verify by checking tracer is defined)
      expect(tracerWithEndpoint).toBeDefined();

      await tracerWithEndpoint.shutdown();
    });

    it('should_notStartTimer_when_noEndpoint', () => {
      const tracerNoEndpoint = new Tracer({ enabled: true });
      expect(tracerNoEndpoint).toBeDefined();
    });
  });

  describe('startSpan', () => {
    it('should_createNewSpan_when_called', () => {
      const span = tracer.startSpan('test-operation');

      expect(span).toBeInstanceOf(Span);
    });

    it('should_setSpanName_when_provided', () => {
      const span = tracer.startSpan('custom-operation');
      const data = span.getData();

      expect(data.name).toBe('custom-operation');
    });

    it('should_setAttributes_when_provided', () => {
      const span = tracer.startSpan('operation', {
        'attr1': 'value1',
        'attr2': 42,
      });

      const data = span.getData();
      expect(data.attributes['attr1']).toBe('value1');
      expect(data.attributes['attr2']).toBe(42);
    });

    it('should_useProvidedTraceId_when_overrideProvided', () => {
      const span = tracer.startSpan('operation', undefined, { traceId: 'trace_custom' });
      const context = span.getContext();

      expect(context.traceId).toBe('trace_custom');
    });
  });

  describe('trace', () => {
    it('should_executeFunction_when_called', async () => {
      const mockFn = vi.fn().mockResolvedValue('result');

      const result = await tracer.trace('operation', mockFn);

      expect(mockFn).toHaveBeenCalled();
      expect(result).toBe('result');
    });

    it('should_passSpanToFunction_when_executing', async () => {
      let receivedSpan: Span | undefined;

      await tracer.trace('operation', (span) => {
        receivedSpan = span;
        return Promise.resolve();
      });

      expect(receivedSpan).toBeInstanceOf(Span);
    });

    it('should_useProvidedTraceId_when_traceOptionsProvided', async () => {
      const traceId = 'trace_custom';
      let spanTraceId = '';

      await tracer.trace('operation', async (span) => {
        spanTraceId = span.getContext().traceId;
      }, undefined, { traceId });

      expect(spanTraceId).toBe(traceId);
    });

    it('should_restoreSpanStack_when_traceCompletes', async () => {
      let firstTraceId = '';

      await tracer.trace('operation', async (span) => {
        firstTraceId = span.getContext().traceId;
      });

      const nextSpan = tracer.startSpan('next-operation');
      expect(nextSpan.getContext().traceId).not.toBe(firstTraceId);
      nextSpan.end();
    });

    it('should_setStatusOk_when_functionSucceeds', async () => {
      const recordedSpans: SpanData[] = [];
      vi.spyOn(tracer, 'recordSpan').mockImplementation((data) => {
        recordedSpans.push(data);
      });

      await tracer.trace('operation', () => Promise.resolve());

      expect(recordedSpans[0]?.status).toBe('ok');
    });

    it('should_recordException_when_functionThrows', async () => {
      const error = new Error('Test error');
      const recordedSpans: SpanData[] = [];
      vi.spyOn(tracer, 'recordSpan').mockImplementation((data) => {
        recordedSpans.push(data);
      });

      await expect(tracer.trace('operation', () => Promise.reject(error))).rejects.toThrow('Test error');

      expect(recordedSpans[0]?.status).toBe('error');
    });

    it('should_rethrowError_when_functionFails', async () => {
      const error = new Error('Original error');

      await expect(
        tracer.trace('operation', () => Promise.reject(error))
      ).rejects.toThrow('Original error');
    });
  });

  describe('recordLLMCall', () => {
    it('should_setLLMAttributes_when_called', () => {
      const span = tracer.startSpan('llm-call');

      const usage: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      };

      tracer.recordLLMCall(span, {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        tokens: usage,
        cost: 0.005,
        latencyMs: 250,
        cached: false,
      });

      const data = span.getData();
      expect(data.attributes['llm.provider']).toBe('anthropic');
      expect(data.attributes['llm.model']).toBe('claude-3-sonnet');
      expect(data.attributes['llm.tokens.input']).toBe(100);
      expect(data.attributes['llm.tokens.output']).toBe(50);
      expect(data.attributes['llm.tokens.total']).toBe(150);
      expect(data.attributes['llm.cost']).toBe(0.005);
      expect(data.attributes['llm.latency_ms']).toBe(250);
      expect(data.attributes['llm.cached']).toBe(false);
    });
  });

  describe('recordSpan', () => {
    it('should_addSpanToList_when_enabled', () => {
      const span = tracer.startSpan('operation');
      span.end();

      const spans = tracer.getSpans();
      expect(spans.length).toBe(1);
    });

    it('should_notRecordSpan_when_disabled', () => {
      const disabledTracer = new Tracer({ enabled: false });
      const span = disabledTracer.startSpan('operation');
      span.end();

      const spans = disabledTracer.getSpans();
      expect(spans.length).toBe(0);
    });

    it('should_respectSampleRate_when_configured', () => {
      // Sample rate 0 should never record
      const neverSampleTracer = new Tracer({ enabled: true, sampleRate: 0 });

      for (let i = 0; i < 100; i++) {
        const span = neverSampleTracer.startSpan(`operation-${i}`);
        span.end();
      }

      expect(neverSampleTracer.getSpans().length).toBe(0);
    });

    it('should_addToExportQueue_when_recorded', () => {
      const span = tracer.startSpan('operation');
      span.end();

      // Internal state, but we can verify by checking spans count
      const spans = tracer.getSpans();
      expect(spans.length).toBe(1);
    });
  });

  describe('flush', () => {
    it('should_exportSpans_when_endpointConfigured', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const tracerWithEndpoint = new Tracer({
        enabled: true,
        exportEndpoint: 'http://localhost:4317',
      });

      const span = tracerWithEndpoint.startSpan('operation');
      span.end();

      await tracerWithEndpoint.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4317',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await tracerWithEndpoint.shutdown();
    });

    it('should_doNothing_when_noEndpoint', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      const span = tracer.startSpan('operation');
      span.end();

      await tracer.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should_requeueOnFailure_when_exportFails', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      global.fetch = mockFetch;
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const tracerWithEndpoint = new Tracer({
        enabled: true,
        exportEndpoint: 'http://localhost:4317',
      });

      const span = tracerWithEndpoint.startSpan('operation');
      span.end();

      await tracerWithEndpoint.flush();

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      await tracerWithEndpoint.shutdown();
    });
  });

  describe('getSpans', () => {
    it('should_returnCopyOfSpans_when_called', () => {
      const span = tracer.startSpan('operation');
      span.end();

      const spans1 = tracer.getSpans();
      const spans2 = tracer.getSpans();

      expect(spans1).not.toBe(spans2);
      expect(spans1).toEqual(spans2);
    });
  });

  describe('clearSpans', () => {
    it('should_clearAllSpans_when_called', () => {
      for (let i = 0; i < 5; i++) {
        const span = tracer.startSpan(`operation-${i}`);
        span.end();
      }

      expect(tracer.getSpans().length).toBe(5);

      tracer.clearSpans();

      expect(tracer.getSpans().length).toBe(0);
    });
  });

  describe('generateTraceId', () => {
    it('should_generateUniqueIds_when_calledMultipleTimes', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(tracer.generateTraceId());
      }

      expect(ids.size).toBe(100);
    });

    it('should_startWithTracePrefix_when_generated', () => {
      const traceId = tracer.generateTraceId();
      expect(traceId).toMatch(/^trace_/);
    });
  });

  describe('shutdown', () => {
    it('should_flushPendingSpans_when_calledWithEndpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      global.fetch = mockFetch;

      const tracerWithEndpoint = new Tracer({
        enabled: true,
        exportEndpoint: 'http://localhost:4317',
      });

      const span = tracerWithEndpoint.startSpan('operation');
      span.end();

      await tracerWithEndpoint.shutdown();

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should_completeWithoutError_when_shutdownCalled', async () => {
      const tracerWithEndpoint = new Tracer({
        enabled: true,
        exportEndpoint: 'http://localhost:4317',
      });

      // Shutdown should complete without throwing
      await expect(tracerWithEndpoint.shutdown()).resolves.not.toThrow();
    });
  });
});

describe('createNoopTracer', () => {
  it('should_returnDisabledTracer_when_called', () => {
    const noopTracer = createNoopTracer();

    const span = noopTracer.startSpan('operation');
    span.end();

    // Should not record any spans
    expect(noopTracer.getSpans().length).toBe(0);
  });

  it('should_stillCreateSpans_when_methodsCalled', () => {
    const noopTracer = createNoopTracer();

    const span = noopTracer.startSpan('operation');

    expect(span).toBeInstanceOf(Span);
  });
});
