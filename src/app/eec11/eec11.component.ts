import { Component, signal, effect, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface KnobState {
  signal: any;
  startValue: number;
  lastAngle: number;
  totalRotation: number;
  minValue: number;
  maxValue: number;
}

type TaskMode = 'task1' | 'task2' | 'task3';
type PlateWidth = 10 | 5 | 3 | 2;
type Material = 'aluminum' | 'polymer' | 'steel';
type Shape = 'circle' | 'square' | 'triangle' | 'rectangle';

@Component({
  selector: 'app-eec11',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './eec11.component.html',
  styleUrl: './eec11.component.css'
})
export class Eec11Component implements AfterViewInit, OnDestroy {
  @ViewChild('waveformCanvas', { static: false }) waveformCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('plateCanvas', { static: false }) plateCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('task2Canvas', { static: false }) task2Canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('task3Canvas', { static: false }) task3Canvas!: ElementRef<HTMLCanvasElement>;
  
  // Task mode
  currentTask = signal<TaskMode>('task1');
  
  // Control values
  intensity = signal(5);
  brightness = signal(5);
  scale = signal(5);
  startPosition = signal(0); // 0-150mm, start position of visible range
  isPowerOn = signal(false);
  
  // Task 1: Plate selection
  selectedPlate = signal<PlateWidth | null>(null);
  plateDistance = signal<number>(35); // 30-40 mm
  
  // Task 2: Object with shape
  objectShape = signal<Shape>('circle');
  objectRotation = signal(0); // 0-360 degrees
  objectDistance = signal(50); // mm
  
  // Task 3: Cylinder
  cylinderMaterial = signal<Material>('aluminum');
  cylinderThickness = signal(50); // mm
  
  // Display values
  speed = signal(1500); // m/s (constant)
  measurement = signal('MM');
  measuredDistance = signal(0); // mm - для вимірювання відстані між сигналами
  displayDistance = signal(0); // mm - відображається на маленькому екранчику
  
  // Manual modal
  showManual = signal(false);
  
  private animationFrameId: number | null = null;
  private waveformData: number[] = [];
  private timeOffset = 0;
  private activeKnob: KnobState | null = null;
  private knobElement: HTMLElement | null = null;
  private continuousAdjustInterval: number | null = null;
  private adjustTimeoutId: number | null = null;
  private adjustDirection: number = 0;
  
  // Plate visualization animation
  private plateAnimationFrameId: number | null = null;
  private waveAnimationTime = 0;
  
  // Task 2 visualization animation
  private task2AnimationFrameId: number | null = null;
  private task2WaveAnimationTime = 0;
  
  // Task 3 visualization animation
  private task3AnimationFrameId: number | null = null;
  private task3WaveAnimationTime = 0;

  private mouseMoveHandler = this.handleMouseMove.bind(this);
  private mouseUpHandler = this.handleMouseUp.bind(this);
  private touchMoveHandler = this.handleTouchMove.bind(this);
  private touchEndHandler = this.handleTouchEnd.bind(this);

  constructor() {
    // Initialize random shape and material for tasks
    this.initializeRandomValues();
    
    // Initialize waveform data
    this.generateWaveform();
    
    // Effect to regenerate waveform when controls change
    effect(() => {
      if (this.isPowerOn()) {
        // Trigger regeneration when intensity, scale, brightness, or start position changes
        const intensity = this.intensity();
        const scale = this.scale();
        const brightness = this.brightness();
        const startPos = this.startPosition();
        this.generateWaveform();
      }
    });
    
    // Effect to update display distance when measured distance changes (from knob)
    effect(() => {
      this.displayDistance.set(this.measuredDistance());
    });
    
    // Effect to auto-position when scale changes
    effect(() => {
      const scale = this.scale();
      // Автоматично позиціонуємо графік при зміні масштабу
      if (this.isPowerOn()) {
        this.autoPositionWaveform();
      }
    });
    
    // Effect to update plate visualization when plate or distance changes
    effect(() => {
      const plate = this.selectedPlate();
      const distance = this.plateDistance();
      const task = this.currentTask();
      if (plate !== null && task === 'task1' && this.plateCanvas?.nativeElement) {
        this.startPlateAnimation();
      } else {
        this.stopPlateAnimation();
      }
      
      // Task 2 animation
      if (task === 'task2' && this.task2Canvas?.nativeElement) {
        this.startTask2Animation();
      } else {
        this.stopTask2Animation();
      }
      
      // Task 3 animation
      if (task === 'task3' && this.task3Canvas?.nativeElement) {
        this.startTask3Animation();
      } else {
        this.stopTask3Animation();
      }
    });
  }

  ngAfterViewInit() {
    if (this.isPowerOn()) {
      this.startAnimation();
    }
    // Ініціалізуємо візуалізацію для активного завдання
    if (this.currentTask() === 'task1' && this.selectedPlate() !== null) {
      setTimeout(() => {
        this.drawPlateVisualization();
        this.startPlateAnimation();
      }, 100);
    } else if (this.currentTask() === 'task2') {
      setTimeout(() => {
        this.drawTask2Visualization();
        this.startTask2Animation();
      }, 100);
    } else if (this.currentTask() === 'task3') {
      setTimeout(() => {
        this.drawTask3Visualization();
        this.startTask3Animation();
      }, 100);
    }
  }

  ngOnDestroy() {
    this.stopAnimation();
    this.stopPlateAnimation();
    this.stopTask2Animation();
    this.stopTask3Animation();
    this.cleanupKnobListeners();
    this.stopContinuousAdjust();
  }

  initializeRandomValues() {
    // Random shape for task 2
    const shapes: Shape[] = ['circle', 'square', 'triangle', 'rectangle'];
    this.objectShape.set(shapes[Math.floor(Math.random() * shapes.length)]);
    
    // Random material for task 3
    const materials: Material[] = ['aluminum', 'polymer', 'steel'];
    this.cylinderMaterial.set(materials[Math.floor(Math.random() * materials.length)]);
    
    // Random plate distance for task 1 (30-40 mm)
    this.plateDistance.set(30 + Math.random() * 10);
  }

  selectTask(task: TaskMode) {
    this.currentTask.set(task);
    this.isPowerOn.set(false);
    this.stopAnimation();
    this.stopPlateAnimation();
    this.stopTask2Animation();
    this.stopTask3Animation();
    // Скидаємо вимірювання при зміні завдання
    this.measuredDistance.set(0);
    // Очищаємо екран
    this.clearDisplay();
    // Автоматично позиціонуємо графік для нового завдання
    this.autoPositionWaveform();
    // Ініціалізуємо візуалізацію для обраного завдання
    if (task === 'task1' && this.selectedPlate() !== null) {
      setTimeout(() => {
        this.drawPlateVisualization();
        this.startPlateAnimation();
      }, 100);
    } else if (task === 'task2') {
      setTimeout(() => {
        this.drawTask2Visualization();
        this.startTask2Animation();
      }, 100);
    } else if (task === 'task3') {
      setTimeout(() => {
        this.drawTask3Visualization();
        this.startTask3Animation();
      }, 100);
    }
  }

  clearDisplay() {
    const canvas = this.waveformCanvas?.nativeElement;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }

  selectPlate(width: PlateWidth) {
    this.selectedPlate.set(width);
    // Автоматично позиціонуємо графік для обраної пластинки
    if (this.currentTask() === 'task1' && this.isPowerOn()) {
      this.autoPositionWaveform();
    }
    // Перезапускаємо анімацію хвиль
    this.stopPlateAnimation();
    this.waveAnimationTime = 0;
    // Оновлюємо візуалізацію пластинки з невеликою затримкою для плавної анімації
    setTimeout(() => {
      this.drawPlateVisualization();
      this.startPlateAnimation();
    }, 50);
  }
  
  startPlateAnimation() {
    if (this.plateAnimationFrameId !== null) return;
    
    const animate = () => {
      this.waveAnimationTime += 0.016; // ~60 FPS
      this.drawPlateVisualization();
      this.plateAnimationFrameId = requestAnimationFrame(animate);
    };
    
    this.plateAnimationFrameId = requestAnimationFrame(animate);
  }
  
  stopPlateAnimation() {
    if (this.plateAnimationFrameId !== null) {
      cancelAnimationFrame(this.plateAnimationFrameId);
      this.plateAnimationFrameId = null;
    }
    this.waveAnimationTime = 0;
  }
  
  // Task 2 Animation
  startTask2Animation() {
    if (this.task2AnimationFrameId !== null) return;
    
    const animate = () => {
      this.task2WaveAnimationTime += 0.016; // ~60 FPS
      this.drawTask2Visualization();
      this.task2AnimationFrameId = requestAnimationFrame(animate);
    };
    
    this.task2AnimationFrameId = requestAnimationFrame(animate);
  }
  
  stopTask2Animation() {
    if (this.task2AnimationFrameId !== null) {
      cancelAnimationFrame(this.task2AnimationFrameId);
      this.task2AnimationFrameId = null;
    }
    this.task2WaveAnimationTime = 0;
  }
  
  // Task 3 Animation
  startTask3Animation() {
    if (this.task3AnimationFrameId !== null) return;
    
    const animate = () => {
      this.task3WaveAnimationTime += 0.016; // ~60 FPS
      this.drawTask3Visualization();
      this.task3AnimationFrameId = requestAnimationFrame(animate);
    };
    
    this.task3AnimationFrameId = requestAnimationFrame(animate);
  }
  
  stopTask3Animation() {
    if (this.task3AnimationFrameId !== null) {
      cancelAnimationFrame(this.task3AnimationFrameId);
      this.task3AnimationFrameId = null;
    }
    this.task3WaveAnimationTime = 0;
  }

  generateWaveform() {
    const points = 200;
    this.waveformData = [];
    
    const task = this.currentTask();
    
    if (task === 'task1') {
      this.generateTask1Waveform(points);
    } else if (task === 'task2') {
      this.generateTask2Waveform(points);
    } else if (task === 'task3') {
      this.generateTask3Waveform(points);
    }
  }

  generateTask1Waveform(points: number) {
    // Task 1: Two signals based on plate width and distance
    const plateWidth = this.selectedPlate();
    if (!plateWidth) {
      // No signal if no plate selected
      this.waveformData = new Array(points).fill(0);
      return;
    }

    const distance = this.plateDistance();
    const intensity = this.intensity();
    const scale = this.scale();
    const startPos = this.startPosition();
    
    // Scale affects the visible range: scale 1 = 150mm, scale 10 = 15mm (zoomed in)
    const maxRange = 150 / scale; // From 150mm (scale 1) to 15mm (scale 10)
    
    for (let i = 0; i < points; i++) {
      // x represents actual position in mm, starting from startPos
      const x = startPos + (i / points) * maxRange;
      
      // First echo (from front of plate)
      const echo1Pos = distance;
      
      // Second echo (from back of plate)
      const echo2Pos = distance + plateWidth;
      
      let value = 0;
      
      // Signal width - for 2mm plate, signals should merge (wider), for others they should be distinct
      const baseSignalWidth = 0.6;
      let signalWidth: number;
      let power: number;
      
      if (plateWidth === 2) {
        // For 2mm: wider signals that merge into one pulse
        signalWidth = baseSignalWidth * 1.5; // Wider to create merging effect
        power = 3; // Lower power = wider base, signals merge better
      } else if (plateWidth === 3) {
        signalWidth = baseSignalWidth * 0.8; // Medium width for 3mm
        power = 4;
      } else if (plateWidth === 5) {
        signalWidth = baseSignalWidth * 0.9; // Medium for 5mm
        power = 4;
      } else {
        signalWidth = baseSignalWidth * 1.0; // Normal for 10mm
        power = 4;
      }
      
      // Calculate signal values with smoother, more uniform curves
      const dist1 = Math.abs(x - echo1Pos);
      const dist2 = Math.abs(x - echo2Pos);
      
      // Add first signal with smooth Gaussian-like curve
      if (dist1 < signalWidth * 4) {
        const normalizedDist1 = dist1 / signalWidth;
        value += Math.exp(-Math.pow(normalizedDist1, power)) * (intensity / 10) * 0.6;
      }
      
      // Add second signal with smooth curve
      if (dist2 < signalWidth * 4) {
        const normalizedDist2 = dist2 / signalWidth;
        value += Math.exp(-Math.pow(normalizedDist2, power)) * (intensity / 10) * 0.6;
      }
      
      // Add very minimal, smooth noise only to baseline (away from signals)
      const minDistToSignal = Math.min(dist1, dist2);
      if (minDistToSignal > signalWidth * 2) {
        // Only add noise to baseline areas, not near signals
        value += (Math.random() - 0.5) * 0.005;
      }
      
      this.waveformData.push(value);
    }
  }

  generateTask2Waveform(points: number) {
    // Task 2: Signals based on object shape and rotation
    const shape = this.objectShape();
    const rotation = this.objectRotation();
    const distance = this.objectDistance();
    const intensity = this.intensity();
    const scale = this.scale();
    const startPos = this.startPosition();
    
    // Scale affects the visible range
    const maxRange = 150 / scale;
    
    // Calculate shape dimensions based on rotation
    const shapePoints = this.getShapePoints(shape, rotation);
    
    for (let i = 0; i < points; i++) {
      // x represents actual position in mm, starting from startPos
      const x = startPos + (i / points) * maxRange;
      let value = 0;
      
      // Add signals for each point of the shape
      const signalWidth = 2;
      shapePoints.forEach(point => {
        const signalPos = distance + point;
        if (Math.abs(x - signalPos) < signalWidth * 2) {
          value += Math.exp(-Math.pow((x - signalPos) / signalWidth, 2)) * (intensity / 10) * 0.6;
        }
      });
      
      value += (Math.random() - 0.5) * 0.05;
      this.waveformData.push(value);
    }
  }

  generateTask3Waveform(points: number) {
    // Task 3: Two signals with different heights based on material
    const material = this.cylinderMaterial();
    const thickness = this.cylinderThickness();
    const intensity = this.intensity();
    const scale = this.scale();
    const startPos = this.startPosition();
    
    // Material affects signal amplitude
    const materialAmplitude: Record<Material, number> = {
      aluminum: 0.9,
      polymer: 0.4,
      steel: 0.85
    };
    
    const amplitude = materialAmplitude[material];
    
    // Scale affects the visible range
    const maxRange = 150 / scale;
    
    for (let i = 0; i < points; i++) {
      // x represents actual position in mm, starting from startPos
      const x = startPos + (i / points) * maxRange;
      
      // First echo (from top of cylinder)
      const echo1Pos = 25; // Fixed position
      // Second echo (from bottom of cylinder)
      const echo2Pos = 25 + thickness;
      
      let value = 0;
      
      // First signal
      const signalWidth = 2;
      if (Math.abs(x - echo1Pos) < signalWidth * 2) {
        value += Math.exp(-Math.pow((x - echo1Pos) / signalWidth, 2)) * (intensity / 10) * amplitude;
      }
      
      // Second signal (weaker due to material absorption)
      if (Math.abs(x - echo2Pos) < signalWidth * 2) {
        value += Math.exp(-Math.pow((x - echo2Pos) / signalWidth, 2)) * (intensity / 10) * amplitude * 0.7;
      }
      
      value += (Math.random() - 0.5) * 0.05;
      this.waveformData.push(value);
    }
  }

  getShapePoints(shape: Shape, rotation: number): number[] {
    const rad = (rotation * Math.PI) / 180;
    const size = 20; // mm
    
    switch (shape) {
      case 'circle':
        // Circle: multiple points around circumference
        const points: number[] = [];
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * 2 * Math.PI + rad;
          points.push(Math.cos(angle) * size / 2);
        }
        return points;
        
      case 'square':
        // Square: 4 corners
        return [
          Math.cos(rad) * size / 2 - Math.sin(rad) * size / 2,
          Math.cos(rad) * size / 2 + Math.sin(rad) * size / 2,
          -Math.cos(rad) * size / 2 - Math.sin(rad) * size / 2,
          -Math.cos(rad) * size / 2 + Math.sin(rad) * size / 2
        ];
        
      case 'triangle':
        // Triangle: 3 vertices
        return [
          Math.cos(rad) * size / 2,
          Math.cos(rad + 2 * Math.PI / 3) * size / 2,
          Math.cos(rad + 4 * Math.PI / 3) * size / 2
        ];
        
      case 'rectangle':
        // Rectangle: 4 corners (wider)
        const width = size;
        const height = size * 0.6;
        return [
          Math.cos(rad) * width / 2 - Math.sin(rad) * height / 2,
          Math.cos(rad) * width / 2 + Math.sin(rad) * height / 2,
          -Math.cos(rad) * width / 2 - Math.sin(rad) * height / 2,
          -Math.cos(rad) * width / 2 + Math.sin(rad) * height / 2
        ];
    }
  }

  startAnimation() {
    const canvas = this.waveformCanvas?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      if (!this.isPowerOn()) {
        this.animationFrameId = null;
        return;
      }

      this.timeOffset += 0.05;
      this.generateWaveform();
      this.drawWaveform(ctx, canvas);
      this.animationFrameId = requestAnimationFrame(draw);
    };

    draw();
  }

  stopAnimation() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  drawWaveform(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const task = this.currentTask();
    const brightnessValue = this.brightness();
    
    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (task === 'task1') {
      this.drawTask1Grid(ctx, canvas);
    } else if (task === 'task2') {
      this.drawTask2Grid(ctx, canvas);
    } else if (task === 'task3') {
      this.drawTask3Grid(ctx, canvas);
    }

    // Draw waveform
    if (this.waveformData.length > 0) {
      // Brightness affects the opacity of the waveform (0.1 to 1.0)
      const opacity = 0.1 + (brightnessValue / 10) * 0.9;
      ctx.strokeStyle = `rgba(0, 255, 0, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      const centerY = canvas.height / 2;
      const scale = this.scale();
      // Adjusted amplitude for better signal visibility
      const amplitude = (canvas.height / 2) * 0.6 * (0.9 + scale * 0.01);
      
      for (let i = 0; i < this.waveformData.length; i++) {
        const x = (i / this.waveformData.length) * canvas.width;
        const y = centerY - (this.waveformData[i] * amplitude);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      ctx.stroke();
    }
    
    // Draw measurement line (вимірювальна лінія)
    this.drawMeasurementLine(ctx, canvas);
  }
  
  drawMeasurementLine(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const task = this.currentTask();
    const measuredDist = this.measuredDistance();
    const scale = this.scale();
    const startPos = this.startPosition();
    const brightnessValue = this.brightness();
    const brightnessMultiplier = 0.2 + (brightnessValue / 10) * 0.8; // 0.2 to 1.0
    
    if (measuredDist < 0) return; // Не малюємо, якщо значення від'ємне
    
    // Визначаємо видимий діапазон залежно від завдання та масштабу
    let maxRange: number;
    
    if (task === 'task1') {
      // Task 1: scale 1 = 150mm, scale 10 = 15mm
      maxRange = 150 / scale;
    } else if (task === 'task2') {
      // Task 2: аналогічно
      maxRange = 150 / scale;
    } else if (task === 'task3') {
      // Task 3: аналогічно
      maxRange = 150 / scale;
    } else {
      maxRange = 150;
    }
    
    // Обчислюємо позицію лінії на екрані з урахуванням startPosition
    // Лінія показує абсолютну позицію, а екран показує діапазон від startPos до startPos+maxRange
    const endPos = startPos + maxRange;
    
    // Перевіряємо чи лінія в межах видимого діапазону
    if (measuredDist < startPos || measuredDist > endPos) {
      return; // Не малюємо лінію якщо вона поза екраном
    }
    
    // Позиція відносно видимого діапазону
    const relativePosition = measuredDist - startPos;
    const linePosition = (relativePosition / maxRange) * canvas.width;
    
    // Обмежуємо позицію в межах canvas
    const finalPosition = Math.max(0, Math.min(canvas.width, linePosition));
    
    // Малюємо вертикальну вимірювальну лінію (просто жовта лінія)
    const lineOpacity = brightnessMultiplier;
    ctx.strokeStyle = `rgba(255, 255, 0, ${lineOpacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(finalPosition, 0);
    ctx.lineTo(finalPosition, canvas.height);
    ctx.stroke();
  }

  drawTask1Grid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // Chessboard grid: 1 cm = 1 square
    // Scale affects the grid size
    const scale = this.scale();
    const brightnessValue = this.brightness();
    const brightnessMultiplier = 0.2 + (brightnessValue / 10) * 0.8; // 0.2 to 1.0
    
    // Keep square size reasonable - smaller at higher scales
    // Base size 20px, decreases as scale increases
    const squareSize = 20 / (scale * 0.3); // At scale 1: 20px, at scale 10: ~6.7px
    
    // Draw checkerboard pattern first (darker background)
    const checkerOpacity = Math.round(0x60 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.fillStyle = `#001100${checkerOpacity}`;
    for (let y = 0; y < canvas.height; y += squareSize) {
      for (let x = 0; x < canvas.width; x += squareSize) {
        if ((x / squareSize + y / squareSize) % 2 === 0) {
          ctx.fillRect(x, y, squareSize, squareSize);
        }
      }
    }
    
    // Draw main grid lines (every 5 cm) - subtle, not too bright
    const mainOpacity = Math.round(0x60 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.strokeStyle = `#00ff00${mainOpacity}`;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 0;
    const mainGridSize = squareSize * 5;
    
    for (let x = 0; x < canvas.width; x += mainGridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    for (let y = 0; y < canvas.height; y += mainGridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    // Draw minor grid lines (every 1 cm) - more subtle
    const minorOpacity = Math.round(0x30 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.strokeStyle = `#00ff00${minorOpacity}`;
    ctx.lineWidth = 1;
    
    for (let x = 0; x < canvas.width; x += squareSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    for (let y = 0; y < canvas.height; y += squareSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  drawTask2Grid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // Standard grid for task 2 - subtle lines
    const brightnessValue = this.brightness();
    const brightnessMultiplier = 0.2 + (brightnessValue / 10) * 0.8; // 0.2 to 1.0
    
    // Draw minor grid lines first
    const minorOpacity = Math.round(0x30 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.strokeStyle = `#00ff00${minorOpacity}`;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    
    for (let i = 0; i <= 20; i++) {
      const y = (canvas.height / 20) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    for (let i = 0; i <= 20; i++) {
      const x = (canvas.width / 20) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    // Draw main grid lines (every 5 divisions) - subtle, not too bright
    const mainOpacity = Math.round(0x60 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.strokeStyle = `#00ff00${mainOpacity}`;
    ctx.lineWidth = 1.5;
    
    for (let i = 0; i <= 10; i++) {
      const y = (canvas.height / 10) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    for (let i = 0; i <= 10; i++) {
      const x = (canvas.width / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
  }

  drawTask3Grid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // Grid for task 3 with vertical scale for height measurement - subtle
    const brightnessValue = this.brightness();
    const brightnessMultiplier = 0.2 + (brightnessValue / 10) * 0.8; // 0.2 to 1.0
    
    // Draw minor horizontal lines first
    const minorOpacity = Math.round(0x30 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.strokeStyle = `#00ff00${minorOpacity}`;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;
    
    for (let i = 0; i <= 40; i++) {
      const y = (canvas.height / 40) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    // Draw main horizontal lines (every 5 divisions) - subtle for height measurement
    const mainOpacity = Math.round(0x60 * brightnessMultiplier).toString(16).padStart(2, '0');
    ctx.strokeStyle = `#00ff00${mainOpacity}`;
    ctx.lineWidth = 1.5;
    
    for (let i = 0; i <= 20; i++) {
      const y = (canvas.height / 20) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
    
    // Draw vertical lines
    ctx.strokeStyle = `#00ff00${minorOpacity}`;
    ctx.lineWidth = 1;
    
    for (let i = 0; i <= 20; i++) {
      const x = (canvas.width / 20) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    // Draw main vertical lines
    ctx.strokeStyle = `#00ff00${mainOpacity}`;
    ctx.lineWidth = 1.5;
    
    for (let i = 0; i <= 10; i++) {
      const x = (canvas.width / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
  }

  onPowerToggle() {
    this.isPowerOn.update(value => !value);
    if (this.isPowerOn()) {
      // Автоматично позиціонуємо графік, щоб сигнали були видимі
      this.autoPositionWaveform();
      setTimeout(() => this.startAnimation(), 100);
    } else {
      this.stopAnimation();
      const canvas = this.waveformCanvas?.nativeElement;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
  }

  autoPositionWaveform() {
    const task = this.currentTask();
    const scale = this.scale();
    const maxRange = 150 / scale; // Видимий діапазон
    
    if (task === 'task1') {
      const plateWidth = this.selectedPlate();
      if (plateWidth) {
        const distance = this.plateDistance();
        const firstSignalPos = distance;
        const secondSignalPos = distance + plateWidth;
        // Центруємо сигнали в видимій області з невеликим відступом зліва
        const centerPos = (firstSignalPos + secondSignalPos) / 2;
        const startPos = Math.max(0, centerPos - maxRange / 2 - 5);
        this.startPosition.set(startPos);
      } else {
        this.startPosition.set(0);
      }
    } else if (task === 'task2') {
      const distance = this.objectDistance();
      // Для завдання 2 сигнали приблизно на відстані distance
      const startPos = Math.max(0, distance - maxRange / 2 - 10);
      this.startPosition.set(startPos);
    } else if (task === 'task3') {
      const thickness = this.cylinderThickness();
      const firstSignalPos = 25;
      const secondSignalPos = 25 + thickness;
      // Центруємо сигнали в видимій області
      const centerPos = (firstSignalPos + secondSignalPos) / 2;
      const startPos = Math.max(0, centerPos - maxRange / 2 - 5);
      this.startPosition.set(startPos);
    } else {
      this.startPosition.set(0);
    }
  }

  onRotationChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.objectRotation.set(parseInt(target.value));
  }

  // Knob rotation handlers
  onKnobMouseDown(event: MouseEvent, signal: any, currentValue: number, minValue: number = 1, maxValue: number = 10) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    this.startKnobRotation(element, event.clientX, event.clientY, signal, currentValue, minValue, maxValue);
  }

  onKnobTouchStart(event: TouchEvent, signal: any, currentValue: number, minValue: number = 1, maxValue: number = 10) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    const touch = event.touches[0];
    this.startKnobRotation(element, touch.clientX, touch.clientY, signal, currentValue, minValue, maxValue);
    
    document.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    document.addEventListener('touchend', this.touchEndHandler);
  }

  private startKnobRotation(element: HTMLElement, clientX: number, clientY: number, signal: any, currentValue: number, minValue: number, maxValue: number) {
    this.knobElement = element;
    
    const rect = this.knobElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const startAngle = Math.atan2(
      clientY - centerY,
      clientX - centerX
    );
    
    this.activeKnob = {
      signal,
      startValue: currentValue,
      lastAngle: startAngle,
      totalRotation: 0,
      minValue,
      maxValue
    };

    document.addEventListener('mousemove', this.mouseMoveHandler, { passive: false });
    document.addEventListener('mouseup', this.mouseUpHandler);
  }

  private handleMouseMove(event: MouseEvent) {
    this.updateKnobRotation(event.clientX, event.clientY);
  }

  private handleTouchMove(event: TouchEvent) {
    if (event.touches.length > 0) {
      const touch = event.touches[0];
      this.updateKnobRotation(touch.clientX, touch.clientY);
    }
  }

  private updateKnobRotation(clientX: number, clientY: number) {
    if (!this.activeKnob || !this.knobElement) return;
    
    const rect = this.knobElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const currentAngle = Math.atan2(
      clientY - centerY,
      clientX - centerX
    );
    
    let angleDiff = currentAngle - this.activeKnob.lastAngle;
    
    if (angleDiff > Math.PI) {
      angleDiff -= 2 * Math.PI;
    } else if (angleDiff < -Math.PI) {
      angleDiff += 2 * Math.PI;
    }
    
    this.activeKnob.totalRotation += angleDiff;
    this.activeKnob.lastAngle = currentAngle;
    
    const range = this.activeKnob.maxValue - this.activeKnob.minValue;
    const valueChange = (this.activeKnob.totalRotation / (2 * Math.PI)) * range;
    let newValue = this.activeKnob.startValue + valueChange;
    newValue = Math.max(this.activeKnob.minValue, Math.min(this.activeKnob.maxValue, Math.round(newValue)));
    
    this.activeKnob.signal.set(newValue);
  }

  private handleMouseUp() {
    this.cleanupKnobListeners();
  }

  private handleTouchEnd() {
    this.cleanupKnobListeners();
  }

  private cleanupKnobListeners() {
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
    document.removeEventListener('touchmove', this.touchMoveHandler);
    document.removeEventListener('touchend', this.touchEndHandler);
    this.activeKnob = null;
    this.knobElement = null;
  }

  getMaterialName(material: Material): string {
    const names: Record<Material, string> = {
      aluminum: 'Алюміній',
      polymer: 'Полімер',
      steel: 'Сталь'
    };
    return names[material];
  }

  getShapeName(shape: Shape): string {
    const names: Record<Shape, string> = {
      circle: 'Коло',
      square: 'Квадрат',
      triangle: 'Трикутник',
      rectangle: 'Прямокутник'
    };
    return names[shape];
  }

  updateMeasuredDistance() {
    const task = this.currentTask();
    
    if (task === 'task1') {
      // Task 1: відстань між двома сигналами = товщина пластинки
      const plateWidth = this.selectedPlate();
      if (plateWidth) {
        this.measuredDistance.set(plateWidth);
      } else {
        this.measuredDistance.set(0);
      }
    } else if (task === 'task2') {
      // Task 2: відстань між точками 1 і 2 залежить від форми та обертання
      const shape = this.objectShape();
      const rotation = this.objectRotation();
      const shapePoints = this.getShapePoints(shape, rotation);
      
      if (shapePoints.length >= 2) {
        // Знаходимо мінімальну та максимальну позиції
        const minPoint = Math.min(...shapePoints);
        const maxPoint = Math.max(...shapePoints);
        const distance = maxPoint - minPoint;
        this.measuredDistance.set(Math.abs(distance));
      } else {
        this.measuredDistance.set(0);
      }
    } else if (task === 'task3') {
      // Task 3: це висота сигналів, не відстань, тому залишаємо 0 або товщину
      this.measuredDistance.set(this.cylinderThickness());
    } else {
      this.measuredDistance.set(0);
    }
  }

  // Методи для регулювання вимірювання стрілками
  adjustMeasurement(delta: number) {
    const current = Math.round(this.measuredDistance()); // Округлюємо до цілого
    const newValue = Math.max(0, Math.min(200, current + delta));
    this.measuredDistance.set(newValue);
  }

  startContinuousAdjust(direction: number) {
    // Зупиняємо попередній інтервал, якщо він є
    this.stopContinuousAdjust();
    
    this.adjustDirection = direction;
    
    // Перша зміна одразу на 1 мм
    this.adjustMeasurement(direction);
    
    // Починаємо тривале збільшення/зменшення з затримкою
    // Спочатку чекаємо 500мс, потім починаємо безперервне змінювання
    // Це гарантує, що при короткому натисканні зміниться тільки на 1
    const timeoutId = setTimeout(() => {
      if (this.adjustDirection === direction && this.continuousAdjustInterval === null) {
        this.continuousAdjustInterval = window.setInterval(() => {
          this.adjustMeasurement(this.adjustDirection);
        }, 100); // Оновлюємо кожні 100мс (повільніше)
      }
    }, 500);
    
    // Зберігаємо timeoutId для можливості його очищення
    this.adjustTimeoutId = timeoutId;
  }

  stopContinuousAdjust() {
    // Очищаємо інтервал
    if (this.continuousAdjustInterval !== null) {
      clearInterval(this.continuousAdjustInterval);
      this.continuousAdjustInterval = null;
    }
    
    // Очищаємо timeout, щоб не почався інтервал після відпускання кнопки
    if (this.adjustTimeoutId !== null) {
      clearTimeout(this.adjustTimeoutId);
      this.adjustTimeoutId = null;
    }
    
    this.adjustDirection = 0;
  }

  openManual() {
    this.showManual.set(true);
  }

  closeManual() {
    this.showManual.set(false);
  }

  drawPlateVisualization() {
    const canvas = this.plateCanvas?.nativeElement;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const plateWidth = this.selectedPlate();
    if (plateWidth === null) return;
    
    const distance = this.plateDistance();
    
    // Очищаємо canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Фон
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Масштаб для візуалізації (1 мм = 2 пікселі)
    const scale = 2;
    const centerY = canvas.height / 2;
    const leftX = 50; // Позиція зонда зліва
    
    // Малюємо реалістичний зонд (ультразвуковий датчик) - вертикально зліва
    this.drawRealisticProbeVertical(ctx, leftX, centerY);
    
    // Відстань від зонда до пластинки (горизонтальна лінія)
    const plateLeftX = leftX + 20 + distance * scale;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(leftX + 20, centerY);
    ctx.lineTo(plateLeftX, centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Підпис відстані
    ctx.fillStyle = '#666';
    ctx.font = '11px Arial';
    const distanceMidX = leftX + 20 + (distance * scale) / 2;
    ctx.textAlign = 'center';
    ctx.fillText(`${distance.toFixed(1)} мм`, distanceMidX, centerY - 15);
    
    // Малюємо пластинку (вертикальна, товщина горизонтально)
    const plateThickness = plateWidth * scale;
    const plateHeight_px = 120; // Висота пластинки в пікселях
    
    // Тінь пластинки
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(plateLeftX + plateThickness + 3, centerY - plateHeight_px / 2 + 3, 5, plateHeight_px);
    
    // Пластинка (фронтальна грань)
    const gradient = ctx.createLinearGradient(
      plateLeftX, centerY - plateHeight_px / 2,
      plateLeftX, centerY + plateHeight_px / 2
    );
    gradient.addColorStop(0, '#c0c0c0');
    gradient.addColorStop(0.5, '#e0e0e0');
    gradient.addColorStop(1, '#c0c0c0');
    ctx.fillStyle = gradient;
    ctx.fillRect(plateLeftX, centerY - plateHeight_px / 2, plateThickness, plateHeight_px);
    
    // Контур пластинки
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(plateLeftX, centerY - plateHeight_px / 2, plateThickness, plateHeight_px);
    
    // Внутрішні лінії для об'єму (горизонтальні)
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plateLeftX, centerY - plateHeight_px / 2 + 10);
    ctx.lineTo(plateLeftX + plateThickness, centerY - plateHeight_px / 2 + 10);
    ctx.moveTo(plateLeftX, centerY + plateHeight_px / 2 - 10);
    ctx.lineTo(plateLeftX + plateThickness, centerY + plateHeight_px / 2 - 10);
    ctx.stroke();
    
    // Передня поверхня (ліва)
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(plateLeftX, centerY - plateHeight_px / 2);
    ctx.lineTo(plateLeftX, centerY + plateHeight_px / 2);
    ctx.stroke();
    
    // Задня поверхня (права)
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(plateLeftX + plateThickness, centerY - plateHeight_px / 2);
    ctx.lineTo(plateLeftX + plateThickness, centerY + plateHeight_px / 2);
    ctx.stroke();
    
    // Підпис товщини пластинки
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(plateLeftX + plateThickness / 2, centerY + plateHeight_px / 2 + 25);
    ctx.fillText(`Товщина: ${plateWidth} мм`, 0, 0);
    ctx.restore();
    
    // Стрілки для вказівки товщини (вертикальні)
    ctx.strokeStyle = '#d32f2f';
    ctx.fillStyle = '#d32f2f';
    ctx.lineWidth = 2;
    const arrowX = plateLeftX + plateThickness / 2;
    const arrowStartY = centerY - plateHeight_px / 2 - 20;
    const arrowEndY = arrowStartY - 25;
    
    // Вертикальна лінія
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowStartY);
    ctx.lineTo(arrowX, arrowEndY);
    ctx.stroke();
    
    // Стрілка вверх
    ctx.beginPath();
    ctx.moveTo(arrowX - 5, arrowEndY + 8);
    ctx.lineTo(arrowX, arrowEndY);
    ctx.lineTo(arrowX + 5, arrowEndY + 8);
    ctx.fill();
    
    // Стрілка вниз
    ctx.beginPath();
    ctx.moveTo(arrowX - 5, arrowStartY - 8);
    ctx.lineTo(arrowX, arrowStartY);
    ctx.lineTo(arrowX + 5, arrowStartY - 8);
    ctx.fill();
    
    // Анімовані ультразвукові хвилі
    this.drawAnimatedWaves(ctx, leftX, centerY, plateLeftX, plateThickness, distance, scale);
  }
  
  drawAnimatedWaves(
    ctx: CanvasRenderingContext2D,
    leftX: number,
    centerY: number,
    plateLeftX: number,
    plateThickness: number,
    distance: number,
    scale: number
  ) {
    const speed = 0.4; // Швидкість руху хвиль
    const probeRight = leftX + 20;
    const plateFront = plateLeftX; // Передня поверхня (ліва, зелена)
    const plateBack = plateLeftX + plateThickness; // Задня поверхня (права, помаранчева)
    const totalDistance = distance * scale;
    
    const cycleTime = 4; // Повний цикл
    const currentTime = (this.waveAnimationTime * speed) % cycleTime;
    
    // ХВИЛЯ 1: Відбивається від ЗЕЛЕНОЇ поверхні (передньої)
    // 1.1. Хвиля йде від зонда до зеленої поверхні
    if (currentTime < 1) {
      const waveX = probeRight + currentTime * totalDistance;
      if (waveX <= plateFront) {
        this.drawWave(ctx, waveX, centerY, '#0096ff', 0.8);
      }
    }
    
    // 1.2. Хвиля відбивається від зеленої поверхні і повертається до зонда - ПЕРШИЙ СИГНАЛ
    if (currentTime >= 1 && currentTime < 2) {
      const reflectedX = plateFront - (currentTime - 1) * totalDistance;
      if (reflectedX >= probeRight) {
        // Зелена хвиля, що відбивається від зеленої поверхні
        this.drawWave(ctx, reflectedX, centerY, '#00ff00', 0.8);
      }
    }
    
    // ХВИЛЯ 2: Відбивається від ПОМАРАНЧЕВОЇ поверхні (задньої)
    // 2.1. Хвиля йде від зонда до зеленої поверхні (одночасно з хвилею 1)
    const wave2Time = currentTime; // Починається одночасно
    if (wave2Time < 1) {
      const waveX = probeRight + wave2Time * totalDistance;
      if (waveX <= plateFront) {
        // Ця хвиля буде проходити далі, тому інший колір
        this.drawWave(ctx, waveX, centerY, '#0066cc', 0.6);
      }
    }
    
    // 2.2. Хвиля проходить через пластинку (від зеленої до помаранчевої поверхні)
    if (wave2Time >= 1 && wave2Time < 1.5) {
      const progress = (wave2Time - 1) / 0.5;
      const waveX = plateFront + progress * plateThickness;
      if (waveX <= plateBack) {
        this.drawWave(ctx, waveX, centerY, '#0066cc', 0.6);
      }
    }
    
    // 2.3. Хвиля відбивається від помаранчевої поверхні (повертається через пластинку до зеленої)
    if (wave2Time >= 1.5 && wave2Time < 2) {
      const progress = (wave2Time - 1.5) / 0.5;
      const waveX = plateBack - progress * plateThickness;
      if (waveX >= plateFront) {
        // Помаранчева хвиля, що відбивається від помаранчевої поверхні
        this.drawWave(ctx, waveX, centerY, '#ff6600', 0.8);
      }
    }
    
    // 2.4. Хвиля виходить з зеленої поверхні і повертається до зонда - ДРУГИЙ СИГНАЛ
    if (wave2Time >= 2 && wave2Time < 3) {
      const waveX = plateFront - (wave2Time - 2) * totalDistance;
      if (waveX >= probeRight) {
        // Помаранчева хвиля, що повертається від зеленої поверхні
        this.drawWave(ctx, waveX, centerY, '#ff8800', 0.7);
      }
    }
    
    // Додаткова хвиля для більш динамічного вигляду
    const extraWaveTime = (this.waveAnimationTime * speed * 0.6) % 2.5;
    if (extraWaveTime < 1) {
      const extraX = probeRight + extraWaveTime * totalDistance;
      if (extraX <= plateFront) {
        this.drawWave(ctx, extraX, centerY, '#0088dd', 0.3, 15);
      }
    }
  }
  
  drawWave(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    opacity: number,
    baseRadius: number = 20
  ) {
    // Градієнт для хвилі
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, baseRadius + 15);
    gradient.addColorStop(0, `rgba(${this.hexToRgb(color)}, ${opacity * 0.8})`);
    gradient.addColorStop(0.5, `rgba(${this.hexToRgb(color)}, ${opacity * 0.4})`);
    gradient.addColorStop(1, `rgba(${this.hexToRgb(color)}, 0)`);
    
    // Зовнішнє коло (світіння)
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, baseRadius + 15, 0, Math.PI * 2);
    ctx.fill();
    
    // Основне коло хвилі
    ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, ${opacity})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Внутрішнє коло для об'єму
    ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, ${opacity * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, baseRadius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  hexToRgb(hex: string): string {
    // Конвертує hex в RGB формат "r, g, b"
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      const r = parseInt(result[1], 16);
      const g = parseInt(result[2], 16);
      const b = parseInt(result[3], 16);
      return `${r}, ${g}, ${b}`;
    }
    return '0, 150, 255'; // Default blue
  }
  
  // Task 2 Visualization
  drawTask2Visualization() {
    const canvas = this.task2Canvas?.nativeElement;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const shape = this.objectShape();
    const rotation = this.objectRotation();
    const distance = this.objectDistance();
    
    // Очищаємо canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Фон
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Масштаб для візуалізації (1 мм = 2 пікселі)
    const scale = 2;
    const centerY = canvas.height / 2;
    const probeX = 50; // Позиція зонда зліва
    
    // Малюємо реалістичний зонд (ультразвуковий датчик)
    this.drawRealisticProbeVertical(ctx, probeX, centerY);
    
    // Відстань від зонда до об'єкта
    const objectX = probeX + 20 + distance * scale;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(probeX + 20, centerY);
    ctx.lineTo(objectX, centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Підпис відстані
    ctx.fillStyle = '#666';
    ctx.font = '11px Arial';
    const distanceMidX = probeX + 20 + (distance * scale) / 2;
    ctx.textAlign = 'center';
    ctx.fillText(`${distance} мм`, distanceMidX, centerY - 15);
    
    // Малюємо об'єкт з формою
    ctx.save();
    ctx.translate(objectX, centerY);
    ctx.rotate((rotation * Math.PI) / 180);
    
    const size = 20 * scale; // 20 мм * масштаб
    
    ctx.fillStyle = '#c0c0c0';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    
    switch (shape) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'square':
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.strokeRect(-size / 2, -size / 2, size, size);
        break;
        
      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(0, -size / 2);
        ctx.lineTo(-size / 2, size / 2);
        ctx.lineTo(size / 2, size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'rectangle':
        const width = size;
        const height = size * 0.6;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.strokeRect(-width / 2, -height / 2, width, height);
        break;
    }
    
    ctx.restore();
    
    // Підпис форми
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Форма: ${this.getShapeName(shape)}`, objectX, centerY + size / 2 + 25);
    
    // Анімовані хвилі
    this.drawTask2AnimatedWaves(ctx, probeX, centerY, objectX, distance, scale, shape, size);
  }
  
  drawTask2AnimatedWaves(
    ctx: CanvasRenderingContext2D,
    probeX: number,
    centerY: number,
    objectX: number,
    distance: number,
    scale: number,
    shape: Shape,
    objectSize: number
  ) {
    const speed = 0.4;
    const probeRight = probeX + 20;
    const totalDistance = distance * scale;
    
    // Хвиля, що йде від зонда до об'єкта
    const waveProgress = (this.task2WaveAnimationTime * speed) % 3;
    if (waveProgress < 1.5) {
      const waveX = probeRight + (waveProgress / 1.5) * totalDistance;
      if (waveX <= objectX) {
        this.drawWave(ctx, waveX, centerY, '#0096ff', 0.7);
      } else {
        // Хвиля відбивається від об'єкта
        const reflectedX = objectX - ((waveProgress - 1.5) / 1.5) * totalDistance;
        if (reflectedX >= probeRight) {
          this.drawWave(ctx, reflectedX, centerY, '#00d4ff', 0.6);
        }
      }
    } else {
      // Відбита хвиля повертається до зонда
      const reflectedProgress = waveProgress - 1.5;
      const reflectedX = objectX - (reflectedProgress / 1.5) * totalDistance;
      if (reflectedX >= probeRight) {
        this.drawWave(ctx, reflectedX, centerY, '#00d4ff', 0.6);
      }
    }
    
    // Додаткова хвиля для динаміки
    const extraWaveTime = (this.task2WaveAnimationTime * speed * 0.6) % 2.5;
    if (extraWaveTime < 1) {
      const extraX = probeRight + extraWaveTime * totalDistance;
      if (extraX <= objectX) {
        this.drawWave(ctx, extraX, centerY, '#0088dd', 0.3, 15);
      }
    }
  }
  
  // Task 3 Visualization
  drawTask3Visualization() {
    const canvas = this.task3Canvas?.nativeElement;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const thickness = this.cylinderThickness();
    const material = this.cylinderMaterial();
    
    // Очищаємо canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Фон
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Масштаб для візуалізації (1 мм = 2 пікселі)
    const scale = 2;
    const centerX = canvas.width / 2;
    const probeY = 50; // Позиція зонда зверху
    
    // Малюємо реалістичний зонд (ультразвуковий датчик) - горизонтально зверху
    this.drawRealisticProbeHorizontal(ctx, centerX, probeY);
    
    // Відстань від зонда до циліндра
    const cylinderTop = probeY + 20 + 25 * scale; // 25 мм відстань
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(centerX, probeY + 20);
    ctx.lineTo(centerX, cylinderTop);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Малюємо циліндр (2D вигляд збоку - прямокутник)
    const cylinderThickness = thickness * scale;
    const cylinderWidth = 100; // Ширина циліндра в пікселях
    
    // Тінь
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(centerX + cylinderWidth / 2 + 3, cylinderTop + cylinderThickness + 3, 5, 10);
    
    // Циліндр
    const gradient = ctx.createLinearGradient(
      centerX - cylinderWidth / 2, cylinderTop,
      centerX + cylinderWidth / 2, cylinderTop
    );
    gradient.addColorStop(0, '#c0c0c0');
    gradient.addColorStop(0.5, '#e0e0e0');
    gradient.addColorStop(1, '#c0c0c0');
    ctx.fillStyle = gradient;
    ctx.fillRect(centerX - cylinderWidth / 2, cylinderTop, cylinderWidth, cylinderThickness);
    
    // Контур
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - cylinderWidth / 2, cylinderTop, cylinderWidth, cylinderThickness);
    
    // Верхня поверхня (зелена)
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX - cylinderWidth / 2, cylinderTop);
    ctx.lineTo(centerX + cylinderWidth / 2, cylinderTop);
    ctx.stroke();
    
    // Нижня поверхня (помаранчева)
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX - cylinderWidth / 2, cylinderTop + cylinderThickness);
    ctx.lineTo(centerX + cylinderWidth / 2, cylinderTop + cylinderThickness);
    ctx.stroke();
    
    // Підпис товщини
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`Товщина: ${thickness} мм`, centerX, cylinderTop + cylinderThickness + 25);
    
    // Підпис матеріалу (прихований)
    ctx.fillStyle = '#666';
    ctx.font = '11px Arial';
    ctx.fillText(`Матеріал: ???`, centerX, cylinderTop + cylinderThickness + 40);
    
    // Анімовані хвилі
    this.drawTask3AnimatedWaves(ctx, centerX, probeY, cylinderTop, cylinderThickness, scale);
  }
  
  drawTask3AnimatedWaves(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    probeY: number,
    cylinderTop: number,
    cylinderThickness: number,
    scale: number
  ) {
    const speed = 0.4;
    const probeBottom = probeY + 20;
    const distanceToTop = 25 * scale; // 25 мм до верху циліндра
    
    // Хвиля, що йде від зонда до верху циліндра
    const waveProgress = (this.task3WaveAnimationTime * speed) % 3;
    if (waveProgress < 1) {
      const waveY = probeBottom + (waveProgress) * distanceToTop;
      if (waveY <= cylinderTop) {
        this.drawWaveVertical(ctx, centerX, waveY, '#0096ff', 0.7);
      }
    }
    
    // Хвиля відбита від верху циліндра (перший сигнал)
    if (waveProgress >= 1 && waveProgress < 2) {
      const reflectedY = cylinderTop - (waveProgress - 1) * distanceToTop;
      if (reflectedY >= probeBottom) {
        this.drawWaveVertical(ctx, centerX, reflectedY, '#00d4ff', 0.6);
      }
    }
    
    // Хвиля, що проходить через циліндр
    const wave2Progress = ((this.task3WaveAnimationTime * speed) - 1) % 3;
    if (wave2Progress >= 0 && wave2Progress < 0.5) {
      const waveY = cylinderTop + (wave2Progress / 0.5) * cylinderThickness;
      if (waveY <= cylinderTop + cylinderThickness) {
        this.drawWaveVertical(ctx, centerX, waveY, '#0066cc', 0.5);
      }
    }
    
    // Хвиля відбита від низу циліндра
    if (wave2Progress >= 0.5 && wave2Progress < 1) {
      const waveY = (cylinderTop + cylinderThickness) - ((wave2Progress - 0.5) / 0.5) * cylinderThickness;
      if (waveY >= cylinderTop) {
        this.drawWaveVertical(ctx, centerX, waveY, '#ff6600', 0.6);
      }
    }
    
    // Хвиля, що виходить з верху і повертається до зонда (другий сигнал)
    if (wave2Progress >= 1 && wave2Progress < 2) {
      const waveY = cylinderTop - (wave2Progress - 1) * distanceToTop;
      if (waveY >= probeBottom) {
        this.drawWaveVertical(ctx, centerX, waveY, '#ff8800', 0.5);
      }
    }
  }
  
  drawWaveVertical(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    opacity: number,
    baseRadius: number = 20
  ) {
    // Градієнт для вертикальної хвилі
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, baseRadius + 15);
    gradient.addColorStop(0, `rgba(${this.hexToRgb(color)}, ${opacity * 0.8})`);
    gradient.addColorStop(0.5, `rgba(${this.hexToRgb(color)}, ${opacity * 0.4})`);
    gradient.addColorStop(1, `rgba(${this.hexToRgb(color)}, 0)`);
    
    // Зовнішнє коло (світіння)
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, baseRadius + 15, 0, Math.PI * 2);
    ctx.fill();
    
    // Основне коло хвилі
    ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, ${opacity})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Внутрішнє коло для об'єму
    ctx.strokeStyle = `rgba(${this.hexToRgb(color)}, ${opacity * 0.6})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, baseRadius * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  // Метод для малювання реалістичного зонда (вертикальна орієнтація)
  drawRealisticProbeVertical(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const probeWidth = 24;
    const probeHeight = 70;
    const probeX = x;
    const probeY = y - probeHeight / 2;
    
    // Тінь зонда
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(probeX + 3, probeY + 3, probeWidth, probeHeight);
    
    // Основний корпус зонда (градієнт для об'єму)
    const bodyGradient = ctx.createLinearGradient(probeX, probeY, probeX + probeWidth, probeY);
    bodyGradient.addColorStop(0, '#2a2a2a');
    bodyGradient.addColorStop(0.3, '#3a3a3a');
    bodyGradient.addColorStop(0.7, '#3a3a3a');
    bodyGradient.addColorStop(1, '#2a2a2a');
    ctx.fillStyle = bodyGradient;
    ctx.fillRect(probeX, probeY, probeWidth, probeHeight);
    
    // Округлені кути (верх)
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(probeX + probeWidth / 2, probeY, probeWidth / 2, Math.PI, 0, false);
    ctx.fill();
    
    // Округлені кути (низ)
    ctx.beginPath();
    ctx.arc(probeX + probeWidth / 2, probeY + probeHeight, probeWidth / 2, 0, Math.PI, false);
    ctx.fill();
    
    // Контур зонда
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.strokeRect(probeX, probeY, probeWidth, probeHeight);
    
    // Округлені кути (контур)
    ctx.beginPath();
    ctx.arc(probeX + probeWidth / 2, probeY, probeWidth / 2, Math.PI, 0, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(probeX + probeWidth / 2, probeY + probeHeight, probeWidth / 2, 0, Math.PI, false);
    ctx.stroke();
    
    // Активна поверхня (датчик) - темна з металевим відблиском
    const sensorY = probeY + probeHeight - 12;
    const sensorGradient = ctx.createLinearGradient(probeX, sensorY, probeX, sensorY + 12);
    sensorGradient.addColorStop(0, '#0a0a0a');
    sensorGradient.addColorStop(0.5, '#1a1a1a');
    sensorGradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = sensorGradient;
    ctx.fillRect(probeX + 2, sensorY, probeWidth - 4, 12);
    
    // Відблиск на датчику
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(probeX + 3, sensorY + 1, probeWidth - 6, 4);
    
    // Контур датчика
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(probeX + 2, sensorY, probeWidth - 4, 12);
    
    // Верхня частина зонда (ручка/корпус)
    const handleGradient = ctx.createLinearGradient(probeX, probeY, probeX, probeY + 20);
    handleGradient.addColorStop(0, '#4a4a4a');
    handleGradient.addColorStop(1, '#3a3a3a');
    ctx.fillStyle = handleGradient;
    ctx.fillRect(probeX + 3, probeY + 5, probeWidth - 6, 15);
    
    // Відблиск на корпусі
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(probeX + 4, probeY + 6, probeWidth - 8, 8);
    
    // Лінії на корпусі для реалізму
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(probeX + 6, probeY + 25);
    ctx.lineTo(probeX + probeWidth - 6, probeY + 25);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(probeX + 6, probeY + 35);
    ctx.lineTo(probeX + probeWidth - 6, probeY + 35);
    ctx.stroke();
    
    // Підпис зонда
    ctx.fillStyle = '#555';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(probeX - 18, y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('ЗОНД', 0, 0);
    ctx.restore();
  }
  
  // Метод для малювання реалістичного зонда (горизонтальна орієнтація)
  drawRealisticProbeHorizontal(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const probeWidth = 70;
    const probeHeight = 24;
    const probeX = x - probeWidth / 2;
    const probeY = y;
    
    // Тінь зонда
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(probeX + 3, probeY + 3, probeWidth, probeHeight);
    
    // Основний корпус зонда (градієнт для об'єму)
    const bodyGradient = ctx.createLinearGradient(probeX, probeY, probeX, probeY + probeHeight);
    bodyGradient.addColorStop(0, '#2a2a2a');
    bodyGradient.addColorStop(0.3, '#3a3a3a');
    bodyGradient.addColorStop(0.7, '#3a3a3a');
    bodyGradient.addColorStop(1, '#2a2a2a');
    ctx.fillStyle = bodyGradient;
    ctx.fillRect(probeX, probeY, probeWidth, probeHeight);
    
    // Округлені кути (ліво)
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(probeX, probeY + probeHeight / 2, probeHeight / 2, Math.PI / 2, 3 * Math.PI / 2, false);
    ctx.fill();
    
    // Округлені кути (право)
    ctx.beginPath();
    ctx.arc(probeX + probeWidth, probeY + probeHeight / 2, probeHeight / 2, 3 * Math.PI / 2, Math.PI / 2, false);
    ctx.fill();
    
    // Контур зонда
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    ctx.strokeRect(probeX, probeY, probeWidth, probeHeight);
    
    // Округлені кути (контур)
    ctx.beginPath();
    ctx.arc(probeX, probeY + probeHeight / 2, probeHeight / 2, Math.PI / 2, 3 * Math.PI / 2, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(probeX + probeWidth, probeY + probeHeight / 2, probeHeight / 2, 3 * Math.PI / 2, Math.PI / 2, false);
    ctx.stroke();
    
    // Активна поверхня (датчик) - темна з металевим відблиском
    const sensorX = probeX + probeWidth - 12;
    const sensorGradient = ctx.createLinearGradient(sensorX, probeY, sensorX + 12, probeY);
    sensorGradient.addColorStop(0, '#0a0a0a');
    sensorGradient.addColorStop(0.5, '#1a1a1a');
    sensorGradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = sensorGradient;
    ctx.fillRect(sensorX, probeY + 2, 12, probeHeight - 4);
    
    // Відблиск на датчику
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(sensorX + 1, probeY + 3, 4, probeHeight - 6);
    
    // Контур датчика
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(sensorX, probeY + 2, 12, probeHeight - 4);
    
    // Ліва частина зонда (ручка/корпус)
    const handleGradient = ctx.createLinearGradient(probeX, probeY, probeX + 20, probeY);
    handleGradient.addColorStop(0, '#4a4a4a');
    handleGradient.addColorStop(1, '#3a3a3a');
    ctx.fillStyle = handleGradient;
    ctx.fillRect(probeX + 5, probeY + 3, 15, probeHeight - 6);
    
    // Відблиск на корпусі
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(probeX + 6, probeY + 4, 8, probeHeight - 8);
    
    // Лінії на корпусі для реалізму
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(probeX + 25, probeY + 6);
    ctx.lineTo(probeX + 25, probeY + probeHeight - 6);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(probeX + 35, probeY + 6);
    ctx.lineTo(probeX + 35, probeY + probeHeight - 6);
    ctx.stroke();
    
    // Підпис зонда
    ctx.fillStyle = '#555';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ЗОНД', x, probeY - 8);
  }
}
