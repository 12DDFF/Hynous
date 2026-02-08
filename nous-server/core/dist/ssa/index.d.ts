import { z } from 'zod';
import { GraphMetrics, ScoredNode, RankedNode, ScoreBreakdown } from '../params/index.js';

/**
 * @module @nous/core/ssa
 * @description Seeded Spreading Activation retrieval algorithm
 * @version 1.0.0
 * @spec Brainstorms/Specs/Phase-3-Retrieval-Core/storm-005
 * @storm Brainstorms/Infrastructure/storm-005-retrieval-algorithm
 *
 * This module implements storm-005: SSA Retrieval Algorithm.
 *
 * Algorithm flow:
 * 0. Parse filters → 1. Embed queries → 2. Hybrid seeding →
 * 3. Spreading activation → 4. Reranking → 5. Build result
 *
 * Key integrations:
 * - storm-016: Embedding thresholds (SSA_SEED_THRESHOLD, DENSE_WEIGHT, BM25_WEIGHT)
 * - storm-028: SSA_PARAMS, SSA_EDGE_WEIGHTS, rerankCandidates()
 */

/**
 * Serendipity levels for unexpected connection discovery.
 */
declare const SERENDIPITY_LEVELS: readonly ["off", "low", "medium", "high"];
type SerendipityLevel = (typeof SERENDIPITY_LEVELS)[number];
/**
 * Query combination strategies for multi-query.
 */
declare const QUERY_COMBINATION_STRATEGIES: readonly ["average", "max_pooling"];
type QueryCombinationStrategy = (typeof QUERY_COMBINATION_STRATEGIES)[number];
/**
 * Serendipity thresholds per level.
 */
declare const SERENDIPITY_THRESHOLDS: Record<SerendipityLevel, {
    minGraph: number;
    maxSim: number;
    count: number;
}>;
/**
 * Date range filter.
 */
interface DateRangeFilter {
    after?: string;
    before?: string;
}
declare const DateRangeFilterSchema: z.ZodEffects<z.ZodObject<{
    after: z.ZodOptional<z.ZodString>;
    before: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    before?: string | undefined;
    after?: string | undefined;
}, {
    before?: string | undefined;
    after?: string | undefined;
}>, {
    before?: string | undefined;
    after?: string | undefined;
}, {
    before?: string | undefined;
    after?: string | undefined;
}>;
/**
 * Last accessed filter.
 */
interface LastAccessedFilter {
    within_days: number;
}
declare const LastAccessedFilterSchema: z.ZodObject<{
    within_days: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    within_days: number;
}, {
    within_days: number;
}>;
/**
 * Search filters for SSA.
 */
interface SSASearchFilters {
    date_range?: DateRangeFilter;
    last_accessed?: LastAccessedFilter;
    types?: string[];
    exclude_types?: string[];
    clusters?: string[];
    tags?: string[];
    tags_any?: string[];
    exclude_tags?: string[];
    relationships?: string[];
    connected_to?: string;
    within_hops?: number;
}
declare const SSASearchFiltersSchema: z.ZodObject<{
    date_range: z.ZodOptional<z.ZodEffects<z.ZodObject<{
        after: z.ZodOptional<z.ZodString>;
        before: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        before?: string | undefined;
        after?: string | undefined;
    }, {
        before?: string | undefined;
        after?: string | undefined;
    }>, {
        before?: string | undefined;
        after?: string | undefined;
    }, {
        before?: string | undefined;
        after?: string | undefined;
    }>>;
    last_accessed: z.ZodOptional<z.ZodObject<{
        within_days: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        within_days: number;
    }, {
        within_days: number;
    }>>;
    types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    exclude_types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    clusters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    tags_any: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    exclude_tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    relationships: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    connected_to: z.ZodOptional<z.ZodString>;
    within_hops: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    last_accessed?: {
        within_days: number;
    } | undefined;
    tags?: string[] | undefined;
    date_range?: {
        before?: string | undefined;
        after?: string | undefined;
    } | undefined;
    types?: string[] | undefined;
    exclude_types?: string[] | undefined;
    clusters?: string[] | undefined;
    tags_any?: string[] | undefined;
    exclude_tags?: string[] | undefined;
    relationships?: string[] | undefined;
    connected_to?: string | undefined;
    within_hops?: number | undefined;
}, {
    last_accessed?: {
        within_days: number;
    } | undefined;
    tags?: string[] | undefined;
    date_range?: {
        before?: string | undefined;
        after?: string | undefined;
    } | undefined;
    types?: string[] | undefined;
    exclude_types?: string[] | undefined;
    clusters?: string[] | undefined;
    tags_any?: string[] | undefined;
    exclude_tags?: string[] | undefined;
    relationships?: string[] | undefined;
    connected_to?: string | undefined;
    within_hops?: number | undefined;
}>;
/**
 * Search request for SSA.
 */
