/**
 * Agent Coordination Tests
 * Tests for the file-based multi-agent coordination system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentCoord, AgentInfo, AgentMessage, AgentTask } from '../../src/agents/agent-state.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

describe('AgentCoord', () => {
  let agentCoord: AgentCoord;
  const testStateDir = '/tmp/test-agent-state';

  beforeEach(() => {
    agentCoord = new AgentCoord({
      stateDir: testStateDir,
      agentName: 'claude',
      agentId: 'claude_test_123',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should_setAgentName_when_provided', () => {
      const coord = new AgentCoord({ agentName: 'gemini' });
      // Internal state is private, but we can verify behavior
      expect(coord).toBeDefined();
    });

    it('should_generateAgentId_when_notProvided', () => {
      const coord = new AgentCoord({ agentName: 'claude' });
      expect(coord).toBeDefined();
    });

    it('should_useDefaultStateDir_when_notProvided', () => {
      const coord = new AgentCoord({ agentName: 'claude' });
      expect(coord).toBeDefined();
    });

    it('should_useCustomStateDir_when_provided', () => {
      const coord = new AgentCoord({
        agentName: 'claude',
        stateDir: '/custom/path',
      });
      expect(coord).toBeDefined();
    });
  });

  describe('init', () => {
    it('should_createRequiredDirectories_when_called', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      await agentCoord.init();

      expect(fs.mkdir).toHaveBeenCalledTimes(3);
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(testStateDir, 'agents'),
        { recursive: true }
      );
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(testStateDir, 'messages'),
        { recursive: true }
      );
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join(testStateDir, 'tasks'),
        { recursive: true }
      );
    });
  });

  describe('heartbeat', () => {
    it('should_writeAgentFile_when_called', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const info = await agentCoord.heartbeat();

      expect(fs.writeFile).toHaveBeenCalled();
      expect(info.name).toBe('claude');
      expect(info.id).toBe('claude_test_123');
    });

    it('should_setStatusToActive_when_noTaskProvided', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const info = await agentCoord.heartbeat();

      expect(info.status).toBe('active');
      expect(info.currentTask).toBeUndefined();
    });

    it('should_setStatusToBusy_when_taskProvided', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const info = await agentCoord.heartbeat('Working on tests');

      expect(info.status).toBe('busy');
      expect(info.currentTask).toBe('Working on tests');
    });

    it('should_includeCapabilities_when_heartbeatSent', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const info = await agentCoord.heartbeat();

      expect(info.capabilities).toBeDefined();
      expect(info.capabilities).toContain('chat');
      expect(info.capabilities).toContain('code_generation');
    });

    it('should_includeClaudeCapabilities_when_claudeAgent', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const info = await agentCoord.heartbeat();

      expect(info.capabilities).toContain('long_context');
      expect(info.capabilities).toContain('reasoning');
      expect(info.capabilities).toContain('code_review');
    });

    it('should_includeGeminiCapabilities_when_geminiAgent', async () => {
      const geminiCoord = new AgentCoord({ agentName: 'gemini' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const info = await geminiCoord.heartbeat();

      expect(info.capabilities).toContain('multimodal');
      expect(info.capabilities).toContain('fast_iteration');
      expect(info.capabilities).toContain('pattern_recognition');
    });

    it('should_cleanupStaleAgents_when_heartbeatSent', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['stale_agent.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        id: 'stale_agent',
        name: 'test',
        lastHeartbeat: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago (> 5 min TTL)
      }));
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await agentCoord.heartbeat();

      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe('listAgents', () => {
    it('should_returnActiveAgents_when_agentsExist', async () => {
      const mockAgents = [
        {
          id: 'agent_1',
          name: 'claude',
          status: 'active',
          lastHeartbeat: new Date().toISOString(),
          capabilities: [],
        },
        {
          id: 'agent_2',
          name: 'gemini',
          status: 'busy',
          lastHeartbeat: new Date().toISOString(),
          capabilities: [],
        },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['agent_1.json', 'agent_2.json'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockAgents[0]))
        .mockResolvedValueOnce(JSON.stringify(mockAgents[1]));

      const agents = await agentCoord.listAgents();

      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe('claude');
      expect(agents[1].name).toBe('gemini');
    });

    it('should_filterOutStaleAgents_when_listing', async () => {
      const mockAgents = [
        {
          id: 'active_agent',
          name: 'claude',
          lastHeartbeat: new Date().toISOString(),
        },
        {
          id: 'stale_agent',
          name: 'gemini',
          lastHeartbeat: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
        },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['active.json', 'stale.json'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockAgents[0]))
        .mockResolvedValueOnce(JSON.stringify(mockAgents[1]));

      const agents = await agentCoord.listAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('claude');
    });

    it('should_returnEmptyArray_when_directoryDoesNotExist', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('ENOENT'));

      const agents = await agentCoord.listAgents();

      expect(agents).toEqual([]);
    });

    it('should_ignoreInvalidFiles_when_parsing', async () => {
      vi.mocked(fs.readdir).mockResolvedValue(['valid.json', 'invalid.json'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({
          id: 'valid',
          name: 'claude',
          lastHeartbeat: new Date().toISOString(),
        }))
        .mockResolvedValueOnce('invalid json');

      const agents = await agentCoord.listAgents();

      expect(agents).toHaveLength(1);
    });
  });

  describe('whoIsWorking', () => {
    it('should_categorizeAgentsByStatus_when_called', async () => {
      const mockAgents = [
        { id: '1', name: 'claude', status: 'active', lastHeartbeat: new Date().toISOString() },
        { id: '2', name: 'gemini', status: 'busy', lastHeartbeat: new Date().toISOString() },
        { id: '3', name: 'gpt', status: 'idle', lastHeartbeat: new Date().toISOString() },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json', '3.json'] as any);
      mockAgents.forEach((agent, i) => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(agent));
      });

      const status = await agentCoord.whoIsWorking();

      expect(status.active).toHaveLength(1);
      expect(status.busy).toHaveLength(1);
      expect(status.idle).toHaveLength(1);
    });
  });

  describe('sendMessage', () => {
    it('should_writeMessageFile_when_sendingToAgent', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const message = await agentCoord.sendMessage('gemini', 'ping', 'Hello!');

      expect(message.from).toBe('claude');
      expect(message.to).toBe('gemini');
      expect(message.type).toBe('ping');
      expect(message.content).toBe('Hello!');
      expect(message.read).toBe(false);
    });

    it('should_generateUniqueMessageId_when_sending', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const msg1 = await agentCoord.sendMessage('gemini', 'ping', 'Hello 1');
      const msg2 = await agentCoord.sendMessage('gemini', 'ping', 'Hello 2');

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('should_includeBroadcastPath_when_broadcasting', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await agentCoord.sendMessage('broadcast', 'finding', 'Important finding');

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('broadcast'),
        expect.any(Object)
      );
    });

    it('should_includeData_when_provided', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const message = await agentCoord.sendMessage(
        'gemini',
        'task',
        'Please review this',
        { files: ['file1.ts', 'file2.ts'], priority: 'high' }
      );

      expect(message.data).toEqual({
        files: ['file1.ts', 'file2.ts'],
        priority: 'high',
      });
    });
  });

  describe('getInbox', () => {
    it('should_returnUnreadMessages_when_calledWithDefaultParams', async () => {
      const mockMessage = {
        id: 'msg_1',
        from: 'gemini',
        to: 'claude',
        timestamp: new Date().toISOString(),
        type: 'ping',
        content: 'Hello',
        read: false,
      };

      // First call for direct messages, second for broadcast
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(['msg_1.json'] as any)
        .mockResolvedValueOnce([] as any); // No broadcast messages
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockMessage));

      const messages = await agentCoord.getInbox();

      expect(messages).toHaveLength(1);
      expect(messages[0].read).toBe(false);
    });

    it('should_includeReadMessages_when_includeReadTrue', async () => {
      const mockMessages = [
        { id: '1', read: false, timestamp: new Date().toISOString() },
        { id: '2', read: true, timestamp: new Date().toISOString() },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json'] as any);
      mockMessages.forEach(msg => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(msg));
      });

      const messages = await agentCoord.getInbox(true);

      expect(messages).toHaveLength(2);
    });

    it('should_checkBroadcastMessages_when_gettingInbox', async () => {
      vi.mocked(fs.readdir)
        .mockResolvedValueOnce([]) // Direct messages
        .mockResolvedValueOnce(['broadcast_msg.json'] as any); // Broadcast

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        id: 'broadcast_1',
        from: 'gemini',
        to: 'broadcast',
        timestamp: new Date().toISOString(),
        read: false,
      }));

      const messages = await agentCoord.getInbox();

      expect(messages).toHaveLength(1);
    });

    it('should_sortByTimestamp_when_returning', async () => {
      const mockMessages = [
        { id: '1', timestamp: new Date(2024, 0, 1).toISOString(), read: false },
        { id: '2', timestamp: new Date(2024, 0, 3).toISOString(), read: false },
        { id: '3', timestamp: new Date(2024, 0, 2).toISOString(), read: false },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json', '3.json'] as any);
      mockMessages.forEach(msg => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(msg));
      });

      const messages = await agentCoord.getInbox();

      // Most recent first
      expect(messages[0].id).toBe('2');
      expect(messages[1].id).toBe('3');
      expect(messages[2].id).toBe('1');
    });
  });

  describe('markAsRead', () => {
    it('should_updateMessageFile_when_marking', async () => {
      const mockMessage = {
        id: 'msg_123',
        read: false,
        timestamp: new Date().toISOString(),
      };

      vi.mocked(fs.readdir).mockResolvedValue(['msg_123.json'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockMessage));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await agentCoord.markAsRead('msg_123');

      expect(fs.writeFile).toHaveBeenCalled();
      // Verify the written content has read: true
      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.read).toBe(true);
    });
  });

  describe('createTask', () => {
    it('should_writeTaskFile_when_creating', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.createTask(
        'Review code',
        'Please review the following code changes'
      );

      expect(task.title).toBe('Review code');
      expect(task.description).toBe('Please review the following code changes');
      expect(task.status).toBe('pending');
      expect(task.createdBy).toBe('claude');
    });

    it('should_setDefaultPriority_when_notProvided', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.createTask('Test task', 'Description');

      expect(task.priority).toBe('medium');
    });

    it('should_useProvidedPriority_when_given', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.createTask('Urgent task', 'Description', {
        priority: 'critical',
      });

      expect(task.priority).toBe('critical');
    });

    it('should_includeTags_when_provided', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.createTask('Tagged task', 'Description', {
        tags: ['testing', 'urgent'],
      });

      expect(task.tags).toContain('testing');
      expect(task.tags).toContain('urgent');
    });
  });

  describe('listTasks', () => {
    it('should_returnAllTasks_when_noFilter', async () => {
      const mockTasks = [
        { id: '1', title: 'Task 1', status: 'pending', priority: 'medium', createdAt: new Date().toISOString() },
        { id: '2', title: 'Task 2', status: 'completed', priority: 'high', createdAt: new Date().toISOString() },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json'] as any);
      mockTasks.forEach(task => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(task));
      });

      const tasks = await agentCoord.listTasks();

      expect(tasks).toHaveLength(2);
    });

    it('should_filterByStatus_when_provided', async () => {
      const mockTasks = [
        { id: '1', status: 'pending', priority: 'medium', createdAt: new Date().toISOString() },
        { id: '2', status: 'completed', priority: 'medium', createdAt: new Date().toISOString() },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json'] as any);
      mockTasks.forEach(task => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(task));
      });

      const tasks = await agentCoord.listTasks({ status: 'pending' });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('pending');
    });

    it('should_filterByAssignedTo_when_provided', async () => {
      const mockTasks = [
        { id: '1', assignedTo: 'claude', priority: 'medium', createdAt: new Date().toISOString() },
        { id: '2', assignedTo: 'gemini', priority: 'medium', createdAt: new Date().toISOString() },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json'] as any);
      mockTasks.forEach(task => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(task));
      });

      const tasks = await agentCoord.listTasks({ assignedTo: 'claude' });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].assignedTo).toBe('claude');
    });

    it('should_sortByPriorityThenDate_when_returning', async () => {
      const mockTasks = [
        { id: '1', priority: 'low', createdAt: new Date(2024, 0, 1).toISOString() },
        { id: '2', priority: 'critical', createdAt: new Date(2024, 0, 2).toISOString() },
        { id: '3', priority: 'high', createdAt: new Date(2024, 0, 3).toISOString() },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(['1.json', '2.json', '3.json'] as any);
      mockTasks.forEach(task => {
        vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(task));
      });

      const tasks = await agentCoord.listTasks();

      expect(tasks[0].priority).toBe('critical');
      expect(tasks[1].priority).toBe('high');
      expect(tasks[2].priority).toBe('low');
    });
  });

  describe('claimTask', () => {
    it('should_claimTask_when_pending', async () => {
      const mockTask = {
        id: 'task_123',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTask));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.claimTask('task_123');

      expect(task).not.toBeNull();
      expect(task?.status).toBe('claimed');
      expect(task?.assignedTo).toBe('claude');
    });

    it('should_returnNull_when_alreadyClaimed', async () => {
      const mockTask = {
        id: 'task_123',
        status: 'claimed',
        assignedTo: 'gemini',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTask));

      const task = await agentCoord.claimTask('task_123');

      expect(task).toBeNull();
    });

    it('should_returnNull_when_taskNotFound', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const task = await agentCoord.claimTask('nonexistent');

      expect(task).toBeNull();
    });
  });

  describe('updateTask', () => {
    it('should_updateStatus_when_provided', async () => {
      const mockTask = {
        id: 'task_123',
        status: 'in_progress',
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTask));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.updateTask('task_123', { status: 'completed' });

      expect(task?.status).toBe('completed');
    });

    it('should_updateResult_when_provided', async () => {
      const mockTask = {
        id: 'task_123',
        status: 'in_progress',
        updatedAt: new Date().toISOString(),
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTask));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const task = await agentCoord.updateTask('task_123', {
        status: 'completed',
        result: { success: true, output: 'Done!' },
      });

      expect(task?.result).toEqual({ success: true, output: 'Done!' });
    });

    it('should_returnNull_when_taskNotFound', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const task = await agentCoord.updateTask('nonexistent', { status: 'completed' });

      expect(task).toBeNull();
    });
  });
});
