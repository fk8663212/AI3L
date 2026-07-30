"use client";

import { useId } from "react";
import type { ConceptMap } from "@/lib/ai/schemas";

type PositionedNode = ConceptMap["nodes"][number] & {
  x: number;
  y: number;
};

function positionedNodes(map: ConceptMap): PositionedNode[] {
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
    (left, right) =>
      (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0),
  )[0];
  const surrounding = map.nodes.filter((node) => node.id !== central.id);

  return [
    { ...central, x: 50, y: 50 },
    ...surrounding.map((node, index) => {
      const ring = Math.floor(index / 8);
      const ringStart = ring * 8;
      const itemsInRing = Math.min(8, surrounding.length - ringStart);
      const positionInRing = index - ringStart;
      const angle =
        -Math.PI / 2 + (positionInRing / itemsInRing) * Math.PI * 2;
      const radiusX = Math.min(44, 29 + ring * 12);
      const radiusY = Math.min(43, 27 + ring * 12);
      return {
        ...node,
        x: 50 + Math.cos(angle) * radiusX,
        y: 50 + Math.sin(angle) * radiusY,
      };
    }),
  ];
}

export function ConceptMapCard({
  map,
  title = "概念圖",
}: {
  map: ConceptMap;
  title?: string;
}) {
  const markerId = `concept-arrow-${useId()}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );
  const nodes = positionedNodes(map);
  const positionById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="artifact-card concept-map-card">
      <div className="artifact-card-header">
        <span>{title}</span>
        <small>
          {map.nodes.length} 節點 · {map.edges.length} 關係
        </small>
      </div>
      <div className="artifact-card-body">
        <div className="concept-graph" role="img" aria-label={title}>
          <svg
            className="concept-edge-layer"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <marker
                id={markerId}
                markerWidth="4"
                markerHeight="4"
                refX="3.1"
                refY="2"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L4,2 L0,4 Z" />
              </marker>
            </defs>
            {map.edges.map((edge) => {
              const from = positionById.get(edge.from);
              const to = positionById.get(edge.to);
              if (!from || !to) return null;
              const middleX = (from.x + to.x) / 2;
              const middleY = (from.y + to.y) / 2;
              return (
                <g
                  className={edge.source === "ai" ? "ai" : "student"}
                  key={edge.id}
                >
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    markerEnd={`url(#${markerId})`}
                  />
                  <text x={middleX} y={middleY - 1.2}>
                    {edge.relationEn}
                  </text>
                </g>
              );
            })}
          </svg>

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
                <strong>— {edge.relationEn} →</strong>{" "}
                {to?.labelEn ?? edge.to}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