interface SearchRequest {
    query?: string;
    queries?: string[];
    filters?: SSASearchFilters;
    serendipity_level?: SerendipityLevel;
    query_combination?: QueryCombinationStrategy;
    limit?: number;
    include_connections?: boolean;
}
declare const SearchRequestSchema: z.ZodEffects<z.ZodObject<{
    query: z.ZodOptional<z.ZodString>;
    queries: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    filters: z.ZodOptional<z.ZodObject<{
        date_range: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            after: z.ZodOptional<z.ZodString>;
            before: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            before?: string | undefined;
            after?: string | undefined;
        }, {
            before?: string | undefined;
            after?: string | undefined;
        }>, {
            before?: string | undefined;
            after?: string | undefined;
        }, {
            before?: string | undefined;
            after?: string | undefined;
        }>>;
        last_accessed: z.ZodOptional<z.ZodObject<{
            within_days: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            within_days: number;
        }, {
            within_days: number;
        }>>;
        types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude_types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        clusters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags_any: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude_tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        relationships: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        connected_to: z.ZodOptional<z.ZodString>;
        within_hops: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    }, {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    }>>;
    serendipity_level: z.ZodOptional<z.ZodEnum<["off", "low", "medium", "high"]>>;
    query_combination: z.ZodOptional<z.ZodEnum<["average", "max_pooling"]>>;
    limit: z.ZodOptional<z.ZodNumber>;
    include_connections: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    query?: string | undefined;
    limit?: number | undefined;
    filters?: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    } | undefined;
    queries?: string[] | undefined;
    serendipity_level?: "medium" | "high" | "low" | "off" | undefined;
    query_combination?: "average" | "max_pooling" | undefined;
    include_connections?: boolean | undefined;
}, {
    query?: string | undefined;
    limit?: number | undefined;
    filters?: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    } | undefined;
    queries?: string[] | undefined;
    serendipity_level?: "medium" | "high" | "low" | "off" | undefined;
    query_combination?: "average" | "max_pooling" | undefined;
    include_connections?: boolean | undefined;
}>, {
    query?: string | undefined;
    limit?: number | undefined;
    filters?: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    } | undefined;
    queries?: string[] | undefined;
    serendipity_level?: "medium" | "high" | "low" | "off" | undefined;
    query_combination?: "average" | "max_pooling" | undefined;
    include_connections?: boolean | undefined;
}, {
    query?: string | undefined;
    limit?: number | undefined;
    filters?: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    } | undefined;
    queries?: string[] | undefined;
    serendipity_level?: "medium" | "high" | "low" | "off" | undefined;
    query_combination?: "average" | "max_pooling" | undefined;
    include_connections?: boolean | undefined;
}>;
/**
 * Score breakdown for a ranked node.
 */
interface SSAScoreBreakdown {
    semantic: number;
    keyword: number;
    graph: number;
    recency: number;
    authority: number;
    affinity: number;
}
declare const SSAScoreBreakdownSchema: z.ZodObject<{
    semantic: z.ZodNumber;
    keyword: z.ZodNumber;
    graph: z.ZodNumber;
    recency: z.ZodNumber;
    authority: z.ZodNumber;
    affinity: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}, {
    semantic: number;
    graph: number;
    keyword: number;
    recency: number;
    authority: number;
    affinity: number;
}>;
/**
 * Ranking reason explaining why a node was ranked.
 */
interface RankingReason {
    primary_signal: keyof SSAScoreBreakdown;
    explanation: string;
    score_breakdown: SSAScoreBreakdown;
}
declare const RankingReasonSchema: z.ZodObject<{
    primary_signal: z.ZodEnum<["semantic", "keyword", "graph", "recency", "authority", "affinity"]>;
    explanation: z.ZodString;
    score_breakdown: z.ZodObject<{
        semantic: z.ZodNumber;
        keyword: z.ZodNumber;
        graph: z.ZodNumber;
        recency: z.ZodNumber;
        authority: z.ZodNumber;
        affinity: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        semantic: number;
        graph: number;
        keyword: number;
        recency: number;
        authority: number;
        affinity: number;
    }, {
        semantic: number;
        graph: number;
        keyword: number;
        recency: number;
        authority: number;
        affinity: number;
    }>;
}, "strip", z.ZodTypeAny, {
    explanation: string;
    primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
    score_breakdown: {
        semantic: number;
        graph: number;
        keyword: number;
        recency: number;
        authority: number;
        affinity: number;
    };
}, {
    explanation: string;
    primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
    score_breakdown: {
        semantic: number;
        graph: number;
        keyword: number;
        recency: number;
        authority: number;
        affinity: number;
    };
}>;
/**
 * Ranked node in search results.
 */
