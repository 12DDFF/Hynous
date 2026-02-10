import { nanoid } from 'nanoid';

/** Generate a node ID: n_ + 12 chars */
export function nodeId(): string {
  return `n_${nanoid(12)}`;
}

/** Generate an edge ID: e_ + 12 chars */
export function edgeId(): string {
  return `e_${nanoid(12)}`;
}

/** Generate a cluster ID: cl_ + 12 chars */
export function clusterId(): string {
  return `cl_${nanoid(12)}`;
}

/** Current ISO timestamp */
export function now(): string {
  return new Date().toISOString();
}
