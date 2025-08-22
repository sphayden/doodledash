/**
 * ResultsScreen Component - Enhanced results display with animations and modern UI
 * Matches the application's design theme with blue background and card-based layout
 */

import React, { useState, useEffect } from 'react';
import { Button, Badge, Modal } from 'react-bootstrap';
import AnimatedBackground from './AnimatedBackground';
import { GameResult, GameState } from '../interfaces/GameManager';
import './ResultsScreen.css';

interface ResultsScreenProps {
  gameState: GameState;
  onNewGame: () => void;
  onPlayAgain?: () => void;
}

const ResultsScreen: React.FC<ResultsScreenProps> = ({
  gameState,
  onNewGame,
  onPlayAgain
}) => {
  // Initialize showResults based on game state to prevent blank screen
  const [showResults, setShowResults] = useState(
    gameState.gamePhase === 'judging' || 
    gameState.gamePhase === 'judging-failed' || 
    (gameState.results && gameState.results.length > 0)
  );
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const [showDrawingModal, setShowDrawingModal] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<GameResult | null>(null);
  // Removed: const [showCelebration, setShowCelebration] = useState(false);
  const [showJudgingErrorModal, setShowJudgingErrorModal] = useState(false);
  // Initialize loading modal based on current judging state to prevent blank screen
  const [showJudgingLoadingModal, setShowJudgingLoadingModal] = useState(gameState.gamePhase === 'judging');
  
  // Detect game phases
  const judgingFailed = gameState.gamePhase === 'judging-failed';
  const isJudging = gameState.gamePhase === 'judging';
  const hasResults = gameState.results && gameState.results.length > 0;

  // Handle different phases and modals - immediate response
  useEffect(() => {
    // Show loading modal immediately if currently judging
    if (isJudging) {
      setShowJudgingLoadingModal(true);
      setShowJudgingErrorModal(false);
      setShowResults(true);
    }
    // Show error modal if judging failed
    else if (judgingFailed) {
      setShowJudgingLoadingModal(false);
      setShowJudgingErrorModal(true);
      setShowResults(true);
    }
    // Show results without celebration overlay
    else if (hasResults) {
      setShowJudgingLoadingModal(false);
      setShowJudgingErrorModal(false);
      setShowResults(true);
    }
    // Default case - show results after brief delay for smooth transition
    else {
      const timer = setTimeout(() => setShowResults(true), 100);
      return () => clearTimeout(timer);
    }
  }, [gameState.results, gameState.gamePhase, judgingFailed, isJudging, hasResults]);
  
  // Reset modal state when component unmounts or game state changes significantly
  useEffect(() => {
    // Reset modal state when switching away from results screen
    return () => {
      setShowJudgingErrorModal(false);
      setShowJudgingLoadingModal(false);
      setShowDrawingModal(false);
    };
  }, []);

  // Animate individual results
  useEffect(() => {
    if (!showResults || !gameState.results) return;

    const animateResults = async () => {
      for (let i = 0; i < gameState.results.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        setCurrentResultIndex(i);
      }
    };

    animateResults();
  }, [showResults, gameState.results]);

  const handleDrawingClick = (result: GameResult) => {
    setSelectedDrawing(result);
    setShowDrawingModal(true);
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${rank}`;
    }
  };

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1: return '#FFD700'; // Gold
      case 2: return '#C0C0C0'; // Silver
      case 3: return '#CD7F32'; // Bronze
      default: return '#6c757d'; // Gray
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return '#28a745'; // Green
    if (score >= 70) return '#ffc107'; // Yellow
    if (score >= 50) return '#fd7e14'; // Orange
    return '#dc3545'; // Red
  };

  // For judging failed, we want to show the drawings even without results
  if (!hasResults && !judgingFailed) {
    return (
      <div className="results-screen">
        <AnimatedBackground />
        <div className="container-fluid">
          <div className="results-container">
            <div className="results-header">
              <h1 className="results-title">🎨 Game Results</h1>
              <p className="results-subtitle">No results available</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="results-screen">
      <AnimatedBackground />
      
      {/* Removed celebration overlay for cleaner results display */}

      <div className="container-fluid">
        <div className="results-container">
          
          {/* Header */}
          <div className="results-header">
            <div className="logo-container">
              <img 
                src="/logo.png" 
                alt="Doodle Logo" 
                className="logo-responsive"
                onError={(e) => {
                  // Fallback to text logo if image fails to load
                  const parent = e.currentTarget.parentElement;
                  if (parent) {
                    parent.innerHTML = '<div class="text-logo">🎨 DOODLE</div>';
                  }
                }}
              />
            </div>
            <h1 className="results-title">
              🎨 {isJudging ? 'AI Judging in Progress...' : judgingFailed ? 'Game Complete!' : 'Final Results!'}
            </h1>
            <p className="results-subtitle">
              The word was: <span className="chosen-word">"{gameState.chosenWord}"</span>
            </p>
          </div>

          {/* Results Grid */}
          <div className="results-grid-container">
            {((hasResults && gameState.results.length > 3) || (isJudging && gameState.playerCount > 3)) && (
              <div className="scroll-hint">
                <span>← Scroll to see all {isJudging ? 'drawings' : 'results'} →</span>
              </div>
            )}
            <div className="results-grid">
              {/* Show results if available, or create placeholder cards during judging */}
              {(hasResults ? gameState.results.sort((a, b) => a.rank - b.rank) : 
                isJudging ? gameState.players?.map(player => ({
                  playerId: player.id,
                  playerName: player.name,
                  canvasData: '', // Will be populated when drawings are available
                  rank: 0,
                  score: 0,
                  feedback: ''
                })) || [] : [])
                .map((result, index) => (
                <div
                  key={result.playerId}
                  className={`result-card ${
                    showResults && index <= currentResultIndex ? 'visible' : ''
                  } ${!judgingFailed && result.rank === 1 ? 'winner' : ''}`}
                  style={{ 
                    animationDelay: `${index * 0.3}s`,
                    '--rank-color': getRankColor(result.rank)
                  } as React.CSSProperties}
                >
                  <div className="result-card-inner">
                    
                    {/* Rank Badge - only show if judging succeeded */}
                    {!judgingFailed && !isJudging && (
                      <div className="rank-badge" style={{ backgroundColor: getRankColor(result.rank) }}>
                        <span className="rank-icon">{getRankIcon(result.rank)}</span>
                      </div>
                    )}

                    {/* Player Info */}
                    <div className="player-section">
                      <h3 className="player-name">{result.playerName}</h3>
                      {!judgingFailed && !isJudging && (
                        <div className="score-section">
                          <div 
                            className="score-circle"
                            style={{ borderColor: getScoreColor(result.score) }}
                          >
                            <span 
                              className="score-number"
                              style={{ color: getScoreColor(result.score) }}
                            >
                              {result.score}
                            </span>
                            <span className="score-label">/ 100</span>
                          </div>
                        </div>
                      )}
                      {isJudging && (
                        <div className="judging-indicator">
                          <div className="spinner-border spinner-border-sm text-primary" role="status">
                            <span className="visually-hidden">Judging...</span>
                          </div>
                          <small className="text-muted ms-2">Being judged...</small>
                        </div>
                      )}
                    </div>

                    {/* Drawing Preview */}
                    <div className="drawing-section">
                      <div 
                        className="drawing-preview"
                        onClick={() => handleDrawingClick(result)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleDrawingClick(result);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View ${result.playerName}'s drawing in full size`}
                      >
                        <img 
                          src={result.canvasData} 
                          alt={`${result.playerName}'s drawing of "${gameState.chosenWord}"`}
                          className="drawing-image"
                          onError={(e) => {
                            // Fallback for broken images
                            e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjhmOWZhIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzZjNzU3ZCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
                          }}
                        />
                        <div className="drawing-overlay">
                          <span className="view-text">👁️ View</span>
                        </div>
                      </div>
                    </div>

                    {/* AI Feedback - only show if judging succeeded */}
                    {!judgingFailed && !isJudging && (
                      <div className="feedback-section">
                        <div className="feedback-bubble">
                          <div className="feedback-header">
                            <span className="ai-icon">🤖</span>
                            <span className="ai-label">AI Judge</span>
                          </div>
                          <p className="feedback-text">{result.feedback}</p>
                        </div>
                      </div>
                    )}
                    
                    {/* Judging placeholder */}
                    {isJudging && (
                      <div className="feedback-section">
                        <div className="feedback-bubble bg-light">
                          <div className="feedback-header">
                            <span className="ai-icon">🤖</span>
                            <span className="ai-label">AI Judge</span>
                          </div>
                          <p className="feedback-text text-muted">
                            <em>Analyzing drawing...</em>
                          </p>
                        </div>
                      </div>
                    )}

                  </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Action Buttons - Hide during judging */}
          {!isJudging && (
            <div className="action-section">
            <div className="action-buttons">
              {onPlayAgain && (
                <Button
                  className="action-btn play-again-btn"
                  onClick={() => {
                    // Hide any open modals before playing again
                    setShowJudgingErrorModal(false);
                    setShowJudgingLoadingModal(false);
                    setShowDrawingModal(false);
                    onPlayAgain();
                  }}
                  size="lg"
                >
                  🔄 Play Again
                </Button>
              )}
              <Button
                className="action-btn new-game-btn"
                onClick={() => {
                  // Hide any open modals before starting new game
                  setShowJudgingErrorModal(false);
                  setShowJudgingLoadingModal(false);
                  setShowDrawingModal(false);
                  onNewGame();
                }}
                size="lg"
              >
                🏠 New Game
              </Button>
              </div>
              
              {/* Game Stats */}
              <div className="game-stats">
                <div className="stat-item">
                  <span className="stat-label">Players:</span>
                  <span className="stat-value">{hasResults ? gameState.results.length : gameState.playerCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Word:</span>
                  <span className="stat-value">"{gameState.chosenWord}"</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Room:</span>
                  <span className="stat-value">{gameState.roomCode}</span>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Drawing Modal */}
      <Modal 
        show={showDrawingModal} 
        onHide={() => setShowDrawingModal(false)}
        size="lg"
        centered
        className="drawing-modal"
      >
        <Modal.Header closeButton className="drawing-modal-header">
          <Modal.Title>
            {selectedDrawing?.playerName}'s Drawing
            <Badge 
              className="ms-2"
              style={{ backgroundColor: getRankColor(selectedDrawing?.rank || 0) }}
            >
              {getRankIcon(selectedDrawing?.rank || 0)}
            </Badge>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="drawing-modal-body">
          {selectedDrawing && (
            <>
              <div className="modal-drawing-container">
                <img 
                  src={selectedDrawing.canvasData} 
                  alt={`${selectedDrawing.playerName}'s drawing`}
                  className="modal-drawing-image"
                />
              </div>
              <div className="modal-drawing-info">
                <div className="modal-score">
                  <span className="modal-score-label">Score:</span>
                  <span 
                    className="modal-score-value"
                    style={{ color: getScoreColor(selectedDrawing.score) }}
                  >
                    {selectedDrawing.score}/100
                  </span>
                </div>
                <div className="modal-feedback">
                  <div className="modal-feedback-header">
                    <span className="ai-icon">🤖</span>
                    <span>AI Feedback</span>
                  </div>
                  <p className="modal-feedback-text">{selectedDrawing.feedback}</p>
                </div>
              </div>
            </>
          )}
        </Modal.Body>
      </Modal>

      {/* AI Judging Error Modal */}
      <Modal 
        show={showJudgingErrorModal} 
        onHide={() => setShowJudgingErrorModal(false)}
        centered
        className="judging-error-modal"
      >
        <Modal.Header closeButton className="bg-warning text-dark">
          <Modal.Title>
            <i className="fas fa-exclamation-triangle me-2"></i>
            AI Judging Failed
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-3">
            Unfortunately, the AI judge couldn't evaluate the drawings due to a technical issue.
          </p>
          <p className="mb-3">
            <strong>Error:</strong> {gameState.judgingError || 'Unknown error'}
          </p>
          <p className="mb-0">
            You can still view all the amazing artwork and use the "New Game" or "Play Again" buttons below!
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowJudgingErrorModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* AI Judging Loading Modal */}
      <Modal 
        show={showJudgingLoadingModal} 
        onHide={() => {}} // Cannot be closed during judging
        centered
        className="judging-loading-modal"
        backdrop="static" // Prevent closing by clicking outside
        keyboard={false} // Prevent closing with ESC
      >
        <Modal.Header className="bg-primary text-white text-center">
          <Modal.Title className="w-100 text-center">
            <i className="fas fa-robot me-2"></i>
            AI Judge at Work
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="text-center py-4">
          <div className="d-flex flex-column align-items-center">
            {/* Animated AI Judge Icon */}
            <div className="ai-judge-animation mb-3">
              <div className="judge-emoji">🤖</div>
              <div className="thinking-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </div>
            </div>
            
            {/* Dynamic Status Messages */}
            <h5 className="mb-3 judging-status">Analyzing your masterpieces...</h5>
            <p className="text-muted mb-3">
              Our AI judge is carefully evaluating each drawing for <strong>"{gameState.chosenWord}"</strong>
            </p>
            
            {/* Artistic Progress Indicators */}
            <div className="judging-criteria mb-3">
              <div className="criteria-item">
                <span className="criteria-icon">👁️</span>
                <span className="criteria-text">Recognizability</span>
                <div className="criteria-check">✓</div>
              </div>
              <div className="criteria-item">
                <span className="criteria-icon">🎨</span>
                <span className="criteria-text">Creativity</span>
                <div className="criteria-check">✓</div>
              </div>
              <div className="criteria-item">
                <span className="criteria-icon">⚡</span>
                <span className="criteria-text">Execution</span>
                <div className="criteria-check">✓</div>
              </div>
            </div>
            
            {/* Animated Progress Bar */}
            <div className="progress w-100 mb-3 judging-progress" style={{height: '12px'}}>
              <div 
                className="progress-bar progress-bar-striped progress-bar-animated"
                style={{
                  width: '100%',
                  background: 'linear-gradient(45deg, #007bff, #0056b3, #007bff)',
                  backgroundSize: '200% 100%',
                  animation: 'judging-gradient 2s linear infinite'
                }}
              ></div>
            </div>
            
            <div className="judging-tips">
              <small className="text-muted">
                <span className="tip-icon">💡</span>
                The AI considers artistic effort, accuracy, and how well the drawing represents "{gameState.chosenWord}"
              </small>
            </div>
          </div>
        </Modal.Body>
      </Modal>

    </div>
  );
};

export default ResultsScreen;