interface SSARankedNode {
    node_id: string;
    score: number;
    ranking_reason: RankingReason;
}
declare const SSARankedNodeSchema: z.ZodObject<{
    node_id: z.ZodString;
    score: z.ZodNumber;
    ranking_reason: z.ZodObject<{
        primary_signal: z.ZodEnum<["semantic", "keyword", "graph", "recency", "authority", "affinity"]>;
        explanation: z.ZodString;
        score_breakdown: z.ZodObject<{
            semantic: z.ZodNumber;
            keyword: z.ZodNumber;
            graph: z.ZodNumber;
            recency: z.ZodNumber;
            authority: z.ZodNumber;
            affinity: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        }, {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    }, {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    }>;
}, "strip", z.ZodTypeAny, {
    node_id: string;
    score: number;
    ranking_reason: {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    };
}, {
    node_id: string;
    score: number;
    ranking_reason: {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    };
}>;
/**
 * Connection between two nodes.
 */
interface NodeConnection {
    source_id: string;
    target_id: string;
    edge_type: string;
    weight: number;
}
declare const NodeConnectionSchema: z.ZodObject<{
    source_id: z.ZodString;
    target_id: z.ZodString;
    edge_type: z.ZodString;
    weight: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    weight: number;
    source_id: string;
    target_id: string;
    edge_type: string;
}, {
    weight: number;
    source_id: string;
    target_id: string;
    edge_type: string;
}>;
/**
 * Map of connections between activated nodes.
 */
interface ConnectionMap {
    connections: NodeConnection[];
    node_count: number;
    edge_count: number;
}
declare const ConnectionMapSchema: z.ZodObject<{
    connections: z.ZodArray<z.ZodObject<{
        source_id: z.ZodString;
        target_id: z.ZodString;
        edge_type: z.ZodString;
        weight: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        weight: number;
        source_id: string;
        target_id: string;
        edge_type: string;
    }, {
        weight: number;
        source_id: string;
        target_id: string;
        edge_type: string;
    }>, "many">;
    node_count: z.ZodNumber;
    edge_count: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    node_count: number;
    connections: {
        weight: number;
        source_id: string;
        target_id: string;
        edge_type: string;
    }[];
    edge_count: number;
}, {
    node_count: number;
    connections: {
        weight: number;
        source_id: string;
        target_id: string;
        edge_type: string;
    }[];
    edge_count: number;
}>;
/**
 * Serendipity candidate - unexpected but connected node.
 */
interface SerendipityCandidate {
    node_id: string;
    semantic_score: number;
    graph_score: number;
    connection_path: string[];
    explanation: string;
}
declare const SerendipityCandidateSchema: z.ZodObject<{
    node_id: z.ZodString;
    semantic_score: z.ZodNumber;
    graph_score: z.ZodNumber;
    connection_path: z.ZodArray<z.ZodString, "many">;
    explanation: z.ZodString;
}, "strip", z.ZodTypeAny, {
    node_id: string;
    semantic_score: number;
    graph_score: number;
    explanation: string;
    connection_path: string[];
}, {
    node_id: string;
    semantic_score: number;
    graph_score: number;
    explanation: string;
    connection_path: string[];
}>;
/**
 * Execution metrics for performance tracking.
 */
interface ExecutionMetrics {
    total_ms: number;
    parse_filters_ms: number;
    embed_queries_ms: number;
    hybrid_seeding_ms: number;
    spreading_ms: number;
    reranking_ms: number;
    seeds_found: number;
    nodes_activated: number;
    nodes_returned: number;
}
declare const ExecutionMetricsSchema: z.ZodObject<{
    total_ms: z.ZodNumber;
    parse_filters_ms: z.ZodNumber;
    embed_queries_ms: z.ZodNumber;
    hybrid_seeding_ms: z.ZodNumber;
    spreading_ms: z.ZodNumber;
    reranking_ms: z.ZodNumber;
    seeds_found: z.ZodNumber;
    nodes_activated: z.ZodNumber;
    nodes_returned: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    total_ms: number;
    parse_filters_ms: number;
    embed_queries_ms: number;
    hybrid_seeding_ms: number;
    spreading_ms: number;
    reranking_ms: number;
    seeds_found: number;
    nodes_activated: number;
    nodes_returned: number;
}, {
    total_ms: number;
    parse_filters_ms: number;
    embed_queries_ms: number;
    hybrid_seeding_ms: number;
    spreading_ms: number;
    reranking_ms: number;
    seeds_found: number;
    nodes_activated: number;
    nodes_returned: number;
}>;
/**
 * Search response from SSA.
 */
interface SearchResponse {
    results: SSARankedNode[];
    filters_applied: SSASearchFilters;
    total_candidates: number;
    execution_time_ms: number;
    metrics: ExecutionMetrics;
}
declare const SearchResponseSchema: z.ZodObject<{
    results: z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        score: z.ZodNumber;
        ranking_reason: z.ZodObject<{
            primary_signal: z.ZodEnum<["semantic", "keyword", "graph", "recency", "authority", "affinity"]>;
            explanation: z.ZodString;
            score_breakdown: z.ZodObject<{
                semantic: z.ZodNumber;
                keyword: z.ZodNumber;
                graph: z.ZodNumber;
                recency: z.ZodNumber;
                authority: z.ZodNumber;
                affinity: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            }, {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        }, {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        }>;
    }, "strip", z.ZodTypeAny, {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }, {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }>, "many">;
    filters_applied: z.ZodObject<{
        date_range: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            after: z.ZodOptional<z.ZodString>;
            before: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            before?: string | undefined;
            after?: string | undefined;
        }, {
            before?: string | undefined;
            after?: string | undefined;
        }>, {
            before?: string | undefined;
            after?: string | undefined;
        }, {
            before?: string | undefined;
            after?: string | undefined;
        }>>;
        last_accessed: z.ZodOptional<z.ZodObject<{
            within_days: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            within_days: number;
        }, {
            within_days: number;
        }>>;
        types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude_types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        clusters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags_any: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude_tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        relationships: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        connected_to: z.ZodOptional<z.ZodString>;
        within_hops: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    }, {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    }>;
    total_candidates: z.ZodNumber;
    execution_time_ms: z.ZodNumber;
    metrics: z.ZodObject<{
        total_ms: z.ZodNumber;
        parse_filters_ms: z.ZodNumber;
        embed_queries_ms: z.ZodNumber;
        hybrid_seeding_ms: z.ZodNumber;
        spreading_ms: z.ZodNumber;
        reranking_ms: z.ZodNumber;
        seeds_found: z.ZodNumber;
        nodes_activated: z.ZodNumber;
        nodes_returned: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    }, {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    }>;
}, "strip", z.ZodTypeAny, {
    results: {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }[];
    filters_applied: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    };
    total_candidates: number;
    execution_time_ms: number;
    metrics: {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    };
}, {
    results: {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }[];
    filters_applied: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    };
    total_candidates: number;
    execution_time_ms: number;
    metrics: {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    };
}>;
/**
 * Complete SSA result for Phase 2 handoff.
 */
