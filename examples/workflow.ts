/**
 * Workflow Engine Example
 *
 * This example demonstrates how to use the LLM Orchestra workflow engine
 * to build multi-step AI pipelines with state management and error handling.
 *
 * Run with: npx tsx examples/workflow.ts
 */

import { Orchestra, WorkflowEngine } from 'llm-orchestra';
import type { WorkflowDefinition, WorkflowContext, WorkflowStepResult } from 'llm-orchestra';

// Define the workflow state
interface ResearchState {
  topic: string;
  research?: string;
  outline?: string[];
  draft?: string;
  finalArticle?: string;
  error?: string;
}

// Define the output type
type ArticleOutput = string;

async function main() {
  const orchestra = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    },
    observability: {
      tracing: {
        enabled: true,
        sampleRate: 1.0,
      },
      costTracking: {
        enabled: true,
      },
    },
  });

  // Define a multi-step article writing workflow
  const articleWorkflow: WorkflowDefinition<ResearchState, ArticleOutput> = {
    id: 'article-writer',
    start: 'research',
    maxSteps: 10,
    onErrorStepId: 'handleError',

    steps: {
      // Step 1: Research the topic
      research: async (
        ctx: WorkflowContext<ResearchState, ArticleOutput>
      ): Promise<WorkflowStepResult<ResearchState, ArticleOutput>> => {
        console.log('\n[Step 1] Researching topic:', ctx.state.topic);

        const response = await orchestra.complete({
          model: 'claude-3-haiku-20240307',
          messages: [
            {
              role: 'user',
              content: `Research the following topic and provide 3-5 key points: "${ctx.state.topic}". Be concise.`,
            },
          ],
        });

        return {
          nextStepId: 'createOutline',
          state: { research: response.content },
          metadata: { tokensUsed: response.meta.tokens.totalTokens },
        };
      },

      // Step 2: Create an outline
      createOutline: async (
        ctx: WorkflowContext<ResearchState, ArticleOutput>
      ): Promise<WorkflowStepResult<ResearchState, ArticleOutput>> => {
        console.log('[Step 2] Creating outline...');

        const response = await orchestra.complete({
          model: 'claude-3-haiku-20240307',
          messages: [
            {
              role: 'user',
              content: `Based on this research:\n${ctx.state.research}\n\nCreate a simple 3-section outline for a short article. Return just the section titles, one per line.`,
            },
          ],
        });

        const outline = response.content.split('\n').filter((line) => line.trim());

        return {
          nextStepId: 'writeDraft',
          state: { outline },
        };
      },

      // Step 3: Write the draft
      writeDraft: async (
        ctx: WorkflowContext<ResearchState, ArticleOutput>
      ): Promise<WorkflowStepResult<ResearchState, ArticleOutput>> => {
        console.log('[Step 3] Writing draft...');
        console.log('  Outline:', ctx.state.outline?.join(', '));

        const response = await orchestra.complete({
          model: 'claude-3-haiku-20240307',
          messages: [
            {
              role: 'user',
              content: `Write a very short article (150 words max) about "${ctx.state.topic}" following this outline:\n${ctx.state.outline?.join('\n')}\n\nUse the research: ${ctx.state.research}`,
            },
          ],
        });

        return {
          nextStepId: 'review',
          state: { draft: response.content },
        };
      },

      // Step 4: Review and finalize
      review: async (
        ctx: WorkflowContext<ResearchState, ArticleOutput>
      ): Promise<WorkflowStepResult<ResearchState, ArticleOutput>> => {
        console.log('[Step 4] Reviewing and finalizing...');

        const response = await orchestra.complete({
          model: 'claude-3-haiku-20240307',
          messages: [
            {
              role: 'user',
              content: `Review and improve this draft. Fix any issues and return the final version:\n\n${ctx.state.draft}`,
            },
          ],
        });

        return {
          done: true,
          output: response.content,
          state: { finalArticle: response.content },
        };
      },

      // Error handler step
      handleError: async (
        ctx: WorkflowContext<ResearchState, ArticleOutput>
      ): Promise<WorkflowStepResult<ResearchState, ArticleOutput>> => {
        console.log('[Error Handler] Something went wrong at step:', ctx.stepId);
        const lastError = ctx.steps[ctx.steps.length - 1]?.error;

        return {
          done: true,
          output: `Error occurred: ${lastError || 'Unknown error'}`,
          state: { error: lastError },
        };
      },
    },
  };

  // Create and run the workflow
  console.log('=== Article Writing Workflow ===');
  const engine = new WorkflowEngine(articleWorkflow);

  const result = await engine.run({
    topic: 'The benefits of TypeScript for large codebases',
  });

  // Display results
  console.log('\n=== Workflow Results ===');
  console.log('Status:', result.status);
  console.log('Steps executed:', result.steps.length);

  console.log('\nStep execution times:');
  result.steps.forEach((step, i) => {
    const duration = step.endedAt - step.startedAt;
    console.log(`  ${i + 1}. ${step.stepId}: ${duration}ms (${step.status})`);
  });

  if (result.status === 'completed' && result.output) {
    console.log('\n=== Final Article ===');
    console.log(result.output);
  }

  if (result.error) {
    console.log('\nError:', result.error.message);
  }

  // Show stats
  console.log('\n=== Cost Summary ===');
  const stats = orchestra.getStats();
  console.log('Total requests:', stats.totalRequests);
  console.log('Total tokens:', stats.totalTokens);
  console.log('Total cost: $' + stats.totalCost.toFixed(6));

  await orchestra.shutdown();
}

main().catch(console.error);
