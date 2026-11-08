"use client";

import { ArrowLeftRight, Link2, Plus, Redo2, RotateCcw, Save, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Core, ElementDefinition, StylesheetJson } from "cytoscape";
import type { ConceptMap } from "@/lib/ai/schemas";
import { ConceptMapCanvas, positionedNodes, type PositionedNode } from "@/components/student/concept-map-card";

type EditableEdge = ConceptMap["edges"][number];

export type ConceptMapEdit = {
  nodes: Array<Pick<PositionedNode, "id" | "labelEn" | "labelZh" | "category" | "x" | "y">>;
  edges: Array<Pick<EditableEdge, "id" | "from" | "to" | "relationEn" | "relationZh">>;
};

type Doc = { nodes: PositionedNode[]; edges: EditableEdge[] };
type Selection = { kind: "node" | "edge"; id: string } | null;

const CATEGORY_LABELS: Record<PositionedNode["category"], string> = {
  person: "人物",
  object: "物品",
  event: "事件",
  place: "地點",
  feeling: "感受",
  quality: "特色",
};

/** Same limits the server enforces on save. */
const MAX_NODES = 40;
const MAX_EDGES = 80;
const HISTORY_LIMIT = 60;
/** Keeps a node fully inside the drawing area (percent). */
const EDGE_MARGIN = 7;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function clamp(value: number): number {
  return Math.min(100 - EDGE_MARGIN, Math.max(EDGE_MARGIN, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

// Cytoscape accepts double-quoted families. Use the site's bundled CJK font,
// rather than depending on Chinese fonts installed on the student's device.
const FONT_FAMILY = 'Nunito, "Noto Sans TC", sans-serif';
const NODE_FONT_SIZE = 13;
const TEXT_MAX_WIDTH = 130;

const STYLES: StylesheetJson = [
  {
    selector: "node",
    style: {
      shape: "round-rectangle",
      // Explicit sizes: Cytoscape's "label" sizing is deprecated and caches
      // a zero size for nodes measured before their font is ready.
      width: "data(w)",
      height: "data(h)",
      label: "data(label)",
      "text-wrap": "wrap",
      "text-max-width": `${TEXT_MAX_WIDTH}px`,
      "text-valign": "center",
      "text-halign": "center",
      "font-family": FONT_FAMILY,
      "font-size": NODE_FONT_SIZE,
      "font-weight": 700,
      "line-height": 1.3,
      color: "#1f2937",
      "background-color": "#ffffff",
      "border-width": 2,
      "border-color": "#3557d8",
    },
  },
  {
    selector: "node.ai",
    style: { "background-color": "#fff8f2", "border-color": "#e8590c" },
  },
  {
    selector: "node.unnamed",
    style: { color: "#b42318", "border-style": "dashed" },
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      width: 2,
      "line-color": "#3557d8",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "#3557d8",
      "arrow-scale": 1.1,
      label: "data(label)",
      "font-family": FONT_FAMILY,
      "font-size": 12,
      "font-weight": 800,
      color: "#4c5668",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.95,
      "text-background-padding": "3px",
      "text-background-shape": "roundrectangle",
      "text-border-width": 1,
      "text-border-color": "#e3e8f0",
      "text-border-opacity": 1,
      // Tapping the relation word selects the relation, which is far
      // easier on a touch screen than hitting a 2px line.
      "text-events": "yes",
    },
  },
  {
    selector: "edge.ai",
    style: {
      "line-color": "#e8590c",
      "line-style": "dashed",
      "target-arrow-color": "#e8590c",
      color: "#806019",
    },
  },
  {
    selector: "edge.unnamed",
    style: { color: "#b42318", "text-border-color": "#b42318" },
  },
  {
    selector: "node:selected",
    style: { "border-width": 4, "overlay-color": "#3557d8", "overlay-opacity": 0.1 },
  },
  {
    selector: "edge:selected",
    style: {
      width: 4,
      "text-border-color": "#2643b4",
      "text-border-width": 2,
    },
  },
  {
    selector: "node.connect-source",
    style: { "border-color": "#0f9d58", "border-width": 4, "border-style": "solid" },
  },
];

function nodeLabel(node: PositionedNode): string {
  const en = node.labelEn.trim() || "（未命名）";
  const zh = node.labelZh.trim();
  return zh && zh !== en ? `${en}\n${zh}` : en;
}

let measureContext: CanvasRenderingContext2D | null = null;

/** Box size for a node label, matching the node font and wrap width. */
function nodeSize(label: string): { w: number; h: number } {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (measureContext) measureContext.font = `700 ${NODE_FONT_SIZE}px ${FONT_FAMILY}`;
  let widest = 0;
  let lines = 0;
  for (const line of label.split("\n")) {
    const width = measureContext?.measureText(line).width ?? line.length * 8;
    widest = Math.max(widest, Math.min(width, TEXT_MAX_WIDTH));
    lines += Math.max(1, Math.ceil(width / TEXT_MAX_WIDTH));
  }
  return { w: Math.max(72, Math.ceil(widest) + 26), h: Math.ceil(lines * NODE_FONT_SIZE * 1.3) + 22 };
}

function edgeLabel(edge: EditableEdge): string {
  return edge.relationEn.trim() || "（輸入關係）";
}

/** The same padded percentage plane used by the saved read-only/Micro maps. */
function drawingArea(cy: Core, plane: HTMLDivElement | null) {
  const width = plane?.clientWidth || cy.width() || 1;
  const height = plane?.clientHeight || cy.height() || 1;
  return { width, height, left: (cy.width() - width) / 2, top: (cy.height() - height) / 2 };
}

/**
 * Stage 5 editor on Cytoscape.js: drag concepts, tap a concept or a
 * relation word to edit it, draw new relations by tapping two concepts, and
 * undo or redo any change. Positions are kept in percent of the drawing
 * area so the read-only map card shows the same layout. The server decides
 * each item's source on save, so the client only sends the map as arranged.
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
  const [doc, setDoc] = useState<Doc>(() => ({ nodes: positionedNodes(map), edges: map.edges }));
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [painted, setPainted] = useState(false);
  const [fontVersion, setFontVersion] = useState(0);
  const [newConcept, setNewConcept] = useState({ labelEn: "", labelZh: "" });

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const relationInputRef = useRef<HTMLInputElement>(null);
  // Typing in one field is one undo step, not one step per letter.
  const lastTextKey = useRef<string | null>(null);
  // Cytoscape event handlers are bound once; they read the latest values here.
  const latest = useRef({ doc, connectFrom });
  useEffect(() => {
    latest.current = { doc, connectFrom };
  });

  const { nodes, edges } = doc;
  const labelText = [...nodes.map(nodeLabel), ...edges.map(edgeLabel)].join(" ");
  useEffect(() => {
    let active = true;
    const loaded = () => { if (active) setFontVersion(version => version + 1); };
    void Promise.all([
      document.fonts.load(`700 ${NODE_FONT_SIZE}px Nunito`, labelText),
      document.fonts.load(`700 ${NODE_FONT_SIZE}px "Noto Sans TC"`, labelText),
    ]).then(loaded, loaded);
    return () => { active = false; };
  }, [labelText]);
  const selectedNode = selection?.kind === "node" ? nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedEdge = selection?.kind === "edge" ? edges.find((edge) => edge.id === selection.id) ?? null : null;
  const label = (id: string) => nodes.find((node) => node.id === id)?.labelEn || "（未命名）";

  const commit = useCallback((update: (current: Doc) => Doc, textKey: string | null = null) => {
    const current = latest.current.doc;
    const next = update(current);
    if (next === current) return;
    const coalesce = textKey !== null && textKey === lastTextKey.current;
    lastTextKey.current = textKey;
    if (!coalesce) {
      setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), current]);
    }
    setFuture([]);
    latest.current = { ...latest.current, doc: next };
    setDoc(next);
    setDirty(true);
  }, []);

  const addRelation = useCallback(
    (from: string, to: string) => {
      if (from === to || latest.current.doc.edges.length >= MAX_EDGES) return;
      const id = newId("r");
      commit((current) => ({
        ...current,
        edges: [...current.edges, { id, from, to, relationEn: "", relationZh: "", source: "student" as const }],
      }));
      setConnectFrom(null);
      setSelection({ kind: "edge", id });
      // The new relation has no words yet: put the cursor where they go.
      window.setTimeout(() => relationInputRef.current?.focus(), 0);
    },
    [commit],
  );

  // Create the Cytoscape instance once. It is loaded on the client only.
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let removeInputListeners: (() => void) | null = null;
    void import("cytoscape").then(({ default: cytoscape }) => {
      const container = containerRef.current;
      if (disposed || !container) return;
      const cy = cytoscape({
        container,
        style: STYLES,
        layout: { name: "preset" },
        // Panning only changes the view. Saved positions remain percentages
        // of the shared drawing plane, including on a narrow screen.
        userZoomingEnabled: false,
        userPanningEnabled: true,
        boxSelectionEnabled: false,
        selectionType: "single",
        autoungrabify: false,
      });
      cyRef.current = cy;

      // The workspace scrolls inside its own panel. Refresh before Cytoscape's
      // handlers run so a first tap after scrolling uses the current bounds.
      const refreshBounds = () => { cy.resize(); };
      container.addEventListener("mousedown", refreshBounds, true);
      container.addEventListener("touchstart", refreshBounds, { capture: true, passive: true });
      removeInputListeners = () => {
        container.removeEventListener("mousedown", refreshBounds, true);
        container.removeEventListener("touchstart", refreshBounds, true);
      };

      const size = () => drawingArea(cy, planeRef.current);

      cy.on("tap", "node", (event) => {
        const id = event.target.id() as string;
        const from = latest.current.connectFrom;
        if (from) {
          if (from !== id) addRelation(from, id);
          return;
        }
        lastTextKey.current = null;
        setSelection({ kind: "node", id });
      });
      cy.on("tap", "edge", (event) => {
        lastTextKey.current = null;
        setConnectFrom(null);
        setSelection({ kind: "edge", id: event.target.id() as string });
      });
      cy.on("tap", (event) => {
        if (event.target === cy) {
          setSelection(null);
          setConnectFrom(null);
        }
      });
      // Keep a dragged node inside the drawing area while it moves.
      cy.on("drag", "node", (event) => {
        const node = event.target;
        const { width, height, left, top } = size();
        const position = node.position();
        const x = left + (clamp(((position.x - left) / width) * 100) / 100) * width;
        const y = top + (clamp(((position.y - top) / height) * 100) / 100) * height;
        if (x !== position.x || y !== position.y) node.position({ x, y });
      });
      // One drag is one undo step, recorded when the node is let go.
      cy.on("dragfree", "node", (event) => {
        const node = event.target;
        const id = node.id() as string;
        const { width, height, left, top } = size();
        const x = round(clamp(((node.position("x") - left) / width) * 100));
        const y = round(clamp(((node.position("y") - top) / height) * 100));
        lastTextKey.current = null;
        commit((current) => {
          const before = current.nodes.find((item) => item.id === id);
          if (!before || (before.x === x && before.y === y)) return current;
          return { ...current, nodes: current.nodes.map((item) => (item.id === id ? { ...item, x, y } : item)) };
        });
      });

      observer = new ResizeObserver(() => {
        cy.resize();
        const { width, height, left, top } = size();
        for (const node of latest.current.doc.nodes) {
          cy.getElementById(node.id).position({ x: left + (node.x / 100) * width, y: top + (node.y / 100) * height });
        }
        const viewport = viewportRef.current;
        if (viewport) {
          viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
          viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
        }
      });
      observer.observe(container);
      setReady(true);
    });
    return () => {
      disposed = true;
      removeInputListeners?.();
      observer?.disconnect();
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [addRelation, commit]);

  // Mirror the document into Cytoscape: add, update and remove elements so
  // the canvas always shows exactly the React state.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    const { width, height, left, top } = drawingArea(cy, planeRef.current);
    cy.one("render", () => setPainted(true));
    cy.batch(() => {
      const nodeIds = new Set(nodes.map((node) => node.id));
      const edgeIds = new Set(edges.map((edge) => edge.id));
      cy.elements().forEach((element) => {
        const id = element.id();
        const keep = element.group() === "nodes" ? nodeIds.has(id) : edgeIds.has(id);
        if (!keep) element.remove();
      });
      const added: ElementDefinition[] = [];
      for (const node of nodes) {
        const position = { x: left + (node.x / 100) * width, y: top + (node.y / 100) * height };
        const classes = [node.source === "ai" ? "ai" : "student", node.labelEn.trim() ? "" : "unnamed"]
          .filter(Boolean)
          .join(" ");
        const text = nodeLabel(node);
        const existing = cy.getElementById(node.id);
        if (existing.empty()) {
          added.push({ group: "nodes", data: { id: node.id, label: text, ...nodeSize(text) }, position, classes });
        } else {
          existing.data({ label: text, ...nodeSize(text) });
        }
        if (!existing.empty()) {
          existing.classes(classes);
          if (!existing.grabbed()) existing.position(position);
        }
      }
      for (const edge of edges) {
        const classes = [edge.source === "ai" ? "ai" : "student", edge.relationEn.trim() ? "" : "unnamed"]
          .filter(Boolean)
          .join(" ");
        const existing = cy.getElementById(edge.id);
        // Endpoints can change (reversing a relation), which Cytoscape does
        // not allow in place: re-add the edge instead.
        if (!existing.empty() && (existing.data("source") !== edge.from || existing.data("target") !== edge.to)) {
          existing.remove();
        }
        const current = cy.getElementById(edge.id);
        if (current.empty()) {
          added.push({
            group: "edges",
            data: { id: edge.id, source: edge.from, target: edge.to, label: edgeLabel(edge) },
            classes,
          });
        } else {
          current.data("label", edgeLabel(edge));
          current.classes(classes);
        }
      }
      if (added.length) cy.add(added);
    });
  }, [nodes, edges, ready, fontVersion]);

  // Selection and connect-mode highlight follow React state.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selection) cy.getElementById(selection.id).select();
      cy.nodes().removeClass("connect-source");
      if (connectFrom) cy.getElementById(connectFrom).addClass("connect-source");
    });
  }, [selection, connectFrom, ready, nodes, edges]);

  useEffect(() => {
    cyRef.current?.autoungrabify(busy);
  }, [busy, ready]);

  function updateNode(id: string, patch: Partial<PositionedNode>, field?: string) {
    commit(
      (current) => ({ ...current, nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)) }),
      field ? `node:${id}:${field}` : null,
    );
  }

  function updateEdge(id: string, patch: Partial<EditableEdge>, field?: string) {
    commit(
      (current) => ({ ...current, edges: current.edges.map((edge) => (edge.id === id ? { ...edge, ...patch } : edge)) }),
      field ? `edge:${id}:${field}` : null,
    );
  }

  function deleteNode(id: string) {
    // A relation needs both of its concepts.
    commit((current) => ({
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.from !== id && edge.to !== id),
    }));
    setSelection(null);
    setConnectFrom(null);
  }

  function deleteEdge(id: string) {
    commit((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== id) }));
    setSelection(null);
  }

  function addConcept() {
    const labelEn = newConcept.labelEn.trim();
    if (!labelEn || nodes.length >= MAX_NODES) return;
    const id = newId("c");
    // Place new concepts in a small spiral around the centre, not on top of
    // each other.
    const turn = nodes.length * 0.9;
    commit((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        {
          id,
          labelEn,
          labelZh: newConcept.labelZh.trim() || labelEn,
          category: "object" as const,
          source: "student" as const,
          x: round(clamp(50 + Math.cos(turn) * 18)),
          y: round(clamp(50 + Math.sin(turn) * 18)),
        },
      ],
    }));
    setNewConcept({ labelEn: "", labelZh: "" });
    setSelection({ kind: "node", id });
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    lastTextKey.current = null;
    setPast(past.slice(0, -1));
    setFuture([doc, ...future]);
    latest.current = { ...latest.current, doc: previous };
    setDoc(previous);
    setDirty(true);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    lastTextKey.current = null;
    setFuture(future.slice(1));
    setPast([...past, doc]);
    latest.current = { ...latest.current, doc: next };
    setDoc(next);
    setDirty(true);
  }

  function restore() {
    if (!window.confirm("要還原成剛審核完的概念圖嗎？你可以再按「復原」回到現在的樣子。")) return;
    commit(() => ({ nodes: positionedNodes(reviewed), edges: reviewed.edges }));
    setSelection(null);
    setConnectFrom(null);
  }

  // Undo/redo and delete from the keyboard, except while typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // Only when the student is working in the editor (the canvas itself
      // takes no focus, so a tap there leaves focus on the page body).
      const editor = containerRef.current?.closest(".concept-editor");
      if (target && target !== document.body && !editor?.contains(target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        if (selection.kind === "node") deleteNode(selection.id);
        else deleteEdge(selection.id);
      } else if (event.key === "Escape") {
        setSelection(null);
        setConnectFrom(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
        直接在圖上操作：拖曳概念移動位置；點概念或關係詞就能修改；選一個概念後按「連到…」，再點另一個概念就能新增關係。可拖曳空白處查看圖面，按「圖面置中」回到原視角。
      </p>

      <div className="concept-editor-toolbar" role="toolbar" aria-label="概念圖工具">
        <button className="button secondary compact" type="button" disabled={!past.length || busy} onClick={undo}>
          <Undo2 size={15} />
          復原
        </button>
        <button className="button secondary compact" type="button" disabled={!future.length || busy} onClick={redo}>
          <Redo2 size={15} />
          重做
        </button>
        <button className="button secondary compact" type="button" onClick={() => {
          cyRef.current?.pan({ x: 0, y: 0 });
          const viewport = viewportRef.current;
          if (viewport) {
            viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
            viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
          }
        }}>
          圖面置中
        </button>
        {connectFrom ? (
          <span className="concept-editor-status" role="status">
            <Link2 size={15} aria-hidden="true" /> 點另一個概念，把「{label(connectFrom)}」連過去
            <button className="icon-button" type="button" aria-label="取消連線" onClick={() => setConnectFrom(null)}>
              <X size={15} />
            </button>
          </span>
        ) : (
          <span className="concept-editor-status muted">
            {nodes.length} 個概念 · {edges.length} 條關係
          </span>
        )}
      </div>

      <div className="artifact-card concept-map-card">
        <div className="artifact-card-body">
          <div
            className={`concept-graph cy-editor ${connectFrom ? "connecting" : ""}`}
            ref={viewportRef}
            role="application"
            aria-label="可編輯的概念圖"
            aria-busy={!painted || fontVersion === 0}
          >
            <ConceptMapCanvas nodeCount={nodes.length} planeRef={planeRef} editable overlay={
              <div className="cy-editor-surface" ref={containerRef} />
            }>{null}</ConceptMapCanvas>
          </div>
        </div>
      </div>

      {selectedNode ? (
        <div className="concept-editor-panel">
          <div className="concept-editor-heading">
            <strong>編輯概念</strong>
            <div className="concept-editor-actions">
              <button
                className="button secondary compact"
                type="button"
                disabled={edges.length >= MAX_EDGES}
                onClick={() => setConnectFrom(selectedNode.id)}
              >
                <Link2 size={15} />
                連到…
              </button>
              <button className="button secondary compact" type="button" onClick={() => deleteNode(selectedNode.id)}>
                <Trash2 size={15} />
                刪除
              </button>
            </div>
          </div>
          <div className="concept-editor-fields">
            <label>
              英文
              <input
                className="input"
                value={selectedNode.labelEn}
                maxLength={80}
                onChange={(event) => updateNode(selectedNode.id, { labelEn: event.target.value }, "labelEn")}
              />
            </label>
            <label>
              中文
              <input
                className="input"
                value={selectedNode.labelZh}
                maxLength={80}
                onChange={(event) => updateNode(selectedNode.id, { labelZh: event.target.value }, "labelZh")}
              />
            </label>
            <label>
              類型
              <select
                className="input"
                value={selectedNode.category}
                onChange={(event) =>
                  updateNode(selectedNode.id, { category: event.target.value as PositionedNode["category"] })
                }
              >
                {Object.entries(CATEGORY_LABELS).map(([value, name]) => (
                  <option key={value} value={value}>{name}</option>
                ))}
              </select>
            </label>
            <label>
              或從清單選要連到的概念
              <select
                className="input"
                value=""
                disabled={edges.length >= MAX_EDGES}
                onChange={(event) => {
                  if (event.target.value) addRelation(selectedNode.id, event.target.value);
                }}
              >
                <option value="">選擇概念</option>
                {nodes
                  .filter((node) => node.id !== selectedNode.id)
                  .map((node) => (
                    <option key={node.id} value={node.id}>{node.labelEn || "（未命名）"}</option>
                  ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {selectedEdge ? (
        <div className="concept-editor-panel">
          <div className="concept-editor-heading">
            <strong>
              編輯關係：{label(selectedEdge.from)} → {label(selectedEdge.to)}
            </strong>
            <div className="concept-editor-actions">
              <button
                className="button secondary compact"
                type="button"
                onClick={() => updateEdge(selectedEdge.id, { from: selectedEdge.to, to: selectedEdge.from })}
              >
                <ArrowLeftRight size={15} />
                反轉方向
              </button>
              <button className="button secondary compact" type="button" onClick={() => deleteEdge(selectedEdge.id)}>
                <Trash2 size={15} />
                刪除
              </button>
            </div>
          </div>
          <div className="concept-editor-fields">
            <label>
              關係（英文）
              <input
                ref={relationInputRef}
                className="input"
                placeholder="例如 sells、is next to"
                value={selectedEdge.relationEn}
                maxLength={80}
                onChange={(event) => updateEdge(selectedEdge.id, { relationEn: event.target.value }, "relationEn")}
              />
            </label>
            <label>
              關係（中文）
              <input
                className="input"
                placeholder="例如 販賣"
                value={selectedEdge.relationZh}
                maxLength={80}
                onChange={(event) => updateEdge(selectedEdge.id, { relationZh: event.target.value }, "relationZh")}
              />
            </label>
          </div>
        </div>
      ) : null}

      {!selection ? (
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
                onKeyDown={(event) => {
                  if (event.key === "Enter") addConcept();
                }}
              />
            </label>
            <label>
              中文
              <input
                className="input"
                value={newConcept.labelZh}
                maxLength={80}
                onChange={(event) => setNewConcept((current) => ({ ...current, labelZh: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addConcept();
                }}
              />
            </label>
          </div>
          <button
            className="button secondary compact"
            type="button"
            disabled={!newConcept.labelEn.trim() || nodes.length >= MAX_NODES}
            onClick={addConcept}
          >
            <Plus size={15} />
            {nodes.length >= MAX_NODES ? `最多 ${MAX_NODES} 個概念` : "新增概念"}
          </button>
        </div>
      ) : null}

      <details className="concept-editor-panel concept-edge-list">
        <summary>
          <strong>所有關係（{edges.length}）</strong>
          <small className="muted">點圖上的關係詞比較快，這裡是完整清單</small>
        </summary>
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
                  onChange={(event) => updateEdge(edge.id, { relationEn: event.target.value }, "relationEn")}
                />
                <input
                  className="input"
                  aria-label={`${label(edge.from)} 到 ${label(edge.to)} 的中文關係`}
                  value={edge.relationZh}
                  maxLength={80}
                  onChange={(event) => updateEdge(edge.id, { relationZh: event.target.value }, "relationZh")}
                />
                <span>→ {label(edge.to)}</span>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`刪除 ${label(edge.from)} 到 ${label(edge.to)} 的關係`}
                  onClick={() => deleteEdge(edge.id)}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">還沒有關係。選一個概念後按「連到…」就可以新增。</p>
        )}
      </details>

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
