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
  
  // Task mode
  currentTask = signal<TaskMode>('task1');
  
  // Control values
  intensity = signal(5);
  brightness = signal(5);
  focus = signal(5);
  scale = signal(5);
  limitation = signal(5);
  startPosition = signal(0); // 0-150mm, start position of visible range
  isPowerOn = signal(false);
  isVaryMode = signal(false);
  
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
  
  private animationFrameId: number | null = null;
  private waveformData: number[] = [];
  private timeOffset = 0;
  private activeKnob: KnobState | null = null;
  private knobElement: HTMLElement | null = null;
  private continuousAdjustInterval: number | null = null;
  private adjustTimeoutId: number | null = null;
  private adjustDirection: number = 0;

  private mouseMoveHandler = this.handleMouseMove.bind(this);
  private mouseUpHandler = this.handleMouseUp.bind(this);
  private touchMoveHandler = this.handleTouchMove.bind(this);
  private touchEndHandler = this.handleTouchEnd.bind(this);

  // Material properties (speed of sound in m/s)
  private materialSpeeds: Record<Material, number> = {
    aluminum: 6320,
    polymer: 2400,
    steel: 5900
  };

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
    
    // Effect to reset start position when scale changes
    effect(() => {
      const scale = this.scale();
      // Reset to start (0mm) when scale changes
      this.startPosition.set(0);
    });
  }

  ngAfterViewInit() {
    if (this.isPowerOn()) {
      this.startAnimation();
    }
  }

  ngOnDestroy() {
    this.stopAnimation();
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
    // Скидаємо вимірювання при зміні завдання
    this.measuredDistance.set(0);
    // Скидаємо позицію на початок
    this.startPosition.set(0);
    // Очищаємо екран
    this.clearDisplay();
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
      
      // Make signals sharper - narrower width, especially for thin plates
      // Signal width decreases with scale to keep signals sharp when zoomed
      const baseSignalWidth = 0.8;
      // For thin plates, make signals even sharper
      const signalWidth = plateWidth <= 3 ? baseSignalWidth * 0.5 : baseSignalWidth;
      
      // Add first signal with sharper peak (higher power = 4 instead of 2)
      if (Math.abs(x - echo1Pos) < signalWidth * 3) {
        value += Math.exp(-Math.pow((x - echo1Pos) / signalWidth, 4)) * (intensity / 10) * 0.9;
      }
      
      // Add second signal with sharper peak
      if (Math.abs(x - echo2Pos) < signalWidth * 3) {
        value += Math.exp(-Math.pow((x - echo2Pos) / signalWidth, 4)) * (intensity / 10) * 0.9;
      }
      
      // Add minimal noise
      value += (Math.random() - 0.5) * 0.03;
      
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
      // Scale also affects vertical amplitude slightly
      const amplitude = (canvas.height / 2) * 0.8 * (0.8 + scale * 0.02);
      
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

  onVaryToggle() {
    this.isVaryMode.update(value => !value);
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
}
