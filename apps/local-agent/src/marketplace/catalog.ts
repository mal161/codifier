import { createHash } from "node:crypto";
import type { GraphSnapshot } from "@codifier/domain";
import {
  architectureTemplateCatalogSchema,
  type ArchitectureTemplate,
} from "@codifier/contracts";

type CatalogTemplate = Omit<ArchitectureTemplate, "installed">;

const templates: CatalogTemplate[] = [
  {
    id: "layered-backend",
    title: "Layered backend",
    description:
      "A pragmatic separation for backend services, from transport concerns to domain logic and external integrations.",
    category: "Backend",
    tags: ["backend", "services", "layered"],
    version: "1.0.0",
    publisher: "Bundled with Codifier",
    components: [
      {
        id: "presentation",
        name: "Presentation",
        description: "HTTP routes, controllers, request validation, and views.",
      },
      {
        id: "application",
        name: "Application",
        description: "Use cases and orchestration of domain operations.",
      },
      {
        id: "domain",
        name: "Domain",
        description: "Business rules and the core domain model.",
      },
      {
        id: "infrastructure",
        name: "Infrastructure",
        description: "Databases, external services, and technical adapters.",
      },
    ],
  },
  {
    id: "frontend-feature-slices",
    title: "Frontend feature slices",
    description:
      "Organize a frontend around product features while keeping shared UI and data access visible.",
    category: "Frontend",
    tags: ["frontend", "features", "ui"],
    version: "1.0.0",
    publisher: "Bundled with Codifier",
    components: [
      {
        id: "application-shell",
        name: "Application shell",
        description: "App entry points, routing, and top-level composition.",
      },
      {
        id: "feature-modules",
        name: "Feature modules",
        description: "User-facing features and their local state and views.",
      },
      {
        id: "shared-ui",
        name: "Shared UI",
        description: "Reusable design-system components and presentation.",
      },
      {
        id: "data-access",
        name: "Data access",
        description:
          "API clients, persistence adapters, and data transformations.",
      },
    ],
  },
];

export function listArchitectureTemplates(
  snapshot?: GraphSnapshot,
): ArchitectureTemplate[] {
  const repositoryId = snapshot?.repositoryId;

  return architectureTemplateCatalogSchema.parse(
    templates.map((template) => ({
      ...template,
      installed:
        snapshot !== undefined &&
        repositoryId !== undefined &&
        template.components.every((component) => {
          const entityId = templateComponentEntityId(
            repositoryId,
            template.id,
            component.id,
          );
          const expectedEvidence = templateComponentEvidence(
            repositoryId,
            template.id,
            component.id,
            template.version,
            component.description,
          );
          const entity = snapshot.entities.find(
            (candidate) => candidate.id === entityId,
          );
          const evidence = snapshot.evidence.find(
            (candidate) => candidate.id === expectedEvidence.id,
          );
          return (
            entity?.kind === "component" &&
            entity.state === "intended" &&
            entity.name === component.name &&
            entity.evidenceIds.includes(expectedEvidence.id) &&
            evidence?.origin === expectedEvidence.origin &&
            evidence.description === expectedEvidence.description
          );
        }),
    })),
  );
}

export function findArchitectureTemplate(
  templateId: string,
): CatalogTemplate | undefined {
  return templates.find((template) => template.id === templateId);
}

export function templateComponentEntityId(
  repositoryId: string,
  templateId: string,
  componentId: string,
): string {
  return stableUuid(
    `${repositoryId}:architecture-template:${templateId}:${componentId}`,
  );
}

export function templateComponentEvidence(
  repositoryId: string,
  templateId: string,
  componentId: string,
  version: string,
  description: string,
): { id: string; origin: "imported"; description: string } {
  return {
    id: stableUuid(
      `${repositoryId}:architecture-template-evidence:${templateId}:${componentId}`,
    ),
    origin: "imported",
    description: `Bundled architecture template ${templateId} v${version}: ${description}`,
  };
}

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
