/**
 * Tank AZ Online - Server Physics Engine (CommonJS, Node.js 14 compatible)
 */

class PhysicsEngine {
  /**
   * Generates a random maze map using Recursive Backtracker algorithm.
   */
  static generateMaze(cols, rows, cellSize) {
    if (!cols) cols = 8;
    if (!rows) rows = 6;
    if (!cellSize) cellSize = 100;

    var width = cols * cellSize;
    var height = rows * cellSize;
    var thickness = 10;

    var visited = [];
    for (var r = 0; r < rows; r++) {
      var rowArr = [];
      for (var c = 0; c < cols; c++) {
        rowArr.push(false);
      }
      visited.push(rowArr);
    }

    var horizWalls = [];
    for (var r = 0; r < rows - 1; r++) {
      var rowArr = [];
      for (var c = 0; c < cols; c++) {
        rowArr.push(true);
      }
      horizWalls.push(rowArr);
    }

    var vertWalls = [];
    for (var r = 0; r < rows; r++) {
      var rowArr = [];
      for (var c = 0; c < cols - 1; c++) {
        rowArr.push(true);
      }
      vertWalls.push(rowArr);
    }

    var stack = [];
    var startR = Math.floor(Math.random() * rows);
    var startC = Math.floor(Math.random() * cols);

    visited[startR][startC] = true;
    stack.push({ r: startR, c: startC });

    while (stack.length > 0) {
      var current = stack[stack.length - 1];
      var neighbors = [];

      if (current.r > 0 && !visited[current.r - 1][current.c]) {
        neighbors.push({ r: current.r - 1, c: current.c, dir: 'N' });
      }
      if (current.c < cols - 1 && !visited[current.r][current.c + 1]) {
        neighbors.push({ r: current.r, c: current.c + 1, dir: 'E' });
      }
      if (current.r < rows - 1 && !visited[current.r + 1][current.c]) {
        neighbors.push({ r: current.r + 1, c: current.c, dir: 'S' });
      }
      if (current.c > 0 && !visited[current.r][current.c - 1]) {
        neighbors.push({ r: current.r, c: current.c - 1, dir: 'W' });
      }

      if (neighbors.length > 0) {
        var next = neighbors[Math.floor(Math.random() * neighbors.length)];
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

    for (var r = 0; r < rows - 1; r++) {
      for (var c = 0; c < cols; c++) {
        if (horizWalls[r][c] && Math.random() < 0.25) {
          horizWalls[r][c] = false;
        }
      }
    }
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols - 1; c++) {
        if (vertWalls[r][c] && Math.random() < 0.25) {
          vertWalls[r][c] = false;
        }
      }
    }

    var walls = [];
    var wallIdCounter = 0;

    // Outer Boundary Walls
    walls.push({ id: 'w_' + (wallIdCounter++), x1: 0, y1: 0, x2: width, y2: 0, thickness: thickness });
    walls.push({ id: 'w_' + (wallIdCounter++), x1: 0, y1: height, x2: width, y2: height, thickness: thickness });
    walls.push({ id: 'w_' + (wallIdCounter++), x1: 0, y1: 0, x2: 0, y2: height, thickness: thickness });
    walls.push({ id: 'w_' + (wallIdCounter++), x1: width, y1: 0, x2: width, y2: height, thickness: thickness });

    for (var r = 0; r < rows - 1; r++) {
      for (var c = 0; c < cols; c++) {
        if (horizWalls[r][c]) {
          var y = (r + 1) * cellSize;
          var x1 = c * cellSize;
          var x2 = (c + 1) * cellSize;
          walls.push({ id: 'w_' + (wallIdCounter++), x1: x1, y1: y, x2: x2, y2: y, thickness: thickness });
        }
      }
    }

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols - 1; c++) {
        if (vertWalls[r][c]) {
          var x = (c + 1) * cellSize;
          var y1 = r * cellSize;
          var y2 = (r + 1) * cellSize;
          walls.push({ id: 'w_' + (wallIdCounter++), x1: x, y1: y1, x2: x, y2: y2, thickness: thickness });
        }
      }
    }

    return { cols: cols, rows: rows, cellSize: cellSize, walls: walls, width: width, height: height };
  }

  static getWallBox(wall) {
    var halfThick = wall.thickness / 2;
    if (wall.y1 === wall.y2) {
      return {
        minX: Math.min(wall.x1, wall.x2) - halfThick,
        maxX: Math.max(wall.x1, wall.x2) + halfThick,
        minY: wall.y1 - halfThick,
        maxY: wall.y1 + halfThick,
      };
    } else {
      return {
        minX: wall.x1 - halfThick,
        maxX: wall.x1 + halfThick,
        minY: Math.min(wall.y1, wall.y2) - halfThick,
        maxY: Math.max(wall.y1, wall.y2) + halfThick,
      };
    }
  }

  static resolveCircleWallCollision(circle, wall) {
    var box = this.getWallBox(wall);

    var closestX = Math.max(box.minX, Math.min(circle.x, box.maxX));
    var closestY = Math.max(box.minY, Math.min(circle.y, box.maxY));

    var distX = circle.x - closestX;
    var distY = circle.y - closestY;
    var distSq = distX * distX + distY * distY;

    if (distSq < circle.radius * circle.radius && distSq > 0) {
      var distance = Math.sqrt(distSq);
      var overlap = circle.radius - distance;
      var nx = distX / distance;
      var ny = distY / distance;

      return {
        collided: true,
        x: circle.x + nx * overlap,
        y: circle.y + ny * overlap,
      };
    } else if (distSq === 0) {
      return {
        collided: true,
        x: circle.x,
        y: circle.y - circle.radius,
      };
    }

    return { collided: false, x: circle.x, y: circle.y };
  }

  static processBulletRicochet(bullet, walls, dt) {
    var nextX = bullet.x + bullet.vx * dt;
    var nextY = bullet.y + bullet.vy * dt;

    var earliestTime = 1.0;
    var hitNormal = null;
    var hitPoint = null;
    var hitWall = null;
    var bounced = false;

    for (var i = 0; i < walls.length; i++) {
      var wall = walls[i];
      var box = this.getWallBox(wall);
      var expandedBox = {
        minX: box.minX - bullet.radius,
        minY: box.minY - bullet.radius,
        maxX: box.maxX + bullet.radius,
        maxY: box.maxY + bullet.radius,
      };

      var ray = this.rayBoxIntersection(bullet.x, bullet.y, nextX - bullet.x, nextY - bullet.y, expandedBox);
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
      bullet.x = hitPoint.x + hitNormal.x * 0.5;
      bullet.y = hitPoint.y + hitNormal.y * 0.5;

      var dot = bullet.vx * hitNormal.x + bullet.vy * hitNormal.y;
      bullet.vx = bullet.vx - 2 * dot * hitNormal.x;
      bullet.vy = bullet.vy - 2 * dot * hitNormal.y;
      bullet.bounces += 1;

      return { bounced: true, hitPoint: hitPoint, normal: hitNormal, hitWall: hitWall };
    } else {
      bullet.x = nextX;
      bullet.y = nextY;
      return { bounced: false };
    }
  }

  static rayBoxIntersection(ox, oy, dx, dy, box) {
    var tMinX = (box.minX - ox) / (dx || 0.00001);
    var tMaxX = (box.maxX - ox) / (dx || 0.00001);
    var normX = -1;
    if (tMinX > tMaxX) {
      var tmpX = tMinX;
      tMinX = tMaxX;
      tMaxX = tmpX;
      normX = 1;
    }

    var tMinY = (box.minY - oy) / (dy || 0.00001);
    var tMaxY = (box.maxY - oy) / (dy || 0.00001);
    var normY = -1;
    if (tMinY > tMaxY) {
      var tmpY = tMinY;
      tMinY = tMaxY;
      tMaxY = tmpY;
      normY = 1;
    }

    var tNear = Math.max(tMinX, tMinY);
    var tFar = Math.min(tMaxX, tMaxY);

    if (tNear > tFar || tFar < 0) return null;

    var normal = { x: 0, y: 0 };
    if (tMinX > tMinY) {
      normal = { x: normX, y: 0 };
    } else {
      normal = { x: 0, y: normY };
    }

    return { t: Math.max(0, tNear), normal: normal };
  }

  static checkCircleCollision(c1, c2) {
    var dx = c1.x - c2.x;
    var dy = c1.y - c2.y;
    var distSq = dx * dx + dy * dy;
    var rSum = c1.radius + c2.radius;
    return distSq <= rSum * rSum;
  }

  static distToSegment(p, v, w) {
    var l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    var t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  /**
   * Raycast laser calculation for map boundaries, walls, and players.
   */
  static raycastLaser(startX, startY, angle, arg4, arg5, arg6, arg7) {
    var maxDistance = 2000;
    var mapWidth = 900;
    var mapHeight = 700;
    var obstacles = [];
    var players = [];
    var shooterId = null;

    // Detect signature:
    // Signature A: (startX, startY, angle, maxDistance, obstacles, players, shooterId)
    // Signature B: (startX, startY, angle, walls, mapWidth, mapHeight, maxDistance)
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

    var dirX = Math.cos(angle);
    var dirY = Math.sin(angle);

    var t = maxDistance;

    // Calculate map boundary intersection
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
    var endX = Math.max(0, Math.min(mapWidth, startX + dirX * t));
    var endY = Math.max(0, Math.min(mapHeight, startY + dirY * t));

    var hitPoint = { x: endX, y: endY };
    var hitPlayer = null;

    if (players && players.length > 0) {
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (!p || p.id === shooterId || (p.hp !== undefined && p.hp <= 0)) continue;
        var d = this.distToSegment({ x: p.x, y: p.y }, { x: startX, y: startY }, { x: endX, y: endY });
        if (d <= (p.radius || 18) + 10) {
          hitPlayer = p;
          break;
        }
      }
    }

    return {
      x: endX,
      y: endY,
      hitPoint: hitPoint,
      hitPlayer: hitPlayer,
      distance: t,
    };
  }

  static hasLineOfSight(p1, p2, walls) {
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;

    for (var i = 0; i < walls.length; i++) {
      var box = this.getWallBox(walls[i]);
      var hit = this.rayBoxIntersection(p1.x, p1.y, dx, dy, box);
      if (hit && hit.t >= 0 && hit.t <= 1.0) {
        return false;
      }
    }
    return true;
  }
}

exports.PhysicsEngine = PhysicsEngine;
module.exports = exports;