interface SSAResult {
    original_queries: string[];
    filters_applied: SSASearchFilters;
    relevant_nodes: SSARankedNode[];
    connection_map?: ConnectionMap;
    ranking_reasons: Record<string, RankingReason>;
    serendipity_candidates?: SerendipityCandidate[];
    metrics: ExecutionMetrics;
}
declare const SSAResultSchema: z.ZodObject<{
    original_queries: z.ZodArray<z.ZodString, "many">;
    filters_applied: z.ZodObject<{
        date_range: z.ZodOptional<z.ZodEffects<z.ZodObject<{
            after: z.ZodOptional<z.ZodString>;
            before: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            before?: string | undefined;
            after?: string | undefined;
        }, {
            before?: string | undefined;
            after?: string | undefined;
        }>, {
            before?: string | undefined;
            after?: string | undefined;
        }, {
            before?: string | undefined;
            after?: string | undefined;
        }>>;
        last_accessed: z.ZodOptional<z.ZodObject<{
            within_days: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            within_days: number;
        }, {
            within_days: number;
        }>>;
        types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude_types: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        clusters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        tags_any: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        exclude_tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        relationships: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        connected_to: z.ZodOptional<z.ZodString>;
        within_hops: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    }, {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    }>;
    relevant_nodes: z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        score: z.ZodNumber;
        ranking_reason: z.ZodObject<{
            primary_signal: z.ZodEnum<["semantic", "keyword", "graph", "recency", "authority", "affinity"]>;
            explanation: z.ZodString;
            score_breakdown: z.ZodObject<{
                semantic: z.ZodNumber;
                keyword: z.ZodNumber;
                graph: z.ZodNumber;
                recency: z.ZodNumber;
                authority: z.ZodNumber;
                affinity: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            }, {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            }>;
        }, "strip", z.ZodTypeAny, {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        }, {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        }>;
    }, "strip", z.ZodTypeAny, {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }, {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }>, "many">;
    connection_map: z.ZodOptional<z.ZodObject<{
        connections: z.ZodArray<z.ZodObject<{
            source_id: z.ZodString;
            target_id: z.ZodString;
            edge_type: z.ZodString;
            weight: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            weight: number;
            source_id: string;
            target_id: string;
            edge_type: string;
        }, {
            weight: number;
            source_id: string;
            target_id: string;
            edge_type: string;
        }>, "many">;
        node_count: z.ZodNumber;
        edge_count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        node_count: number;
        connections: {
            weight: number;
            source_id: string;
            target_id: string;
            edge_type: string;
        }[];
        edge_count: number;
    }, {
        node_count: number;
        connections: {
            weight: number;
            source_id: string;
            target_id: string;
            edge_type: string;
        }[];
        edge_count: number;
    }>>;
    ranking_reasons: z.ZodRecord<z.ZodString, z.ZodObject<{
        primary_signal: z.ZodEnum<["semantic", "keyword", "graph", "recency", "authority", "affinity"]>;
        explanation: z.ZodString;
        score_breakdown: z.ZodObject<{
            semantic: z.ZodNumber;
            keyword: z.ZodNumber;
            graph: z.ZodNumber;
            recency: z.ZodNumber;
            authority: z.ZodNumber;
            affinity: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        }, {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        }>;
    }, "strip", z.ZodTypeAny, {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    }, {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    }>>;
    serendipity_candidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        semantic_score: z.ZodNumber;
        graph_score: z.ZodNumber;
        connection_path: z.ZodArray<z.ZodString, "many">;
        explanation: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        node_id: string;
        semantic_score: number;
        graph_score: number;
        explanation: string;
        connection_path: string[];
    }, {
        node_id: string;
        semantic_score: number;
        graph_score: number;
        explanation: string;
        connection_path: string[];
    }>, "many">>;
    metrics: z.ZodObject<{
        total_ms: z.ZodNumber;
        parse_filters_ms: z.ZodNumber;
        embed_queries_ms: z.ZodNumber;
        hybrid_seeding_ms: z.ZodNumber;
        spreading_ms: z.ZodNumber;
        reranking_ms: z.ZodNumber;
        seeds_found: z.ZodNumber;
        nodes_activated: z.ZodNumber;
        nodes_returned: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    }, {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    }>;
}, "strip", z.ZodTypeAny, {
    filters_applied: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    };
    metrics: {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    };
    original_queries: string[];
    relevant_nodes: {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }[];
    ranking_reasons: Record<string, {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    }>;
    connection_map?: {
        node_count: number;
        connections: {
            weight: number;
            source_id: string;
            target_id: string;
            edge_type: string;
        }[];
        edge_count: number;
    } | undefined;
    serendipity_candidates?: {
        node_id: string;
        semantic_score: number;
        graph_score: number;
        explanation: string;
        connection_path: string[];
    }[] | undefined;
}, {
    filters_applied: {
        last_accessed?: {
            within_days: number;
        } | undefined;
        tags?: string[] | undefined;
        date_range?: {
            before?: string | undefined;
            after?: string | undefined;
        } | undefined;
        types?: string[] | undefined;
        exclude_types?: string[] | undefined;
        clusters?: string[] | undefined;
        tags_any?: string[] | undefined;
        exclude_tags?: string[] | undefined;
        relationships?: string[] | undefined;
        connected_to?: string | undefined;
        within_hops?: number | undefined;
    };
    metrics: {
        total_ms: number;
        parse_filters_ms: number;
        embed_queries_ms: number;
        hybrid_seeding_ms: number;
        spreading_ms: number;
        reranking_ms: number;
        seeds_found: number;
        nodes_activated: number;
        nodes_returned: number;
    };
    original_queries: string[];
    relevant_nodes: {
        node_id: string;
        score: number;
        ranking_reason: {
            explanation: string;
            primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
            score_breakdown: {
                semantic: number;
                graph: number;
                keyword: number;
                recency: number;
                authority: number;
                affinity: number;
            };
        };
    }[];
    ranking_reasons: Record<string, {
        explanation: string;
        primary_signal: "semantic" | "graph" | "keyword" | "recency" | "authority" | "affinity";
        score_breakdown: {
            semantic: number;
            graph: number;
            keyword: number;
            recency: number;
            authority: number;
            affinity: number;
        };
    }>;
    connection_map?: {
        node_count: number;
        connections: {
            weight: number;
            source_id: string;
            target_id: string;
            edge_type: string;
        }[];
        edge_count: number;
    } | undefined;
    serendipity_candidates?: {
        node_id: string;
        semantic_score: number;
        graph_score: number;
        explanation: string;
        connection_path: string[];
    }[] | undefined;
}>;
/**
 * SSA algorithm configuration.
 */
