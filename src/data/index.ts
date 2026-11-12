/** Browser-safe barrel (the Node fetcher lives in ./fetchNode). */
export * from './loadWorld';
export { DataFormatError, decodeTable, base64ToBytes, base64ToInt16 } from './decode';
export { buildPolygonIndex, type PolygonIndex } from './spatial';
