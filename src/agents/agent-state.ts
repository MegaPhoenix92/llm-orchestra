/**
 * Agent State Management
 * File-based coordination for multi-agent systems
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export type AgentName = 'claude' | 'gemini' | 'codex' | 'gpt' | string;

export interface AgentInfo {
  id: string;
  name: AgentName;
  status: 'active' | 'idle' | 'busy' | 'offline';
  lastHeartbeat: string;
  currentTask?: string;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  from: AgentName;
  to: AgentName | 'broadcast';
  timestamp: string;
  type: 'ping' | 'task' | 'finding' | 'question' | 'response';
  content: string;
  data?: Record<string, unknown>;
  read: boolean;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed';
  assignedTo?: AgentName;
  createdBy: AgentName;
  createdAt: string;
  updatedAt: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  tags: string[];
  result?: unknown;
}

const DEFAULT_STATE_DIR = '.agent-state';
const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * AgentCoord - File-based multi-agent coordination
 */
export class AgentCoord {
  private stateDir: string;
  private agentId: string;
  private agentName: AgentName;

  constructor(options: {
    stateDir?: string;
    agentName: AgentName;
    agentId?: string;
  }) {
    this.stateDir = options.stateDir ?? path.join(process.cwd(), DEFAULT_STATE_DIR);
    this.agentName = options.agentName;
    this.agentId = options.agentId ?? `${options.agentName}_${Date.now()}`;
  }

