"use client";

import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";
import type { ConceptMap } from "@/lib/ai/schemas";

export type PositionedNode = ConceptMap["nodes"][number] & {
  x: number;
  y: number;
};

/**
 * Node positions in percent of the drawing area: the student's own layout
 * where they dragged a node, the automatic ring layout everywhere else.
 */
export function positionedNodes(map: ConceptMap): PositionedNode[] {
  const auto = autoLayout(map);
  return auto.map((node) => {
    const original = map.nodes.find((item) => item.id === node.id);
    return typeof original?.x === "number" && typeof original?.y === "number"
      ? { ...node, x: original.x, y: original.y }
      : node;
  });
}

function autoLayout(map: ConceptMap): PositionedNode[] {
  if (map.nodes.length === 0) return [];
  if (map.nodes.length === 1) {
    return [{ ...map.nodes[0], x: 50, y: 50 }];
  }
  if (map.nodes.length === 2) {
    return [
      { ...map.nodes[0], x: 28, y: 50 },
      { ...map.nodes[1], x: 72, y: 50 },
    ];
  }

  const degree = new Map(map.nodes.map((node) => [node.id, 0]));
  for (const edge of map.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const central = [...map.nodes].sort(
    (left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0),
  )[0];
  const surrounding = map.nodes.filter((node) => node.id !== central.id);

  return [
    { ...central, x: 50, y: 50 },
    ...surrounding.map((node, index) => {
      // With an even count, start half a step off the vertical so nodes sit
      // on the diagonals instead of directly beside the centre node, where
      // they overlapped it on narrower screens.
      const offset =
        surrounding.length > 2 && surrounding.length % 2 === 0
          ? Math.PI / surrounding.length
          : 0;
      const angle =
        -Math.PI / 2 + offset + (index / surrounding.length) * Math.PI * 2;
      return {
        ...node,
        x: 50 + Math.cos(angle) * 44,
        y: 50 + Math.sin(angle) * 44,
      };
    }),
  ];
}

/** Reserve room for labels, while letting crowded maps scroll inside the card. */
export function ConceptMapCanvas({
  nodeCount,
  children,
  planeRef,
}: {
  nodeCount: number;
  children: ReactNode;
  planeRef?: Ref<HTMLDivElement>;
}) {
  const spacious = nodeCount > 2 || Boolean(planeRef);
  return (
    <div
      className="concept-map-canvas"
      data-spacious={spacious}
      style={{
        minWidth: spacious ? Math.max(640, (nodeCount - 1) * 96) : "100%",
        minHeight: spacious ? Math.max(480, (nodeCount - 1) * 64) : "100%",
      }}
    >
      <div className="concept-map-plane" ref={planeRef}>
        {children}
      </div>
    </div>
  );
}

/** Arrows and relation words between positioned nodes. */
export function ConceptEdgeLayer({
  nodes,
  edges,
}: {
  nodes: PositionedNode[];
  edges: ConceptMap["edges"];
}) {
  const markerId = `concept-arrow-${useId()}`.replace(/[^a-zA-Z0-9_-]/g, "");
  const positionById = new Map(nodes.map((node) => [node.id, node]));
  return (
    <svg
      className="concept-edge-layer"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {(["student", "ai"] as const).map((source) => (
          <marker
            key={source}
            id={`${markerId}-${source}`}
            className={source}
            markerWidth="4"
            markerHeight="4"
            refX="3.1"
            refY="2"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L4,2 L0,4 Z" />
          </marker>
        ))}
      </defs>
      {edges.map((edge) => {
        const from = positionById.get(edge.from);
        const to = positionById.get(edge.to);
        if (!from || !to) return null;
        return (
          <g className={edge.source === "ai" ? "ai" : "student"} key={edge.id}>
            <line
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              markerEnd={`url(#${markerId}-${edge.source})`}
            />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 1.2}>
              {edge.relationEn}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ConceptMapCard({
  map,
  title = "概念圖",
}: {
  map: ConceptMap;
  title?: string;
}) {
  const nodes = positionedNodes(map);
  const graphRef = useRef<HTMLDivElement>(null);
  const layoutKey = nodes
    .map((node) => `${node.id}:${node.x}:${node.y}`)
    .join("|");
  useEffect(() => {
    const viewport = graphRef.current;
    if (!viewport) return;
    const center = () => {
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
      viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layoutKey]);

  return (
    <div className="artifact-card concept-map-card">
      <div className="artifact-card-header">
        <span>{title}</span>
        <small>
          {map.nodes.length} 節點 · {map.edges.length} 關係
        </small>
      </div>
      <div className="artifact-card-body">
        {nodes.length > 2 ? (
          <p className="concept-map-hint">
            可在圖內左右、上下捲動，查看完整概念圖。
          </p>
        ) : null}
        <div
          className="concept-graph"
          ref={graphRef}
          role="img"
          aria-label={title}
          tabIndex={nodes.length > 2 ? 0 : undefined}
        >
          <ConceptMapCanvas nodeCount={nodes.length}>
            <ConceptEdgeLayer nodes={nodes} edges={map.edges} />

            {nodes.map((node) => (
              <div
                className={`concept-node ${node.source === "ai" ? "ai" : "student"}`}
                data-category={node.category}
                key={node.id}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
              >
                <strong>{node.labelEn}</strong>
                <small>{node.labelZh}</small>
                {node.source === "ai" ? <em>AI 新增</em> : null}
              </div>
            ))}
          </ConceptMapCanvas>
        </div>

        <div className="concept-map-legend">
          <span className="student">學生原有概念</span>
          <span className="ai">AI 擴充概念／關係</span>
        </div>
        <div className="edge-list">
          {map.edges.map((edge) => {
            const from = map.nodes.find((node) => node.id === edge.from);
            const to = map.nodes.find((node) => node.id === edge.to);
            return (
              <div className={edge.source} key={edge.id}>
                {from?.labelEn ?? edge.from}{" "}
                <strong>— {edge.relationEn} →</strong> {to?.labelEn ?? edge.to}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
