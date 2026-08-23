export type LabelRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TokenLabelObstacle = {
  tokenId: string;
  x: number;
  y: number;
  radius: number;
};

export type TokenLabelRequest = {
  tokenId: string;
  text: string;
  tokenX: number;
  tokenY: number;
  radius: number;
  width: number;
  height: number;
  priority: number;
  selected: boolean;
};

export type TokenLabelAnchor = "bottom" | "top" | "right" | "left" | "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type TokenLabelPlacement = TokenLabelRequest & LabelRectangle & {
  anchor: TokenLabelAnchor;
  leader: boolean;
};

const LABEL_GAP = 5;
const COLLISION_PADDING = 3;

function candidates(request: TokenLabelRequest): Array<LabelRectangle & { anchor: TokenLabelAnchor }> {
  const { tokenX, tokenY, radius, width, height } = request;
  const horizontalOffset = radius + LABEL_GAP + width / 2;
  const verticalOffset = radius + LABEL_GAP + height / 2;
  const diagonalX = radius + LABEL_GAP * 0.7 + width / 2;
  const diagonalY = radius + LABEL_GAP * 0.7 + height / 2;
  const rectangle = (centerX: number, centerY: number, anchor: TokenLabelAnchor) => ({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    anchor,
  });
  return [
    rectangle(tokenX, tokenY + verticalOffset, "bottom"),
    rectangle(tokenX, tokenY - verticalOffset, "top"),
    rectangle(tokenX + horizontalOffset, tokenY, "right"),
    rectangle(tokenX - horizontalOffset, tokenY, "left"),
    rectangle(tokenX + diagonalX, tokenY + diagonalY, "bottom-right"),
    rectangle(tokenX - diagonalX, tokenY + diagonalY, "bottom-left"),
    rectangle(tokenX + diagonalX, tokenY - diagonalY, "top-right"),
    rectangle(tokenX - diagonalX, tokenY - diagonalY, "top-left"),
  ];
}

function within(rectangle: LabelRectangle, bounds: LabelRectangle): boolean {
  return rectangle.x >= bounds.x
    && rectangle.y >= bounds.y
    && rectangle.x + rectangle.width <= bounds.x + bounds.width
    && rectangle.y + rectangle.height <= bounds.y + bounds.height;
}

function rectanglesOverlap(a: LabelRectangle, b: LabelRectangle, padding = COLLISION_PADDING): boolean {
  return a.x < b.x + b.width + padding
    && a.x + a.width + padding > b.x
    && a.y < b.y + b.height + padding
    && a.y + a.height + padding > b.y;
}

function rectangleIntersectsCircle(rectangle: LabelRectangle, obstacle: TokenLabelObstacle): boolean {
  const nearestX = Math.max(rectangle.x, Math.min(obstacle.x, rectangle.x + rectangle.width));
  const nearestY = Math.max(rectangle.y, Math.min(obstacle.y, rectangle.y + rectangle.height));
  const dx = obstacle.x - nearestX;
  const dy = obstacle.y - nearestY;
  const paddedRadius = obstacle.radius + COLLISION_PADDING;
  return dx * dx + dy * dy < paddedRadius * paddedRadius;
}

function fallbackSelectedPlacement(request: TokenLabelRequest, bounds: LabelRectangle): LabelRectangle & { anchor: TokenLabelAnchor } {
  const preferred = candidates(request).find((candidate) => within(candidate, bounds)) ?? candidates(request)[0];
  return {
    ...preferred,
    x: Math.min(Math.max(preferred.x, bounds.x), Math.max(bounds.x, bounds.x + bounds.width - preferred.width)),
    y: Math.min(Math.max(preferred.y, bounds.y), Math.max(bounds.y, bounds.y + bounds.height - preferred.height)),
  };
}

export function layoutTokenLabels(
  requests: readonly TokenLabelRequest[],
  tokenObstacles: readonly TokenLabelObstacle[],
  bounds: LabelRectangle,
  reservedRectangles: readonly LabelRectangle[] = [],
): TokenLabelPlacement[] {
  const placedRectangles: LabelRectangle[] = [...reservedRectangles];
  const placements: TokenLabelPlacement[] = [];
  const orderedRequests = [...requests].sort((left, right) => {
    const priorityDifference = right.priority - left.priority;
    if (priorityDifference) return priorityDifference;
    return left.tokenId === right.tokenId ? 0 : left.tokenId < right.tokenId ? -1 : 1;
  });

  for (const request of orderedRequests) {
    const available = candidates(request).find((candidate) => within(candidate, bounds)
      && !placedRectangles.some((placed) => rectanglesOverlap(candidate, placed))
      && !tokenObstacles.some((obstacle) => obstacle.tokenId !== request.tokenId && rectangleIntersectsCircle(candidate, obstacle)));
    const candidate = available ?? (request.selected ? fallbackSelectedPlacement(request, bounds) : null);
    if (!candidate) continue;
    const placement = {
      ...request,
      ...candidate,
      leader: request.selected && candidate.anchor !== "bottom",
    };
    placements.push(placement);
    placedRectangles.push(candidate);
  }
  return placements;
}
