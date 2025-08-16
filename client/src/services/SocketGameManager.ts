import { io, Socket } from 'socket.io-client';
import {
  GameManager,
  GameState,
  Player,
  GameResult,
  GameError,
  GameErrorCode,
  TieBreakerCallbacks,
  GameStateChangeCallback,
  GameErrorCallback,
  NetworkMessage,
  createGameError
} from '../interfaces';
import { validatePlayerName, validateRoomCode, validateCanvasData, validateVote } from '../utils/validation';
import { ErrorHandler } from '../utils/errorHandling';
import { NetworkResilienceManager } from '../utils/networkResilience';
import { ErrorRecoveryManager } from '../utils/errorRecovery';
import { NetworkOptimizationManager } from '../utils/networkOptimization';
import config from '../config/environment';
import logger from '../utils/logger';
import performanceMonitor from '../utils/performanceMonitor';

// Legacy interface for backward compatibility
export interface AIResult extends GameResult {}

// Re-export types for backward compatibility
export type { GameState as SocketGameState, TieBreakerCallbacks } from '../interfaces';

/**
 * SocketGameManager - Socket.io-based implementation of the GameManager interface
 * 
 * This class provides a complete implementation of the GameManager interface using
 * Socket.io for real-time communication with the game server. It handles connection
 * management, error recovery, state synchronization, and all game operations.
 * 
 * Key Features:
 * - Automatic reconnection with exponential backoff
 * - Comprehensive error handling and recovery
 * - Real-time state synchronization
 * - Network resilience and timeout management
 * - Development tools integration
 * 
 * @example
 * ```typescript
 * const gameManager = new SocketGameManager();
 * gameManager.onStateChange((state) => {
 *   console.log('Game state updated:', state);
 * });
 * 
 * try {
 *   const roomCode = await gameManager.hostGame('PlayerName');
 *   console.log('Game hosted with room code:', roomCode);
 * } catch (error) {
 *   console.error('Failed to host game:', error);
 * }
 * ```
 */
export class SocketGameManager implements GameManager {
  /** Socket.io client instance for server communication */
  private socket: Socket | null = null;
  
  /** Current game state synchronized with server */
  private gameState: GameState | null = null;
  
  /** Whether the current player is the host */
  private isHostPlayer: boolean = false;
  
  /** Set of callbacks to notify on state changes */
  private stateChangeCallbacks: Set<GameStateChangeCallback> = new Set();
  
  /** Set of callbacks to notify on errors */
  private errorCallbacks: Set<GameErrorCallback> = new Set();
  
  /** Callbacks for handling tie-breaker scenarios */
  private tieBreakerCallbacks: TieBreakerCallbacks | null = null;
  
  /** Callback for auto-submit when timer expires */
  private onAutoSubmitRequired: (() => void) | null = null;
  
  /** Name of the current player */
  private playerName: string = '';
  
  /** Current room code */
  private currentRoomCode: string = '';
  
  /** Last error that occurred */
  private lastError: GameError | null = null;
  
  /** History of network messages for debugging */
  private networkMessages: NetworkMessage[] = [];
  
  /** Current connection status */
  private connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error' = 'disconnected';
  
  // Connection management properties
  /** Current number of reconnection attempts */
  private reconnectAttempts: number = 0;
  
  /** Maximum number of reconnection attempts before giving up */
  private maxReconnectAttempts: number = 3;
  
  /** Current delay between reconnection attempts (increases exponentially) */
  private reconnectDelay: number = 2000; // Start with 2 seconds
  
  /** Timeout for connection attempts */
  private connectionTimeout: number = 10000; // 10 seconds
  
  /** Timer for reconnection attempts */
  private reconnectTimer: NodeJS.Timeout | null = null;
  
  /** Timer for connection timeout */
  private connectionTimer: NodeJS.Timeout | null = null;
  
  /** Whether the manager has been destroyed */
  private isDestroyed: boolean = false;
  
  /** Server URL for socket connection */
  private serverUrl: string;
  
  // Enhanced error handling
  private errorHandler: ErrorHandler;
  private networkResilience: NetworkResilienceManager;
  private errorRecovery: ErrorRecoveryManager;
  
  // Network optimization
  private networkOptimization: NetworkOptimizationManager;

