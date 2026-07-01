export interface SankeyNode {
  id: string;
  name: string;
  color?: string;
  // Calculated properties
  value?: number;
  depth?: number;
  x?: number;
  y?: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  color?: string;
  isFeedback?: boolean;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface ParsedSankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  feedbackLinks: SankeyLink[];
  warnings: string[];
}
