/**
 * TaskExecutionStreamClient Tests
 * 
 * Unit tests for the task execution stream client WebSocket functionality.
 */

import {
  TaskExecutionStreamClient,
  getStreamClient,
  resetStreamClient,
} from '@/src/lib/taskExecutionStreamClient';
import { TaskExecutionEvent } from '@/src/types/taskExecution';

// Mock socket.io
jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

// Mock logger
jest.mock('@/src/lib/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('TaskExecutionStreamClient', () => {
  let client: TaskExecutionStreamClient;

  beforeEach(() => {
    resetStreamClient();
    client = new TaskExecutionStreamClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Connection Management', () => {
    it('should initialize with disconnected state', () => {
      expect(client.getConnectionState()).toBe('disconnected');
    });

    it('should handle socket connection', (done) => {
      const mockSocket = {
        on: jest.fn((event, handler) => {
          if (event === 'connect') {
            handler();
          }
        }),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: false,
      };

      const { io } = require('socket.io-client');
      io.mockReturnValue(mockSocket);

      jest.spyOn(client as any, 'setupSocketListeners').mockImplementation(() => {});

      client.connect().then(() => {
        expect(client.getConnectionState()).toBe('connected');
        done();
      });
    });

    it('should set connection state to connecting', async () => {
      let connectHandler: (() => void) | undefined;
      const mockSocket = {
        on: jest.fn((event, handler) => {
          if (event === 'connect') connectHandler = handler;
        }),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: false,
      };

      const { io } = require('socket.io-client');
      io.mockReturnValue(mockSocket);

      const connectPromise = client.connect();
      expect(client.getConnectionState()).toBe('connecting');
      if (connectHandler) connectHandler();
      await connectPromise;
    });

    it('should disconnect gracefully', async () => {
      const mockSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: true,
      };

      (client as any).socket = mockSocket;
      (client as any).connectionState = 'connected';

      await client.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(client.getConnectionState()).toBe('disconnected');
    });
  });

  describe('Subscription Management', () => {
    beforeEach(() => {
      const mockSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: true,
      };
      (client as any).socket = mockSocket;
      (client as any).connectionState = 'connected';
    });

    it('should subscribe to task events', () => {
      client.subscribe({ taskId: 'task-123' });

      const mockSocket = (client as any).socket;
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'task:subscribe',
        expect.objectContaining({ taskId: 'task-123' }),
      );
    });

    it('should throw error when subscribing while disconnected', () => {
      (client as any).socket = null;

      expect(() => {
        client.subscribe({ taskId: 'task-123' });
      }).toThrow('Stream client is not connected');
    });

    it('should unsubscribe from task events', () => {
      client.subscribe({ taskId: 'task-123' });
      client.unsubscribe('task-123');

      const mockSocket = (client as any).socket;
      expect(mockSocket.emit).toHaveBeenCalledWith('task:unsubscribe', {
        taskId: 'task-123',
      });
    });
  });

  describe('Event Handling', () => {
    beforeEach(() => {
      const mockSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: true,
      };
      (client as any).socket = mockSocket;
      (client as any).connectionState = 'connected';
    });

    it('should handle status change events', () => {
      client.subscribe({ taskId: 'task-123' });

      const event: TaskExecutionEvent = {
        id: 'event-1',
        type: 'status_change',
        taskId: 'task-123',
        timestamp: new Date().toISOString(),
        payload: {
          oldStatus: 'pending',
          newStatus: 'executing',
        },
      };

      let emittedEvent: TaskExecutionEvent | null = null;
      client.on('event', (e) => {
        emittedEvent = e;
      });

      (client as any).handleExecutionEvent(event);

      expect(emittedEvent).toEqual(event);
    });

    it('should buffer events for task state reconstruction', () => {
      client.subscribe({ taskId: 'task-123' });

      const statusEvent: TaskExecutionEvent = {
        id: 'event-1',
        type: 'status_change',
        taskId: 'task-123',
        timestamp: new Date().toISOString(),
        payload: {
          oldStatus: 'pending',
          newStatus: 'executing',
        },
      };

      (client as any).handleExecutionEvent(statusEvent);

      const state = client.getTaskExecutionState('task-123');
      expect(state?.status).toBe('executing');
    });

    it('should enforce max buffer size', () => {
      const maxSize = 10;
      client.subscribe({ taskId: 'task-123', maxLogBufferSize: maxSize });

      // Add more events than the buffer size
      for (let i = 0; i < maxSize + 5; i++) {
        const event: TaskExecutionEvent = {
          id: `event-${i}`,
          type: 'log_entry',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          payload: {
            id: `log-${i}`,
            taskId: 'task-123',
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Log ${i}`,
          },
        };
        (client as any).handleExecutionEvent(event);
      }

      const state = client.getTaskExecutionState('task-123');
      expect(state!.logs.length).toBeLessThanOrEqual(maxSize);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple calls', () => {
      resetStreamClient();
      const instance1 = getStreamClient();
      const instance2 = getStreamClient();

      expect(instance1).toBe(instance2);
    });

    it('should reset singleton', () => {
      const instance1 = getStreamClient();
      resetStreamClient();
      const instance2 = getStreamClient();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Task Execution State', () => {
    beforeEach(() => {
      const mockSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: true,
      };
      (client as any).socket = mockSocket;
      (client as any).connectionState = 'connected';
    });

    it('should reconstruct execution state from events', () => {
      client.subscribe({ taskId: 'task-123' });

      const events: TaskExecutionEvent[] = [
        {
          id: 'event-1',
          type: 'status_change',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          payload: {
            oldStatus: 'pending',
            newStatus: 'executing',
          },
        },
        {
          id: 'event-2',
          type: 'progress_update',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          payload: {
            current: 50,
            total: 100,
          },
        },
      ];

      events.forEach((e) => (client as any).handleExecutionEvent(e));

      const state = client.getTaskExecutionState('task-123');
      expect(state).toBeDefined();
      expect(state!.status).toBe('executing');
      expect(state!.progress).toEqual({ current: 50, total: 100 });
    });

    it('should return null for untracked tasks', () => {
      const state = client.getTaskExecutionState('unknown-task');
      expect(state).toBeNull();
    });
  });

  describe('Log Retrieval', () => {
    beforeEach(() => {
      const mockSocket = {
        on: jest.fn(),
        emit: jest.fn(),
        disconnect: jest.fn(),
        connected: true,
      };
      (client as any).socket = mockSocket;
      (client as any).connectionState = 'connected';
    });

    it('should get task logs', () => {
      client.subscribe({ taskId: 'task-123' });

      const logEvents: TaskExecutionEvent[] = [
        {
          id: 'log-1',
          type: 'log_entry',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          payload: {
            id: 'log-1',
            taskId: 'task-123',
            timestamp: new Date().toISOString(),
            level: 'info',
            message: 'Test log 1',
          },
        },
        {
          id: 'log-2',
          type: 'log_entry',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          payload: {
            id: 'log-2',
            taskId: 'task-123',
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'Test log 2',
          },
        },
      ];

      logEvents.forEach((e) => (client as any).handleExecutionEvent(e));

      const logs = client.getTaskLogs('task-123');
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Test log 1');
      expect(logs[1].message).toBe('Test log 2');
    });

    it('should get logs with limit', () => {
      client.subscribe({ taskId: 'task-123' });

      for (let i = 0; i < 10; i++) {
        const event: TaskExecutionEvent = {
          id: `log-${i}`,
          type: 'log_entry',
          taskId: 'task-123',
          timestamp: new Date().toISOString(),
          payload: {
            id: `log-${i}`,
            taskId: 'task-123',
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Log ${i}`,
          },
        };
        (client as any).handleExecutionEvent(event);
      }

      const logs = client.getTaskLogs('task-123', 5);
      expect(logs).toHaveLength(5);
    });

    it('should return empty array for untracked tasks', () => {
      const logs = client.getTaskLogs('unknown-task');
      expect(logs).toEqual([]);
    });
  });
});
