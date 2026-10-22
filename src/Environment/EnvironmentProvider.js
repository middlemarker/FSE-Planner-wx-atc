import React from 'react';
import { setLiveSnapshot } from './liveSnapshot.mjs';

const Context = React.createContext(null);
const configuredApi = process.env.REACT_APP_ENVIRONMENT_API_URL;
const API = (configuredApi || (process.env.NODE_ENV === 'development'
  ? 'http://127.0.0.1:8787/api/environment/v1'
  : '/api/environment/v1')).replace(/\/$/, '');
export const ENVIRONMENT_API = API;
export function EnvironmentProvider({ children }) {
  const [snapshot, setSnapshot] = React.useState({ vatsim: null, weather: null, airspace: null });
  const [errors, setErrors] = React.useState({});
  const [loading, setLoading] = React.useState(false);
  const [now, setNow] = React.useState(Date.now());
  const [demand, setDemand] = React.useState(0);
  const [options, setOptions] = React.useState({ weatherSource: 'auto', refreshIntervalSec: 0 });
  const snapshotRef = React.useRef(snapshot), optionsRef = React.useRef(options), pending = React.useRef(null), abort = React.useRef(null);
  const mounted = React.useRef(true);
  React.useEffect(() => { optionsRef.current = options; }, [options]);
  const refresh = React.useCallback(async () => {
    if (pending.current) return pending.current;
    const controller = new AbortController(); abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 90000);
    setLoading(true);
    const weatherSource = optionsRef.current.weatherSource || 'auto';
    const paths = { vatsim: '/vatsim', weather: `/weather/snapshot?source=${encodeURIComponent(weatherSource)}`, airspace: '/boundaries' };
    pending.current = (async () => {
      const next = { ...snapshotRef.current }, failures = {};
      await Promise.all(Object.entries(paths).map(async ([key, path]) => {
        if (key === 'airspace' && next.airspace && Date.now() - Date.parse(next.airspace.fetchedAt) < 86400000) return;
        try {
          const response = await fetch(API + path, { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (data.schemaVersion !== 1) throw new Error('Unsupported data format');
          if (key === 'vatsim' && !Array.isArray(data.controllers)) throw new Error('Invalid controllers');
          if (key === 'weather' && !data.observations) throw new Error('Invalid weather observations');
          if (key === 'airspace' && !Array.isArray(data.features)) throw new Error('Invalid boundaries');
          next[key] = data;
        } catch (error) { failures[key] = `${key}: ${error.name === 'AbortError' ? 'timed out' : error.message}`; }
      }));
      if (mounted.current) {
        snapshotRef.current = next; setSnapshot(next); setErrors(failures); setNow(Date.now());
      }
      return next;
    })().finally(() => {
      clearTimeout(timeout); pending.current = null;
      if (mounted.current) setLoading(false);
    });
    return pending.current;
  }, []);
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; abort.current?.abort(); };
  }, []);
  React.useEffect(() => {
    if (!demand) return;
    refresh();
  }, [demand, refresh]);
  const subscribe = React.useCallback(() => {
    setDemand(n => n + 1);
    return () => setDemand(n => Math.max(0, n - 1));
  }, []);
  const configure = React.useCallback(next => setOptions(current => {
    const merged = { ...current, ...(next || {}) };
    optionsRef.current = merged;
    return Object.keys(merged).every(key => merged[key] === current[key]) ? current : merged;
  }), []);
  React.useEffect(() => { setLiveSnapshot(snapshot); }, [snapshot]);
  const value = React.useMemo(() => ({ snapshot, errors, loading, now, options, refresh, subscribe, configure }), [snapshot, errors, loading, now, options, refresh, subscribe, configure]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useEnvironment(enabled = false, options = null) {
  const value = React.useContext(Context);
  const subscribe = value?.subscribe;
  const configure = value?.configure;
  React.useEffect(() => { if (enabled && configure && options) configure(options); }, [enabled, configure, options]);
  React.useEffect(() => enabled && subscribe ? subscribe() : undefined, [enabled, subscribe]);
  return value;
}
