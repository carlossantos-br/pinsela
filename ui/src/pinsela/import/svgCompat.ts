export type SvgPathAnchor = {
  x: number;
  y: number;
  in?: { x: number; y: number } | null;
  out?: { x: number; y: number } | null;
  mode?: "corner" | "smooth";
};

export type SvgPathSubpath = {
  closed: boolean;
  anchors: SvgPathAnchor[];
};

type SvgPoint = { x: number; y: number };

const ARC_QUARTER_K = 0.5522847498307936;
const COMMAND_RE = /[AaCcHhLlMmQqSsTtVvZz]/;
const TOKEN_RE = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

function round2(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function clampRadius(value: number, maxValue: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.abs(value), Math.max(0, maxValue)));
}

function approxPoint(a: SvgPoint | null | undefined, b: SvgPoint | null | undefined, epsilon = 0.001): boolean {
  if (!a || !b) return false;
  return Math.abs(Number(a.x || 0) - Number(b.x || 0)) <= epsilon
    && Math.abs(Number(a.y || 0) - Number(b.y || 0)) <= epsilon;
}

function normalizeAnchorMode(anchor: SvgPathAnchor): SvgPathAnchor {
  const hasIn = !!anchor.in;
  const hasOut = !!anchor.out;
  return {
    x: round2(anchor.x),
    y: round2(anchor.y),
    in: hasIn ? { x: round2(anchor.in!.x), y: round2(anchor.in!.y) } : anchor.in ?? null,
    out: hasOut ? { x: round2(anchor.out!.x), y: round2(anchor.out!.y) } : anchor.out ?? null,
    mode: hasIn || hasOut ? "smooth" : "corner",
  };
}

function finalizeSubpath(rawAnchors: SvgPathAnchor[], closed: boolean): SvgPathSubpath | null {
  let anchors: SvgPathAnchor[] = rawAnchors.map((anchor) => ({
    x: Number(anchor.x || 0),
    y: Number(anchor.y || 0),
    in: anchor.in ? { x: Number(anchor.in.x || 0), y: Number(anchor.in.y || 0) } : anchor.in ?? null,
    out: anchor.out ? { x: Number(anchor.out.x || 0), y: Number(anchor.out.y || 0) } : anchor.out ?? null,
    mode: (anchor.mode === "smooth" ? "smooth" : "corner") as "corner" | "smooth",
  }));

  if (closed && anchors.length >= 2 && approxPoint(anchors[0], anchors[anchors.length - 1])) {
    const duplicate = anchors[anchors.length - 1];
    const first = anchors[0];
    if (duplicate.in) first.in = duplicate.in;
    anchors = anchors.slice(0, -1);
  }

  if (anchors.length < 2) return null;
  return {
    closed: closed && anchors.length >= 2,
    anchors: anchors.map(normalizeAnchorMode),
  };
}

function reflectPoint(point: SvgPoint, control: SvgPoint | null): SvgPoint {
  if (!control) return { x: point.x, y: point.y };
  return {
    x: point.x * 2 - control.x,
    y: point.y * 2 - control.y,
  };
}

function angleBetween(u: SvgPoint, v: SvgPoint): number {
  const length = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
  if (length <= 1e-12) return 0;
  const dot = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / length));
  const cross = u.x * v.y - u.y * v.x;
  return Math.atan2(cross, dot);
}

function arcSegmentToCubic(
  center: SvgPoint,
  rx: number,
  ry: number,
  phi: number,
  startAngle: number,
  endAngle: number,
): { c1: SvgPoint; c2: SvgPoint; p: SvgPoint } {
  const delta = endAngle - startAngle;
  const k = (4 / 3) * Math.tan(delta / 4);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const p0 = { x: Math.cos(startAngle), y: Math.sin(startAngle) };
  const p1 = { x: p0.x - k * p0.y, y: p0.y + k * p0.x };
  const p3 = { x: Math.cos(endAngle), y: Math.sin(endAngle) };
  const p2 = { x: p3.x + k * p3.y, y: p3.y - k * p3.x };

  const map = (point: SvgPoint): SvgPoint => ({
    x: center.x + rx * (cosPhi * point.x - sinPhi * point.y),
    y: center.y + ry * (sinPhi * point.x + cosPhi * point.y),
  });

  return {
    c1: map(p1),
    c2: map(p2),
    p: map(p3),
  };
}

