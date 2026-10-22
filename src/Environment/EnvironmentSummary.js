import React from 'react';
import { Box, Typography, Button, Alert } from '@mui/material';
import { CATEGORY_COLORS, atcActive } from './defaults.mjs';
import { formatUtc } from './vatsim.mjs';
import { formatSky } from './weather.mjs';
import { createEvaluator } from './evaluate.mjs';
import { useEnvironment } from './EnvironmentProvider.js';

function skyColor(observation) {
  return CATEGORY_COLORS[observation.state === 'known' ? observation.category : 'UNKNOWN'];
}

function ConditionLine({ evaluation }) {
  const policy = evaluation.policy || {};
  const atcOn = atcActive(policy);
  const weatherOn = policy.weather && policy.weather !== 'off';
  const enrouteOn = policy.enroute && policy.enroute !== 'off';
  const parts = [
    atcOn && `ATC ${Math.round(evaluation.coverageScore)}`,
    enrouteOn && `Track ${evaluation.unknown ? 'unknown' : `${Math.round(evaluation.fraction * 100)}%`}`,
    weatherOn && `Weather ${Math.round(evaluation.weatherScore)}`,
    atcOn && weatherOn && `Score ${Math.round(evaluation.routeScore)}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <Typography variant="body2">{parts.join(' · ')}</Typography>;
}

function WeatherHints({ observations }) {
  if (!observations?.length) return null;
  return <Typography variant="body2" component="div">
    {observations.map((observation, index) => <Box component="span" key={`${observation.phase}:${observation.icao}:${index}`} sx={{ color: skyColor(observation), mr: 1.25 }}>
      {observation.phase === 'arrival' ? 'Arr' : 'Dep'} {observation.icao} {formatSky(observation)}{observation.meets === false ? ' · off target' : ''}
    </Box>)}
  </Typography>;
}

export default function EnvironmentSummary({ result, detailed = false, airports }) {
  const environmentOptions = React.useMemo(() => ({
    weatherSource: result.environment?.policy?.weatherSource,
    refreshIntervalSec: result.environment?.policy?.refreshIntervalSec,
  }), [result.environment?.policy?.weatherSource, result.environment?.policy?.refreshIntervalSec]);
  const live = useEnvironment(detailed && !!result.environment, environmentOptions);
  const [checked, setChecked] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setChecked(null), [result]);
  const e = checked || result.environment;
  if (!e) return null;
  const atcOn = atcActive(e.policy);
  const weatherOn = e.policy?.weather && e.policy.weather !== 'off';
  const enrouteOn = e.policy?.enroute && e.policy.enroute !== 'off';
  return <Box sx={{ mt: detailed ? 1 : 0.5, p: detailed ? 2 : 0 }}>
    <ConditionLine evaluation={e} />
    <WeatherHints observations={weatherOn ? e.observations : []} />
    {detailed && <>
      <Typography variant="caption" display="block">Snapshot {e.snapshotTime ? new Date(e.snapshotTime).toUTCString() : 'unavailable'}</Typography>
      {enrouteOn && <Typography variant="body2">Longest uncovered gap: {e.unknown ? 'unknown' : `${e.longestGapNm.toFixed(1)} NM`}</Typography>}
      {atcOn && [...e.departures.map(v => ({ ...v, phase: 'Departure' })), ...e.arrivals.map(v => ({ ...v, phase: 'Arrival' }))].map((v, i) =>
        <Typography key={i} variant="body2">{v.phase} {v.icao}: {v.state}{v.callsigns?.length ? ` (${v.callsigns.join(', ')})` : ''}{v.confidence === 'inferred' ? ' — inferred' : ''}{v.confidence === 'booked' ? ' — booked' : ''}{v.booking ? ` · booking ${formatUtc(v.booking.start, Date.parse(v.at || e.evaluatedAt))}–${formatUtc(v.booking.end, Date.parse(v.at || e.evaluatedAt))}` : ''}</Typography>)}
      {weatherOn && e.observations.map((v, i) => <Box key={`${v.phase}:${v.icao}:${i}`} sx={{ mt: 1 }}>
        <Typography variant="body2" sx={{ color: skyColor(v) }}>{v.phase === 'arrival' ? 'Arrival' : 'Departure'} {v.icao}: {formatSky(v)}{v.meets === false ? ` · ${v.targetReason}` : ''}</Typography>
        <Typography variant="caption" display="block">{[v.stationId, v.observedAt ? new Date(v.observedAt).toUTCString() : 'No observation', (v.clouds || []).map(cloud => `${cloud.cover}${cloud.baseFtAGL == null ? '' : ` ${cloud.baseFtAGL} ft`}`).join(', ')].filter(Boolean).join(' · ')}</Typography>
        {v.raw && <Typography variant="caption" display="block" sx={{ overflowWrap: 'anywhere' }}>{v.raw}</Typography>}
      </Box>)}
      {checked && <Alert severity={e.eligible ? 'success' : 'warning'} sx={{ mt: 1 }}>{e.eligible ? 'Still meets the selected requirements.' : e.reasons.join('; ')}</Alert>}
      <Button size="small" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const snapshot = await live.refresh(); setChecked(createEvaluator(snapshot, airports, result.environment.policy, Date.now(), { speed: result.plane?.speed || 0 }).evaluate(result.icaos, { details: true })); }
        finally { setBusy(false); }
      }}>Recheck selected route</Button>
      <Typography variant="caption" display="block">Search again to discover routes using the latest data. When a controller has a booking, coverage uses that window against cruise time to the airport.</Typography>
    </>}
  </Box>;
}
