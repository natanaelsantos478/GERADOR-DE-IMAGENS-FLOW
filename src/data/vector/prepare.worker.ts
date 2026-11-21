/** Runs the vector-map preparation of a detailed battle off the page thread (its garbage and its seconds of work stay here). */
import { prepareTacticalVector, type PrepareOptions } from './prepare';

self.onmessage = async (e: MessageEvent<{ id: number; lon: number; lat: number; o: PrepareOptions }>) => {
  const { id, lon, lat, o } = e.data;
  const nav = await prepareTacticalVector(lon, lat, o);
  (self as unknown as Worker).postMessage({ id, nav });
};
