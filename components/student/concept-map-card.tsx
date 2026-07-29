import type { ConceptMap } from "@/lib/ai/schemas";

export function ConceptMapCard({
  map,
  title = "概念圖",
}: {
  map: ConceptMap;
  title?: string;
}) {
  return (
    <div className="artifact-card">
      <div className="artifact-card-header">
        <span>{title}</span>
        <small>
          {map.nodes.length} 節點 · {map.edges.length} 關係
        </small>
      </div>
      <div className="artifact-card-body">
        <div className="concept-graph">
          <div className="concept-tree">
            {map.nodes.map((node) => (
              <div
                className={`concept-node ${node.source === "ai" ? "ai" : ""}`}
                key={node.id}
              >
                <strong>{node.labelEn}</strong>
                <small>{node.labelZh}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="edge-list">
          {map.edges.map((edge) => {
            const from = map.nodes.find((node) => node.id === edge.from);
            const to = map.nodes.find((node) => node.id === edge.to);
            return (
              <div key={edge.id}>
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
