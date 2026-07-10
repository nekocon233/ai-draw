export const DEFAULT_COLOR_REPLACE_TOLERANCE = 32
export const DEFAULT_FILL_TOLERANCE = 32
export const DEFAULT_REPLACE_TOLERANCE = 30

export type TransparentReplaceMatchMode = 'global' | 'connected' | 'continuous'
export type TransparentEdgeEnhancementMode = 'connected_color' | 'global_color' | 'dilate'

export const DEFAULT_TRANSPARENT_REPLACE_MATCH_MODE: TransparentReplaceMatchMode = 'connected'
export const DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT_MODE: TransparentEdgeEnhancementMode = 'dilate'
export const DEFAULT_TRANSPARENT_EDGE_ENHANCEMENT = 1

export function isHardTransparentReplacementTarget(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && Number.isInteger(x)
    && Number.isInteger(y)
    && x >= 0
    && x < width
    && y >= 0
    && y < height
    && source.length === width * height * 4
    && source[(y * width + x) * 4 + 3] !== 0
}

export function applyHardTransparentReplacement(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
  edgeEnhancement: number,
  matchMode: TransparentReplaceMatchMode = 'global',
  edgeEnhancementMode: TransparentEdgeEnhancementMode = 'connected_color',
): Uint8ClampedArray | null {
  if (!isHardTransparentReplacementTarget(source, width, height, x, y)) {
    return null
  }

  const clickedOffset = (y * width + x) * 4
  const result = new Uint8ClampedArray(source)
  const clickedRed = source[clickedOffset]
  const clickedGreen = source[clickedOffset + 1]
  const clickedBlue = source[clickedOffset + 2]
  const normalizedTolerance = Number.isFinite(tolerance)
    ? Math.min(50, Math.max(0, Math.round(tolerance)))
    : 0
  const distanceThreshold = normalizedTolerance * 255 / 50
  const normalizedEnhancement = Number.isFinite(edgeEnhancement)
    ? Math.min(50, Math.max(0, Math.round(edgeEnhancement)))
    : 0
  const enhancedDistanceThreshold = (normalizedTolerance + normalizedEnhancement) * 255 / 50
  const pixelCount = width * height
  const mask = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  const distanceToClickedColor = (pixelIndex: number) => {
    const offset = pixelIndex * 4
    return Math.hypot(
      source[offset] - clickedRed,
      source[offset + 1] - clickedGreen,
      source[offset + 2] - clickedBlue,
    )
  }

  const startPoint = y * width + x
  if (matchMode === 'global') {
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (source[pixelIndex * 4 + 3] !== 0 && distanceToClickedColor(pixelIndex) <= distanceThreshold) {
        mask[pixelIndex] = 1
      }
    }
  } else {
    mask[startPoint] = 1
    queue[queueEnd++] = startPoint
    const enqueueBaseCandidate = (pixelIndex: number, referencePoint: number) => {
      if (mask[pixelIndex] || source[pixelIndex * 4 + 3] === 0) return
      const matches = matchMode === 'continuous'
        ? (() => {
            const offset = pixelIndex * 4
            const referenceOffset = referencePoint * 4
            return Math.hypot(
              source[offset] - source[referenceOffset],
              source[offset + 1] - source[referenceOffset + 1],
              source[offset + 2] - source[referenceOffset + 2],
            ) <= distanceThreshold
          })()
        : distanceToClickedColor(pixelIndex) <= distanceThreshold
      if (!matches) return
      mask[pixelIndex] = 1
      queue[queueEnd++] = pixelIndex
    }
    while (queueStart < queueEnd) {
      const pixelIndex = queue[queueStart++]
      const pixelX = pixelIndex % width
      if (pixelX > 0) enqueueBaseCandidate(pixelIndex - 1, pixelIndex)
      if (pixelX < width - 1) enqueueBaseCandidate(pixelIndex + 1, pixelIndex)
      if (pixelIndex >= width) enqueueBaseCandidate(pixelIndex - width, pixelIndex)
      if (pixelIndex < pixelCount - width) enqueueBaseCandidate(pixelIndex + width, pixelIndex)
    }
  }

  if (normalizedEnhancement > 0 && edgeEnhancementMode === 'global_color') {
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (source[pixelIndex * 4 + 3] !== 0 && distanceToClickedColor(pixelIndex) <= enhancedDistanceThreshold) {
        mask[pixelIndex] = 1
      }
    }
  }

  if (normalizedEnhancement > 0 && edgeEnhancementMode === 'connected_color') {
    queueStart = 0
    queueEnd = 0
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (mask[pixelIndex]) queue[queueEnd++] = pixelIndex
    }
    const enqueueEnhancedCandidate = (pixelIndex: number) => {
      if (
        mask[pixelIndex]
        || source[pixelIndex * 4 + 3] === 0
        || distanceToClickedColor(pixelIndex) > enhancedDistanceThreshold
      ) return
      mask[pixelIndex] = 1
      queue[queueEnd++] = pixelIndex
    }
    while (queueStart < queueEnd) {
      const pixelIndex = queue[queueStart++]
      const pixelX = pixelIndex % width
      if (pixelX > 0) enqueueEnhancedCandidate(pixelIndex - 1)
      if (pixelX < width - 1) enqueueEnhancedCandidate(pixelIndex + 1)
      if (pixelIndex >= width) enqueueEnhancedCandidate(pixelIndex - width)
      if (pixelIndex < pixelCount - width) enqueueEnhancedCandidate(pixelIndex + width)
    }
  }

  if (normalizedEnhancement > 0 && edgeEnhancementMode === 'dilate') {
    queueStart = 0
    queueEnd = 0
    const levels = new Uint8Array(pixelCount)
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (!mask[pixelIndex]) continue
      levels[pixelIndex] = 1
      queue[queueEnd++] = pixelIndex
    }
    while (queueStart < queueEnd) {
      const pixelIndex = queue[queueStart++]
      const level = levels[pixelIndex]
      if (level > normalizedEnhancement) continue
      const pixelX = pixelIndex % width
      const pixelY = Math.floor(pixelIndex / width)
      for (let neighborY = Math.max(0, pixelY - 1); neighborY <= Math.min(height - 1, pixelY + 1); neighborY += 1) {
        for (let neighborX = Math.max(0, pixelX - 1); neighborX <= Math.min(width - 1, pixelX + 1); neighborX += 1) {
          const neighborIndex = neighborY * width + neighborX
          if (levels[neighborIndex]) continue
          levels[neighborIndex] = level + 1
          mask[neighborIndex] = 1
          queue[queueEnd++] = neighborIndex
        }
      }
    }
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (mask[pixelIndex] !== 0) {
      result.fill(0, pixelIndex * 4, pixelIndex * 4 + 4)
    }
  }

  return result
}