interface SSAConfig {
    seed_threshold: number;
    dense_weight: number;
    bm25_weight: number;
    max_seeds: number;
    initial_activation: number;
    hop_decay: number;
    min_threshold: number;
    max_hops: number;
    max_nodes: number;
    aggregation: 'sum' | 'max';
    query_combination: QueryCombinationStrategy;
    default_limit: number;
}
declare const SSAConfigSchema: z.ZodObject<{
    seed_threshold: z.ZodNumber;
    dense_weight: z.ZodNumber;
    bm25_weight: z.ZodNumber;
    max_seeds: z.ZodNumber;
    initial_activation: z.ZodNumber;
    hop_decay: z.ZodNumber;
    min_threshold: z.ZodNumber;
    max_hops: z.ZodNumber;
    max_nodes: z.ZodNumber;
    aggregation: z.ZodEnum<["sum", "max"]>;
    query_combination: z.ZodEnum<["average", "max_pooling"]>;
    default_limit: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    initial_activation: number;
    hop_decay: number;
    min_threshold: number;
    max_hops: number;
    max_nodes: number;
    aggregation: "sum" | "max";
    query_combination: "average" | "max_pooling";
    seed_threshold: number;
    dense_weight: number;
    bm25_weight: number;
    max_seeds: number;
    default_limit: number;
}, {
    initial_activation: number;
    hop_decay: number;
    min_threshold: number;
    max_hops: number;
    max_nodes: number;
    aggregation: "sum" | "max";
    query_combination: "average" | "max_pooling";
    seed_threshold: number;
    dense_weight: number;
    bm25_weight: number;
    max_seeds: number;
    default_limit: number;
}>;
/**
 * Default SSA configuration using storm-016 and storm-028 values.
 */