  constructor(onStateChange: GameStateChangeCallback, tieBreakerCallbacks?: TieBreakerCallbacks) {
    this.onStateChange(onStateChange);
    this.tieBreakerCallbacks = tieBreakerCallbacks || null;
    this.serverUrl = config.serverUrl;
    this.maxReconnectAttempts = config.reconnectAttempts;
    this.reconnectDelay = config.reconnectDelay;
    this.connectionTimeout = config.socketTimeout;
    
    // Initialize enhanced error handling
    this.errorHandler = new ErrorHandler();
    this.networkResilience = new NetworkResilienceManager();
    this.errorRecovery = new ErrorRecoveryManager();
    
    // Initialize network optimization
    this.networkOptimization = new NetworkOptimizationManager(
      (messages) => this.sendBatchedMessages(messages),
      {
        maxBatchSize: 10,
        maxBatchDelay: 100,
        batchableTypes: ['drawing-stroke', 'cursor-position', 'typing-indicator']
      },
      {
        minCompressionSize: 1024,
        compressibleTypes: ['submit-drawing', 'game-state-update'],
        compressionLevel: 6
      }
    );
    
    logger.info(`SocketGameManager initialized with server: ${this.serverUrl}`, 'NETWORK');
    this.initializeSocket();
  }

  private initializeSocket() {
    if (this.isDestroyed) return;
    
    this.socket = io(this.serverUrl, {
      autoConnect: false,
      timeout: this.connectionTimeout,
      reconnection: false, // We'll handle reconnection manually
      forceNew: true
    });

    this.setupEventHandlers();
  }

