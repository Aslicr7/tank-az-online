/**
 * Tank AZ Online - Maze Map & Powerup Renderer
 * Handles grid maze drawing, wall shadow geometry, wall segments, and animated powerups.
 */

export class MapRenderer {
  pulseTimer: number = 0;

  constructor() {
    this.pulseTimer = 0;
  }

  update(dt) {
    this.pulseTimer += dt * 3;
  }

  renderGrid(ctx, width, height, cellSize) {
    ctx.save();
    ctx.fillStyle = '#0f172a'; // Dark slate backdrop
    ctx.fillRect(0, 0, width, height);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;

    for (let x = 0; x <= width; x += cellSize / 2) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += cellSize / 2) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderWalls(ctx, walls) {
    ctx.save();

    // 1. Draw soft wall drop shadows
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    walls.forEach((wall) => {
      const halfThick = wall.thickness / 2;
      if (wall.y1 === wall.y2) {
        // Horizontal wall shadow
        ctx.fillRect(
          Math.min(wall.x1, wall.x2) - halfThick + 4,
          wall.y1 - halfThick + 4,
          Math.abs(wall.x2 - wall.x1) + wall.thickness,
          wall.thickness
        );
      } else {
        // Vertical wall shadow
        ctx.fillRect(
          wall.x1 - halfThick + 4,
          Math.min(wall.y1, wall.y2) - halfThick + 4,
          wall.thickness,
          Math.abs(wall.y2 - wall.y1) + wall.thickness
        );
      }
    });

    // 2. Draw wall body with classic AZ blue metal style
    walls.forEach((wall) => {
      const halfThick = wall.thickness / 2;
      let rx = Math.min(wall.x1, wall.x2) - halfThick;
      let ry = Math.min(wall.y1, wall.y2) - halfThick;
      let rw = wall.x1 === wall.x2 ? wall.thickness : Math.abs(wall.x2 - wall.x1) + wall.thickness;
      let rh = wall.y1 === wall.y2 ? wall.thickness : Math.abs(wall.y2 - wall.y1) + wall.thickness;

      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;

      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);

      // Inner highlight line
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(rx + 2, ry + 2, rw - 4, 2);
    });

    ctx.restore();
  }

  renderPowerups(ctx, powerups) {
    ctx.save();
    const bobOffset = Math.sin(this.pulseTimer) * 4;
    const pulseScale = 1 + Math.sin(this.pulseTimer * 2) * 0.12;

    powerups.forEach((p) => {
      const px = Math.floor(p.x);
      const py = Math.floor(p.y + bobOffset);

      let symbol = '⚡';
      let color = '#facc15';
      let title = 'Tăng Tốc Độ';

      switch (p.type) {
        // Nhóm 1 - ĐẠN: VIẾT HOA TOÀN BỘ
        case 'fastBullet':
          symbol = '🔥';
          color = '#ef4444';
          title = 'ĐẠN SIÊU TỐC';
          break;
        case 'laser':
          symbol = '⚡';
          color = '#f87171';
          title = 'ĐẠN LASER';
          break;
        case 'bigBullet':
        case 'piercing':
        case 'spread':
        case 'tripleShot':
          symbol = '💣';
          color = '#a855f7';
          title = 'ĐẠN CỠ LỚN';
          break;
        case 'crazyBounce':
        case 'bounce':
        case 'ricochet':
          symbol = '🪃';
          color = '#10b981';
          title = 'ĐẠN SIÊU NẢY';
          break;

        // Nhóm 2 - HIỆU ỨNG: Viết Hoa Chữ Cái Đầu
        case 'shield':
          symbol = '🛡️';
          color = '#3b82f6';
          title = 'Khiên Bảo Vệ';
          break;
        case 'speed':
          symbol = '⚡';
          color = '#facc15';
          title = 'Tăng Tốc Độ';
          break;
        case 'rapidFire':
          symbol = '⏱️';
          color = '#ec4899';
          title = 'Bắn Liên Tục';
          break;

        // Nhóm 3 - NỘI TẠI: viết thường toàn bộ
        case 'heart':
        case 'extraLife':
          symbol = '❤️';
          color = '#f43f5e';
          title = 'mạng phụ';
          break;
      }

      ctx.save();

      // 1. High contrast outer neon shadowBlur glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 16 + Math.sin(this.pulseTimer * 3) * 6;

      // Outer aura
      ctx.beginPath();
      ctx.arc(px, py, 18 * pulseScale, 0, Math.PI * 2);
      ctx.fillStyle = color + '33';
      ctx.fill();

      // Outer border ring
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();

      // 2. Solid Badge core
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();

      // 3. Render Icon Symbol
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, px, py + 1);

      // 4. Floating item text label below
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      ctx.font = 'bold 9px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(title, px, py + 23);

      ctx.restore();
    });

    ctx.restore();
  }

  renderDangerZone(ctx: CanvasRenderingContext2D, width: number, height: number, timeRemaining: number, gameMode?: string) {
    if (gameMode !== 'teambattle' || timeRemaining > 20 || timeRemaining <= 0) return;

    ctx.save();
    const centerX = width / 2;
    const centerY = height / 2;

    // Linear Interpolation (LERP) for shrinking circle radius
    const startRadius = Math.hypot(centerX, centerY);
    const t = Math.min(1.0, Math.max(0, (20 - timeRemaining) / 20));
    const currentRadius = Math.max(0, startRadius * (1 - t));

    if (currentRadius <= 0) {
      ctx.fillStyle = 'rgba(225, 29, 72, 0.65)';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
      return;
    }

    // 1. Semi-transparent toxic red/dark overlay outside safe circle
    ctx.fillStyle = 'rgba(225, 29, 72, 0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2, true);
    ctx.fill();

    // 2. Glowing Neon Pink/Red boundary line
    const pulseAlpha = 0.8 + Math.sin(this.pulseTimer * 8) * 0.2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 0, 85, ${pulseAlpha})`;
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 15;
    ctx.stroke();

    // 3. Inner subtle accent warning ring
    if (currentRadius > 4) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius - 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 180, 210, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 4. Warning Label
    if (currentRadius > 35) {
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ffe4e6';
      ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      const labelY = Math.max(22, centerY - currentRadius - 10);
      ctx.fillText('⚠️ VÒNG BO TRÒN SIẾT TÂM MAP! ⚠️', centerX, labelY);
    }

    ctx.restore();
  }
}
