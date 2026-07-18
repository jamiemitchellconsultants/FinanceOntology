/**
 * Gap Analyzer — automatically detects gaps and uncertainties in the ontology.
 *
 * Runs a suite of detection rules and produces Gap records for:
 * - Concepts without system mappings
 * - Concepts with low confidence
 * - Isolated concepts (no relationships)
 * - Systems that have never been ingested
 * - Concepts in multiple systems with no equivalence relationship
 */

import type { Gap, GapType } from '../ontology/types.js';
import type { OntologyManager } from '../ontology/manager.js';

export interface AnalysisReport {
  runsAt: string;
  newGapsCreated: number;
  existingGapsUpdated: number;
  gapsByType: Partial<Record<GapType, number>>;
  summary: string;
}

export class GapAnalyzer {
  private manager: OntologyManager;

  constructor(manager: OntologyManager) {
    this.manager = manager;
  }

  /**
   * Run a full gap analysis pass and persist any new gaps found.
   */
  analyze(): AnalysisReport {
    const report: AnalysisReport = {
      runsAt: new Date().toISOString(),
      newGapsCreated: 0,
      existingGapsUpdated: 0,
      gapsByType: {},
    } as AnalysisReport;

    const rules: Array<() => Gap[]> = [
      () => this.detectMissingMappings(),
      () => this.detectLowConfidenceConcepts(),
      () => this.detectIsolatedConcepts(),
      () => this.detectInactiveSystems(),
      () => this.detectAmbiguousMappings(),
      () => this.detectMissingKeyFinanceConcepts(),
    ];

    const detectedGaps: Gap[] = [];
    for (const rule of rules) {
      detectedGaps.push(...rule());
    }

    for (const gap of detectedGaps) {
      const existing = this.findExistingGap(gap);
      if (!existing) {
        this.manager.addGap({
          type: gap.type,
          description: gap.description,
          affectedConceptIds: gap.affectedConceptIds,
          severity: gap.severity,
          status: 'open',
          source: gap.source ?? 'gap_analyzer',
        });
        report.newGapsCreated++;
        report.gapsByType[gap.type] = (report.gapsByType[gap.type] ?? 0) + 1;
      }
    }

    this.manager.save();

    const totalOpen = this.manager.listGaps('open').length;
    report.summary = [
      `Gap analysis complete.`,
      `New gaps found: ${report.newGapsCreated}.`,
      `Total open gaps: ${totalOpen}.`,
    ].join(' ');

    return report;
  }

  // ─── Detection Rules ───────────────────────────────────────────────────────

  /** Concepts that exist but have no system mappings */
  private detectMissingMappings(): Gap[] {
    const concepts = this.manager.listConcepts();
    const gaps: Gap[] = [];

    for (const concept of concepts) {
      if (concept.type === 'attribute') continue; // Attributes don't need system mappings
      if (concept.systemMappings.length === 0) {
        gaps.push({
          id: '',
          type: 'missing_mapping',
          description: `Concept "${concept.name}" (${concept.type}) has no system mappings — agents cannot retrieve this data`,
          affectedConceptIds: [concept.id],
          severity: concept.type === 'entity' ? 'high' : 'medium',
          status: 'open',
          source: 'gap_analyzer:missing_mappings',
          discoveredAt: '',
        });
      }
    }
    return gaps;
  }

  /** Concepts with confidence below 0.5 */
  private detectLowConfidenceConcepts(): Gap[] {
    const concepts = this.manager.listConcepts({ minConfidence: 0 });
    const gaps: Gap[] = [];

    for (const concept of concepts) {
      if (concept.confidence < 0.5) {
        gaps.push({
          id: '',
          type: 'incomplete_definition',
          description: `Concept "${concept.name}" has low confidence (${(concept.confidence * 100).toFixed(0)}%) — definition may be incomplete`,
          affectedConceptIds: [concept.id],
          severity: concept.confidence < 0.25 ? 'high' : 'medium',
          status: 'open',
          source: 'gap_analyzer:low_confidence',
          discoveredAt: '',
        });
      }
    }
    return gaps;
  }

  /** Concepts with no relationships (isolated nodes) */
  private detectIsolatedConcepts(): Gap[] {
    const concepts = this.manager.listConcepts();
    const gaps: Gap[] = [];

    for (const concept of concepts) {
      if (concept.type === 'attribute') continue;
      const rels = this.manager.listRelationships({ conceptId: concept.id });
      if (rels.length === 0) {
        gaps.push({
          id: '',
          type: 'missing_relationship',
          description: `Concept "${concept.name}" is isolated — no relationships defined`,
          affectedConceptIds: [concept.id],
          severity: 'low',
          status: 'open',
          source: 'gap_analyzer:isolated',
          discoveredAt: '',
        });
      }
    }
    return gaps;
  }

  /** Systems that are registered but status is unknown or never ingested */
  private detectInactiveSystems(): Gap[] {
    const systems = this.manager.listSystems();
    const gaps: Gap[] = [];

    for (const system of systems) {
      if (system.status === 'unknown' || !system.lastIngestedAt) {
        gaps.push({
          id: '',
          type: 'unknown_system',
          description: `System "${system.name}" (${system.type}) has never been ingested`,
          affectedConceptIds: [],
          severity: 'medium',
          status: 'open',
          source: 'gap_analyzer:inactive_system',
          discoveredAt: '',
        });
      }
    }
    return gaps;
  }

  /** Concepts that appear in multiple systems without an equivalence relationship */
  private detectAmbiguousMappings(): Gap[] {
    const concepts = this.manager.listConcepts();
    const gaps: Gap[] = [];

    for (const concept of concepts) {
      if (concept.systemMappings.length > 1) {
        const equivalents = this.manager.listRelationships({
          conceptId: concept.id,
        }).filter((r) => r.type === 'equivalent_to');

        if (equivalents.length === 0) {
          gaps.push({
            id: '',
            type: 'ambiguous_mapping',
            description: `Concept "${concept.name}" maps to ${concept.systemMappings.length} systems but has no equivalence relationships — cross-system reconciliation is unclear`,
            affectedConceptIds: [concept.id],
            severity: 'medium',
            status: 'open',
            source: 'gap_analyzer:ambiguous_mappings',
            discoveredAt: '',
          });
        }
      }
    }
    return gaps;
  }

  /**
   * Check for key finance concepts that should always exist in a finance ontology.
   * These are the most critical concepts for a typical finance team.
   */
  private detectMissingKeyFinanceConcepts(): Gap[] {
    const requiredConcepts = [
      'General Ledger',
      'Chart of Accounts',
      'Cost Center',
      'Invoice',
      'Purchase Order',
      'Vendor',
      'Budget',
    ];

    const existing = this.manager.listConcepts();
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
    const gaps: Gap[] = [];

    for (const required of requiredConcepts) {
      if (!existingNames.has(required.toLowerCase())) {
        gaps.push({
          id: '',
          type: 'missing_concept',
          description: `Key finance concept "${required}" is missing from the ontology`,
          affectedConceptIds: [],
          severity: 'high',
          status: 'open',
          source: 'gap_analyzer:required_concepts',
          discoveredAt: '',
        });
      }
    }
    return gaps;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Check if a functionally identical gap already exists (to avoid duplicates) */
  private findExistingGap(candidate: Gap): Gap | undefined {
    return this.manager.listGaps().find(
      (g) =>
        g.status !== 'resolved' &&
        g.type === candidate.type &&
        g.description === candidate.description
    );
  }
}
