/**
 * @hc/learning: engine-service interface, move classification, game ingestion and opening statistics.
 *
 * Milestone 2 scope: interfaces and pure, deterministic helpers only. No engine binary, no network, no storage,
 * no machine learning. Nothing in this package may change the rules in @hc/shared (docs/ENGINE_AGENT.md).
 */
export * from './engineService.js';
export * from './moveClassification.js';
export * from './ingest.js';
export * from './openingLearning.js';
