/**
 * Tank AZ Online - Server Physics Engine
 * Handles maze generation, collision detection, wall bouncing, and tank dynamics.
 */

export interface WallSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  isSteel?: boolean;
  isBrick?: boolean;
  hp?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MazeGrid {
  cols: number;
  rows: number;
  cellSize: number;
  walls: WallSegment[];
  width: number;
  height: number;
}

export class PhysicsEngine {
  /**
   * Generates a random maze map using Recursive Backtracker algorithm.
   */
  static generateMaze(cols: number = 8, rows: number = 6, cellSize: number = 100): MazeGrid {
    const width = cols * cellSize;
    const height = rows * cellSize;
    const thickness = 10;

    // Grid representing cells
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false));
    
    // Track horizontal and vertical inner walls
    // horizWalls[r][c] is the wall below cell (r, c)
    const horizWalls: boolean[][] = Array.from({ length: rows - 1 }, () => Array(cols).fill(true));
    // vertWalls[r][c] is the wall to the right of cell (r, c)
    const vertWalls: boolean[][] = Array.from({ length: rows }, () => Array(cols - 1).fill(true));

    const stack: { r: number; c: number }[] = [];
    const startR = Math.floor(Math.random() * rows);
    const startC = Math.floor(Math.random() * cols);

    visited[startR][startC] = true;
    stack.push({ r: startR, c: startC });

    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      const neighbors: { r: number; c: number; dir: string }[] = [];

      // Top neighbor
      if (current.r > 0 && !visited[current.r - 1][current.c]) {
        neighbors.push({ r: current.r - 1, c: current.c, dir: 'N' });
      }
      // Right neighbor
      if (current.c < cols - 1 && !visited[current.r][current.c + 1]) {
        neighbors.push({ r: current.r, c: current.c + 1, dir: 'E' });
      }
      // Bottom neighbor
      if (current.r < rows - 1 && !visited[current.r + 1][current.c]) {
        neighbors.push({ r: current.r + 1, c: current.c, dir: 'S' });
      }
      // Left neighbor
      if (current.c > 0 && !visited[current.r][current.c - 1]) {
        neighbors.push({ r: current.r, c: current.c - 1, dir: 'W' });
      }

      if (neighbors.length > 0) {
        const next = neighbors[Math.floor(Math.random() * neighbors.length)];
        if (next.dir === 'N') {
          horizWalls[next.r][next.c] = false;
        } else if (next.dir === 'E') {
          vertWalls[current.r][current.c] = false;
        } else if (next.dir === 'S') {
          horizWalls[current.r][current.c] = false;
        } else if (next.dir === 'W') {
          vertWalls[next.r][next.c] = false;
        }

        visited[next.r][next.c] = true;
        stack.push({ r: next.r, c: next.c });
      } else {
        stack.pop();
      }
    }

    // Randomly remove 20% of remaining inner walls to create open loops / tactics
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (horizWalls[r][c] && Math.random() < 0.25) {
          horizWalls[r][c] = false;
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (vertWalls[r][c] && Math.random() < 0.25) {
          vertWalls[r][c] = false;
        }
      }
    }

    const walls: WallSegment[] = [];
    let wallIdCounter = 0;

    // Outer Boundary Walls
    walls.push({ id: `w_${wallIdCounter++}`, x1: 0, y1: 0, x2: width, y2: 0, thickness });
    walls.push({ id: `w_${wallIdCounter++}`, x1: 0, y1: height, x2: width, y2: height, thickness });
    walls.push({ id: `w_${wallIdCounter++}`, x1: 0, y1: 0, x2: 0, y2: height, thickness });
    walls.push({ id: `w_${wallIdCounter++}`, x1: width, y1: 0, x2: width, y2: height, thickness });

    // Inner Horizontal Walls
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        if (horizWalls[r][c]) {
          const y = (r + 1) * cellSize;
          const x1 = c * cellSize;
          const x2 = (c + 1) * cellSize;
          walls.push({ id: `w_${wallIdCounter++}`, x1, y1: y, x2, y2: y, thickness });
        }
      }
    }

    // Inner Vertical Walls
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (vertWalls[r][c]) {
          const x = (c + 1) * cellSize;
          const y1 = r * cellSize;
          const y2 = (r + 1) * cellSize;
          walls.push({ id: `w_${wallIdCounter++}`, x1: x, y1, x2: x, y2, thickness });
        }
      }
    }

    return { cols, rows, cellSize, walls, width, height };
  }

  /**
   * Converts a wall segment to a bounding box rectangle.
   */
  static getWallBox(wall: WallSegment): Box {
    const halfThick = wall.thickness / 2;
    if (wall.y1 === wall.y2) {
      // Horizontal segment
      return {
        minX: Math.min(wall.x1, wall.x2) - halfThick,
        maxX: Math.max(wall.x1, wall.x2) + halfThick,
        minY: wall.y1 - halfThick,
        maxY: wall.y1 + halfThick,
      };
    } else {
      // Vertical segment
      return {
        minX: wall.x1 - halfThick,
        maxX: wall.x1 + halfThick,
        minY: Math.min(wall.y1, wall.y2) - halfThick,
        maxY: Math.max(wall.y1, wall.y2) + halfThick,
      };
    }
  }

  /**
   * Resolves collision between a circle (e.g. Tank) and a wall box.
   */
  static resolveCircleWallCollision(circle: Circle, wall: WallSegment): { collided: boolean; x: number; y: number } {
    const box = this.getWallBox(wall);

    // Closest point on rectangle to circle center
    const closestX = Math.max(box.minX, Math.min(circle.x, box.maxX));
    const closestY = Math.max(box.minY, Math.min(circle.y, box.maxY));

    const distX = circle.x - closestX;
    const distY = circle.y - closestY;
    const distSq = distX * distX + distY * distY;

    if (distSq < circle.radius * circle.radius && distSq > 0) {
      const distance = Math.sqrt(distSq);
      const overlap = circle.radius - distance;
      const nx = distX / distance;
      const ny = distY / distance;

      return {
        collided: true,
        x: circle.x + nx * overlap,
        y: circle.y + ny * overlap,
      };
    } else if (distSq === 0) {
      // Center is inside box - push outwards
      return {
        collided: true,
        x: circle.x,
        y: circle.y - circle.radius,
      };
    }

    return { collided: false, x: circle.x, y: circle.y };
  }

  /**
   * Calculates bouncing ricochet vector for a fast bullet against walls.
   */
  static processBulletRicochet(
    bullet: { x: number; y: number; vx: number; vy: number; radius: number; bounces: number },
    walls: WallSegment[],
    dt: number
  ): { bounced: boolean; hitPoint?: Point; normal?: Point; hitWall?: WallSegment } {
    const nextX = bullet.x + bullet.vx * dt;
    const nextY = bullet.y + bullet.vy * dt;

    let earliestTime = 1.0;
    let hitNormal: Point | null = null;
    let hitPoint: Point | null = null;
    let hitWall: WallSegment | null = null;
    let bounced = false;

    for (const wall of walls) {
      const box = this.getWallBox(wall);
      // Expand box by bullet radius
      const expandedBox: Box = {
        minX: box.minX - bullet.radius,
        minY: box.minY - bullet.radius,
        maxX: box.maxX + bullet.radius,
        maxY: box.maxY + bullet.radius,
      };

      // Raycast from (bullet.x, bullet.y) to (nextX, nextY) against expandedBox
      const ray = this.rayBoxIntersection(bullet.x, bullet.y, nextX - bullet.x, nextY - bullet.y, expandedBox);
      if (ray && ray.t >= 0 && ray.t <= earliestTime) {
        earliestTime = ray.t;
        hitNormal = ray.normal;
        hitWall = wall;
        hitPoint = {
          x: bullet.x + (nextX - bullet.x) * ray.t,
          y: bullet.y + (nextY - bullet.y) * ray.t,
        };
        bounced = true;
      }
    }

    if (bounced && hitNormal && hitPoint) {
      // Position at hit location with tiny offset
      bullet.x = hitPoint.x + hitNormal.x * 0.5;
      bullet.y = hitPoint.y + hitNormal.y * 0.5;

      // Reflection vector: V_new = V - 2 * (V . N) * N
      const dot = bullet.vx * hitNormal.x + bullet.vy * hitNormal.y;
      bullet.vx = bullet.vx - 2 * dot * hitNormal.x;
      bullet.vy = bullet.vy - 2 * dot * hitNormal.y;
      bullet.bounces += 1;

      return { bounced: true, hitPoint, normal: hitNormal, hitWall };
    } else {
      bullet.x = nextX;
      bullet.y = nextY;
      return { bounced: false };
    }
  }

  /**
   * Ray vs AABB box intersection with hit normal.
   */
  private static rayBoxIntersection(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    box: Box
  ): { t: number; normal: Point } | null {
    let tMinX = (box.minX - ox) / (dx || 0.00001);
    let tMaxX = (box.maxX - ox) / (dx || 0.00001);
    let normX = -1;
    if (tMinX > tMaxX) {
      [tMinX, tMaxX] = [tMaxX, tMinX];
      normX = 1;
    }

    let tMinY = (box.minY - oy) / (dy || 0.00001);
    let tMaxY = (box.maxY - oy) / (dy || 0.00001);
    let normY = -1;
    if (tMinY > tMaxY) {
      [tMinY, tMaxY] = [tMaxY, tMinY];
      normY = 1;
    }

    const tNear = Math.max(tMinX, tMinY);
    const tFar = Math.min(tMaxX, tMaxY);

    if (tNear > tFar || tFar < 0) return null;

    let normal: Point = { x: 0, y: 0 };
    if (tMinX > tMinY) {
      normal = { x: normX, y: 0 };
    } else {
      normal = { x: 0, y: normY };
    }

    return { t: Math.max(0, tNear), normal };
  }

  /**
   * Checks collision between two circles.
   */
  static checkCircleCollision(c1: Circle, c2: Circle): boolean {
    const dx = c1.x - c2.x;
    const dy = c1.y - c2.y;
    const distSq = dx * dx + dy * dy;
    const rSum = c1.radius + c2.radius;
    return distSq <= rSum * rSum;
  }

  /**
   * Distance from a point p to a line segment v-w
   */
  static distToSegment(p: Point, v: Point, w: Point): number {
    const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  /**
   * Raycast laser beam for map boundaries, walls, and optional player collision.
   */
  static raycastLaser(
    startX: number,
    startY: number,
    angle: number,
    arg4?: any,
    arg5?: any,
    arg6?: any,
    arg7?: any
  ): { x: number; y: number; hitPoint: Point; hitPlayer?: any; distance: number; hitWall?: WallSegment } {
    let maxDistance = 2000;
    let mapWidth = 900;
    let mapHeight = 700;
    let obstacles: WallSegment[] = [];
    let players: any[] = [];
    let shooterId: string | null = null;

    if (typeof arg4 === 'number') {
      maxDistance = arg4;
      if (Array.isArray(arg5)) obstacles = arg5;
      if (Array.isArray(arg6) || (arg6 && typeof arg6.values === 'function')) {
        players = Array.isArray(arg6) ? arg6 : Array.from(arg6.values());
      }
      if (arg7) shooterId = arg7;
    } else {
      if (Array.isArray(arg4)) obstacles = arg4;
      if (typeof arg5 === 'number') mapWidth = arg5;
      if (typeof arg6 === 'number') mapHeight = arg6;
      if (typeof arg7 === 'number') maxDistance = arg7;
    }

    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let t = maxDistance;

    // Calculate intersection with map boundaries [0, mapWidth] x [0, mapHeight]
    if (dirX > 0) {
      t = Math.min(t, (mapWidth - startX) / dirX);
    } else if (dirX < 0) {
      t = Math.min(t, (0 - startX) / dirX);
    }

    if (dirY > 0) {
      t = Math.min(t, (mapHeight - startY) / dirY);
    } else if (dirY < 0) {
      t = Math.min(t, (0 - startY) / dirY);
    }

    t = Math.max(0, t);

    const endX = Math.max(0, Math.min(mapWidth, startX + dirX * t));
    const endY = Math.max(0, Math.min(mapHeight, startY + dirY * t));
    const hitPoint: Point = { x: endX, y: endY };
    let hitPlayer: any = null;

    if (players && players.length > 0) {
      for (const p of players) {
        if (!p || p.id === shooterId || (p.hp !== undefined && p.hp <= 0)) continue;
        const d = this.distToSegment({ x: p.x, y: p.y }, { x: startX, y: startY }, { x: endX, y: endY });
        if (d <= (p.radius || 18) + 10) {
          hitPlayer = p;
          break;
        }
      }
    }

    return {
      x: endX,
      y: endY,
      hitPoint,
      hitPlayer,
      distance: t,
    };
  }

  /**
   * Raycast line of sight check between two points. Returns true if no walls block view.
   */
  static hasLineOfSight(p1: Point, p2: Point, walls: WallSegment[]): boolean {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    for (const wall of walls) {
      const box = this.getWallBox(wall);
      const hit = this.rayBoxIntersection(p1.x, p1.y, dx, dy, box);
      if (hit && hit.t >= 0 && hit.t <= 1.0) {
        return false;
      }
    }
    return true;
  }
}
