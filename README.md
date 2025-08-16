# 🎨 DoodleDash

A multiplayer drawing game where players create artwork based on prompts and an AI judge evaluates the results. Built with React, Node.js, Socket.io, and OpenAI.

## ✨ Features

- **Real-time multiplayer gameplay** with WebSocket connections
- **AI-powered judging** using OpenAI's vision models
- **Interactive drawing canvas** with multiple tools and colors
- **Lobby system** with room codes for private games
- **Voting mechanics** with tie-breaker resolution
- **Responsive design** that works on desktop and mobile
- **Developer tools** for testing and debugging

## 🚀 Quick Start

### Prerequisites
- Node.js 18.x or higher
- npm 8.x or higher

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/doodledash.git
   cd doodledash
   ```

2. **Install dependencies**
   ```bash
   npm run install:all
   ```

3. **Set up environment variables**
   ```bash
   # Copy example environment file
   cp server/.env.example server/.env
   
   # Add your OpenAI API key to server/.env
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Start development servers**
   ```bash
   npm run dev
   ```

   This starts:
   - React client on http://localhost:3000
   - Node.js server on http://localhost:3001

### Production Deployment

The application is configured for easy deployment on Railway:

1. **Build the application**
   ```bash
   npm run build
   ```

2. **Start production server**
   ```bash
   npm start
   ```

The server serves both the API and the built React frontend.

## 🏗️ Architecture

### Frontend (`/client`)
- **React 19** with TypeScript
- **Bootstrap 5** for styling
- **Fabric.js** for canvas drawing
- **Socket.io-client** for real-time communication

### Backend (`/server`)
- **Express.js** server
- **Socket.io** for WebSocket connections
- **OpenAI API** for AI judging
- **Joi** for request validation

### Key Components
- **GameManager**: Unified interface for game state management
- **SocketGameManager**: Socket.io implementation with error handling
- **DevTools**: Developer utilities for testing game flows
- **Error Handling**: Comprehensive error recovery and user feedback

## 🎮 How to Play

1. **Start a Game**: Create a room or join with a room code
2. **Wait for Players**: Games need 2-6 players to start
3. **Vote on Prompts**: Choose what everyone will draw
4. **Draw**: Create your masterpiece in the time limit
5. **AI Judging**: OpenAI evaluates all drawings
6. **Results**: See scores and play again!

## 🛠️ Development

### Available Scripts

- `npm run dev` - Start development servers
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run test suites
- `npm run install:all` - Install all dependencies

### Testing

The project includes comprehensive test suites:
- **Unit tests** for game logic and utilities
- **Integration tests** for API endpoints
- **Component tests** for React components
- **End-to-end tests** for game flows

### Developer Tools

Access developer tools in development mode:
- **Game State Inspector**: View real-time game state
- **Multi-player Simulator**: Test with simulated players
- **Network Monitor**: Debug WebSocket messages
- **Error Simulator**: Test error handling

## 🚀 Deployment

### Railway (Recommended)

1. Connect your repository to Railway
2. Set environment variables:
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `NODE_ENV`: `production`
3. Deploy automatically on push

### Manual Deployment

1. Build the application: `npm run build`
2. Set environment variables
3. Start the server: `npm start`
4. Server runs on port specified by `PORT` env var (default: 3001)

## 📝 Environment Variables

### Server Configuration
- `OPENAI_API_KEY` - OpenAI API key for AI judging
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 3001)
- `CORS_ORIGINS` - Allowed CORS origins

### Optional Configuration
- `LOG_LEVEL` - Logging level (debug/info/warn/error)
- `MAX_ROOMS` - Maximum concurrent rooms
- `GAME_TIMEOUT` - Game timeout in minutes

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenAI for the vision API that powers our AI judge
- The React and Node.js communities
- Socket.io for real-time communication
- Fabric.js for canvas functionality