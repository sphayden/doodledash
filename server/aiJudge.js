const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIJudge {
  constructor() {
    // Check which AI services are available
    this.hasOpenAI = !!process.env.OPENAI_API_KEY;
    this.hasGemini = !!process.env.GEMINI_API_KEY;
    
    // Determine which service to use (preference: Gemini > OpenAI > Mock)
    this.aiProvider = process.env.AI_PROVIDER || 'auto';
    
    // Initialize OpenAI if available
    if (this.hasOpenAI) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      console.log('🤖 AI Judge: OpenAI API configured');
    }
    
    // Initialize Gemini if available
    if (this.hasGemini) {
      this.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      this.geminiModel = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
      console.log('🤖 AI Judge: Gemini API configured');
    }
    
    // Determine active provider
    this.activeProvider = this.determineActiveProvider();
    console.log(`🤖 AI Judge: Using ${this.activeProvider} for judging`);
    
    if (this.activeProvider === 'mock') {
      console.warn('⚠️ AI Judge: No API keys configured, using mock judging');
    }
  }
  
  determineActiveProvider() {
    if (this.aiProvider === 'openai' && this.hasOpenAI) return 'openai';
    if (this.aiProvider === 'gemini' && this.hasGemini) return 'gemini';
    
    // Auto selection (prefer Gemini for cost efficiency)
    if (this.hasGemini) return 'gemini';
    if (this.hasOpenAI) return 'openai';
    
    return 'mock';
  }

  /**
   * Evaluate all drawings and return ranked results
   */
  async evaluateDrawings(drawingSubmissions) {
    if (!drawingSubmissions || drawingSubmissions.length === 0) {
      return [];
    }

    console.log(`🤖 AI Judge: Evaluating ${drawingSubmissions.length} drawings for word: "${drawingSubmissions[0].word}" using ${this.activeProvider}`);
    
    // If no AI is available, use mock judging
    if (this.activeProvider === 'mock') {
      return this.mockEvaluateDrawings(drawingSubmissions);
    }
    
    try {
      // Evaluate each drawing
      const evaluations = await Promise.all(
        drawingSubmissions.map(submission => this.evaluateDrawing(submission))
      );
      
      // Sort by score (highest first)
      evaluations.sort((a, b) => b.score - a.score);
      
      // Assign ranks with proper tie handling
      this.assignRanksWithTies(evaluations);
      
      console.log('🏆 AI Judge: Evaluation complete');
      evaluations.forEach(result => {
        console.log(`   ${result.rank}. ${result.playerName}: ${result.score}/100`);
      });
      
      return evaluations;
    } catch (error) {
      console.error('❌ AI Judge: Evaluation failed:', error);
      
      // Don't generate fake results - throw the error to be handled properly
      throw new Error(`AI judging failed: ${error.message}`);
    }
  }

  /**
   * Evaluate a single drawing
   */
  async evaluateDrawing(submission) {
    const { playerId, playerName, canvasData, word } = submission;
    
    try {
      let aiResponse;
      
      if (this.activeProvider === 'openai') {
        aiResponse = await this.evaluateWithOpenAI(canvasData, word);
      } else if (this.activeProvider === 'gemini') {
        aiResponse = await this.evaluateWithGemini(canvasData, word);
      } else {
        throw new Error('No AI provider available');
      }
      
      // Debug: Log the raw AI response to understand what we're getting
      console.log(`🔍 [DEBUG] Raw AI response for ${playerName}:`, aiResponse);
      
      const score = this.parseScore(aiResponse);
      const feedback = this.parseFeedback(aiResponse);
      
      console.log(`🔍 [DEBUG] Parsed score for ${playerName}: ${score}`);
      
      return {
        playerId,
        playerName,
        score,
        feedback,
        canvasData,
        rank: 0 // Will be set after sorting
      };
      
    } catch (error) {
      console.error(`❌ AI Judge: Failed to evaluate drawing for ${playerName}:`, error);
      
      // Don't return fake results - rethrow the error to be handled at a higher level
      throw error;
    }
  }
  
  /**
   * Evaluate drawing using OpenAI GPT-4V
   */
  async evaluateWithOpenAI(canvasData, word) {
    const response = await this.openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: this.generateEvaluationPrompt(word)
            },
            {
              type: "image_url",
              image_url: {
                url: canvasData,
                detail: "low" // Use low detail to reduce costs and improve speed
              }
            }
          ]
        }
      ],
      max_tokens: 150,
      temperature: 0.1 // Low temperature for consistent scoring
    });
    
    return response.choices[0].message.content;
  }
  
  /**
   * Evaluate drawing using Google Gemini
   */
  async evaluateWithGemini(canvasData, word) {
    // Convert base64 data URL to format Gemini expects
    const base64Data = canvasData.replace(/^data:image\/[a-z]+;base64,/, '');
    
    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: "image/png"
      }
    };
    
    const prompt = this.generateEvaluationPrompt(word);
    
    const result = await this.geminiModel.generateContent([prompt, imagePart]);
    const response = await result.response;
    return response.text();
  }

  /**
   * Generate evaluation prompt for GPT-4V
   */
  generateEvaluationPrompt(word) {
    return `You are an AI judge for a multiplayer drawing game. Your job is to fairly evaluate this drawing of "${word}" on a scale of 1-100.

Scoring Guidelines:
• 80-100: Excellent - Very clear, detailed, recognizable representation
• 60-79: Good - Clearly recognizable with decent effort
• 40-59: Average - Somewhat recognizable, basic effort
• 20-39: Poor - Hard to recognize, minimal effort
• 1-19: Very Poor - Unrecognizable or no real attempt

Evaluation Criteria:
1. How recognizable is this as "${word}"?
2. What level of artistic effort and detail is shown?
3. How accurately does it represent the real appearance of "${word}"?

IMPORTANT: You must respond in this EXACT format:
SCORE: [number]
FEEDBACK: [your explanation]

Example:
SCORE: 73
FEEDBACK: Clear drawing with good proportions and recognizable features.`;
  }

  /**
   * Parse score from AI response
   */
  parseScore(response) {
    const scoreMatch = response.match(/SCORE:\s*(\d+)/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1]);
      return Math.max(1, Math.min(100, score)); // Clamp between 1-100
    }
    
    // Fallback: try to find any number in response
    const numberMatch = response.match(/(\d+)/);
    if (numberMatch) {
      const score = parseInt(numberMatch[1]);
      if (score >= 1 && score <= 100) {
        return score;
      }
    }
    
    // Final fallback
    console.warn('⚠️ AI Judge: Could not parse score from response:', response);
    console.warn('⚠️ AI Judge: Using fallback random score');
    return Math.floor(Math.random() * 40) + 30; // Random 30-70
  }

  /**
   * Parse feedback from AI response
   */
  parseFeedback(response) {
    const feedbackMatch = response.match(/FEEDBACK:\s*(.+)/i);
    if (feedbackMatch) {
      return feedbackMatch[1].trim();
    }
    
    // If no explicit feedback found, use the whole response (truncated)
    const cleanResponse = response.replace(/SCORE:\s*\d+/i, '').trim();
    return cleanResponse.slice(0, 100) + (cleanResponse.length > 100 ? '...' : '');
  }

  /**
   * Generate fallback results when AI fails
   */
  generateFallbackResults(drawingSubmissions) {
    console.log('🎲 AI Judge: Using fallback random scoring');
    
    const results = drawingSubmissions.map(submission => ({
      playerId: submission.playerId,
      playerName: submission.playerName,
      score: Math.floor(Math.random() * 60) + 20, // Random 20-80
      feedback: "Technical difficulties prevented AI evaluation. Score is randomly assigned.",
      canvasData: submission.canvasData,
      rank: 0
    }));
    
    // Sort and rank with tie handling
    results.sort((a, b) => b.score - a.score);
    this.assignRanksWithTies(results);
    
    return results;
  }

  /**
   * Test method for validating AI connection
   */
  async testConnection() {
    try {
      if (this.activeProvider === 'openai') {
        const response = await this.openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: "Hello, this is a test." }],
          max_tokens: 10
        });
        return { success: true, message: "OpenAI connection successful", provider: 'openai' };
      } else if (this.activeProvider === 'gemini') {
        const result = await this.geminiModel.generateContent("Hello, this is a test.");
        const response = await result.response;
        return { success: true, message: "Gemini connection successful", provider: 'gemini' };
      } else {
        return { success: false, message: "No AI provider configured", provider: 'mock' };
      }
    } catch (error) {
      return { success: false, message: error.message, provider: this.activeProvider };
    }
  }
  /**
   * Mock evaluation for when OpenAI is not available
   */
  mockEvaluateDrawings(drawingSubmissions) {
    console.log('🎭 Using mock AI judging (OpenAI not configured)');
    
    return drawingSubmissions.map((submission, index) => ({
      playerId: submission.playerId,
      playerName: submission.playerName,
      rank: index + 1,
      score: Math.floor(Math.random() * 40) + 60, // Random score between 60-100
      feedback: `Great drawing! ${this.getMockFeedback()}`,
      canvasData: submission.canvasData
    }));
    
    // Sort and assign ranks with tie handling
    results.sort((a, b) => b.score - a.score);
    this.assignRanksWithTies(results);
    
    return results;
  }
  
  /**
   * Get random mock feedback
   */
  /**
   * Assign ranks with proper tie handling
   * Players with the same score get the same rank
   */
  assignRanksWithTies(results) {
    let currentRank = 1;
    let previousScore = null;
    let playersAtCurrentRank = 0;
    
    results.forEach((result, index) => {
      if (previousScore !== null && result.score < previousScore) {
        // Score decreased, update rank
        currentRank += playersAtCurrentRank;
        playersAtCurrentRank = 1;
      } else if (previousScore === null || result.score === previousScore) {
        // First player or tied score
        playersAtCurrentRank++;
      }
      
      result.rank = currentRank;
      previousScore = result.score;
    });
    
    // Log tie information
    const tiedGroups = this.findTiedGroups(results);
    if (tiedGroups.length > 0) {
      console.log('🤝 Ties detected:');
      tiedGroups.forEach(group => {
        const playerNames = group.players.map(p => p.playerName).join(', ');
        console.log(`   Rank ${group.rank}: ${playerNames} (${group.score} points)`);
      });
    }
  }
  
  /**
   * Find groups of tied players
   */
  findTiedGroups(results) {
    const tiedGroups = [];
    const scoreGroups = {};
    
    // Group players by score
    results.forEach(result => {
      if (!scoreGroups[result.score]) {
        scoreGroups[result.score] = [];
      }
      scoreGroups[result.score].push(result);
    });
    
    // Find groups with more than one player (ties)
    Object.entries(scoreGroups).forEach(([score, players]) => {
      if (players.length > 1) {
        tiedGroups.push({
          score: parseInt(score),
          rank: players[0].rank,
          players: players
        });
      }
    });
    
    return tiedGroups;
  }

  getMockFeedback() {
    const feedbacks = [
      "Nice use of colors and shapes!",
      "Creative interpretation of the word!",
      "Good attention to detail!",
      "Excellent artistic style!",
      "Very recognizable drawing!",
      "Great composition and balance!",
      "Impressive creativity!",
      "Well-executed concept!"
    ];
    return feedbacks[Math.floor(Math.random() * feedbacks.length)];
  }
}

module.exports = AIJudge;