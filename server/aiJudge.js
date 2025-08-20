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
    
    // Auto selection (prefer OpenAI for better reliability)
    if (this.hasOpenAI) return 'openai';
    if (this.hasGemini) return 'gemini';
    
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
      // Evaluate all drawings together for relative comparison
      const evaluations = await this.evaluateAllDrawingsTogether(drawingSubmissions);
      
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
      
      // Check for empty canvas first (applies to all providers)
      if (this.isCanvasEmpty(canvasData)) {
        console.log(`🖼️ Empty canvas detected for ${playerName}`);
        aiResponse = `SCORE: 3\nFEEDBACK: No drawing detected - appears to be a blank canvas.`;
      } else if (this.activeProvider === 'openai') {
        aiResponse = await this.evaluateWithOpenAI(canvasData, word);
      } else if (this.activeProvider === 'gemini') {
        aiResponse = await this.evaluateWithGemini(canvasData, word);
      } else {
        throw new Error('No AI provider available');
      }
      
      // Debug: Log the raw AI response to understand what we're getting
      console.log(`🔍 [DEBUG] Raw AI response for ${playerName}:`, aiResponse);
      
      const score = this.parseScore(aiResponse);
      const feedback = this.parseFeedback(aiResponse, this.activeProvider);
      
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
   * Evaluate all drawings together for relative comparison
   */
  async evaluateAllDrawingsTogether(drawingSubmissions) {
    const { word } = drawingSubmissions[0];
    
    try {
      let aiResponse;
      
      if (this.activeProvider === 'openai') {
        aiResponse = await this.evaluateAllWithOpenAI(drawingSubmissions, word);
      } else if (this.activeProvider === 'gemini') {
        aiResponse = await this.evaluateAllWithGemini(drawingSubmissions, word);
      } else {
        throw new Error('No AI provider available');
      }
      
      // Debug: Log the raw AI response
      console.log(`🔍 [DEBUG] Raw batch AI response:`, aiResponse);
      
      // Parse the batch response into individual results
      const evaluations = this.parseBatchResponse(aiResponse, drawingSubmissions);
      
      return evaluations;
      
    } catch (error) {
      console.error(`❌ AI Judge: Failed to evaluate drawings in batch:`, error);
      console.log('🔄 AI Judge: Falling back to individual evaluation');
      
      // Fallback to individual evaluation if batch fails
      const evaluations = await Promise.all(
        drawingSubmissions.map(submission => this.evaluateDrawing(submission))
      );
      
      return evaluations;
    }
  }
  
  /**
   * Check if canvas is empty or mostly empty
   */
  isCanvasEmpty(canvasData) {
    try {
      // Extract base64 data
      const base64Data = canvasData.replace(/^data:image\/[a-z]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Very rough heuristic: small file size likely means empty canvas
      // Empty/mostly empty canvas typically < 5KB
      const isEmpty = buffer.length < 5000;
      
      console.log(`🔍 Canvas size check: ${buffer.length} bytes, isEmpty: ${isEmpty}`);
      return isEmpty;
    } catch (error) {
      console.warn('❌ Error checking canvas emptiness:', error);
      return false;
    }
  }

  /**
   * Evaluate drawing using OpenAI GPT-4V with improved consistency
   */
  async evaluateWithOpenAI(canvasData, word) {
    // Check for empty canvas first
    if (this.isCanvasEmpty(canvasData)) {
      console.log('📝 Empty canvas detected, assigning low score');
      return `SCORE: 5
FEEDBACK: No drawing detected - appears to be a blank canvas.`;
    }

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
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
                detail: "high" // Higher detail for better accuracy
              }
            }
          ]
        }
      ],
      max_tokens: 200, // More tokens for detailed feedback
      temperature: 0.1, // Lower temperature for more consistent scoring
      seed: 42 // Fixed seed for more consistency
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
   * Evaluate all drawings with OpenAI in a single request
   */
  async evaluateAllWithOpenAI(drawingSubmissions, word) {
    const content = [
      {
        type: "text",
        text: this.generateBatchEvaluationPrompt(word, drawingSubmissions)
      }
    ];

    // Add all images to the content array
    drawingSubmissions.forEach((submission, index) => {
      content.push({
        type: "image_url",
        image_url: {
          url: submission.canvasData,
          detail: "low"
        }
      });
    });

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: content
      }],
      max_tokens: 1000, // Increased for multiple evaluations
      temperature: 0.1, // Lower temperature for consistency
      seed: 42 // Fixed seed for reproducible results
    });
    
    return response.choices[0].message.content;
  }

  /**
   * Evaluate all drawings with Gemini in a single request
   */
  async evaluateAllWithGemini(drawingSubmissions, word) {
    const prompt = this.generateBatchEvaluationPrompt(word, drawingSubmissions);
    const contentParts = [prompt];

    // Add all images
    drawingSubmissions.forEach((submission) => {
      const base64Data = submission.canvasData.replace(/^data:image\/[a-z]+;base64,/, '');
      contentParts.push({
        inlineData: {
          data: base64Data,
          mimeType: "image/png"
        }
      });
    });

    const result = await this.geminiModel.generateContent(contentParts);
    const response = await result.response;
    return response.text();
  }

  /**
   * Generate evaluation prompt for GPT-4V
   */
  generateEvaluationPrompt(word) {
    return `You are an AI judge for a multiplayer drawing game. Evaluate this drawing of "${word}" on a scale of 1-100.

CRITICAL INSTRUCTIONS:
- Be CONSISTENT in your scoring - similar drawings should get similar scores
- Examine the image carefully for ANY drawn content before scoring
- Empty or blank canvases should score 1-10 maximum
- Use the FULL scoring range 1-100
- AVOID multiples of 5 - use specific scores like 67, 73, 84, 91, 88

SCORING CRITERIA (be strict and consistent):
• 90-100: Exceptional - Professional quality, highly detailed, instantly recognizable
• 80-89: Very Good - Clear representation, good detail, easily recognizable
• 70-79: Good - Recognizable with decent effort and some detail
• 60-69: Above Average - Somewhat recognizable, basic effort shown
• 50-59: Average - Minimally recognizable, limited effort
• 40-49: Below Average - Hard to identify, very basic attempt
• 30-39: Poor - Barely resembles "${word}", minimal effort
• 20-29: Very Poor - Almost unrecognizable, very little effort
• 10-19: Extremely Poor - No clear attempt to draw "${word}"
• 1-9: No Effort - Blank canvas, scribbles, or completely unrelated

EVALUATION CHECKLIST:
1. Is there ANY visible drawing content? (If no → score 1-10)
2. Can you recognize it as "${word}"? (If no → score 10-40)
3. How much effort and detail is shown? (affects score range)
4. How accurate is it to real "${word}"? (affects final score)

REQUIRED FORMAT:
SCORE: [number 1-100]
FEEDBACK: [one clear sentence explaining the score]

Be objective, consistent, and thorough in your evaluation.`;
  }

  /**
   * Generate batch evaluation prompt for comparing multiple drawings
   */
  generateBatchEvaluationPrompt(word, drawingSubmissions) {
    const playerList = drawingSubmissions.map((submission, index) => 
      `Drawing ${index + 1}: ${submission.playerName}`
    ).join('\n');

    return `You are an AI judge for a multiplayer drawing game. You will see ${drawingSubmissions.length} drawings of "${word}" and must evaluate and rank them relative to each other.

${playerList}

CRITICAL SCORING INSTRUCTIONS:
- Score each drawing from 1-100 based on how well it represents "${word}"
- Compare drawings relative to each other - better drawings should get higher scores
- AVOID multiples of 5 (70, 75, 80, 85, 90) - use fluid scores like 67, 73, 84, 91, 88
- Use the full scoring range and create meaningful differences between drawings
- Avoid clustering scores - spread them out naturally based on quality differences
- Consider: recognizability, artistic effort, accuracy, creativity, and execution

Scoring Guidelines:
• 90-100: Exceptional quality, instantly recognizable, detailed
• 80-89: Very good representation, clear and well-executed
• 70-79: Good drawing, recognizable with decent effort
• 60-69: Above average, somewhat recognizable
• 50-59: Average attempt, basic recognizability
• 40-49: Below average, hard to recognize
• 30-39: Poor attempt, barely resembles the word
• 20-29: Very poor, almost unrecognizable
• 10-19: Minimal effort, no clear attempt
• 1-9: No real effort or completely unrelated

IMPORTANT: Respond with evaluations for each drawing in this EXACT format:

DRAWING 1 - ${drawingSubmissions[0]?.playerName}:
SCORE: [number]
FEEDBACK: [one sentence]

DRAWING 2 - ${drawingSubmissions[1]?.playerName}:
SCORE: [number]  
FEEDBACK: [one sentence]

${drawingSubmissions.slice(2).map((submission, index) => 
  `DRAWING ${index + 3} - ${submission.playerName}:\nSCORE: [number]\nFEEDBACK: [one sentence]`
).join('\n\n')}

Evaluate each drawing thoughtfully and provide varied, fair scores that reflect their relative quality.`;
  }

  /**
   * Parse batch response into individual results
   */
  parseBatchResponse(response, drawingSubmissions) {
    const evaluations = [];
    
    // Split response into sections for each drawing
    const drawingMatches = response.match(/DRAWING\s+(\d+)\s*-\s*([^:]+):\s*SCORE:\s*(\d+)\s*FEEDBACK:\s*([^\n]+)/gi);
    
    if (!drawingMatches) {
      console.warn('⚠️ AI Judge: Could not parse batch response, falling back to individual evaluation');
      throw new Error('Failed to parse batch response');
    }
    
    drawingMatches.forEach((match, index) => {
      const detailMatch = match.match(/DRAWING\s+(\d+)\s*-\s*([^:]+):\s*SCORE:\s*(\d+)\s*FEEDBACK:\s*(.+)/i);
      
      if (detailMatch && index < drawingSubmissions.length) {
        const drawingNum = parseInt(detailMatch[1]) - 1; // Convert to 0-based index
        const playerName = detailMatch[2].trim();
        const score = Math.max(1, Math.min(100, parseInt(detailMatch[3])));
        const feedback = detailMatch[4].trim();
        
        // Find matching submission by player name or use index
        let submission = drawingSubmissions.find(s => s.playerName === playerName);
        if (!submission && drawingNum >= 0 && drawingNum < drawingSubmissions.length) {
          submission = drawingSubmissions[drawingNum];
        }
        
        if (submission) {
          evaluations.push({
            playerId: submission.playerId,
            playerName: submission.playerName,
            score: score,
            feedback: `${this.activeProvider === 'openai' ? 'OpenAI' : this.activeProvider === 'gemini' ? 'Gemini' : 'AI'} says - ${feedback}`,
            canvasData: submission.canvasData,
            rank: 0 // Will be set after sorting
          });
        }
      }
    });
    
    // If we couldn't parse enough results, throw error to fall back
    if (evaluations.length !== drawingSubmissions.length) {
      console.warn(`⚠️ AI Judge: Parsed ${evaluations.length} results but expected ${drawingSubmissions.length}`);
      throw new Error('Incomplete batch parsing');
    }
    
    return evaluations;
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
  parseFeedback(response, provider = 'AI') {
    let feedback = '';
    const feedbackMatch = response.match(/FEEDBACK:\s*(.+)/i);
    if (feedbackMatch) {
      feedback = feedbackMatch[1].trim();
    } else {
      // If no explicit feedback found, use the whole response (truncated)
      const cleanResponse = response.replace(/SCORE:\s*\d+/i, '').trim();
      feedback = cleanResponse.slice(0, 100) + (cleanResponse.length > 100 ? '...' : '');
    }
    
    // Add provider prefix
    const providerName = provider === 'openai' ? 'OpenAI' : provider === 'gemini' ? 'Gemini' : 'AI';
    return `${providerName} says - ${feedback}`;
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
      feedback: "Fallback AI says - Technical difficulties prevented AI evaluation. Score is randomly assigned.",
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
      feedback: `Mock AI says - Great drawing! ${this.getMockFeedback()}`,
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