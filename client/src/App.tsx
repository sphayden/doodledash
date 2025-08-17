import React, { useState, useEffect, useCallback } from 'react';
import StartScreen from './components/StartScreen';
import JoinGameScreen from './components/JoinGameScreen';
import LobbyScreen from './components/LobbyScreen';
import VotingScreen from './components/VotingScreen';
import GameScreen from './components/GameScreen';
import TieBreakerModal from './components/TieBreakerModal';
import ResultsScreen from './components/ResultsScreen';
import ConnectionStatus from './components/ConnectionStatus';
import ErrorModal from './components/ErrorModal';
import ReconnectionProgress from './components/ReconnectionProgress';
import DevTools from './components/DevTools';
import { DevToolsService } from './services/DevToolsService';
import config, { logCurrentConfig, validateConfig } from './config/environment';
// TEST_SCENARIOS imported in DevTools component
import { 
  GameManager, 
  GameState, 
  GameError, 
  TieBreakerCallbacks,
  GameErrorCode 
} from './interfaces';
import { SocketGameManager } from './services/SocketGameManager';
import { getSavedPlayerName } from './utils/userStorage';
import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';

interface AppState {
  currentScreen: 'start' | 'join' | 'lobby' | 'voting' | 'game' | 'results' | 'judging-failed';
  playerName: string;
  gameManager: GameManager | null;
  gameState: GameState | null;
  isHost: boolean;
  roomCode: string;
  error: string | undefined;
  isConnecting: boolean;
  showTieBreaker: boolean;
  tiedOptions: string[];
  winningWord: string;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  showErrorModal: boolean;
  showReconnectionProgress: boolean;
  reconnectionAttempt: number;
  maxReconnectionAttempts: number;
  nextAttemptIn: number;
  showDevTools: boolean;
  showWaitingModal: boolean;
  waitingMessage: string;
  devToolsService: DevToolsService | null;
}

