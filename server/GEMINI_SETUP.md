# Gemini AI Setup Guide

Your doodle game now supports both OpenAI and Google Gemini for AI judging! Here's how to set it up:

## Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Sign in with your Google account
3. Click "Get API Key" 
4. Create a new API key
5. Copy the key

## Configuration

Add your Gemini API key to your environment variables:

### Development (.env file)
```bash
# Add to your .env file
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Choose which AI provider to use
AI_PROVIDER=gemini  # Options: 'openai', 'gemini', 'auto'
```

### Environment Variables
```bash
export GEMINI_API_KEY="your_gemini_api_key_here"
export AI_PROVIDER="gemini"  # Optional
```

## AI Provider Selection

The system automatically chooses the best available AI provider:

1. **AI_PROVIDER=auto** (default): Prefers Gemini > OpenAI > Mock
2. **AI_PROVIDER=gemini**: Forces Gemini (fails if no key)
3. **AI_PROVIDER=openai**: Forces OpenAI (fails if no key)

## Cost Comparison

| Provider | Free Tier | Cost per Image | Model |
|----------|-----------|----------------|-------|
| **Gemini** | 15 req/min, 1,500/day | ~$0.0025 | gemini-1.5-flash |
| **OpenAI** | None | ~$0.01-0.03 | gpt-4-vision-preview |

## Testing Gemini

```bash
# Test with Gemini
GEMINI_API_KEY=your_key ENABLE_AI_JUDGING=true AI_PROVIDER=gemini npm run dev

# Test with both (auto-select)
GEMINI_API_KEY=your_key OPENAI_API_KEY=your_openai_key ENABLE_AI_JUDGING=true npm run dev
```

## Railway Deployment

Add environment variables in Railway dashboard:
- `GEMINI_API_KEY`: Your Gemini API key
- `AI_PROVIDER`: gemini (optional)
- `ENABLE_AI_JUDGING`: true

## Benefits of Gemini

✅ **Much cheaper** than OpenAI
✅ **Free tier** available (1,500 requests/day)
✅ **Fast responses**
✅ **Good vision capabilities**
✅ **Easy to switch** between providers