function arcToCubics(
  start: SvgPoint,
  rxRaw: number,
  ryRaw: number,
  xAxisRotation: number,
  largeArcFlag: boolean,
  sweepFlag: boolean,
  end: SvgPoint,
): Array<{ c1: SvgPoint; c2: SvgPoint; p: SvgPoint }> {
  let rx = Math.abs(Number(rxRaw || 0));
  let ry = Math.abs(Number(ryRaw || 0));
  if (rx <= 0.0001 || ry <= 0.0001 || approxPoint(start, end)) return [];

  const phi = (Number(xAxisRotation || 0) * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (start.x - end.x) / 2;
  const dy2 = (start.y - end.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const numerator = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const denominator = Math.max(1e-12, rx2 * y1p2 + ry2 * x1p2);
  const factor = sign * Math.sqrt(numerator / denominator);

  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);
  const center = {
    x: cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2,
    y: sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2,
  };

  const vectorA = { x: (x1p - cxp) / rx, y: (y1p - cyp) / ry };
  const vectorB = { x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry };
  let startAngle = angleBetween({ x: 1, y: 0 }, vectorA);
  let deltaAngle = angleBetween(vectorA, vectorB);

  if (!sweepFlag && deltaAngle > 0) deltaAngle -= Math.PI * 2;
  if (sweepFlag && deltaAngle < 0) deltaAngle += Math.PI * 2;

  const segments = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const step = deltaAngle / segments;
  const curves: Array<{ c1: SvgPoint; c2: SvgPoint; p: SvgPoint }> = [];
  for (let index = 0; index < segments; index += 1) {
    const from = startAngle + step * index;
    const to = from + step;
    curves.push(arcSegmentToCubic(center, rx, ry, phi, from, to));
  }
  return curves;
}

function parseCoordinateTokens(raw: string): number[] {
  const matches = String(raw || "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  return matches
    .map((token) => Number(token))
    .filter((value) => Number.isFinite(value));
}

export function parseSvgPoints(raw: string): SvgPoint[] {
  const tokens = parseCoordinateTokens(raw);
  const points: SvgPoint[] = [];
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    points.push({
      x: round2(tokens[index]),
      y: round2(tokens[index + 1]),
    });
  }
  return points;
}

export function buildSvgLineSubpath(x1: number, y1: number, x2: number, y2: number): SvgPathSubpath | null {
  const subpath = finalizeSubpath(
    [
      { x: Number(x1 || 0), y: Number(y1 || 0), mode: "corner" },
      { x: Number(x2 || 0), y: Number(y2 || 0), mode: "corner" },
    ],
    false,
  );
  return subpath;
}

export function buildSvgPolylineSubpath(points: SvgPoint[], closed: boolean): SvgPathSubpath | null {
  const anchors = points.map((point) => ({ x: point.x, y: point.y, mode: "corner" as const }));
  if (closed && points.length >= 2 && approxPoint(points[0], points[points.length - 1])) {
    anchors.pop();
  }
  return finalizeSubpath(anchors, closed);
}

export function buildSvgEllipseSubpath(cx: number, cy: number, rx: number, ry: number): SvgPathSubpath | null {
  const safeRx = Math.max(0, Number(rx || 0));
  const safeRy = Math.max(0, Number(ry || 0));
  if (safeRx <= 0.0001 || safeRy <= 0.0001) return null;
  const kx = safeRx * ARC_QUARTER_K;
  const ky = safeRy * ARC_QUARTER_K;
  return finalizeSubpath(
    [
      {
        x: cx,
        y: cy - safeRy,
        in: { x: cx - kx, y: cy - safeRy },
        out: { x: cx + kx, y: cy - safeRy },
      },
      {
        x: cx + safeRx,
        y: cy,
        in: { x: cx + safeRx, y: cy - ky },
        out: { x: cx + safeRx, y: cy + ky },
      },
      {
        x: cx,
        y: cy + safeRy,
        in: { x: cx + kx, y: cy + safeRy },
        out: { x: cx - kx, y: cy + safeRy },
      },
      {
        x: cx - safeRx,
        y: cy,
        in: { x: cx - safeRx, y: cy + ky },
        out: { x: cx - safeRx, y: cy - ky },
      },
    ],
    true,
  );
}

export function buildSvgRectSubpaths(
  x: number,
  y: number,
  width: number,
  height: number,
  rxRaw = 0,
  ryRaw = 0,
): SvgPathSubpath[] {
  const safeWidth = Math.max(0, Number(width || 0));
  const safeHeight = Math.max(0, Number(height || 0));
  if (safeWidth <= 0.0001 || safeHeight <= 0.0001) return [];

  let rx = Number(rxRaw || 0);
  let ry = Number(ryRaw || 0);
  if (rx > 0 && ry <= 0) ry = rx;
  if (ry > 0 && rx <= 0) rx = ry;
  rx = clampRadius(rx, safeWidth / 2);
  ry = clampRadius(ry, safeHeight / 2);

  if (rx <= 0.0001 || ry <= 0.0001) {
    const rect = finalizeSubpath(
      [
        { x, y, mode: "corner" },
        { x: x + safeWidth, y, mode: "corner" },
        { x: x + safeWidth, y: y + safeHeight, mode: "corner" },
        { x, y: y + safeHeight, mode: "corner" },
      ],
      true,
    );
    return rect ? [rect] : [];
  }

  const d = [
    `M ${x + rx} ${y}`,
    `H ${x + safeWidth - rx}`,
    `C ${x + safeWidth - rx + rx * ARC_QUARTER_K} ${y} ${x + safeWidth} ${y + ry - ry * ARC_QUARTER_K} ${x + safeWidth} ${y + ry}`,
    `V ${y + safeHeight - ry}`,
    `C ${x + safeWidth} ${y + safeHeight - ry + ry * ARC_QUARTER_K} ${x + safeWidth - rx + rx * ARC_QUARTER_K} ${y + safeHeight} ${x + safeWidth - rx} ${y + safeHeight}`,
    `H ${x + rx}`,
    `C ${x + rx - rx * ARC_QUARTER_K} ${y + safeHeight} ${x} ${y + safeHeight - ry + ry * ARC_QUARTER_K} ${x} ${y + safeHeight - ry}`,
    `V ${y + ry}`,
    `C ${x} ${y + ry - ry * ARC_QUARTER_K} ${x + rx - rx * ARC_QUARTER_K} ${y} ${x + rx} ${y}`,
    "Z",
  ].join(" ");

  return parseSvgPathDataSubpaths(d);
}

export function parseSvgPathDataSubpaths(pathData: string): SvgPathSubpath[] {
  const tokens = String(pathData || "").match(TOKEN_RE) || [];
  if (!tokens.length) return [];

  const out: SvgPathSubpath[] = [];
  let index = 0;
  let command = "";
  let current: SvgPoint | null = null;
  let subpathStart: SvgPoint | null = null;
  let previousCubicControl: SvgPoint | null = null;
  let previousQuadraticControl: SvgPoint | null = null;
  let anchors: SvgPathAnchor[] = [];

  const flush = (closed: boolean) => {
    const subpath = finalizeSubpath(anchors, closed);
    if (subpath) out.push(subpath);
    anchors = [];
  };

  const currentAnchor = () => (anchors.length ? anchors[anchors.length - 1] : null);

  const ensureMoveAnchor = (point: SvgPoint) => {
    if (anchors.length === 0) {
      anchors.push({ x: point.x, y: point.y, mode: "corner" });
    }
  };

  const lineTo = (point: SvgPoint) => {
    ensureMoveAnchor(point);
    const last = currentAnchor();
    if (!last) return;
    if (approxPoint(last, point)) {
      current = point;
      return;
    }
    anchors.push({ x: point.x, y: point.y, mode: "corner" });
    current = point;
    previousCubicControl = null;
    previousQuadraticControl = null;
  };

  const cubicTo = (control1: SvgPoint, control2: SvgPoint, point: SvgPoint) => {
    ensureMoveAnchor(point);
    const last = currentAnchor();
    if (!last || !current) return;
    last.out = { x: control1.x, y: control1.y };
    anchors.push({
      x: point.x,
      y: point.y,
      in: { x: control2.x, y: control2.y },
      mode: "smooth",
    });
    current = point;
    previousCubicControl = control2;
    previousQuadraticControl = null;
  };

  const quadraticTo = (control: SvgPoint, point: SvgPoint) => {
    if (!current) return;
    const c1 = {
      x: current.x + ((control.x - current.x) * 2) / 3,
      y: current.y + ((control.y - current.y) * 2) / 3,
    };
    const c2 = {
      x: point.x + ((control.x - point.x) * 2) / 3,
      y: point.y + ((control.y - point.y) * 2) / 3,
    };
    cubicTo(c1, c2, point);
    previousQuadraticControl = control;
  };

  const nextNumber = () => Number(tokens[index++]);
  const hasNumber = () => index < tokens.length && !COMMAND_RE.test(tokens[index]);

  while (index < tokens.length) {
    if (COMMAND_RE.test(tokens[index])) {
      command = tokens[index++];
    } else if (!command) {
      break;
    }

    const relative = command === command.toLowerCase();
    const commandUpper = command.toUpperCase();

    switch (commandUpper) {
      case "M": {
        let first = true;
        while (hasNumber()) {
          const x = nextNumber();
          const y = nextNumber();
          const point: SvgPoint = {
            x: round2((relative && current ? current.x : 0) + x),
            y: round2((relative && current ? current.y : 0) + y),
          };
          if (first) {
            if (anchors.length) flush(false);
            anchors = [{ x: point.x, y: point.y, mode: "corner" }];
            current = point;
            subpathStart = point;
            previousCubicControl = null;
            previousQuadraticControl = null;
            first = false;
          } else {
            lineTo(point);
          }
        }
        break;
      }
      case "Z": {
        if (anchors.length) flush(true);
        current = subpathStart;
        previousCubicControl = null;
        previousQuadraticControl = null;
        break;
      }
      case "L": {
        while (hasNumber()) {
          const x = nextNumber();
          const y = nextNumber();
          const point: SvgPoint = {
            x: round2((relative && current ? current.x : 0) + x),
            y: round2((relative && current ? current.y : 0) + y),
          };
          lineTo(point);
        }
        break;
      }
      case "H": {
        while (hasNumber()) {
          const x = nextNumber();
          if (!current) break;
          lineTo({
            x: round2((relative ? current.x : 0) + x),
            y: round2(current.y),
          });
        }
        break;
      }
      case "V": {
        while (hasNumber()) {
          const y = nextNumber();
          if (!current) break;
          lineTo({
            x: round2(current.x),
            y: round2((relative ? current.y : 0) + y),
          });
        }
        break;
      }
      case "C": {
        while (hasNumber()) {
          if (!current) break;
          const x1 = nextNumber();
          const y1 = nextNumber();
          const x2 = nextNumber();
          const y2 = nextNumber();
          const x = nextNumber();
          const y = nextNumber();
          const control1 = {
            x: round2((relative ? current.x : 0) + x1),
            y: round2((relative ? current.y : 0) + y1),
          };
          const control2 = {
            x: round2((relative ? current.x : 0) + x2),
            y: round2((relative ? current.y : 0) + y2),
          };
          const point: SvgPoint = {
            x: round2((relative ? current.x : 0) + x),
            y: round2((relative ? current.y : 0) + y),
          };
          cubicTo(control1, control2, point);
        }
        break;
      }
      case "S": {
        while (hasNumber()) {
          if (!current) break;
          const reflected = reflectPoint(current, previousCubicControl);
          const x2 = nextNumber();
          const y2 = nextNumber();
          const x = nextNumber();
          const y = nextNumber();
          const control2 = {
            x: round2((relative ? current.x : 0) + x2),
            y: round2((relative ? current.y : 0) + y2),
          };
          const point: SvgPoint = {
            x: round2((relative ? current.x : 0) + x),
            y: round2((relative ? current.y : 0) + y),
          };
          cubicTo(reflected, control2, point);
        }
        break;
      }
      case "Q": {
        while (hasNumber()) {
          if (!current) break;
          const x1 = nextNumber();
          const y1 = nextNumber();
          const x = nextNumber();
          const y = nextNumber();
          const control = {
            x: round2((relative ? current.x : 0) + x1),
            y: round2((relative ? current.y : 0) + y1),
          };
          const point: SvgPoint = {
            x: round2((relative ? current.x : 0) + x),
            y: round2((relative ? current.y : 0) + y),
          };
          quadraticTo(control, point);
        }
        break;
      }
      case "T": {
        while (hasNumber()) {
          if (!current) break;
          const control = reflectPoint(current, previousQuadraticControl);
          const x = nextNumber();
          const y = nextNumber();
          const point: SvgPoint = {
            x: round2((relative ? current.x : 0) + x),
            y: round2((relative ? current.y : 0) + y),
          };
          quadraticTo(control, point);
        }
        break;
      }
      case "A": {
        while (hasNumber()) {
          if (!current) break;
          const rx = nextNumber();
          const ry = nextNumber();
          const rotation = nextNumber();
          const largeArc = nextNumber();
          const sweep = nextNumber();
          const x = nextNumber();
          const y = nextNumber();
          const point: SvgPoint = {
            x: round2((relative ? current.x : 0) + x),
            y: round2((relative ? current.y : 0) + y),
          };
          const segments = arcToCubics(current, rx, ry, rotation, Boolean(largeArc), Boolean(sweep), point);
          if (!segments.length) {
            lineTo(point);
            continue;
          }
          for (const segment of segments) {
            cubicTo(segment.c1, segment.c2, segment.p);
          }
        }
        break;
      }
      default:
        while (hasNumber()) index += 1;
        previousCubicControl = null;
        previousQuadraticControl = null;
        break;
    }
  }

  if (anchors.length) flush(false);
  return out;
}
