import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Spinner } from 'react-bootstrap';
import AnimatedBackground from './AnimatedBackground';
import NotificationModal from './NotificationModal';
import { generateRandomName } from '../utils/nameGenerator';
import { getSavedPlayerName, savePlayerName, clearSavedPlayerName } from '../utils/userStorage';
import './StartScreen.css';

interface StartScreenProps {
  onHostGame: (playerName: string) => void;
  onJoinGame: (playerName: string) => void;
  error?: string;
  onClearError: () => void;
  isConnecting?: boolean;
  connectionStatus?: 'connecting' | 'connected' | 'disconnected' | 'error';
  initialPlayerName?: string;
}

const StartScreen: React.FC<StartScreenProps> = ({ 
  onHostGame, 
  onJoinGame, 
  error, 
  onClearError,
  isConnecting = false,
  connectionStatus = 'disconnected',
  initialPlayerName
}) => {
  const [playerName, setPlayerName] = useState('');

  // Load player name on component mount - prioritize initialPlayerName, then saved name
  useEffect(() => {
    if (initialPlayerName) {
      setPlayerName(initialPlayerName);
    } else {
      const savedName = getSavedPlayerName();
      if (savedName) {
        setPlayerName(savedName);
      }
    }
  }, [initialPlayerName]);

  const handleHostGame = () => {
    const finalName = playerName.trim() || generateRandomName();
    // Save the player name for future use
    if (finalName) {
      savePlayerName(finalName);
    }
    onHostGame(finalName);
  };

  const handleJoinGame = () => {
    const finalName = playerName.trim() || generateRandomName();
    // Save the player name for future use
    if (finalName) {
      savePlayerName(finalName);
    }
    onJoinGame(finalName);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // Default to hosting on Enter
      handleHostGame();
    }
  };

  return (
    <div className="start-screen">
      <AnimatedBackground />
      
      <Container fluid className="h-100 d-flex align-items-center">
        <Row className="w-100 justify-content-center">
          <Col xs={12} sm={10} md={8} lg={6} xl={5} className="text-center">
            
            {/* Logo Section */}
            <div className="logo-section mb-4">
              <img 
                src="/logo.svg" 
                alt="Doodle Logo" 
                className="logo-responsive" 
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }} 
              />
              <h3 className="subtitle-text mt-3">
                Compete with your friends and race the clock for the best doodle!
              </h3>
            </div>

            {/* Notification Modal */}
            <NotificationModal
              show={!!error}
              message={error || ''}
              type="error"
              onClose={onClearError}
            />

            {/* Combined Name Input and Game Options Section */}
            <div className="start-game-section">
              <div className="name-input-container mb-4">
                <Form.Control
                  type="text"
                  placeholder="Enter your name (optional)"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  maxLength={15}
                  className="name-input"
                  size="lg"
                />
                {playerName && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="clear-name-btn"
                    onClick={() => {
                      setPlayerName('');
                      clearSavedPlayerName();
                    }}
                    title="Clear saved name"
                  >
                    ×
                  </Button>
                )}
              </div>
              
              <p className="helper-text mb-4">
                {playerName.trim() 
                  ? `Ready to play, ${playerName}?` 
                  : 'No name? No problem! We\'ll generate one for you.'}
              </p>
              
              <Row className="g-3">
                <Col xs={12} sm={6}>
                  <Button
                    variant="success"
                    size="lg"
                    className={`game-btn host-btn w-100 ${isConnecting ? 'connecting' : ''}`}
                    onClick={handleHostGame}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          role="status"
                          aria-hidden="true"
                          className="me-2"
                        />
                        HOSTING...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-crown me-2"></i>
                        HOST GAME
                      </>
                    )}
                  </Button>
                </Col>
                <Col xs={12} sm={6}>
                  <Button
                    variant="info"
                    size="lg"
                    className="game-btn join-btn w-100"
                    onClick={handleJoinGame}
                    disabled={isConnecting}
                  >
                    <i className="fas fa-users me-2"></i>
                    JOIN GAME
                  </Button>
                </Col>
              </Row>
            </div>
          </Col>
        </Row>
      </Container>
    </div>
  );
};

export default StartScreen; 