declare const DEFAULT_SSA_CONFIG: SSAConfig;
/**
 * Seed node from hybrid seeding.
 */
interface SeedNode {
    node_id: string;
    vector_score: number;
    bm25_score: number;
    combined_score: number;
}
declare const SeedNodeSchema: z.ZodObject<{
    node_id: z.ZodString;
    vector_score: z.ZodNumber;
    bm25_score: z.ZodNumber;
    combined_score: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    node_id: string;
    bm25_score: number;
    vector_score: number;
    combined_score: number;
}, {
    node_id: string;
    bm25_score: number;
    vector_score: number;
    combined_score: number;
}>;
/**
 * Result of hybrid seeding phase.
 */
interface SeedingResult {
    seeds: SeedNode[];
    vector_candidates: number;
    bm25_candidates: number;
    combined_candidates: number;
    execution_ms: number;
}
declare const SeedingResultSchema: z.ZodObject<{
    seeds: z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        vector_score: z.ZodNumber;
        bm25_score: z.ZodNumber;
        combined_score: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        node_id: string;
        bm25_score: number;
        vector_score: number;
        combined_score: number;
    }, {
        node_id: string;
        bm25_score: number;
        vector_score: number;
        combined_score: number;
    }>, "many">;
    vector_candidates: z.ZodNumber;
    bm25_candidates: z.ZodNumber;
    combined_candidates: z.ZodNumber;
    execution_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    seeds: {
        node_id: string;
        bm25_score: number;
        vector_score: number;
        combined_score: number;
    }[];
    vector_candidates: number;
    bm25_candidates: number;
    combined_candidates: number;
    execution_ms: number;
}, {
    seeds: {
        node_id: string;
        bm25_score: number;
        vector_score: number;
        combined_score: number;
    }[];
    vector_candidates: number;
    bm25_candidates: number;
    combined_candidates: number;
    execution_ms: number;
}>;
/**
 * Activated node during spreading.
 */
interface SSAActivatedNode {
    node_id: string;
    activation: number;
    hop_distance: number;
    activation_path: string[];
    is_seed: boolean;
    vector_score: number;
    bm25_score: number;
}
declare const SSAActivatedNodeSchema: z.ZodObject<{
    node_id: z.ZodString;
    activation: z.ZodNumber;
    hop_distance: z.ZodNumber;
    activation_path: z.ZodArray<z.ZodString, "many">;
    is_seed: z.ZodBoolean;
    vector_score: z.ZodNumber;
    bm25_score: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    node_id: string;
    bm25_score: number;
    activation: number;
    vector_score: number;
    hop_distance: number;
    activation_path: string[];
    is_seed: boolean;
}, {
    node_id: string;
    bm25_score: number;
    activation: number;
    vector_score: number;
    hop_distance: number;
    activation_path: string[];
    is_seed: boolean;
}>;
/**
 * Result of spreading activation phase.
 */
