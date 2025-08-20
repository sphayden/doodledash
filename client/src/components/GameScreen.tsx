import React, { useEffect, useState, useRef, useCallback } from 'react';
// REMOVED FABRIC.JS - Using pure HTML5 canvas for pixel-perfect drawing
// import { Canvas, PencilBrush, FabricImage } from 'fabric';
import { Alert, Spinner } from 'react-bootstrap';
import { GameError } from '../interfaces';
import './GameScreen.css';

interface GameScreenProps {
  word: string;
  timeRemaining: number;
  onDrawingComplete?: (canvasData: string) => void;
  onFinishDrawing?: () => void;
  playersFinished?: string[];
  currentPlayerId?: string;
  isConnected?: boolean;
  connectionStatus?: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: GameError | null;
  playerCount?: number;
  submittedDrawings?: number;
}

const GameScreen: React.FC<GameScreenProps> = ({ 
  word, 
  timeRemaining, 
  onDrawingComplete,
  onFinishDrawing,
  playersFinished = [],
  currentPlayerId,
  isConnected = true,
  connectionStatus = 'connected',
  error = null,
  playerCount = 0,
  submittedDrawings = 0
}) => {
  const [timeLeft, setTimeLeft] = useState(timeRemaining);
  const [brushSize, setBrushSize] = useState(5);
  const [brushColor, setBrushColor] = useState('#000000');
  const [isFinished, setIsFinished] = useState(false);
  const [activeTool, setActiveTool] = useState<'brush' | 'fill'>('brush');
  const [canvasHistory, setCanvasHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  // const [toolsVisible, setToolsVisible] = useState(true); // Reserved for future use
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [colorDropdownOpen, setColorDropdownOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{x: number, y: number} | null>(null);

  // Initialize PURE HTML5 canvas (NO FABRIC.JS)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (canvasRef.current && !ctxRef.current) {
      const canvas = canvasRef.current;
      const container = canvas.parentElement;
      const containerWidth = container?.clientWidth || 800;
      const containerHeight = container?.clientHeight || 600;
      
      // Set canvas size
      const canvasWidth = containerWidth - 60;
      const canvasHeight = containerHeight - 60;
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.style.width = canvasWidth + 'px';
      canvas.style.height = canvasHeight + 'px';
      
      // Get context and configure for pixel-perfect drawing
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // PIXEL-PERFECT SETTINGS
        ctx.imageSmoothingEnabled = false;
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        
        // Set initial brush settings
        ctx.strokeStyle = brushColor;
        ctx.lineWidth = brushSize;
        
        ctxRef.current = ctx;
        
        console.log('🎨 PURE HTML5 canvas initialized:', {
          width: canvasWidth,
          height: canvasHeight,
          antiAliasing: false,
          lineCap: 'square',
          lineJoin: 'miter'
        });
        
        // Save initial state
        const initialState = canvas.toDataURL();
        setCanvasHistory([initialState]);
        setHistoryIndex(0);
      }

      return () => {
        ctxRef.current = null;
      };
    }
  }, []);  // Canvas initialization only happens once

  // Update brush settings for PURE HTML5 canvas
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ctxRef.current) {
      ctxRef.current.strokeStyle = brushColor;
      ctxRef.current.lineWidth = brushSize;
      // AGGRESSIVE ANTI-ALIASING PREVENTION
      ctxRef.current.imageSmoothingEnabled = false;
      (ctxRef.current as any).webkitImageSmoothingEnabled = false;
      (ctxRef.current as any).mozImageSmoothingEnabled = false;
      (ctxRef.current as any).msImageSmoothingEnabled = false;
      (ctxRef.current as any).oImageSmoothingEnabled = false;
      ctxRef.current.lineCap = 'butt';  // Sharpest edges
      ctxRef.current.lineJoin = 'miter';
      
      console.log('Pure canvas brush updated:', {
        width: brushSize,
        color: brushColor,
        antiAliasing: false
      });
    }
  }, [brushSize, brushColor]);

  // Save canvas state to history - PURE HTML5
  const saveCanvasState = useCallback(() => {
    if (canvasRef.current) {
      const currentState = canvasRef.current.toDataURL();
      setCanvasHistory(prev => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(currentState);
        // Limit history to last 20 states for memory efficiency
        if (newHistory.length > 20) {
          newHistory.shift();
          setHistoryIndex(prev => prev - 1);
          return newHistory;
        }
        return newHistory;
      });
      setHistoryIndex(prev => prev + 1);
    }
  }, [historyIndex]);

  // Helper function to convert hex to RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  };

  // PURE HTML5 CANVAS FLOOD FILL - No Fabric.js interference
  const performPureFloodFill = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number, startX: number, startY: number, fillColor: string) => {
    // Convert from pixel-perfect coordinates (x.5) to integer coordinates
    const x = Math.floor(startX);
    const y = Math.floor(startY);
    
    console.log('🎨 PURE HTML5 flood fill starting at:', x, y, 'canvas size:', canvasWidth, 'x', canvasHeight);
    
    // Get image data for the entire canvas
    const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    console.log('🎨 Image data obtained:', width, 'x', height, 'total pixels:', data.length / 4);
    
    // Check bounds
    if (x < 0 || x >= width || y < 0 || y >= height) {
      console.log('❌ Click outside canvas bounds:', x, y);
      return;
    }
    
    // Pixel functions
    const getPixel = (px: number, py: number) => {
      const pos = (py * width + px) * 4;
      return {
        r: data[pos],
        g: data[pos + 1], 
        b: data[pos + 2],
        a: data[pos + 3]
      };
    };
    
    const setPixel = (px: number, py: number, color: {r: number, g: number, b: number, a: number}) => {
      const pos = (py * width + px) * 4;
      data[pos] = color.r;
      data[pos + 1] = color.g;
      data[pos + 2] = color.b;
      data[pos + 3] = color.a;
    };
    
    // ANTI-ALIASING FIX: Add tolerance for fuzzy edges like Photoshop
    const colorsMatch = (c1: {r: number, g: number, b: number, a: number}, c2: {r: number, g: number, b: number, a: number}, tolerance: number = 10) => {
      return Math.abs(c1.r - c2.r) <= tolerance &&
             Math.abs(c1.g - c2.g) <= tolerance &&
             Math.abs(c1.b - c2.b) <= tolerance &&
             Math.abs(c1.a - c2.a) <= tolerance;
    };
    
    const targetColor = getPixel(x, y);
    console.log('🎯 Target color:', targetColor);
    console.log('🎨 Using tolerance: 10 (fixes anti-aliasing fuzziness)');
    
    // Convert fill color
    const fillRGB = hexToRgb(fillColor);
    if (!fillRGB) {
      console.log('❌ Invalid fill color:', fillColor);
      return;
    }
    
    const fillColorRGBA = {r: fillRGB.r, g: fillRGB.g, b: fillRGB.b, a: 255};
    console.log('🎨 Fill color:', fillColorRGBA);
    
    // Skip if already the target color (exact match for this check)
    if (colorsMatch(targetColor, fillColorRGBA, 0)) {
      console.log('⚠️ Already the fill color');
      return;
    }
    
    // Stack-based flood fill (prevents recursion stack overflow)
    const stack: {x: number, y: number}[] = [{x, y}];
    let pixelsFilled = 0;
    const maxPixels = 1000000; // Large limit for proper fills
    
    console.log('🎨 Starting PURE flood fill...');
    
    while (stack.length > 0 && pixelsFilled < maxPixels) {
      const current = stack.pop()!;
      
      // Bounds check
      if (current.x < 0 || current.x >= width || current.y < 0 || current.y >= height) {
        continue;
      }
      
      // Check if this pixel matches target color (with anti-aliasing tolerance)
      const currentPixel = getPixel(current.x, current.y);
      if (!colorsMatch(currentPixel, targetColor, 10)) {
        continue;
      }
      
      // Fill this pixel
      setPixel(current.x, current.y, fillColorRGBA);
      pixelsFilled++;
      
      // Add adjacent pixels to stack
      stack.push(
        {x: current.x + 1, y: current.y},
        {x: current.x - 1, y: current.y},
        {x: current.x, y: current.y + 1},
        {x: current.x, y: current.y - 1}
      );
      
      // Progress logging
      if (pixelsFilled % 50000 === 0) {
        console.log(`🎨 Filled ${pixelsFilled} pixels, stack: ${stack.length}`);
      }
    }
    
    console.log(`✅ PURE flood fill complete: ${pixelsFilled} pixels filled`);
    
    // Apply the changes
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // PURE HTML5 CANVAS EVENT HANDLERS
  const getCanvasCoordinates = useCallback((e: MouseEvent | TouchEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if (e.type.startsWith('touch')) {
      const touchEvent = e as TouchEvent;
      clientX = touchEvent.touches[0]?.clientX || touchEvent.changedTouches[0]?.clientX || 0;
      clientY = touchEvent.touches[0]?.clientY || touchEvent.changedTouches[0]?.clientY || 0;
    } else {
      const mouseEvent = e as MouseEvent;
      clientX = mouseEvent.clientX;
      clientY = mouseEvent.clientY;
    }
    
    // ULTRA PIXEL-PERFECT COORDINATES: Force integer pixel positions
    const x = Math.round(clientX - rect.left);
    const y = Math.round(clientY - rect.top);
    
    return { x, y };
  }, []);
  
  const startDrawing = useCallback((e: MouseEvent | TouchEvent) => {
    if (activeTool === 'brush' && ctxRef.current) {
      isDrawingRef.current = true;
      const coords = getCanvasCoordinates(e);
      lastPointRef.current = coords;
      
      // Draw initial point using pixel-perfect method
      const halfSize = Math.floor(brushSize / 2);
      ctxRef.current.fillStyle = brushColor;
      ctxRef.current.fillRect(coords.x - halfSize, coords.y - halfSize, brushSize, brushSize);
      
      console.log('🖌️ Start drawing at ultra pixel-perfect coords:', coords);
    }
  }, [activeTool, getCanvasCoordinates, brushColor, brushSize]);
  
  // Pixel-level drawing function for ultra-sharp lines
  const drawPixelLine = useCallback((ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, size: number) => {
    // Bresenham's line algorithm for pixel-perfect lines
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0;
    let y = y0;
    
    ctx.fillStyle = color;
    
    while (true) {
      // Draw a square brush at this pixel
      const halfSize = Math.floor(size / 2);
      ctx.fillRect(x - halfSize, y - halfSize, size, size);
      
      if (x === x1 && y === y1) break;
      
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }, []);
  
  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDrawingRef.current || activeTool !== 'brush' || !ctxRef.current || !canvasRef.current) return;
    
    const coords = getCanvasCoordinates(e);
    const lastPoint = lastPointRef.current;
    
    if (lastPoint) {
      // Use pixel-perfect line drawing instead of canvas lines
      drawPixelLine(ctxRef.current, lastPoint.x, lastPoint.y, coords.x, coords.y, brushColor, brushSize);
    } else {
      // Draw a single point
      const halfSize = Math.floor(brushSize / 2);
      ctxRef.current.fillStyle = brushColor;
      ctxRef.current.fillRect(coords.x - halfSize, coords.y - halfSize, brushSize, brushSize);
    }
    
    lastPointRef.current = coords;
  }, [activeTool, getCanvasCoordinates, drawPixelLine, brushColor, brushSize]);
  
  const stopDrawing = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      lastPointRef.current = null;
      saveCanvasState();
      console.log('🖌️ Finished drawing stroke');
    }
  }, [saveCanvasState]);
  
  const handleCanvasClick = useCallback((e: MouseEvent) => {
    if (activeTool === 'fill' && ctxRef.current && canvasRef.current) {
      const coords = getCanvasCoordinates(e);
      
      console.log('🪣 PURE HTML5 FLOOD FILL at:', coords, 'with color:', brushColor);
      
      try {
        performPureFloodFill(ctxRef.current, canvasRef.current.width, canvasRef.current.height, coords.x, coords.y, brushColor);
        saveCanvasState();
        console.log('✅ Pure HTML5 flood fill complete!');
      } catch (error) {
        console.error('❌ Fill tool error:', error);
        alert('Fill tool encountered an error. Please try again or use the brush tool.');
      }
    }
  }, [activeTool, brushColor, getCanvasCoordinates, performPureFloodFill, saveCanvasState]);


  // Helper function to get color names
  const getColorName = (color: string) => {
    const colorNames: { [key: string]: string } = {
      '#000000': 'Black',
      '#FFFFFF': 'White',
      '#FF0000': 'Red',
      '#00FF00': 'Green',
      '#0000FF': 'Blue',
      '#FFFF00': 'Yellow',
      '#FF00FF': 'Magenta',
      '#00FFFF': 'Cyan',
      '#FFA500': 'Orange',
      '#800080': 'Purple',
      '#008000': 'Dark Green',
      '#8B4513': 'Brown',
      '#FFB6C1': 'Light Pink',
      '#808080': 'Gray',
      '#C0C0C0': 'Silver',
      '#800000': 'Maroon',
      '#008080': 'Teal',
      '#000080': 'Navy'
    };
    return colorNames[color] || color;
  };

  // Undo function - PURE HTML5
  const undo = useCallback(() => {
    if (historyIndex > 0 && canvasRef.current && ctxRef.current) {
      const newIndex = historyIndex - 1;
      const previousState = canvasHistory[newIndex];
      
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current && ctxRef.current) {
          const canvas = canvasRef.current;
          const ctx = ctxRef.current;
          
          // Clear and redraw
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          
          console.log('↶ Undo applied');
        }
      };
      img.src = previousState;
      
      setHistoryIndex(newIndex);
    }
  }, [historyIndex, canvasHistory]);

  // Redo function - PURE HTML5
  const redo = useCallback(() => {
    if (historyIndex < canvasHistory.length - 1 && canvasRef.current && ctxRef.current) {
      const newIndex = historyIndex + 1;
      const nextState = canvasHistory[newIndex];
      
      const img = new Image();
      img.onload = () => {
        if (canvasRef.current && ctxRef.current) {
          const canvas = canvasRef.current;
          const ctx = ctxRef.current;
          
          // Clear and redraw
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          
          console.log('↷ Redo applied');
        }
      };
      img.src = nextState;
      
      setHistoryIndex(newIndex);
    }
  }, [historyIndex, canvasHistory]);

  // Setup PURE HTML5 canvas event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    console.log('🔧 Setting up pure HTML5 canvas events for tool:', activeTool);
    
    // Remove existing listeners
    canvas.removeEventListener('mousedown', startDrawing);
    canvas.removeEventListener('mousemove', draw);
    canvas.removeEventListener('mouseup', stopDrawing);
    canvas.removeEventListener('click', handleCanvasClick);
    canvas.removeEventListener('touchstart', startDrawing);
    canvas.removeEventListener('touchmove', draw);
    canvas.removeEventListener('touchend', stopDrawing);
    
    if (activeTool === 'brush') {
      console.log('🖌️ Setting up brush events');
      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('touchstart', startDrawing);
      canvas.addEventListener('touchmove', draw);
      canvas.addEventListener('touchend', stopDrawing);
      canvas.style.cursor = 'crosshair';
    } else if (activeTool === 'fill') {
      console.log('🪣 Setting up fill events');
      canvas.addEventListener('click', handleCanvasClick);
      canvas.style.cursor = 'pointer';
    }
    
    return () => {
      // Cleanup listeners
      canvas.removeEventListener('mousedown', startDrawing);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', stopDrawing);
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('touchstart', startDrawing);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', stopDrawing);
    };
  }, [activeTool, startDrawing, draw, stopDrawing, handleCanvasClick]);

  // Keyboard shortcuts and click outside handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          redo();
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorDropdownOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [undo, redo]);

  // No Fabric.js offset recalculation needed with pure HTML5 canvas

  // Handle window resize for pure HTML5 canvas
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && ctxRef.current) {
        // Save current canvas content before resize
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;
        tempCanvas.width = canvasRef.current.width;
        tempCanvas.height = canvasRef.current.height;
        tempCtx.drawImage(canvasRef.current, 0, 0);
        
        const container = canvasRef.current.parentElement;
        const containerWidth = container?.clientWidth || 800;
        const containerHeight = container?.clientHeight || 600;
        
        const canvasWidth = containerWidth - 60;
        const canvasHeight = containerHeight - 60;

        // Resize pure HTML5 canvas
        canvasRef.current.width = canvasWidth;
        canvasRef.current.height = canvasHeight;
        canvasRef.current.style.width = canvasWidth + 'px';
        canvasRef.current.style.height = canvasHeight + 'px';
        
        // Restore aggressive pixel-perfect settings after resize
        ctxRef.current.imageSmoothingEnabled = false;
        (ctxRef.current as any).webkitImageSmoothingEnabled = false;
        (ctxRef.current as any).mozImageSmoothingEnabled = false;
        (ctxRef.current as any).msImageSmoothingEnabled = false;
        (ctxRef.current as any).oImageSmoothingEnabled = false;
        ctxRef.current.lineCap = 'butt';
        ctxRef.current.lineJoin = 'miter';
        ctxRef.current.strokeStyle = brushColor;
        ctxRef.current.lineWidth = brushSize;
        
        // Fill with white background then restore content
        ctxRef.current.fillStyle = '#ffffff';
        ctxRef.current.fillRect(0, 0, canvasWidth, canvasHeight);
        ctxRef.current.drawImage(tempCanvas, 0, 0);
        
        console.log('Pure HTML5 canvas resized to:', canvasWidth, 'x', canvasHeight);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [brushColor, brushSize]);

  // Finish drawing function - PURE HTML5
  const handleFinishDrawing = useCallback(async () => {
    if (canvasRef.current && onDrawingComplete && !isSubmitting) {
      setIsSubmitting(true);
      
      try {
        const canvasData = canvasRef.current.toDataURL('image/png', 0.8);
        
        await onDrawingComplete(canvasData);
        setIsFinished(true);
        
        if (onFinishDrawing) {
          onFinishDrawing();
        }
      } catch (error) {
        console.error('Failed to submit drawing:', error);
        setIsSubmitting(false);
      }
    }
  }, [onDrawingComplete, onFinishDrawing, isSubmitting]);

  // Set up global auto-submit function for server-triggered auto-submit
  useEffect(() => {
    console.log('🔥 Setting up GameScreen auto-submit function');
    (window as any).gameScreenAutoSubmit = () => {
      console.log('🔥 GameScreen auto-submit called!');
      console.log('🔥 isFinished:', isFinished, 'isSubmitting:', isSubmitting);
      console.log('🔥 canvasRef.current:', !!canvasRef.current);
      console.log('🔥 onDrawingComplete:', !!onDrawingComplete);
      
      if (!isFinished && !isSubmitting) {
        console.log('🔥 Conditions met, calling handleFinishDrawing...');
        handleFinishDrawing();
      } else {
        console.warn('🔥 Auto-submit conditions not met!');
      }
    };

    // Cleanup on unmount
    return () => {
      console.log('🔥 Cleaning up GameScreen auto-submit function');
      delete (window as any).gameScreenAutoSubmit;
    };
  }, [handleFinishDrawing, isFinished, isSubmitting, onDrawingComplete]);

  // Timer effect
  useEffect(() => {
    setTimeLeft(timeRemaining);
    
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          // Auto-submit drawing when timer expires
          if (!isFinished && !isSubmitting && canvasRef.current && onDrawingComplete) {
            console.log('⏰ Timer expired, auto-submitting drawing...');
            handleFinishDrawing();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining, isFinished, isSubmitting, onDrawingComplete, handleFinishDrawing]);

  // Clear canvas - PURE HTML5
  const clearCanvas = () => {
    if (canvasRef.current && ctxRef.current) {
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Save cleared state to history
      saveCanvasState();
      console.log('Pure canvas cleared');
    }
  };





  // Color options - expanded palette
  const colors = [
    '#000000', // Black
    '#FFFFFF', // White
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FFA500', // Orange
    '#800080', // Purple
    '#008000', // Dark Green
    '#8B4513', // Brown
    '#FFB6C1', // Light Pink
    '#808080', // Gray
    '#C0C0C0', // Silver
    '#800000', // Maroon
    '#008080', // Teal
    '#000080'  // Navy
  ];

  // Brush sizes
  const brushSizes = [2, 5, 10, 15, 20];

  const getTimeStyle = () => {
    if (timeLeft <= 5) return 'text-danger timer-critical';
    if (timeLeft <= 10) return 'text-danger';
    if (timeLeft <= 20) return 'text-warning';
    return 'text-success';
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="screen-container">
      <div className="game-header">
        <div className="header-content">
          <div className="timer-section">
            <h3>Time Remaining:</h3>
            <span className={`timer ${getTimeStyle()}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
          
          <div className="word-section">
            <h2>Draw: <span className="word">{word}</span></h2>
            {timeLeft <= 10 && timeLeft > 0 && !isFinished && (
              <div className="time-warning">
                <small className="text-danger">
                  ⚠️ {timeLeft <= 5 ? 'Drawing will auto-submit in' : 'Time running out!'} {timeLeft}s
                </small>
              </div>
            )}
          </div>
          
          <div className="status-section">
            <div className="player-status">
              {submittedDrawings > 0 && playerCount > 0 && (
                <div className="finished-players">
                  <span>Submitted: {submittedDrawings}/{playerCount}</span>
                </div>
              )}
              
              {/* Connection Status */}
              {connectionStatus !== 'connected' && (
                <div className="connection-status">
                  {connectionStatus === 'connecting' && (
                    <span className="text-warning">
                      <Spinner size="sm" className="me-1" />
                      Reconnecting...
                    </span>
                  )}
                  {connectionStatus === 'disconnected' && (
                    <span className="text-danger">Disconnected</span>
                  )}
                  {connectionStatus === 'error' && (
                    <span className="text-danger">Connection Error</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="game-content">
        {/* Error Display */}
        {error && (
          <Alert variant="danger" className="game-error-alert">
            <strong>Error:</strong> {error.message}
            {error.recoverable && (
              <div className="mt-2">
                <small>The game will attempt to recover automatically.</small>
              </div>
            )}
          </Alert>
        )}
        
        <div className="canvas-container">
          <canvas 
            ref={canvasRef}
            className={`drawing-canvas ${isFinished ? 'finished' : ''} ${!isConnected ? 'disconnected' : ''}`}
          />
          
          {(isFinished || isSubmitting) && (
            <div className="canvas-overlay">
              <div className="finished-message">
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" className="mb-3" />
                    <h3>Submitting Drawing...</h3>
                    <p>Please wait while we save your masterpiece!</p>
                  </>
                ) : (
                  <>
                    <h3>Drawing Complete!</h3>
                    <p>Waiting for other players...</p>
                    {submittedDrawings > 0 && playerCount > 0 && (
                      <p className="submission-progress">
                        {submittedDrawings}/{playerCount} players finished
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          
          {!isConnected && !isFinished && (
            <div className="canvas-overlay disconnected-overlay">
              <div className="disconnected-message">
                <Spinner animation="border" variant="warning" className="mb-3" />
                <h3>Connection Lost</h3>
                <p>Attempting to reconnect...</p>
                <small>Your drawing is safe and will be submitted when reconnected.</small>
              </div>
            </div>
          )}
        </div>

        <div className="tools-panel">
          <div className="tool-section">
            <h4>Color</h4>
            <div className="custom-color-picker" ref={colorPickerRef}>
              <div 
                className="color-picker-trigger"
                onClick={() => setColorDropdownOpen(!colorDropdownOpen)}
                style={{ backgroundColor: brushColor }}
                title={getColorName(brushColor)}
              >
                <span className="color-name">{getColorName(brushColor)}</span>
                <span className="dropdown-arrow">{colorDropdownOpen ? '▲' : '▼'}</span>
              </div>
              
              {colorDropdownOpen && (
                <div className="color-picker-dropdown">
                  <div className="color-grid">
                    {colors.map(color => (
                      <div
                        key={color}
                        className={`color-option ${brushColor === color ? 'selected' : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={() => {
                          setBrushColor(color);
                          setColorDropdownOpen(false);
                        }}
                        title={getColorName(color)}
                      >
                        {brushColor === color && <span className="checkmark">✓</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="tool-section">
            <h4>Brush Size</h4>
            <div className="brush-sizes">
              {brushSizes.map(size => (
                <button
                  key={size}
                  className={`brush-btn ${brushSize === size ? 'active' : ''}`}
                  onClick={() => setBrushSize(size)}
                  title={`Size ${size}px`}
                >
                  {size}px
                </button>
              ))}
            </div>
          </div>

          <div className="tool-section">
            <h4>Drawing Tools</h4>
            <div className="tool-buttons">
              <button 
                className={`tool-btn ${activeTool === 'brush' ? 'active' : ''}`}
                onClick={() => {
                  console.log('🖌️ Switching to brush tool');
                  setActiveTool('brush');
                }}
                disabled={isFinished || isSubmitting || !isConnected}
                title="Brush tool"
              >
                🖌️ Brush
              </button>
              
              <button 
                className={`tool-btn ${activeTool === 'fill' ? 'active' : ''}`}
                onClick={() => {
                  console.log('🪣 Fill button clicked, switching to fill tool');
                  console.log('🪣 Previous active tool:', activeTool);
                  setActiveTool('fill');
                  console.log('🪣 Active tool should now be: fill');
                }}
                disabled={isFinished || isSubmitting || !isConnected}
                title="Fill/Bucket tool - Click to fill areas"
              >
                🪣 Fill
              </button>
            </div>
          </div>

          <div className="tool-section">
            <h4>Actions</h4>
            <div className="tool-buttons">
              <button 
                className="tool-btn undo-btn"
                onClick={undo}
                disabled={isFinished || isSubmitting || !isConnected || historyIndex <= 0}
                title={!isConnected ? 'Reconnecting...' : 'Undo (Ctrl+Z)'}
              >
                ↶ Undo
              </button>
              
              <button 
                className="tool-btn redo-btn"
                onClick={redo}
                disabled={isFinished || isSubmitting || !isConnected || historyIndex >= canvasHistory.length - 1}
                title={!isConnected ? 'Reconnecting...' : 'Redo (Ctrl+Y)'}
              >
                ↷ Redo
              </button>
              
              <button 
                className="tool-btn clear-btn"
                onClick={clearCanvas}
                disabled={isFinished || isSubmitting || !isConnected}
                title={!isConnected ? 'Reconnecting...' : 'Clear canvas'}
              >
                🗑️ Clear
              </button>
              
              <button 
                className="tool-btn finish-btn"
                onClick={handleFinishDrawing}
                disabled={isFinished || isSubmitting || !isConnected}
                title={!isConnected ? 'Reconnecting...' : 'Submit your drawing'}
              >
                {isSubmitting ? (
                  <>
                    <Spinner size="sm" className="me-1" />
                    Submitting...
                  </>
                ) : (
                  '✅ Finish Drawing'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer Space */}
      <div className="game-footer">
        <div className="footer-content">
          <span>Draw "{word}" • Time: {formatTime(timeLeft)}</span>
        </div>
      </div>
    </div>
  );
};

export default GameScreen; 