function App() {
  // Initialize configuration and validate it
  useEffect(() => {
    const configValidation = validateConfig();
    if (!configValidation.isValid) {
      console.error('❌ Configuration validation failed:', configValidation.errors);
    } else {
      logCurrentConfig();
    }
  }, []);

  const [appState, setAppState] = useState<AppState>({
    currentScreen: 'start',
    playerName: getSavedPlayerName(), // Initialize with saved player name
    gameManager: null,
    gameState: null,
    isHost: false,
    roomCode: '',
    error: undefined,
    isConnecting: false,
    showTieBreaker: false,
    tiedOptions: [],
    winningWord: '',
    connectionStatus: 'disconnected',
    showErrorModal: false,
    showReconnectionProgress: false,
    reconnectionAttempt: 0,
    maxReconnectionAttempts: 5,
    nextAttemptIn: 0,
    showDevTools: false,
    showWaitingModal: false,
    waitingMessage: '',
    devToolsService: null
  });

  // DevTools keyboard shortcut moved after handlers are defined

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (appState.gameManager) {
        appState.gameManager.destroy();
      }
    };
  }, [appState.gameManager]);

  const handleGameStateChange = useCallback((gameState: GameState) => {
    console.log('🔄 [APP] Game state change received:', {
      gamePhase: gameState.gamePhase,
      roomCode: gameState.roomCode,
      hostId: gameState.hostId,
      playerCount: gameState.playerCount
    });
    
    setAppState(prev => {
      // Hide tiebreaker modal when drawing phase starts
      const shouldHideTiebreaker = prev.showTieBreaker && gameState.gamePhase === 'drawing';
      
      if (shouldHideTiebreaker) {
        console.log('🎲 [APP] Hiding tiebreaker modal - drawing phase started');
      }
      
      const newScreen = gameState.gamePhase === 'lobby' ? 'lobby' : 
                        gameState.gamePhase === 'voting' ? 'voting' :
                        gameState.gamePhase === 'drawing' ? 'game' :
                        gameState.gamePhase === 'judging' ? 'results' : // Go to results screen during judging
                        gameState.gamePhase === 'results' ? 'results' :
                        gameState.gamePhase === 'judging-failed' ? 'results' : 'lobby';
      
      console.log('🔄 [APP] Screen transition:', prev.currentScreen, '->', newScreen);
      
      // Determine if current player is host based on game state
      const currentPlayerId = prev.gameManager?.getCurrentPlayer()?.id;
      const gameManagerIsHost = prev.gameManager?.isHost() || false;
      const isHost = gameState.hostId === currentPlayerId || gameManagerIsHost;
      
      console.log('🔄 [APP] Host check:', {
        gameStateHostId: gameState.hostId,
        currentPlayerId: currentPlayerId,
        gameManagerIsHost: gameManagerIsHost,
        finalIsHost: isHost
      });
      
      return {
        ...prev,
        gameState: gameState,
        roomCode: gameState.roomCode,
        connectionStatus: gameState.connectionStatus,
        currentScreen: newScreen,
        isHost: isHost, // Update isHost based on current game state
        // Hide tiebreaker modal when drawing starts
        showTieBreaker: shouldHideTiebreaker ? false : prev.showTieBreaker,
        tiedOptions: shouldHideTiebreaker ? [] : prev.tiedOptions,
        winningWord: shouldHideTiebreaker ? '' : prev.winningWord,
        // Hide waiting modal when successfully joining lobby
        showWaitingModal: gameState.gamePhase === 'lobby' ? false : prev.showWaitingModal,
        waitingMessage: gameState.gamePhase === 'lobby' ? '' : prev.waitingMessage
      };
    });
  }, []);

  const handleGameError = useCallback((error: GameError) => {
    console.error('Game error:', error);
    
    // Handle room not found errors (server restart scenario)
    if (error.code === GameErrorCode.ROOM_NOT_FOUND) {
      console.log('🏠 Room not found - resetting to start screen');
      
      // Reset app state to start screen
      setAppState(prev => ({
        ...prev,
        currentScreen: 'start',
        gameState: null,
        gameManager: null,
        devToolsService: null,
        roomCode: '',
        error: error.message,
        isConnecting: false,
        connectionStatus: 'disconnected',
        showErrorModal: true,
        showTieBreaker: false,
        showReconnectionProgress: false,
        playerName: prev.playerName || getSavedPlayerName() // Preserve current session name, fallback to saved
      }));
      
      return; // Don't process further
    }
    
    // Handle waiting for host scenario
    if (error.code === 'WAITING_FOR_HOST') {
      console.log('🔄 Showing waiting for host modal');
      setAppState(prev => ({
        ...prev,
        showWaitingModal: true,
        waitingMessage: error.message,
        error: undefined,
        showErrorModal: false
      }));
      return;
    }
    
    // Handle host left scenario - only show modal if automatic game creation failed
    if (error.code === 'HOST_LEFT') {
      console.log('🔄 Host left - showing fallback error modal');
      setAppState(prev => ({
        ...prev,
        error: error.message,
        showErrorModal: true,
        showWaitingModal: false
      }));
      return;
    }
    
    // Handle max reconnection attempts reached
    if (error.code === GameErrorCode.CONNECTION_FAILED && 
        error.details?.shouldReturnToMainScreen) {
      console.log('🔄 Max reconnection attempts reached - resetting to start screen');
      
      // Reset app state to start screen
      setAppState(prev => ({
        ...prev,
        currentScreen: 'start',
        gameState: null,
        gameManager: null,
        devToolsService: null,
        roomCode: '',
        error: error.message,
        isConnecting: false,
        connectionStatus: 'disconnected',
        showErrorModal: true,
        showTieBreaker: false,
        showReconnectionProgress: false,
        playerName: prev.playerName || getSavedPlayerName() // Preserve current session name, fallback to saved
      }));
      
      return; // Don't process further
    }
    
    // Update state with error and show modal for serious errors
    setAppState(prev => ({
      ...prev,
      error: error.message,
      isConnecting: false,
      connectionStatus: error.code.includes('CONNECTION') ? 'error' : prev.connectionStatus,
      showErrorModal: !error.recoverable || [
        GameErrorCode.CONNECTION_FAILED,
        GameErrorCode.ROOM_NOT_FOUND,
        GameErrorCode.ROOM_FULL,
        GameErrorCode.INVALID_ROOM_CODE
      ].includes(error.code as GameErrorCode)
    }));
    
    // Show reconnection progress for connection errors
    if ([GameErrorCode.CONNECTION_LOST, GameErrorCode.CONNECTION_TIMEOUT].includes(error.code as GameErrorCode)) {
      setAppState(prev => ({
        ...prev,
        showReconnectionProgress: true,
        reconnectionAttempt: 1
      }));
    }
  }, []);

  const hostGame = async (playerName: string) => {
    console.log('hostGame called with playerName:', playerName);
    try {
      setAppState(prev => ({ 
        ...prev, 
        playerName, 
        isConnecting: true, 
        error: undefined,
        connectionStatus: 'connecting'
      }));

      console.log('Creating GameManager...');
      const tieBreakerCallbacks: TieBreakerCallbacks = {
        onTieDetected: handleTieDetected,
        onTieResolved: handleTieResolved
      };
      
      const gameManager = new SocketGameManager(handleGameStateChange, tieBreakerCallbacks);
      
      // Set up error handling
      gameManager.onError(handleGameError);
      
      // Set up auto-submit callback (will be set by GameScreen component)
      gameManager.setAutoSubmitCallback(() => {
        console.log('🔥 Auto-submit callback triggered by server timer expiration');
        console.log('🔥 GameScreen auto-submit available:', !!(window as any).gameScreenAutoSubmit);
        // The GameScreen component will set up the actual auto-submit logic
        if ((window as any).gameScreenAutoSubmit) {
          console.log('🔥 Calling GameScreen auto-submit...');
          (window as any).gameScreenAutoSubmit();
        } else {
          console.warn('🔥 GameScreen auto-submit not available!');
        }
      });
      
      // Initialize DevTools service
      const devToolsService = new DevToolsService(gameManager);
      gameManager.setDevToolsService?.(devToolsService);
      if (config.enableDebugMode) {
        gameManager.enableDevMode?.();
      }
      
      console.log('Calling hostGame...');
      const roomCode = await gameManager.hostGame(playerName);
      console.log('Host game successful, roomCode:', roomCode);

      setAppState(prev => ({
        ...prev,
        gameManager,
        devToolsService,
        isHost: true,
        roomCode,
        currentScreen: 'lobby',
        isConnecting: false,
        connectionStatus: 'connected'
      }));
    } catch (error) {
      console.error('Error hosting game:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to host game. Please try again.';
      setAppState(prev => ({
        ...prev,
        error: errorMessage,
        isConnecting: false,
        connectionStatus: 'error'
      }));
    }
  };

  const showJoinGame = (playerName: string) => {
    setAppState(prev => ({
      ...prev,
      playerName,
      currentScreen: 'join',
      error: undefined,
      gameManager: null,
      gameState: null,
      roomCode: '',
      isConnecting: false
    }));
  };

  const joinGame = async (roomCode: string) => {
    try {
      setAppState(prev => ({ 
        ...prev, 
        isConnecting: true, 
        error: undefined,
        connectionStatus: 'connecting'
      }));

      const tieBreakerCallbacks: TieBreakerCallbacks = {
        onTieDetected: handleTieDetected,
        onTieResolved: handleTieResolved
      };
      
      const gameManager = new SocketGameManager(handleGameStateChange, tieBreakerCallbacks);
      
      // Set up error handling
      gameManager.onError(handleGameError);
      
      // Set up auto-submit callback (will be set by GameScreen component)
      gameManager.setAutoSubmitCallback(() => {
        console.log('⏰ Auto-submit triggered by server timer expiration');
        // The GameScreen component will set up the actual auto-submit logic
        if ((window as any).gameScreenAutoSubmit) {
          (window as any).gameScreenAutoSubmit();
        }
      });
      
      // Initialize DevTools service
      const devToolsService = new DevToolsService(gameManager);
      gameManager.setDevToolsService?.(devToolsService);
      if (config.enableDebugMode) {
        gameManager.enableDevMode?.();
      }
      
      await gameManager.joinGame(appState.playerName, roomCode);

      setAppState(prev => ({
        ...prev,
        gameManager,
        devToolsService,
        isHost: false,
        roomCode,
        currentScreen: 'lobby',
        isConnecting: false,
        connectionStatus: 'connected'
      }));
    } catch (error) {
      console.error('Error joining game:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to join game. Check the room code and try again.';
      setAppState(prev => ({
        ...prev,
        error: errorMessage,
        isConnecting: false,
        connectionStatus: 'error'
      }));
    }
  };

  const backToStart = () => {
    setAppState(prev => ({
      ...prev,
      currentScreen: 'start',
      error: undefined,
      isConnecting: false,
      playerName: prev.playerName || getSavedPlayerName() // Preserve current session name, fallback to saved
    }));
  };

  const clearError = () => {
    setAppState(prev => ({
      ...prev,
      error: undefined,
      showErrorModal: false
    }));
  };

  const handleRetry = () => {
    if (appState.gameManager) {
      // Clear error and attempt to reconnect
      setAppState(prev => ({
        ...prev,
        error: undefined,
        showErrorModal: false,
        isConnecting: true,
        connectionStatus: 'connecting'
      }));
      
      // Try to reconnect based on current state
      if (appState.isHost) {
        hostGame(appState.playerName);
      } else if (appState.roomCode) {
        joinGame(appState.roomCode);
      }
    }
  };

  const handleReconnect = () => {
    if (appState.gameManager) {
      setAppState(prev => ({
        ...prev,
        showReconnectionProgress: true,
        reconnectionAttempt: 1,
        isConnecting: true,
        connectionStatus: 'connecting'
      }));
      
      // Attempt reconnection
      handleRetry();
    }
  };

  const handleCancelReconnection = () => {
    setAppState(prev => ({
      ...prev,
      showReconnectionProgress: false,
      reconnectionAttempt: 0,
      isConnecting: false
    }));
  };

  const handleTieDetected = (tiedOptions: string[], winningWord: string) => {
    console.log('🎲 [APP] handleTieDetected called with options:', tiedOptions, 'winning word:', winningWord);
    setAppState(prev => ({
      ...prev,
      showTieBreaker: true,
      tiedOptions,
      winningWord
    }));
  };

  const handleTieResolved = (selectedOption: string) => {
    console.log('🎲 [APP] handleTieResolved called with option:', selectedOption);
    setAppState(prev => ({
      ...prev,
      showTieBreaker: false,
      tiedOptions: []
    }));
  };

  const startVoting = () => {
    if (appState.gameManager) {
      appState.gameManager.startVoting();
    }
  };

  const voteForWord = (word: string) => {
    if (appState.gameManager) {
      appState.gameManager.voteForWord(word);
    }
  };

  const handleTieSelectionComplete = (selectedOption: string) => {
    console.log('🎲 [APP] Tie selection complete, chosen word:', selectedOption);
    
    // Notify server that tiebreaker animation is complete
    if (appState.gameManager) {
      console.log('🎲 [APP] Notifying server that tiebreaker animation is complete');
      appState.gameManager.notifyTiebreakerAnimationComplete();
    }
    
    // Only call resolveTiebreaker if this is a manual selection (no server-determined winning word)
    if (appState.gameManager && !appState.winningWord) {
      console.log('🎲 [APP] Manual tiebreaker resolution, sending to server');
      appState.gameManager.resolveTiebreaker(selectedOption);
    } else {
      console.log('🎲 [APP] Server-resolved tiebreaker, animation complete');
    }
    
    // Hide the modal
    setAppState(prev => ({
      ...prev,
      showTieBreaker: false,
      tiedOptions: [],
      winningWord: '' // Reset winning word
    }));
  };


  // DevTools handlers
  const handleShowDevTools = useCallback(() => {
    setAppState(prev => ({
      ...prev,
      showDevTools: true
    }));
  }, []);

  const handleHideDevTools = useCallback(() => {
    setAppState(prev => ({
      ...prev,
      showDevTools: false
    }));
  }, []);

  // DevTools keyboard shortcut (Ctrl+Shift+D or Cmd+Shift+D)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (config.enableDevTools && 
          event.shiftKey && 
          (event.ctrlKey || event.metaKey) && 
          event.key === 'D') {
        event.preventDefault();
        handleShowDevTools();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleShowDevTools]);

  const renderCurrentScreen = () => {
    console.log('Rendering screen:', appState.currentScreen, 'isHost:', appState.isHost, 'roomCode:', appState.roomCode);
    switch (appState.currentScreen) {
      case 'start':
        return <StartScreen 
          onHostGame={hostGame} 
          onJoinGame={showJoinGame} 
          error={appState.error}
          onClearError={clearError}
          isConnecting={appState.isConnecting}
          connectionStatus={appState.connectionStatus}
          initialPlayerName={appState.playerName}
        />;
      case 'join':
        return (
          <JoinGameScreen
            playerName={appState.playerName}
            onJoinGame={joinGame}
            onBack={backToStart}
            error={appState.error}
            onClearError={clearError}
            isConnecting={appState.isConnecting}
          />
        );
      case 'lobby':
        return (
          <LobbyScreen
            players={appState.gameState?.players || []}
            canStart={(appState.gameState?.playerCount || 0) >= 2 && appState.isHost}
            onStartVoting={startVoting}
            isHost={appState.isHost}
            roomCode={appState.roomCode}
            isConnected={appState.gameState?.isConnected || false}
            connectionStatus={appState.connectionStatus}
            error={appState.gameState?.lastError || undefined}
            isStarting={appState.isConnecting && appState.gameState?.gamePhase === 'lobby'}
          />
        );
      case 'voting':
        if (!appState.gameState) return null;
        return (
          <VotingScreen
            wordOptions={appState.gameState.wordOptions}
            votes={appState.gameState.voteCounts}
            onVote={voteForWord}
            isConnected={appState.gameState.isConnected}
            connectionStatus={appState.connectionStatus}
            error={appState.gameState.lastError}
            playerCount={appState.gameState.playerCount}
            playersVoted={Object.values(appState.gameState.voteCounts).reduce((sum, count) => sum + count, 0)}
          />
        );
      case 'game':
        if (!appState.gameState) return null;
        return (
          <GameScreen
            word={appState.gameState.chosenWord}
            timeRemaining={appState.gameState.timeRemaining}
            onDrawingComplete={async (canvasData) => {
              if (appState.gameManager) {
                return appState.gameManager.submitDrawing(canvasData);
              }
            }}
            onFinishDrawing={() => {
              if (appState.gameManager) {
                appState.gameManager.finishDrawing();
              }
            }}
            playersFinished={[]} // Will implement this later
            currentPlayerId={appState.gameManager?.getCurrentPlayer()?.id}
            isConnected={appState.gameState.isConnected}
            connectionStatus={appState.connectionStatus}
            error={appState.gameState.lastError}
            playerCount={appState.gameState.playerCount}
            submittedDrawings={appState.gameState.submittedDrawings}
          />
        );
      case 'results':
        if (!appState.gameState) return null;
        return (
          <ResultsScreen
            gameState={appState.gameState}
            onNewGame={() => {
              if (appState.gameManager) {
                appState.gameManager.destroy();
              }
              setAppState(prev => ({ 
                ...prev, 
                currentScreen: 'start', 
                gameManager: null, 
                gameState: null,
                connectionStatus: 'disconnected',
                playerName: prev.playerName // Preserve current player name from session
              }));
            }}
            onPlayAgain={async () => {
              if (appState.gameManager) {
                try {
                  console.log('🔄 Requesting play again...');
                  await appState.gameManager.playAgain();
                  console.log('🔄 Play again request successful');
                  // The game manager will handle state updates via callbacks
                  // If successful, user will be moved to new lobby automatically
                } catch (error) {
                  console.error('🔄 Play again failed:', error);
                  // Fallback to new game if play again fails
                  appState.gameManager.destroy();
                  setAppState(prev => ({ 
                    ...prev, 
                    currentScreen: 'start', 
                    gameManager: null, 
                    gameState: null,
                    connectionStatus: 'disconnected',
                    playerName: prev.playerName,
                    error: 'Play again failed. Starting new game.'
                  }));
                }
              }
            }}
          />
        );
      default:
        return <StartScreen 
          onHostGame={hostGame} 
          onJoinGame={showJoinGame} 
          error={appState.error}
          onClearError={clearError}
          initialPlayerName={appState.playerName}
        />;
    }
  };

  return (
    <div className="App">
      <div className="overlay"></div>
      
      {/* Connection Status Indicator - Only show when there's an active game */}
      {appState.gameManager && (
        <ConnectionStatus
          connectionStatus={appState.connectionStatus}
          error={appState.gameState?.lastError || undefined}
          onRetry={handleRetry}
          className="connection-status-fixed"
        />
      )}

      {/* DevTools Button - Only show when enabled */}
      {config.enableDevTools && appState.devToolsService && (
        <button
          onClick={handleShowDevTools}
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '50px',
            height: '50px',
            fontSize: '20px',
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
          }}
          title="Open DevTools (Ctrl+Shift+D)"
        >
          🛠️
        </button>
      )}
      
      {renderCurrentScreen()}
      
      {/* Modals */}
      <TieBreakerModal
        show={appState.showTieBreaker}
        onHide={() => {}} // Modal cannot be closed manually during tie breaking
        tiedOptions={appState.tiedOptions}
        winningWord={appState.winningWord}
        onSelectionComplete={handleTieSelectionComplete}
      />

      <ErrorModal
        show={appState.showErrorModal}
        error={appState.gameManager?.getLastError() || null}
        onHide={clearError}
        onRetry={handleRetry}
        onReconnect={handleReconnect}
        isRetrying={appState.isConnecting}
        isReconnecting={appState.showReconnectionProgress}
      />

      <ReconnectionProgress
        show={appState.showReconnectionProgress}
        attempt={appState.reconnectionAttempt}
        maxAttempts={appState.maxReconnectionAttempts}
        nextAttemptIn={appState.nextAttemptIn}
        onCancel={handleCancelReconnection}
        onRetryNow={handleRetry}
        error={appState.error || ''}
      />

      {/* Waiting for Host Modal */}
      {appState.showWaitingModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-body text-center p-4">
                <div className="spinner-border text-primary mb-3" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <h5 className="mb-2">Waiting for Host</h5>
                <p className="text-muted mb-0">{appState.waitingMessage}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Developer Tools Panel */}
      {appState.devToolsService && (
        <DevTools
          show={appState.showDevTools}
          onHide={() => setAppState(prev => ({ ...prev, showDevTools: false }))}
          devToolsService={appState.devToolsService}
        />
      )}

      {/* DevTools Toggle Button - Only show in development with active game */}
      {process.env.NODE_ENV === 'development' && appState.devToolsService && (
        <button
          className="btn btn-outline-secondary position-fixed"
          style={{ bottom: '20px', right: '20px', zIndex: 1060 }}
          onClick={() => setAppState(prev => ({ ...prev, showDevTools: !prev.showDevTools }))}
        >
          🛠️ DevTools
        </button>
      )}


      {/* DevTools Modal - Only show when enabled */}
      {config.enableDevTools && appState.devToolsService && (
        <DevTools
          show={appState.showDevTools}
          onHide={handleHideDevTools}
          devToolsService={appState.devToolsService}
        />
      )}
    </div>
  );
}

export default App;
