/**
 * Framework integrations for LLM Orchestra.
 *
 * @module integrations
 */

// Vercel AI SDK integration
export {
  toVercelStream,
  toVercelStreamWithData,
  createStreamData,
  collectStream,
  hasCompletionMeta,
  type StreamDataLike,
  type ToVercelStreamOptions,
  type VercelStreamWithDataResult,
} from './vercel-ai.js';

// LangChain integration
export {
  OrchestraChatModel,
  toOrchestraMessages,
  toOrchestraTools,
  type OrchestraChatModelOptions,
  type LangChainBaseMessage,
  type LangChainAIMessage,
  type LangChainChatGeneration,
  type LangChainChatResult,
  type LangChainChatGenerationChunk,
  type LangChainTool,
} from './langchain.js';
