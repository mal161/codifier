import { useEffect } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import type { GraphEntity, GraphSnapshot } from "@codifier/domain";
import {
  buildEntityNeighborhood,
  type NeighborhoodNode,
} from "./neighborhood.js";

const nodeTypes: NodeTypes = { entity: EntityNode };

export function NeighborhoodMap({
  snapshot,
  selectedEntity,
  onSelectEntity,
}: {
  snapshot: GraphSnapshot;
  selectedEntity: GraphEntity;
  onSelectEntity: (entityId: string) => void;
}) {
  const neighborhood = buildEntityNeighborhood(snapshot, selectedEntity.id);
  if (neighborhood.nodes.length === 0) {
    return (
      <div className="grid min-h-80 flex-1 place-items-center p-8 text-center text-sm text-muted">
        This item is not available in the relationship map.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="sr-only" id="relationship-map-help">
        Interactive map of this item and its direct relationships. Select a node
        to inspect its evidence and source details. The Browse list remains
        available as a keyboard-friendly alternative.
      </p>
      <div
        aria-describedby="relationship-map-help"
        aria-label={`Relationships for ${selectedEntity.name}`}
        className="min-h-[420px] flex-1"
        role="region"
      >
        <ReactFlowProvider>
          <NeighborhoodFlow
            key={`${selectedEntity.id}:${snapshot.revision ?? "unknown"}`}
            neighborhood={neighborhood}
            onSelectEntity={onSelectEntity}
          />
        </ReactFlowProvider>
      </div>
      <div
        aria-live="polite"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11px] text-muted"
      >
        <span>
          {neighborhood.totalRelationshipCount === 0
            ? "No direct relationships for this item."
            : `${neighborhood.totalRelationshipCount} direct relationship${neighborhood.totalRelationshipCount === 1 ? "" : "s"}`}
        </span>
        {neighborhood.omittedNeighborCount > 0 && (
          <span>
            Showing 16 related items; {neighborhood.omittedNeighborCount} more
            are available in the Browse list.
          </span>
        )}
      </div>
    </div>
  );
}

function NeighborhoodFlow({
  neighborhood,
  onSelectEntity,
}: {
  neighborhood: ReturnType<typeof buildEntityNeighborhood>;
  onSelectEntity: (entityId: string) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(neighborhood.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(neighborhood.edges);

  useEffect(() => {
    setNodes(neighborhood.nodes);
    setEdges(neighborhood.edges);
  }, [neighborhood, setEdges, setNodes]);

  return (
    <ReactFlow
      aria-label="Interactive relationship graph"
      edges={edges}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      maxZoom={1.5}
      minZoom={0.12}
      nodes={nodes}
      nodesConnectable={false}
      nodesDraggable
      nodesFocusable
      onEdgesChange={onEdgesChange}
      onNodeClick={(_event, node) => onSelectEntity(node.data.entityId)}
      onNodesChange={onNodesChange}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: false }}
      selectNodesOnDrag={false}
      nodeTypes={nodeTypes}
    >
      <Background
        color="#dce4dc"
        gap={18}
        size={1}
        variant={BackgroundVariant.Dots}
      />
      <Controls
        aria-label="Relationship map controls"
        className="!overflow-hidden !rounded-xl !border-line !bg-white !shadow-card"
        showInteractive={false}
      />
    </ReactFlow>
  );
}

function EntityNode({ data, selected }: NodeProps<NeighborhoodNode>) {
  return (
    <>
      <Handle
        aria-hidden="true"
        className="!size-2 !border-forest !bg-white"
        position={Position.Left}
        type="target"
      />
      <div
        className={`w-[220px] rounded-xl border bg-white px-3.5 py-3 shadow-card transition ${
          selected
            ? "border-forest ring-2 ring-forest/15"
            : "border-line hover:border-forest/50"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-mist px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-forest">
            {data.kind}
          </span>
          {selected && (
            <span className="text-[9px] font-medium text-forest">Selected</span>
          )}
        </div>
        <p className="mt-2 truncate text-xs font-semibold text-ink">
          {data.name}
        </p>
        {data.path && (
          <p className="mt-1 truncate font-mono text-[9px] text-muted">
            {data.path}
          </p>
        )}
      </div>
      <Handle
        aria-hidden="true"
        className="!size-2 !border-forest !bg-white"
        position={Position.Right}
        type="source"
      />
    </>
  );
}