  /**
   * Initialize the coordination directories
   */
  async init(): Promise<void> {
    const dirs = ['agents', 'messages', 'tasks'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.stateDir, dir), { recursive: true });
    }
  }

  // ============================================================================
  // Agent Registration & Heartbeat
  // ============================================================================

  /**
   * Register this agent and send a heartbeat
   */
  async heartbeat(task?: string): Promise<AgentInfo> {
    const info: AgentInfo = {
      id: this.agentId,
      name: this.agentName,
      status: task ? 'busy' : 'active',
      lastHeartbeat: new Date().toISOString(),
      currentTask: task,
      capabilities: this.getCapabilities(),
    };

    const filePath = path.join(this.stateDir, 'agents', `${this.agentId}.json`);
    await fs.writeFile(filePath, JSON.stringify(info, null, 2));

    // Cleanup stale agents
    await this.cleanupStaleAgents();

    return info;
  }

  /**
   * Get all active agents
   */
  async listAgents(): Promise<AgentInfo[]> {
    const dir = path.join(this.stateDir, 'agents');
    const agents: AgentInfo[] = [];

    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const agent = JSON.parse(content) as AgentInfo;
          // Check if still active (within TTL)
          const lastBeat = new Date(agent.lastHeartbeat).getTime();
          if (Date.now() - lastBeat < TTL_MS) {
            agents.push(agent);
          }
        } catch {
          // Ignore invalid files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return agents;
  }

  /**
   * Check who is currently working
   */
  async whoIsWorking(): Promise<{
    active: AgentInfo[];
    busy: AgentInfo[];
    idle: AgentInfo[];
  }> {
    const agents = await this.listAgents();
    return {
      active: agents.filter(a => a.status === 'active'),
      busy: agents.filter(a => a.status === 'busy'),
      idle: agents.filter(a => a.status === 'idle'),
    };
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send a message to another agent or broadcast
   */
  async sendMessage(
    to: AgentName | 'broadcast',
    type: AgentMessage['type'],
    content: string,
    data?: Record<string, unknown>
  ): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      from: this.agentName,
      to,
      timestamp: new Date().toISOString(),
      type,
      content,
      data,
      read: false,
    };

    const fileName = `${message.timestamp.replace(/[:.]/g, '-')}_${message.id}.json`;
    const dir = to === 'broadcast' ? 'broadcast' : to;
    const filePath = path.join(this.stateDir, 'messages', dir, fileName);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(message, null, 2));

    return message;
  }

  /**
   * Get messages for this agent
   */
  async getInbox(includeRead = false): Promise<AgentMessage[]> {
    const messages: AgentMessage[] = [];
    const dirs = [this.agentName, 'broadcast'];

    for (const dir of dirs) {
      const dirPath = path.join(this.stateDir, 'messages', dir);
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const content = await fs.readFile(path.join(dirPath, file), 'utf-8');
            const msg = JSON.parse(content) as AgentMessage;
            if (includeRead || !msg.read) {
              messages.push(msg);
            }
          } catch {
            // Ignore invalid files
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return messages.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    const dirs = [this.agentName, 'broadcast'];
    for (const dir of dirs) {
      const dirPath = path.join(this.stateDir, 'messages', dir);
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.includes(messageId)) {
            const filePath = path.join(dirPath, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const msg = JSON.parse(content) as AgentMessage;
            msg.read = true;
            await fs.writeFile(filePath, JSON.stringify(msg, null, 2));
            return;
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  }

  // ============================================================================
  // Tasks
  // ============================================================================

  /**
   * Create a new task
   */
  async createTask(
    title: string,
    description: string,
    options?: {
      priority?: AgentTask['priority'];
      tags?: string[];
    }
  ): Promise<AgentTask> {
    const task: AgentTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      title,
      description,
      status: 'pending',
      createdBy: this.agentName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      priority: options?.priority ?? 'medium',
      tags: options?.tags ?? [],
    };

    const filePath = path.join(this.stateDir, 'tasks', `${task.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(task, null, 2));

    return task;
  }

  /**
   * List all tasks
   */
  async listTasks(filter?: {
    status?: AgentTask['status'];
    assignedTo?: AgentName;
  }): Promise<AgentTask[]> {
    const dir = path.join(this.stateDir, 'tasks');
    const tasks: AgentTask[] = [];

    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const task = JSON.parse(content) as AgentTask;

          // Apply filters
          if (filter?.status && task.status !== filter.status) continue;
          if (filter?.assignedTo && task.assignedTo !== filter.assignedTo) continue;

          tasks.push(task);
        } catch {
          // Ignore invalid files
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return tasks.sort((a, b) => {
      // Sort by priority then by date
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  /**
   * Claim a task
   */
  async claimTask(taskId: string): Promise<AgentTask | null> {
    const filePath = path.join(this.stateDir, 'tasks', `${taskId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const task = JSON.parse(content) as AgentTask;

      if (task.status !== 'pending') {
        return null; // Already claimed
      }

      task.status = 'claimed';
      task.assignedTo = this.agentName;
      task.updatedAt = new Date().toISOString();

      await fs.writeFile(filePath, JSON.stringify(task, null, 2));
      return task;
    } catch {
      return null;
    }
  }

  /**
   * Update task status
   */
  async updateTask(
    taskId: string,
    update: Partial<Pick<AgentTask, 'status' | 'result'>>
  ): Promise<AgentTask | null> {
    const filePath = path.join(this.stateDir, 'tasks', `${taskId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const task = JSON.parse(content) as AgentTask;

      Object.assign(task, update);
      task.updatedAt = new Date().toISOString();

      await fs.writeFile(filePath, JSON.stringify(task, null, 2));
      return task;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Cleanup stale agent registrations
   */
  private async cleanupStaleAgents(): Promise<void> {
    const dir = path.join(this.stateDir, 'agents');
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const filePath = path.join(dir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const agent = JSON.parse(content) as AgentInfo;
          const lastBeat = new Date(agent.lastHeartbeat).getTime();
          if (Date.now() - lastBeat > TTL_MS) {
            await fs.unlink(filePath);
          }
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  /**
   * Get capabilities based on agent type
   */
  private getCapabilities(): string[] {
    const baseCapabilities = ['chat', 'code_generation', 'analysis'];

    switch (this.agentName) {
      case 'claude':
        return [...baseCapabilities, 'long_context', 'reasoning', 'code_review'];
      case 'gemini':
        return [...baseCapabilities, 'multimodal', 'fast_iteration', 'pattern_recognition'];
      case 'gpt':
        return [...baseCapabilities, 'function_calling', 'json_mode', 'vision'];
      case 'codex':
        return [...baseCapabilities, 'code_completion', 'code_review'];
      default:
        return baseCapabilities;
    }
  }
}

export default AgentCoord;