  private attemptReconnection() {
    if (this.isDestroyed || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.log(`❌ Maximum reconnection attempts (${this.maxReconnectAttempts}) reached, returning to main screen`);
        this.handleError(createGameError(
          GameErrorCode.CONNECTION_FAILED,
          `Unable to reconnect after ${this.maxReconnectAttempts} attempts. Please check your connection and try again.`,
          { 
            attempts: this.reconnectAttempts, 
            maxAttempts: this.maxReconnectAttempts,
            shouldReturnToMainScreen: true 
          },
          false
        ));
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      if (this.isDestroyed) return;
      
      this.connectionStatus = 'connecting';
      this.updateGameState({ connectionStatus: 'connecting' });
      
      // Reinitialize socket for clean reconnection
      if (this.socket) {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      }
      
      this.initializeSocket();
      
      if (this.currentRoomCode && this.playerName) {
        // Try to rejoin the room
        this.rejoinRoom();
      }
    }, delay);
  }

  private async rejoinRoom() {
    if (!this.socket || this.isDestroyed) return;
    
    try {
      if (this.isHostPlayer) {
        // Host tries to recreate the room
        await this.hostGame(this.playerName);
      } else {
        // Player tries to rejoin
        await this.joinGame(this.playerName, this.currentRoomCode);
      }
      
      // Reset reconnection attempts on successful reconnection
      this.reconnectAttempts = 0;
      console.log('✅ Successfully reconnected and rejoined room');
    } catch (error) {
      console.error('❌ Failed to rejoin room:', error);
      this.attemptReconnection();
    }
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private setupEventHandlers() {
    if (!this.socket || this.isDestroyed) return;

    // Connection events with enhanced error recovery
    this.socket.on('connect', () => {
      console.log('✅ Connected to server');
      this.connectionStatus = 'connected';
      this.reconnectAttempts = 0; // Reset on successful connection
      this.clearTimers();
      
      this.updateGameState({ 
        isConnected: true, 
        connectionStatus: 'connected' 
      });
      
      this.logNetworkMessage('connect', {}, 'received');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from server:', reason);
      this.connectionStatus = 'disconnected';
      
      this.updateGameState({ 
        isConnected: false, 
        connectionStatus: 'disconnected' 
      });
      
      this.logNetworkMessage('disconnect', { reason }, 'received');
      
      // Attempt reconnection unless it was intentional
      if (reason !== 'io client disconnect' && !this.isDestroyed) {
        this.attemptReconnection();
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Connection error:', error);
      this.connectionStatus = 'error';
      
      const gameError = createGameError(
        GameErrorCode.CONNECTION_FAILED,
        'Failed to connect to server',
        { error: error.message, attempts: this.reconnectAttempts },
        true
      );
      
      this.handleError(gameError);
      this.logNetworkMessage('connect_error', { error: error.message }, 'received');
      
      // Attempt reconnection on connection error
      if (!this.isDestroyed) {
        this.attemptReconnection();
      }
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Reconnected after', attemptNumber, 'attempts');
      this.reconnectAttempts = 0;
      this.logNetworkMessage('reconnect', { attemptNumber }, 'received');
    });

    this.socket.on('reconnect_error', (error) => {
      console.error('❌ Reconnection error:', error);
      this.logNetworkMessage('reconnect_error', { error: error.message }, 'received');
    });

    this.socket.on('reconnect_failed', () => {
      console.error('❌ Reconnection failed');
      this.handleError(createGameError(
        GameErrorCode.CONNECTION_FAILED,
        'Failed to reconnect to server',
        { attempts: this.maxReconnectAttempts },
        false
      ));
      this.logNetworkMessage('reconnect_failed', {}, 'received');
    });

    // Room events
    this.socket.on('room-created', (data) => {
      console.log('🏠 Room created:', data.roomCode);
      this.currentRoomCode = data.roomCode;
      this.isHostPlayer = true;
      this.updateGameState({
        ...data.gameState,
        roomCode: data.roomCode,
        isConnected: true,
        connectionStatus: 'connected'
      });
      this.logNetworkMessage('room-created', data, 'received');
    });

    this.socket.on('room-joined', (data) => {
      console.log('🚪 Joined room:', data.roomCode);
      this.currentRoomCode = data.roomCode;
      this.isHostPlayer = false;
      this.updateGameState({
        ...data.gameState,
        roomCode: data.roomCode,
        isConnected: true,
        connectionStatus: 'connected'
      });
      this.logNetworkMessage('room-joined', data, 'received');
    });

    this.socket.on('player-joined', (data) => {
      console.log('👋 Player joined:', data.playerName);
      this.updateGameState(data.gameState);
    });

    this.socket.on('player-left', (data) => {
      console.log('👋 Player left:', data.playerId);
      this.updateGameState(data.gameState);
    });

    // Game flow events
    this.socket.on('voting-started', (data) => {
      console.log('🗳️ Voting started');
      this.updateGameState(data.gameState);
    });

    this.socket.on('vote-updated', (data) => {
      console.log('📊 Vote updated');
      this.updateGameState(data.gameState);
    });

    // Handle tiebreaker events
    this.socket.on('tiebreaker-started', (data) => {
      console.log('🎲 Tiebreaker started, tied words:', data.tiedWords);
      
      // Show tiebreaker modal with animation
      this.tieBreakerCallbacks?.onTieDetected(
        data.tiedWords,
        '' // Server will send chosen word after animation
      );
    });

    this.socket.on('tiebreaker-resolved', (data) => {
      console.log('🎲 Tiebreaker resolved by server, chosen word:', data.chosenWord);
      
      // Update the tiebreaker modal with the winning word (without restarting animation)
      this.tieBreakerCallbacks?.onTieDetected(
        data.tiedWords,
        data.chosenWord // Server-determined winning word
      );
    });

    this.socket.on('drawing-started', (data) => {
      console.log('🎨 Drawing started, word:', data.gameState.chosenWord);
      this.updateGameState(data.gameState);
    });

    this.socket.on('drawing-submitted', (data) => {
      console.log('✅ Drawing submitted by:', data.playerId);
      this.updateGameState(data.gameState);
    });

    this.socket.on('drawing-time-expired', (data) => {
      console.log('🔥 RECEIVED drawing-time-expired event from server');
      console.log('🔥 Auto-submit callback available:', !!this.onAutoSubmitRequired);
      
      // Trigger auto-submit callback if available
      if (this.onAutoSubmitRequired) {
        console.log('🔥 Calling auto-submit callback...');
        this.onAutoSubmitRequired();
      } else {
        console.warn('🔥 No auto-submit callback set!');
      }
      
      this.updateGameState(data.gameState);
    });

    this.socket.on('judging-complete', (data) => {
      console.log('🤖 AI judging complete');
      this.updateGameState(data.gameState);
    });

    // Real-time drawing events
    this.socket.on('real-time-stroke', (data) => {
      // Forward to canvas for real-time viewing (optional feature)
      this.onRealTimeStroke?.(data.playerId, data.strokeData);
    });

    // Handle batched messages from server
    this.socket.on('batch-messages', (data) => {
      console.log('📦 Received batched messages:', data.messages?.length || 0);
      
      if (data.messages && Array.isArray(data.messages)) {
        data.messages.forEach((msg: { type: string; data: any }) => {
          // Process each message in the batch
          this.socket!.emit(msg.type, msg.data);
        });
      }
    });

    // Handle compressed messages
    this.socket.on('compressed-message', (compressedMessage) => {
      try {
        const decompressedMessage = this.networkOptimization.processIncomingMessage(compressedMessage);
        console.log('📦 Decompressed message:', decompressedMessage.type);
        
        // Re-emit the decompressed message
        this.socket!.emit(decompressedMessage.type, decompressedMessage.data);
      } catch (error) {
        console.error('Failed to decompress message:', error);
      }
    });

    // Error handling
    this.socket.on('error', (data) => {
      console.error('🚨 Server error:', data.message);
      
      // Handle room not found errors (server restart scenario)
      if (data.message && data.message.includes('Room not found')) {
        console.log('🏠 Room no longer exists (server may have restarted), clearing local state');
        
        // Clear local state and return to start screen
        this.currentRoomCode = '';
        this.isHostPlayer = false;
        this.gameState = null;
        this.lastError = null;
        
        // Create a specific error for room not found
        const roomNotFoundError = createGameError(
          GameErrorCode.ROOM_NOT_FOUND,
          'The game room no longer exists. The server may have restarted.',
          { originalMessage: data.message },
          false // Not recoverable - user needs to create/join a new room
        );
        
        this.handleError(roomNotFoundError);
      } else {
        // Handle other errors normally
        const genericError = createGameError(
          GameErrorCode.UNKNOWN_ERROR,
          data.message || 'An unknown server error occurred',
          { originalMessage: data.message },
          true
        );
        
        this.handleError(genericError);
      }
    });
  }

  private updateGameState(newState: Partial<GameState>) {
    // Merge with existing state to ensure all required fields are present
    this.gameState = {
      ...this.createDefaultGameState(),
      ...this.gameState,
      ...newState
    };
    
    // Notify all state change callbacks
    this.stateChangeCallbacks.forEach(callback => {
      try {
        callback(this.gameState!);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  private createDefaultGameState(): GameState {
    return {
      roomCode: '',
      isConnected: false,
      connectionStatus: this.connectionStatus,
      players: [],
      currentPlayer: null,
      hostId: '',
      playerCount: 0,
      maxPlayers: 8,
      gamePhase: 'lobby',
      wordOptions: [],
      voteCounts: {},
      chosenWord: '',
      timeRemaining: 0,
      drawingTimeLimit: 60,
      submittedDrawings: 0,
      results: []
    };
  }

  private handleError(error: GameError) {
    this.lastError = error;
    
    // Process error with enhanced error handling
    const classification = this.errorHandler.processError(error);
    
    // Check if we should throttle this error
    if (this.errorHandler.shouldThrottleError(error)) {
      console.warn('Error throttled due to frequency:', error.code);
      return;
    }
    
    // Attempt automatic recovery for recoverable errors
    if (error.recoverable && classification.autoRetry) {
      this.attemptAutoRecovery(error);
    }
    
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (callbackError) {
        console.error('Error in error callback:', callbackError);
      }
    });
  }

  private async attemptAutoRecovery(error: GameError): Promise<void> {
    try {
      const result = await this.errorRecovery.initiateRecovery(error, this, {
        gameState: this.gameState,
        playerName: this.playerName,
        roomCode: this.currentRoomCode,
        isHost: this.isHostPlayer
      });
      
      if (result.success) {
        console.log('✅ Auto-recovery successful:', result.message);
        if (result.newState) {
          this.updateGameState(result.newState);
        }
      } else {
        console.warn('❌ Auto-recovery failed:', result.message);
      }
    } catch (recoveryError) {
      console.error('Recovery process failed:', recoveryError);
    }
  }

  private logNetworkMessage(type: string, data: any, direction: 'sent' | 'received') {
    const message: NetworkMessage = {
      type,
      data,
      timestamp: new Date(),
      direction
    };
    
    this.networkMessages.push(message);
    
    // Keep only last 100 messages to prevent memory leaks
    if (this.networkMessages.length > 100) {
      this.networkMessages = this.networkMessages.slice(-100);
    }
  }

  /**
   * Send batched messages efficiently
   */
  private sendBatchedMessages(messages: NetworkMessage[]): void {
    if (!this.socket || !this.socket.connected || messages.length === 0) {
      return;
    }

    if (messages.length === 1) {
      // Single message - send directly
      const message = messages[0];
      this.socket.emit(message.type, message.data);
      this.logNetworkMessage(message.type, message.data, 'sent');
    } else {
      // Multiple messages - send as batch
      const batchData = {
        messages: messages.map(msg => ({ type: msg.type, data: msg.data })),
        timestamp: Date.now()
      };
      
      this.socket.emit('batch-messages', batchData);
      this.logNetworkMessage('batch-messages', { count: messages.length, types: messages.map(m => m.type) }, 'sent');
      
      // Log individual messages for debugging
      messages.forEach(msg => {
        this.logNetworkMessage(msg.type, msg.data, 'sent');
      });
    }
  }

  /**
   * Send an optimized message through the network optimization layer
   */
  private sendOptimizedMessage(type: string, data: any): void {
    const message: NetworkMessage = {
      type,
      data,
      timestamp: new Date(),
      direction: 'sent'
    };

    // Process through optimization layer
    this.networkOptimization.processOutgoingMessage(message);
  }

  // GameManager Interface Implementation

  async hostGame(playerName: string): Promise<string> {
    logger.info('Attempting to host game', 'GAME', { playerName });
    performanceMonitor.startTiming('host_game', 'GAME');
    
    return await this.networkResilience.executeWithResilience(
      async () => {
        try {
          validatePlayerName(playerName);
          this.playerName = playerName;
          logger.setUserId(playerName);
          
          if (!this.socket) {
            this.initializeSocket();
          }
          
          if (!this.socket) {
            throw createGameError(
              GameErrorCode.CONNECTION_FAILED,
              'Failed to initialize socket connection',
              {},
              false
            );
          }

          this.connectionStatus = 'connecting';
          this.updateGameState({ connectionStatus: 'connecting' });
          
          return new Promise<string>((resolve, reject) => {
            // Set up connection timeout
            this.connectionTimer = setTimeout(() => {
              reject(createGameError(
                GameErrorCode.CONNECTION_TIMEOUT,
                'Connection timeout while creating room',
                { timeout: this.connectionTimeout },
                true
              ));
            }, this.connectionTimeout);

            const cleanup = () => {
              this.clearTimers();
              this.socket?.off('room-created');
              this.socket?.off('error');
              this.socket?.off('connect');
              this.socket?.off('connect_error');
            };

            this.socket!.once('room-created', (data) => {
              console.log('✅ Room created successfully:', data);
              cleanup();
              this.logNetworkMessage('room-created', data, 'received');
              resolve(data.roomCode);
            });

            this.socket!.once('error', (error) => {
              console.error('❌ Server error during room creation:', error);
              cleanup();
              this.logNetworkMessage('error', error, 'received');
              reject(createGameError(
                GameErrorCode.CONNECTION_FAILED,
                error.message || 'Failed to create room',
                { error },
                true
              ));
            });

            this.socket!.once('connect_error', (error) => {
              cleanup();
              reject(createGameError(
                GameErrorCode.CONNECTION_FAILED,
                'Connection failed while creating room',
                { error: error.message },
                true
              ));
            });

            // Wait for connection then create room
            this.socket!.once('connect', () => {
              console.log('🔌 Connected to server, creating room...');
              const message = { playerName };
              this.sendOptimizedMessage('create-room', message);
              console.log('📤 Sent create-room message:', message);
            });

            // Start connection
            if (!this.socket!.connected) {
              console.log('🔌 Connecting to server...');
              this.socket!.connect();
            } else {
              // Already connected, emit immediately
              console.log('🔌 Already connected, creating room immediately...');
              const message = { playerName };
              this.sendOptimizedMessage('create-room', message);
              console.log('📤 Sent create-room message:', message);
            }
          });
        } catch (error) {
          this.clearTimers();
          if (error instanceof Error && 'code' in error) {
            throw error; // Re-throw GameError
          }
          throw createGameError(
            GameErrorCode.UNKNOWN_ERROR,
            'Unexpected error while hosting game',
            { error: error instanceof Error ? error.message : String(error) },
            true
          );
        }
      },
      {
        timeout: this.connectionTimeout,
        requestId: 'host-game'
      }
    );
  }

  async joinGame(playerName: string, roomCode: string): Promise<void> {
    try {
      validatePlayerName(playerName);
      validateRoomCode(roomCode);
      
      this.playerName = playerName;
      
      if (!this.socket) {
        throw createGameError(
          GameErrorCode.CONNECTION_FAILED,
          'Socket not initialized',
          {},
          false
        );
      }

      this.connectionStatus = 'connecting';

      return new Promise((resolve, reject) => {
        this.socket!.connect();

        this.socket!.once('room-joined', (data) => {
          this.logNetworkMessage('room-joined', data, 'received');
          resolve();
        });

        this.socket!.once('error', (error) => {
          this.logNetworkMessage('error', error, 'received');
          reject(createGameError(
            GameErrorCode.ROOM_NOT_FOUND,
            error.message || 'Failed to join room',
            { error, roomCode },
            true
          ));
        });

        // Wait for connection then join room
        this.socket!.once('connect', () => {
          const message = { roomCode, playerName };
          this.sendOptimizedMessage('join-room', message);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          reject(createGameError(
            GameErrorCode.CONNECTION_TIMEOUT,
            'Connection timeout while joining room',
            { timeout: 10000, roomCode },
            true
          ));
        }, 10000);
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        throw error; // Re-throw GameError
      }
      throw createGameError(
        GameErrorCode.UNKNOWN_ERROR,
        'Unexpected error while joining game',
        { error: error instanceof Error ? error.message : String(error) },
        true
      );
    }
  }

  // Game Actions
  startVoting(): void {
    try {
      if (!this.socket || !this.socket.connected) {
        throw createGameError(
          GameErrorCode.CONNECTION_LOST,
          'Cannot start voting: not connected to server',
          {},
          true
        );
      }

      if (!this.isHostPlayer) {
        throw createGameError(
          GameErrorCode.UNAUTHORIZED_ACTION,
          'Cannot start voting: only host can start voting',
          {},
          false
        );
      }

      const message = { roomCode: this.currentRoomCode };
      this.sendOptimizedMessage('start-voting', message);
    } catch (error) {
      this.handleError(error as GameError);
    }
  }

  voteForWord(word: string): void {
    try {
      if (!this.socket || !this.socket.connected) {
        throw createGameError(
          GameErrorCode.CONNECTION_LOST,
          'Cannot vote: not connected to server',
          {},
          true
        );
      }

      if (this.gameState?.wordOptions) {
        validateVote(word, this.gameState.wordOptions);
      }

      const message = { roomCode: this.currentRoomCode, word };
      this.sendOptimizedMessage('vote-word', message);
    } catch (error) {
      this.handleError(error as GameError);
    }
  }

  submitDrawing(canvasData: string): void {
    try {
      validateCanvasData(canvasData);

      if (!this.socket || !this.socket.connected) {
        throw createGameError(
          GameErrorCode.CONNECTION_LOST,
          'Cannot submit drawing: not connected to server',
          {},
          true
        );
      }

      const message = { roomCode: this.currentRoomCode, canvasData };
      this.sendOptimizedMessage('submit-drawing', message);
    } catch (error) {
      this.handleError(error as GameError);
    }
  }

  /**
   * Resolve tiebreaker by sending chosen word to server
   */
  resolveTiebreaker(chosenWord: string): void {
    // Note: Manual tiebreaker resolution removed - server handles all tiebreakers automatically
    // This method is kept for interface compatibility but does nothing
    console.log('🎲 Tiebreaker will be resolved automatically by server');
  }

  notifyTiebreakerAnimationComplete(): void {
    if (!this.socket || !this.socket.connected) {
      console.error('Cannot notify tiebreaker completion: socket not connected');
      return;
    }

    if (!this.currentRoomCode) {
      console.error('Cannot notify tiebreaker completion: no room code');
      return;
    }

    console.log('🎲 Notifying server that tiebreaker animation is complete');
    this.socket.emit('tiebreaker-animation-complete', { 
      roomCode: this.currentRoomCode 
    });
  }

  /**
   * Send real-time drawing stroke (for spectating)
   */
  sendDrawingStroke(strokeData: any): void {
    if (!this.socket) {
      return;
    }

    this.socket.emit('drawing-stroke', { roomCode: this.currentRoomCode, strokeData });
  }

  /**
   * Mark drawing as finished (notifies server)
   */
  finishDrawing(): void {
    if (!this.socket) {
      console.error('Cannot finish drawing: socket not connected');
      return;
    }

    this.socket.emit('finish-drawing', { roomCode: this.currentRoomCode });
  }

  // Connection Management
  disconnect(): void {
    // Flush any pending optimizations
    this.networkOptimization.flush();
    
    if (this.socket) {
      this.socket.disconnect();
      this.connectionStatus = 'disconnected';
      this.logNetworkMessage('disconnect', {}, 'sent');
    }
  }

  /**
   * Cleanup all resources and connections
   */
  destroy(): void {
    this.isDestroyed = true;
    this.clearTimers();
    
    // Cleanup network optimization
    this.networkOptimization.destroy();
    
    // Disconnect socket
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Clear callbacks
    this.stateChangeCallbacks.clear();
    this.errorCallbacks.clear();
    
    // Clear state
    this.gameState = null;
    this.networkMessages = [];
    
    logger.info('SocketGameManager destroyed', 'NETWORK');
  }

  getConnectionStatus(): 'connecting' | 'connected' | 'disconnected' | 'error' {
    return this.connectionStatus;
  }

  // State Management
  getGameState(): GameState | null {
    return this.gameState;
  }

  onStateChange(callback: GameStateChangeCallback): void {
    this.stateChangeCallbacks.add(callback);
  }

  offStateChange(callback: GameStateChangeCallback): void {
    this.stateChangeCallbacks.delete(callback);
  }

  // Error Handling
  onError(callback: GameErrorCallback): void {
    this.errorCallbacks.add(callback);
  }

  offError(callback: GameErrorCallback): void {
    this.errorCallbacks.delete(callback);
  }

  getLastError(): GameError | null {
    return this.lastError;
  }

  clearError(): void {
    this.lastError = null;
  }

  // Utility Methods
  isHost(): boolean {
    return this.isHostPlayer;
  }

  getRoomCode(): string {
    return this.currentRoomCode;
  }

  getCurrentPlayer(): Player | null {
    if (!this.gameState || !this.playerName) {
      return null;
    }
    
    return this.gameState.players.find(p => p.name === this.playerName) || null;
  }

  setTieBreakerCallbacks(callbacks: TieBreakerCallbacks): void {
    this.tieBreakerCallbacks = callbacks;
  }

  /**
   * Set callback for auto-submit when timer expires
   */
  setAutoSubmitCallback(callback: () => void): void {
    this.onAutoSubmitRequired = callback;
  }

  /**
   * Request to play again with the same players
   */
  async playAgain(): Promise<void> {
    if (!this.socket) {
      throw createGameError(
        GameErrorCode.CONNECTION_FAILED,
        'Cannot play again: not connected to server'
      );
    }

    if (!this.currentRoomCode) {
      throw createGameError(
        GameErrorCode.INVALID_ROOM_CODE,
        'Cannot play again: no active room'
      );
    }

    if (this.gameState?.gamePhase !== 'results') {
      throw createGameError(
        GameErrorCode.INVALID_GAME_STATE,
        'Can only play again from results screen'
      );
    }

    logger.info('Requesting play again', 'GAME', { roomCode: this.currentRoomCode });
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(createGameError(
          GameErrorCode.CONNECTION_TIMEOUT,
          'Play again request timed out'
        ));
      }, 10000); // 10 second timeout

      // Handle successful lobby creation
      const handleLobbyCreated = (data: any) => {
        console.log('🔄 [CLIENT] Play again lobby created event received:', data);
        console.log('🔄 [CLIENT] Current socket ID:', this.socket?.id);
        console.log('🔄 [CLIENT] New host ID:', data.gameState?.hostId);
        
        clearTimeout(timeout);
        this.socket?.off('play-again-lobby-created', handleLobbyCreated);
        this.socket?.off('play-again-waiting', handleWaiting);
        this.socket?.off('error', handleError);

        console.log('🔄 [CLIENT] Updating game state with new room:', data.newRoomCode);
        
        // Update room code and game state
        this.currentRoomCode = data.newRoomCode;
        this.gameState = data.gameState;
        this.isHostPlayer = data.gameState.hostId === this.socket?.id;
        
        console.log('🔄 [CLIENT] Updated room code:', this.currentRoomCode);
        console.log('🔄 [CLIENT] Is host:', this.isHostPlayer);
        console.log('🔄 [CLIENT] Game state phase:', this.gameState?.gamePhase);
        
        // Notify state change callbacks
        this.stateChangeCallbacks.forEach(callback => {
          try {
            callback(this.gameState!);
          } catch (error) {
            console.error('Error in state change callback:', error);
          }
        });

        resolve();
      };

      // Handle waiting for more players
      const handleWaiting = (data: any) => {
        console.log('🔄 [CLIENT] Waiting for more players to play again:', data);
        console.log('🔄 [CLIENT] Players ready:', data.playersReady, '/', data.totalPlayers);
        console.log('🔄 [CLIENT] Players needed:', data.playersNeeded);
        
        // For now, we'll resolve immediately and let the UI handle the waiting state
        // In the future, we could add a callback for waiting state updates
        clearTimeout(timeout);
        this.socket?.off('play-again-lobby-created', handleLobbyCreated);
        this.socket?.off('play-again-waiting', handleWaiting);
        this.socket?.off('error', handleError);
        resolve();
      };

      // Handle errors
      const handleError = (error: any) => {
        clearTimeout(timeout);
        this.socket?.off('play-again-lobby-created', handleLobbyCreated);
        this.socket?.off('play-again-waiting', handleWaiting);
        this.socket?.off('error', handleError);
        
        reject(createGameError(
          GameErrorCode.UNKNOWN_ERROR,
          error.message || 'Play again request failed'
        ));
      };

      // Set up event listeners (use on instead of once for reliability)
      this.socket?.on('play-again-lobby-created', handleLobbyCreated);
      this.socket?.on('play-again-waiting', handleWaiting);
      this.socket?.on('error', handleError);

      // Send play again request
      this.socket?.emit('play-again', { roomCode: this.currentRoomCode });
      this.logNetworkMessage('play-again', { roomCode: this.currentRoomCode }, 'sent');
    });
  }




  // Legacy methods for backward compatibility
  getIsHost(): boolean {
    return this.isHost();
  }

  getRoomId(): string {
    return this.getRoomCode();
  }

  // Optional callback handlers for additional events
  public onRealTimeStroke?: (playerId: string, strokeData: any) => void;

  /**
   * DevTools: Simulate partial game state changes for testing
   */
  simulateState(partialState: Partial<GameState>): void {
    if (!this.gameState) {
      console.warn('Cannot simulate state: No current game state');
      return;
    }

    console.log('🎮 SocketGameManager: Simulating state changes:', partialState);
    
    // Merge the partial state with current state
    this.gameState = {
      ...this.gameState,
      ...partialState
    };

    // Record state change for debugging (if DevTools is attached)
    if (this.devToolsService) {
      this.devToolsService.recordStateChange(this.gameState);
    }

    // Notify all state change callbacks
    this.stateChangeCallbacks.forEach(callback => {
      try {
        callback(this.gameState!);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  /**
   * DevTools: Reference to DevTools service for debugging
   */
  private devToolsService: any = null;

  /**
   * DevTools: Set DevTools service reference
   */
  setDevToolsService(devToolsService: any): void {
    this.devToolsService = devToolsService;
  }

  /**
   * DevTools: Enable development mode features
   */
  enableDevMode(): void {
    console.log('🛠️ SocketGameManager: Development mode enabled');
    
    // Initialize with a basic game state if none exists
    if (!this.gameState) {
      this.gameState = {
        roomCode: 'DEV-ROOM',
        isConnected: true,
        connectionStatus: 'connected',
        players: [],
        currentPlayer: {
          id: 'dev-player',
          name: 'DevPlayer',
          isHost: true,
          isConnected: true,
          hasVoted: false,
          hasSubmittedDrawing: false,
          score: 0
        },
        hostId: 'dev-player',
        playerCount: 0,
        maxPlayers: 8,
        gamePhase: 'lobby',
        wordOptions: [],
        voteCounts: {},
        chosenWord: '',
        timeRemaining: 0,
        drawingTimeLimit: 60,
        submittedDrawings: 0,
        results: []
      };
    }

    // Enable additional logging for development
    this.connectionStatus = 'connected';
  }

  /**
   * DevTools: Get access to socket for message interception
   */
  getSocket(): Socket | null {
    return this.socket;
  }

  /**
   * DevTools: Get network optimization statistics
   */
  getNetworkStats(): any {
    return this.networkOptimization.getStats();
  }

  /**
   * DevTools: Flush all pending network optimizations
   */
  flushNetworkOptimizations(): void {
    this.networkOptimization.flush();
  }
}