interface SpreadingResult {
    activated: SSAActivatedNode[];
    hops_completed: number;
    nodes_visited: number;
    edges_traversed: number;
    terminated_reason: 'max_hops' | 'max_nodes' | 'no_spread' | 'threshold';
    execution_ms: number;
}
declare const SpreadingResultSchema: z.ZodObject<{
    activated: z.ZodArray<z.ZodObject<{
        node_id: z.ZodString;
        activation: z.ZodNumber;
        hop_distance: z.ZodNumber;
        activation_path: z.ZodArray<z.ZodString, "many">;
        is_seed: z.ZodBoolean;
        vector_score: z.ZodNumber;
        bm25_score: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        node_id: string;
        bm25_score: number;
        activation: number;
        vector_score: number;
        hop_distance: number;
        activation_path: string[];
        is_seed: boolean;
    }, {
        node_id: string;
        bm25_score: number;
        activation: number;
        vector_score: number;
        hop_distance: number;
        activation_path: string[];
        is_seed: boolean;
    }>, "many">;
    hops_completed: z.ZodNumber;
    nodes_visited: z.ZodNumber;
    edges_traversed: z.ZodNumber;
    terminated_reason: z.ZodEnum<["max_hops", "max_nodes", "no_spread", "threshold"]>;
    execution_ms: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    execution_ms: number;
    activated: {
        node_id: string;
        bm25_score: number;
        activation: number;
        vector_score: number;
        hop_distance: number;
        activation_path: string[];
        is_seed: boolean;
    }[];
    hops_completed: number;
    nodes_visited: number;
    edges_traversed: number;
    terminated_reason: "max_hops" | "max_nodes" | "no_spread" | "threshold";
}, {
    execution_ms: number;
    activated: {
        node_id: string;
        bm25_score: number;
        activation: number;
        vector_score: number;
        hop_distance: number;
        activation_path: string[];
        is_seed: boolean;
    }[];
    hops_completed: number;
    nodes_visited: number;
    edges_traversed: number;
    terminated_reason: "max_hops" | "max_nodes" | "no_spread" | "threshold";
}>;
/**
 * Minimal node info for filter evaluation.
 */
interface FilterNodeInput {
    id: string;
    type: string;
    created_at: string;
    last_accessed: string;
    clusters?: string[];
    tags?: string[];
}
declare const FilterNodeInputSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    created_at: z.ZodString;
    last_accessed: z.ZodString;
    clusters: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    type: string;
    id: string;
    created_at: string;
    last_accessed: string;
    tags?: string[] | undefined;
    clusters?: string[] | undefined;
}, {
    type: string;
    id: string;
    created_at: string;
    last_accessed: string;
    tags?: string[] | undefined;
    clusters?: string[] | undefined;
}>;
/**
 * Minimal edge info for filter evaluation.
 */
interface FilterEdgeInput {
    id: string;
    source_id: string;
    target_id: string;
    edge_type: string;
}
declare const FilterEdgeInputSchema: z.ZodObject<{
    id: z.ZodString;
    source_id: z.ZodString;
    target_id: z.ZodString;
    edge_type: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    source_id: string;
    target_id: string;
    edge_type: string;
}, {
    id: string;
    source_id: string;
    target_id: string;
    edge_type: string;
}>;
/**
 * Filter predicate result.
 */
interface FilterPredicate {
    filters: SSASearchFilters;
    evaluateNode: (node: FilterNodeInput) => boolean;
    evaluateEdge: (edge: FilterEdgeInput) => boolean;
}
/**
 * Node data for reranking.
 */
interface RerankingNodeData {
    id: string;
    last_accessed: Date;
    created_at: Date;
    access_count: number;
    inbound_edge_count: number;
}
/**
 * Neighbor result from graph query.
 */
interface NeighborResult {
    node: FilterNodeInput;
    edge: FilterEdgeInput;
    weight: number;
}
/**
 * Vector search result.
 */
interface SSAVectorSearchResult {
    nodeId: string;
    score: number;
}
/**
 * BM25 search result.
 */
interface BM25SearchResult {
    nodeId: string;
    score: number;
}
/**
 * Graph context for SSA execution.
 */
interface SSAGraphContext {
    getNode: (id: string) => Promise<FilterNodeInput | null>;
    getNeighbors: (nodeId: string) => Promise<NeighborResult[]>;
    vectorSearch: (embedding: Float32Array, limit: number) => Promise<SSAVectorSearchResult[]>;
    bm25Search: (terms: string[], limit: number) => Promise<BM25SearchResult[]>;
    getGraphMetrics: () => Promise<GraphMetrics>;
    getNodeForReranking: (id: string) => Promise<RerankingNodeData | null>;
}
/**
 * Embed function for query embedding.
 */
type EmbedFunction = (queries: string[]) => Promise<Float32Array>;
/**
 * Options for executeSSA.
 */
interface ExecuteSSAOptions {
    request: SearchRequest;
    context: SSAGraphContext;
    embed: EmbedFunction;
    config?: Partial<SSAConfig>;
}
/**
 * Build filter predicate from search filters.
 */
declare function buildFilterPredicate(filters: SSASearchFilters): FilterPredicate;
/**
 * Parse and validate search filters.
 */
declare function parseFilters(filters: unknown): {
    success: true;
    data: SSASearchFilters;
} | {
    success: false;
    error: string;
};
/**
 * Perform hybrid seeding with vector and BM25.
 */
