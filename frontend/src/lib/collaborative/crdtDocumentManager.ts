/**
 * CRDT Document Manager using Yjs
 * Handles operational transformation and conflict resolution for collaborative editing
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type {
  CollaborativeOptions,
  CollaborativeState,
  CollaborativeUser,
  CollaborativeOperation,
  EditConflict,
  CollaborativeEvent,
  CollaborativeEventType,
} from './types';

type EventListener = (event: CollaborativeEvent) => void;

/**
 * Manages a Yjs document for collaborative editing
 */
export class CRDTDocumentManager {
  private ydoc: Y.Doc;
  private provider: WebsocketProvider | null = null;
  private taskId: string;
  private userId: string;
  private userName: string;
  private connectionStatus: 'connected' | 'disconnected' | 'syncing' = 'disconnected';
  private activeUsers: Map<string, CollaborativeUser> = new Map();
  private conflicts: Map<string, EditConflict> = new Map();
  private operations: CollaborativeOperation[] = [];
  private eventListeners: Map<CollaborativeEventType, Set<EventListener>> = new Map();
  private reconnectAttempts: number = 0;
  private maxRetries: number = 3;
  private reconnectTimeout: number = 5000;
  private serverUrl: string;
  private conflictResolutionStrategy: 'last-write-wins' | 'crdt' | 'manual' = 'crdt';
  private enablePersistence: boolean = false;
  private ymap: Y.Map<any>;
  private yarray: Y.Array<any>;
  private awareness: Y.Awareness;

  constructor(options: CollaborativeOptions) {
    this.taskId = options.taskId;
    this.userId = options.userId;
    this.userName = options.userName;
    this.serverUrl = options.serverUrl;
    this.conflictResolutionStrategy = options.conflictResolutionStrategy || 'crdt';
    this.enablePersistence = options.enablePersistence ?? true;
    this.maxRetries = options.maxRetries ?? 3;
    this.reconnectTimeout = options.reconnectTimeout ?? 5000;

    // Initialize Yjs document
    this.ydoc = new Y.Doc();
    this.ymap = this.ydoc.getMap(`task-${this.taskId}`);
    this.yarray = this.ydoc.getArray(`task-${this.taskId}-history`);
    this.awareness = this.ydoc.awareness;

    // Set up event listeners for document changes
    this.setupDocumentListeners();

    if (options.autoConnect ?? true) {
      this.connect();
    }
  }

