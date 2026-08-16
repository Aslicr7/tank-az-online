/**
 * Tank AZ Online - Bullet Renderer & Client Physics
 * Handles cute pastel bullet trail graphics, ricochet motion updates, and bounce glow.
 */

export class BulletRenderer {
  static renderBullet(ctx: CanvasRenderingContext2D, bullet: any) {
    ctx.save();

    const bx = Math.floor(bullet.x);
    const by = Math.floor(bullet.y);

    // 1. Motion Trail
    const speed = Math.hypot(bullet.vx, bullet.vy);
    if (speed > 0) {
      const dirX = bullet.vx / speed;
      const dirY = bullet.vy / speed;
      const trailLen = 16;

      const grad = ctx.createLinearGradient(bx, by, bx - dirX * trailLen, by - dirY * trailLen);
      grad.addColorStop(0, bullet.color || '#f472b6');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - dirX * trailLen, by - dirY * trailLen);
      ctx.lineWidth = bullet.radius * 2;
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 2. Outer Glow
    ctx.beginPath();
    ctx.arc(bx, by, bullet.radius + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
    ctx.fill();

    // 3. Core Bubble Bullet Body
    ctx.beginPath();
    ctx.arc(bx, by, bullet.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = bullet.color || '#f472b6';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // 4. Highlight shine
    ctx.beginPath();
    ctx.arc(bx - bullet.radius * 0.3, by - bullet.radius * 0.3, bullet.radius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }
}