declare function hybridSeed(queryEmbedding: Float32Array, queryTerms: string[], context: SSAGraphContext, predicate: FilterPredicate, config: SSAConfig): Promise<SeedingResult>;
/**
 * Get edge weight for SSA from edge type.
 */
declare function getSSAEdgeWeight(edgeType: string): number;
/**
 * Run spreading activation from seed nodes.
 */
declare function spreadActivation(seeds: SeedNode[], context: SSAGraphContext, predicate: FilterPredicate, config: SSAConfig): Promise<SpreadingResult>;
/**
 * Convert activated nodes to scored nodes for reranking.
 */
declare function buildScoredNodes(activated: SSAActivatedNode[], context: SSAGraphContext): Promise<ScoredNode[]>;
/**
 * Convert ranked nodes to SSA format.
 */
declare function convertToSSARankedNodes(ranked: RankedNode[]): SSARankedNode[];
/**
 * Identify serendipity candidates.
 */
declare function identifySerendipity(activated: SSAActivatedNode[], level: SerendipityLevel): SerendipityCandidate[];
/**
 * Build connection map from activated nodes.
 */
declare function buildConnectionMap(activated: SSAActivatedNode[], context: SSAGraphContext, predicate: FilterPredicate): Promise<ConnectionMap>;
/**
 * Get normalized queries from request.
 */
declare function getNormalizedQueries(request: SearchRequest): string[];
/**
 * Extract query terms for BM25.
 */
declare function extractQueryTerms(queries: string[]): string[];
/**
 * Merge config with defaults.
 */
declare function mergeSSAConfig(partial?: Partial<SSAConfig>): SSAConfig;
/**
 * Create empty execution metrics.
 */
declare function createEmptyMetrics(): ExecutionMetrics;
/**
 * Generate explanation for primary signal.
 */
declare function generateExplanation(primary: keyof ScoreBreakdown, breakdown: ScoreBreakdown): string;
/**
 * Get serendipity threshold for a level.
 */
declare function getSerendipityThreshold(level: SerendipityLevel): {
    minGraph: number;
    maxSim: number;
    count: number;
};
declare function validateSearchRequest(request: unknown): request is SearchRequest;
declare function validateSearchFilters(filters: unknown): filters is SSASearchFilters;
declare function validateSSAConfig(config: unknown): config is SSAConfig;
declare function validateSSAResult(result: unknown): result is SSAResult;
/**
 * Safely parse search request.
 */
declare function parseSearchRequest(request: unknown): {
    success: true;
    data: SearchRequest;
} | {
    success: false;
    error: string;
};
/**
 * Execute SSA retrieval algorithm.
 * Main entry point for Phase 1 retrieval.
 */
declare function executeSSA(options: ExecuteSSAOptions): Promise<SSAResult>;
/**
 * Create a search response from SSA result.
 */
declare function createSearchResponse(result: SSAResult): SearchResponse;

export { type BM25SearchResult, type ConnectionMap, ConnectionMapSchema, DEFAULT_SSA_CONFIG, type DateRangeFilter, DateRangeFilterSchema, type EmbedFunction, type ExecuteSSAOptions, type ExecutionMetrics, ExecutionMetricsSchema, type FilterEdgeInput, FilterEdgeInputSchema, type FilterNodeInput, FilterNodeInputSchema, type FilterPredicate, type LastAccessedFilter, LastAccessedFilterSchema, type NeighborResult, type NodeConnection, NodeConnectionSchema, QUERY_COMBINATION_STRATEGIES, type QueryCombinationStrategy, type RankingReason, RankingReasonSchema, type RerankingNodeData, SERENDIPITY_LEVELS, SERENDIPITY_THRESHOLDS, type SSAActivatedNode, SSAActivatedNodeSchema, type SSAConfig, SSAConfigSchema, type SSAGraphContext, type SSARankedNode, SSARankedNodeSchema, type SSAResult, SSAResultSchema, type SSAScoreBreakdown, SSAScoreBreakdownSchema, type SSASearchFilters, SSASearchFiltersSchema, type SSAVectorSearchResult, type SearchRequest, SearchRequestSchema, type SearchResponse, SearchResponseSchema, type SeedNode, SeedNodeSchema, type SeedingResult, SeedingResultSchema, type SerendipityCandidate, SerendipityCandidateSchema, type SerendipityLevel, type SpreadingResult, SpreadingResultSchema, buildConnectionMap, buildFilterPredicate, buildScoredNodes, convertToSSARankedNodes, createEmptyMetrics, createSearchResponse, executeSSA, extractQueryTerms, generateExplanation, getNormalizedQueries, getSSAEdgeWeight, getSerendipityThreshold, hybridSeed, identifySerendipity, mergeSSAConfig, parseFilters, parseSearchRequest, spreadActivation, validateSSAConfig, validateSSAResult, validateSearchFilters, validateSearchRequest };
