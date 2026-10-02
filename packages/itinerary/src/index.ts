/**
 * Rumbo's itinerary engine: pure functions from a trip's fixed points,
 * flights, wishes and routed legs to a day-by-day plan, its entry
 * requirements, its purchases and its lodging totals. No I/O, no clock.
 * See docs/viajes/rumbo/.
 */
export * from './types.js';
export * from './zoned.js';
export * from './sun.js';
export * from './catalog/places.js';
export * from './catalog/corridors.js';
export * from './catalog/airports.js';
export * from './compose.js';
export * from './flights.js';
export * from './roads.js';
export * from './days.js';
export * from './entry.js';
export * from './fixtures/real-case.js';
export * from './catalog/activities.js';
export * from './catalog/events.js';
export * from './todos.js';
export * from './lodging.js';
export * from './links.js';