  /**
   * Connect to the collaborative server
   */
  public connect(): void {
    if (this.connectionStatus === 'connected' || this.connectionStatus === 'syncing') {
      return;
    }

    this.connectionStatus = 'syncing';
    this.emit('sync', { status: 'syncing' });

    try {
      const url = new URL(this.serverUrl);
      const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${url.host}${url.pathname}`;

      this.provider = new WebsocketProvider(
        wsUrl,
        `task-${this.taskId}`,
        this.ydoc,
        {
          connect: true,
          awareness: this.awareness,
          resyncInterval: 5000,
        }
      );

      this.setupProviderListeners();
      this.reconnectAttempts = 0;
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  /**
   * Disconnect from the collaborative server
   */
  public disconnect(): void {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    this.connectionStatus = 'disconnected';
    this.emit('disconnected', { taskId: this.taskId });
  }

  /**
   * Set up listeners for document changes
   */
  private setupDocumentListeners(): void {
    this.ymap.observe((event) => {
      event.keysChanged.forEach((key) => {
        const change = event.changes.get(key);
        if (change) {
          const operation: CollaborativeOperation = {
            id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            userId: this.userId,
            timestamp: Date.now(),
            type: change.action === 'add' || change.action === 'update' ? 'update' : 'delete',
            path: [key],
            value: this.ymap.get(key),
            oldValue: change.oldValue?.[0],
            resolved: true,
          };

          this.operations.push(operation);
          this.emit('operation', operation);
        }
      });
    });

    this.yarray.observe((event) => {
      event.changes.added.forEach((item) => {
        const operation: CollaborativeOperation = {
          id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          userId: item.content.getUser?.() ?? this.userId,
          timestamp: Date.now(),
          type: 'insert',
          path: ['history', this.yarray.toArray().indexOf(item.content)],
          value: item.content,
          resolved: true,
        };

        this.operations.push(operation);
        this.emit('operation', operation);
      });
    });
  }

  /**
   * Set up listeners for provider events
   */
  private setupProviderListeners(): void {
    if (!this.provider) return;

    this.provider.on('status', ({ status }: { status: 'connected' | 'disconnected' }) => {
      this.connectionStatus = status === 'connected' ? 'connected' : 'disconnected';
      this.emit(status === 'connected' ? 'connected' : 'disconnected', {
        taskId: this.taskId,
      });
    });

    this.provider.on('sync', (synced: boolean) => {
      if (synced) {
        this.connectionStatus = 'connected';
        this.emit('sync', { synced: true });
      }
    });

    // Handle awareness updates (remote users)
    this.awareness.on('change', (changes) => {
      changes.forEach((change) => {
        const state = this.awareness.getLocalState();
        if (state && change.user) {
          const user: CollaborativeUser = {
            clientId: change.user.clientID ?? '',
            userId: change.user.userId ?? '',
            userName: change.user.userName ?? 'Anonymous',
            avatarUrl: change.user.avatarUrl,
            color: change.user.color ?? this.getRandomColor(),
            cursor: change.user.cursor,
            lastActive: Date.now(),
          };

          if (state.userId === this.userId) {
            return; // Don't track ourselves
          }

          this.activeUsers.set(user.clientId, user);
          this.emit('userJoined', user);
        }
      });
    });
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private handleConnectionError(error: any): void {
    console.error('Collaborative connection error:', error);

    if (this.reconnectAttempts < this.maxRetries) {
      this.reconnectAttempts++;
      const backoffTime = this.reconnectTimeout * Math.pow(2, this.reconnectAttempts - 1);
      
      this.emit('error', {
        message: `Connection failed. Retrying in ${backoffTime}ms...`,
        error,
        attempt: this.reconnectAttempts,
        maxRetries: this.maxRetries,
      });

      setTimeout(() => this.connect(), backoffTime);
    } else {
      this.connectionStatus = 'disconnected';
      this.emit('error', {
        message: 'Failed to connect after maximum retries',
        error,
        attempt: this.reconnectAttempts,
        maxRetries: this.maxRetries,
      });
    }
  }

  /**
   * Update a field in the task
   */
  public updateField(path: string[], value: any): void {
    if (path.length === 1) {
      this.ymap.set(path[0], value);
    } else {
      // Navigate nested path
      let obj = this.ymap.get(path[0]);
      for (let i = 1; i < path.length - 1; i++) {
        obj = obj[path[i]];
      }
      obj[path[path.length - 1]] = value;
    }
  }

  /**
   * Get a field from the task
   */
  public getField(path: string[]): any {
    if (path.length === 1) {
      return this.ymap.get(path[0]);
    }

    let obj = this.ymap.get(path[0]);
    for (let i = 1; i < path.length; i++) {
      obj = obj?.[path[i]];
    }
    return obj;
  }

  /**
   * Get the current state
   */
  public getState(): CollaborativeState {
    return {
      taskId: this.taskId,
      isCollaborative: this.connectionStatus === 'connected',
      activeUsers: Array.from(this.activeUsers.values()),
      conflictCount: this.conflicts.size,
      lastSyncTime: Date.now(),
      connectionStatus: this.connectionStatus,
    };
  }

  /**
   * Get operation history
   */
  public getOperationHistory(): CollaborativeOperation[] {
    return [...this.operations];
  }

  /**
   * Resolve a conflict
   */
  public resolveConflict(conflictId: string, resolution: 'local' | 'remote' | 'merged'): void {
    const conflict = this.conflicts.get(conflictId);
    if (conflict) {
      conflict.resolved = true;
      conflict.resolution = resolution;

      if (resolution === 'local') {
        this.updateField(conflict.fieldPath, conflict.localValue);
      } else if (resolution === 'remote') {
        this.updateField(conflict.fieldPath, conflict.remoteValue);
      }
    }
  }

  /**
   * Register an event listener
   */
  public on(eventType: CollaborativeEventType, listener: EventListener): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.eventListeners.get(eventType);
      if (listeners) {
        listeners.delete(listener);
      }
    };
  }

  /**
   * Emit an event
   */
  private emit(eventType: CollaborativeEventType, data?: any): void {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const event: CollaborativeEvent = {
        type: eventType,
        timestamp: Date.now(),
        data,
      };
      listeners.forEach((listener) => listener(event));
    }
  }

  /**
   * Get a random color for user cursor
   */
  private getRandomColor(): string {
    const colors = [
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#FFA07A',
      '#98D8C8',
      '#F7DC6F',
      '#BB8FCE',
      '#85C1E2',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * Get the Yjs document (for advanced use cases)
   */
  public getYDoc(): Y.Doc {
    return this.ydoc;
  }

  /**
   * Get the shared map (for advanced use cases)
   */
  public getYMap(): Y.Map<any> {
    return this.ymap;
  }

  /**
   * Destroy the document manager
   */
  public destroy(): void {
    this.disconnect();
    this.ydoc.destroy();
  }
}
