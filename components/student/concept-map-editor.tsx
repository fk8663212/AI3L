"use client";

import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ConceptMap } from "@/lib/ai/schemas";
import {
  ConceptEdgeLayer,
  positionedNodes,
  type PositionedNode,
} from "@/components/student/concept-map-card";

type EditableEdge = ConceptMap["edges"][number];

export type ConceptMapEdit = {
  nodes: Array<Pick<PositionedNode, "id" | "labelEn" | "labelZh" | "category" | "x" | "y">>;
  edges: Array<Pick<EditableEdge, "id" | "from" | "to" | "relationEn" | "relationZh">>;
};

const CATEGORY_LABELS: Record<PositionedNode["category"], string> = {
  person: "人物",
  object: "物品",
  event: "事件",
  place: "地點",
  feeling: "感受",
  quality: "特色",
};

/** Keeps a dragged node fully inside the drawing area. */
const EDGE_MARGIN = 7;
/** Pointer travel (px) below which a press counts as a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function clamp(value: number): number {
  return Math.min(100 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value));
}

/**
 * Stage 5 editor: drag concepts, edit their words, add or delete concepts
 * and relations. The server decides each item's source on save, so the
 * client only sends the map as the student arranged it.
 */
export function ConceptMapEditor({
  map,
  reviewed,
  busy,
  onSave,
}: {
  /** The map as last saved (the student's edits, or the review result). */
  map: ConceptMap;
  /** The review result before any edits, for "restore". */
  reviewed: ConceptMap;
  busy: boolean;
  onSave: (edit: ConceptMapEdit) => Promise<boolean>;
}) {
  const [nodes, setNodes] = useState<PositionedNode[]>(() => positionedNodes(map));
  const [edges, setEdges] = useState<EditableEdge[]>(() => map.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newConcept, setNewConcept] = useState({ labelEn: "", labelZh: "" });
  const [newRelation, setNewRelation] = useState({ to: "", relationEn: "", relationZh: "" });
  const graphRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);

  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const label = (id: string) => nodes.find((node) => node.id === id)?.labelEn ?? id;

  function change<T>(setter: (update: (current: T) => T) => void, update: (current: T) => T) {
    setter(update);
    setDirty(true);
  }

  function updateNode(id: string, patch: Partial<PositionedNode>) {
    change(setNodes, (current) => current.map((node) => (node.id === id ? { ...node, ...patch } : node)));
  }

  function updateEdge(id: string, patch: Partial<EditableEdge>) {
    change(setEdges, (current) => current.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)));
  }

  function deleteNode(id: string) {
    change(setNodes, (current) => current.filter((node) => node.id !== id));
    // A relation needs both of its concepts.
    setEdges((current) => current.filter((edge) => edge.from !== id && edge.to !== id));
    setSelectedId(null);
  }

  function addConcept() {
    const labelEn = newConcept.labelEn.trim();
    if (!labelEn) return;
    const id = newId("c");
    // Place new concepts in a small spiral around the centre, not on top of
    // each other.
    const turn = nodes.length * 0.9;
    change(setNodes, (current) => [
      ...current,
      {
        id,
        labelEn,
        labelZh: newConcept.labelZh.trim() || labelEn,
        category: "object" as const,
        source: "student" as const,
        x: clamp(50 + Math.cos(turn) * 18),
        y: clamp(50 + Math.sin(turn) * 18),
      },
    ]);
    setNewConcept({ labelEn: "", labelZh: "" });
    setSelectedId(id);
  }

  function addRelation() {
    if (!selected || !newRelation.to || !newRelation.relationEn.trim()) return;
    change(setEdges, (current) => [
      ...current,
      {
        id: newId("r"),
        from: selected.id,
        to: newRelation.to,
        relationEn: newRelation.relationEn.trim(),
        relationZh: newRelation.relationZh.trim() || newRelation.relationEn.trim(),
        source: "student" as const,
      },
    ]);
    setNewRelation({ to: "", relationEn: "", relationZh: "" });
  }

  function restore() {
    if (!window.confirm("要還原成剛審核完的概念圖嗎？你這次的調整會被捨棄。")) return;
    setNodes(positionedNodes(reviewed));
    setEdges(reviewed.edges);
    setSelectedId(null);
    setDirty(true);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, startX: event.clientX, startY: event.clientY, moved: false };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    const area = graphRef.current?.getBoundingClientRect();
    if (!current || !area) return;
    if (
      !current.moved &&
      Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    current.moved = true;
    updateNode(current.id, {
      x: clamp(((event.clientX - area.left) / area.width) * 100),
      y: clamp(((event.clientY - area.top) / area.height) * 100),
    });
  }

  function onPointerUp() {
    const current = drag.current;
    drag.current = null;
    if (current && !current.moved) {
      setSelectedId((id) => (id === current.id ? null : current.id));
    }
  }

  async function save() {
    const saved = await onSave({
      nodes: nodes.map(({ id, labelEn, labelZh, category, x, y }) => ({ id, labelEn, labelZh, category, x, y })),
      edges: edges.map(({ id, from, to, relationEn, relationZh }) => ({ id, from, to, relationEn, relationZh })),
    });
    if (saved) setDirty(false);
  }

  const emptyLabel = nodes.some((node) => !node.labelEn.trim()) || edges.some((edge) => !edge.relationEn.trim());

  return (
    <div className="concept-editor">
      <p className="panel-hint">
        拖曳概念可以移動位置；點一下概念可以修改文字、刪除，或從它拉出新的關係。
      </p>
      <div className="artifact-card concept-map-card">
        <div className="artifact-card-body">
          <div className="concept-graph editable" ref={graphRef}>
            <ConceptEdgeLayer nodes={nodes} edges={edges} />
            {nodes.map((node) => (
              <div
                className={`concept-node ${node.source === "ai" ? "ai" : "student"} ${selectedId === node.id ? "selected" : ""}`}
                data-category={node.category}
                key={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={selectedId === node.id}
                aria-label={`${node.labelEn}，拖曳移動，點一下編輯`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                onPointerDown={(event) => onPointerDown(event, node.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId((id) => (id === node.id ? null : node.id));
                  }
                }}
              >
                <strong>{node.labelEn || "（未命名）"}</strong>
                <small>{node.labelZh}</small>
                {node.source === "ai" ? <em>AI 新增</em> : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected ? (
        <div className="concept-editor-panel">
          <div className="concept-editor-heading">
            <strong>編輯概念</strong>
            <button className="button secondary compact" type="button" onClick={() => deleteNode(selected.id)}>
              <Trash2 size={15} />
              刪除這個概念
            </button>
          </div>
          <div className="concept-editor-fields">
            <label>
              英文
              <input
                className="input"
                value={selected.labelEn}
                maxLength={80}
                onChange={(event) => updateNode(selected.id, { labelEn: event.target.value })}
              />
            </label>
            <label>
              中文
              <input
                className="input"
                value={selected.labelZh}
                maxLength={80}
                onChange={(event) => updateNode(selected.id, { labelZh: event.target.value })}
              />
            </label>
            <label>
              類型
              <select
                className="input"
                value={selected.category}
                onChange={(event) =>
                  updateNode(selected.id, { category: event.target.value as PositionedNode["category"] })
                }
              >
                {Object.entries(CATEGORY_LABELS).map(([value, name]) => (
                  <option key={value} value={value}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <strong className="concept-editor-subheading">從「{selected.labelEn}」新增一條關係</strong>
          <div className="concept-editor-fields">
            <label>
              連到
              <select
                className="input"
                value={newRelation.to}
                onChange={(event) => setNewRelation((current) => ({ ...current, to: event.target.value }))}
              >
                <option value="">選擇概念</option>
                {nodes
                  .filter((node) => node.id !== selected.id)
                  .map((node) => (
                    <option key={node.id} value={node.id}>{node.labelEn}</option>
                  ))}
              </select>
            </label>
            <label>
              關係（英文）
              <input
                className="input"
                placeholder="例如 sells、is next to"
                value={newRelation.relationEn}
                maxLength={80}
                onChange={(event) => setNewRelation((current) => ({ ...current, relationEn: event.target.value }))}
              />
            </label>
            <label>
              關係（中文）
              <input
                className="input"
                placeholder="例如 販賣"
                value={newRelation.relationZh}
                maxLength={80}
                onChange={(event) => setNewRelation((current) => ({ ...current, relationZh: event.target.value }))}
              />
            </label>
          </div>
          <button
            className="button secondary compact"
            type="button"
            disabled={!newRelation.to || !newRelation.relationEn.trim()}
            onClick={addRelation}
          >
            <Plus size={15} />
            新增關係
          </button>
        </div>
      ) : null}

      <div className="concept-editor-panel">
        <strong>新增我自己的概念</strong>
        <div className="concept-editor-fields">
          <label>
            英文
            <input
              className="input"
              value={newConcept.labelEn}
              maxLength={80}
              onChange={(event) => setNewConcept((current) => ({ ...current, labelEn: event.target.value }))}
            />
          </label>
          <label>
            中文
            <input
              className="input"
              value={newConcept.labelZh}
              maxLength={80}
              onChange={(event) => setNewConcept((current) => ({ ...current, labelZh: event.target.value }))}
            />
          </label>
        </div>
        <button className="button secondary compact" type="button" disabled={!newConcept.labelEn.trim()} onClick={addConcept}>
          <Plus size={15} />
          新增概念
        </button>
      </div>

      <div className="concept-editor-panel">
        <strong>關係（{edges.length}）</strong>
        {edges.length ? (
          <ul className="concept-edge-editor">
            {edges.map((edge) => (
              <li key={edge.id}>
                <span>{label(edge.from)}</span>
                <input
                  className="input"
                  aria-label={`${label(edge.from)} 到 ${label(edge.to)} 的英文關係`}
                  value={edge.relationEn}
                  maxLength={80}
                  onChange={(event) => updateEdge(edge.id, { relationEn: event.target.value })}
                />
                <input
                  className="input"
                  aria-label={`${label(edge.from)} 到 ${label(edge.to)} 的中文關係`}
                  value={edge.relationZh}
                  maxLength={80}
                  onChange={(event) => updateEdge(edge.id, { relationZh: event.target.value })}
                />
                <span>→ {label(edge.to)}</span>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`刪除 ${label(edge.from)} 到 ${label(edge.to)} 的關係`}
                  onClick={() => change(setEdges, (current) => current.filter((item) => item.id !== edge.id))}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">還沒有關係。點一下概念就可以新增。</p>
        )}
      </div>

      <div className="stage-panel-row">
        <button className="button secondary" type="button" disabled={busy} onClick={restore}>
          <RotateCcw size={16} />
          還原成審核後的版本
        </button>
        <button className="button" type="button" disabled={busy || !dirty || emptyLabel || !nodes.length} onClick={save}>
          <Save size={16} />
          {emptyLabel ? "每個概念和關係都要有英文" : dirty ? "保存我的概念圖" : "已保存"}
        </button>
      </div>
    </div>
  );
}
