import React from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup, TextField, MenuItem, Slider, FormControlLabel, Checkbox, Alert, Button } from '@mui/material';
import { atcActive, CATEGORY_ORDER, CLOUD_ORDER, categorySpan, cloudSpan, WEATHER_BASES, WEATHER_PRESETS, WEATHER_PROFILES, WEATHER_SOURCES, DEFAULT_WEATHER_TARGET } from '../Environment/defaults.mjs';

const buttonSx = { flex: 1, py: 0.4, fontSize: '0.75rem', lineHeight: 1.3, textTransform: 'none' };

function Modes({ value, onChange }) {
  return <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, next) => next !== null && onChange(next)} sx={{ flex: 1 }}>
    <ToggleButton value="off" sx={buttonSx}>Ignore</ToggleButton>
    <ToggleButton value="prefer" sx={buttonSx}>Prefer</ToggleButton>
    <ToggleButton value="require" sx={buttonSx}>Require</ToggleButton>
  </ToggleButtonGroup>;
}

function Setting({ label, hint, children }) {
  return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
    <Box sx={{ width: 108, flexShrink: 0 }}>
      <Typography variant="body2">{label}</Typography>
      {hint && <Typography variant="caption" color="text.secondary" display="block">{hint}</Typography>}
    </Box>
    {children}
  </Box>;
}

function Choices({ value, options, onChange }) {
  return <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, next) => next !== null && onChange(next)} sx={{ flex: 1 }}>
    {options.map(([id, text]) => <ToggleButton key={id} value={id} sx={buttonSx}>{text}</ToggleButton>)}
  </ToggleButtonGroup>;
}

function Section({ title, children, open = false }) {
  return <Box component="details" open={open} sx={{ mt: 1 }}>
    <Typography component="summary" variant="body2" sx={{ cursor: 'pointer', color: 'primary.main' }}>{title}</Typography>
    <Box sx={{ mt: 1 }}>{children}</Box>
  </Box>;
}

function Importance({ label, value, share, onChange }) {
  return <Box sx={{ px: 0.5 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="caption">{label}</Typography>
      <Typography variant="caption">{share}% of the score</Typography>
    </Box>
    <Slider size="small" min={0} max={100} step={5} value={value} valueLabelDisplay="auto" valueLabelFormat={() => `${share}%`} onChange={(_, next) => onChange(next)} />
  </Box>;
}

function CategoryRange({ target, onChange }) {
  const [from, to] = categorySpan(target);
  const label = from === to ? CATEGORY_ORDER[from] : `${CATEGORY_ORDER[from]} – ${CATEGORY_ORDER[to]}`;
  return <Box sx={{ px: 0.5, mb: 2 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="body2">Flight category</Typography>
      <Typography variant="body2">{label}</Typography>
    </Box>
    <Slider size="small" min={0} max={CATEGORY_ORDER.length - 1} step={1} value={[from, to]} marks={CATEGORY_ORDER.map((id, value) => ({ value, label: id }))} valueLabelDisplay="off"
      onChange={(_, next) => {
        const [start, end] = next;
        onChange({ categoryFrom: CATEGORY_ORDER[start], categoryTo: CATEGORY_ORDER[end], category: start === 0 && end === CATEGORY_ORDER.length - 1 ? 'any' : CATEGORY_ORDER[end] });
      }}
      sx={{ '& .MuiSlider-markLabel': { fontSize: '0.7rem' } }} />
  </Box>;
}

function WeatherProfile({ target, onChange }) {
  const index = WEATHER_PROFILES.findIndex(profile =>
    profile.categoryFrom === target.categoryFrom && profile.categoryTo === target.categoryTo && profile.coverFrom === target.coverFrom && profile.coverTo === target.coverTo && profile.baseFt === target.baseFt
  );
  const value = index < 0 ? 1 : index;
  return <Box sx={{ px: 0.5, mb: 2 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="body2">General preference</Typography>
      <Typography variant="body2">{WEATHER_PROFILES[value].label}</Typography>
    </Box>
    <Slider size="small" min={0} max={WEATHER_PROFILES.length - 1} step={1} value={value} marks={WEATHER_PROFILES.map((profile, markValue) => ({ value: markValue, label: profile.label }))} valueLabelDisplay="off"
      onChange={(_, next) => {
        const { label, ...profile } = WEATHER_PROFILES[next];
        onChange(profile);
      }}
      sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem', transform: 'translateX(-50%) rotate(-15deg)', transformOrigin: 'top center' } }} />
  </Box>;
}

function CloudRange({ target, onChange }) {
  const [from, to] = cloudSpan(target);
  const label = from === to ? CLOUD_ORDER[from] : `${CLOUD_ORDER[from]} – ${CLOUD_ORDER[to]}`;
  return <Box sx={{ px: 0.5, mb: 2 }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography variant="body2">Ideal cloud cover</Typography>
      <Typography variant="body2">{label}</Typography>
    </Box>
    <Slider size="small" min={0} max={CLOUD_ORDER.length - 1} step={1} value={[from, to]} marks={CLOUD_ORDER.map((id, value) => ({ value, label: id }))} valueLabelDisplay="off"
      onChange={(_, next) => {
        const [start, end] = next;
        onChange({ coverFrom: CLOUD_ORDER[start], coverTo: CLOUD_ORDER[end], cover: start === 0 && end === CLOUD_ORDER.length - 1 ? 'any' : CLOUD_ORDER[end] });
      }}
      sx={{ '& .MuiSlider-markLabel': { fontSize: '0.7rem' } }} />
  </Box>;
}

function TargetFields({ target, onChange }) {
  const fields = [
    ['baseFt', 'Ceiling at least', WEATHER_BASES],
  ];
  return <>
    <WeatherProfile target={target} onChange={onChange} />
    <CategoryRange target={target} onChange={onChange} />
    <CloudRange target={target} onChange={onChange} />
    {fields.map(([key, label, options]) => <TextField key={key} select fullWidth size="small" sx={{ mb: 1 }} label={label} value={String(target[key])}
      onChange={event => onChange(key, key === 'baseFt' ? Number(event.target.value) : event.target.value)}>
      {options.map(option => <MenuItem key={option.id} value={String(option.id)}>{option.label}</MenuItem>)}
    </TextField>)}
  </>;
}

function sourceText(weather) {
  const names = weather?.sources?.map(source => source.name).filter(Boolean);
  if (names?.length) return names.join(' · ');
  if (weather?.source === 'AWC') return 'NOAA Aviation Weather Center';
  if (weather?.source === 'NOAA-cycle') return 'NOAA METAR cycles';
  if (weather?.source === 'VATSIM') return 'VATSIM METAR';
  return 'No weather loaded yet';
}

function sourceHint(source) {
  return WEATHER_SOURCES.find(item => item.id === source)?.hint || '';
}

function weatherTime(weather) {
  const timestamp = weather?.sourceUpdatedAt || weather?.fetchedAt;
  return timestamp ? new Date(timestamp).toUTCString() : 'Not loaded';
}

export default function EnvironmentOptions({ value, onChange, environment }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const changeDepartureTarget = (key, next) => {
    const patch = key && typeof key === 'object' ? key : { [key]: next };
    const departureWeather = { ...(value.departureWeather || DEFAULT_WEATHER_TARGET), ...patch };
    onChange({ ...value, departureWeather, arrivalWeather: value.sameWeatherTarget ? { ...departureWeather } : value.arrivalWeather });
  };
  const changeArrivalTarget = (key, next) => {
    const patch = key && typeof key === 'object' ? key : { [key]: next };
    onChange({ ...value, arrivalWeather: { ...(value.arrivalWeather || DEFAULT_WEATHER_TARGET), ...patch } });
  };
  const applyPreset = preset => {
    const target = { categoryFrom: preset.categoryFrom, categoryTo: preset.categoryTo, category: preset.category, coverFrom: preset.coverFrom, coverTo: preset.coverTo, cover: preset.cover, baseFt: preset.baseFt };
    onChange({ ...value, sameWeatherTarget: true, departureWeather: target, arrivalWeather: { ...target } });
  };
  const atcOn = atcActive(value);
  const airportsOn = value.departure !== 'off' || value.arrival !== 'off';
  const impacts = [
    value.departure !== 'off' && ['departureWeight', 'Departure ATC'],
    value.arrival !== 'off' && ['arrivalWeight', 'Arrival ATC'],
    value.enroute !== 'off' && ['enrouteWeight', 'Route ATC'],
    value.weather !== 'off' && ['weatherWeight', 'Weather'],
  ].filter(Boolean);
  const impactTotal = impacts.reduce((sum, [key]) => sum + (Number(value[key]) || 0), 0);
  const departureTarget = value.departureWeather || DEFAULT_WEATHER_TARGET;
  return <Box sx={{ my: 2, display: 'grid', gap: 1.5 }}>
    <Box sx={{ p: 1.5, border: '1px solid #ddd', borderRadius: 1 }}>
      <Typography variant="subtitle1">ATC VATSIM Coverage</Typography>
      <Typography variant="caption" display="block" sx={{ mb: 1.25 }}>Live VATSIM coverage. Booked future coverage can count when the route reaches it.</Typography>
      <Setting label="Departure"><Modes value={value.departure} onChange={next => set('departure', next)} /></Setting>
      <Setting label="Enroute" hint="Direct track"><Modes value={value.enroute} onChange={next => set('enroute', next)} /></Setting>
      <Setting label="Arrival"><Modes value={value.arrival} onChange={next => set('arrival', next)} /></Setting>
      {atcOn && <FormControlLabel label="Predict coverage from VATSIM bookings" control={<Checkbox size="small" checked={value.predictBookings !== false} onChange={event => set('predictBookings', event.target.checked)} />} />}
      {atcOn && <Section title="ATC matching and route coverage">
        {airportsOn && <>
          <Setting label="Airports"><Choices value={value.scope} options={[['endpoints', 'First and last'], ['every-leg', 'Every stop']]} onChange={next => set('scope', next)} /></Setting>
          <Setting label="Counts as covered"><Choices value={value.service} options={[['tower', 'Tower'], ['approach', 'Approach'], ['any', 'Any ATC']]} onChange={next => set('service', next)} /></Setting>
        </>}
        {value.enroute !== 'off' && <>
          <Box sx={{ px: 0.5, mb: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="body2">Minimum of the track covered</Typography><Typography variant="body2">{value.minimumCoverage}%</Typography></Box>
            <Slider size="small" min={0} max={100} step={5} value={value.minimumCoverage} valueLabelDisplay="auto" onChange={(_, next) => set('minimumCoverage', next)} />
          </Box>
          <Setting label="Measure"><Choices value={value.enrouteScope} options={[['each-leg', 'Each leg'], ['itinerary', 'Whole trip']]} onChange={next => set('enrouteScope', next)} /></Setting>
        </>}
        <FormControlLabel label="Also count approximate sector shapes" control={<Checkbox size="small" checked={value.allowInferred} onChange={event => set('allowInferred', event.target.checked)} />} />
      </Section>}
    </Box>
    <Box sx={{ p: 1.5, border: '1px solid #ddd', borderRadius: 1 }}>
      <Typography variant="subtitle1">Weather</Typography>
      <Typography variant="caption" display="block" sx={{ mb: 1.25 }}>Observed METAR for route scoring.</Typography>
      <Setting label="Source" hint={sourceHint(value.weatherSource)}><Choices value={value.weatherSource} options={WEATHER_SOURCES.map(item => [item.id, item.label])} onChange={next => set('weatherSource', next)} /></Setting>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
        <Box>
          <Typography variant="body2">Updated</Typography>
          <Typography variant="caption" color="text.secondary" display="block">{weatherTime(environment.snapshot?.weather)}</Typography>
          <Typography variant="caption" color="text.secondary" display="block">{sourceText(environment.snapshot?.weather)}</Typography>
        </Box>
        <Button size="small" disabled={environment.loading} onClick={environment.refresh}>{environment.loading ? 'Updating…' : 'Update weather'}</Button>
      </Box>
      <Setting label="Use in routes"><Modes value={value.weather} onChange={next => set('weather', next)} /></Setting>
      {value.weather !== 'off' && <>
        <Section title="Weather target" open>
          <Typography variant="caption" display="block" sx={{ mb: 0.75 }}>Start with the general slider, then narrow the category, cloud and ceiling ranges if needed.</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
            {WEATHER_PRESETS.map(preset => <Button key={preset.label} size="small" variant="outlined" onClick={() => applyPreset(preset)} sx={{ textTransform: 'none' }}>{preset.label}</Button>)}
          </Box>
          <FormControlLabel sx={{ mb: 1 }} label="Use a different target at arrival" control={<Checkbox size="small" checked={!value.sameWeatherTarget} onChange={event => {
            const different = event.target.checked;
            onChange({ ...value, sameWeatherTarget: !different, arrivalWeather: different ? { ...(value.arrivalWeather || departureTarget) } : { ...departureTarget } });
          }} />} />
          <Typography variant="body2" sx={{ mb: 0.5 }}>{value.sameWeatherTarget ? 'Departure and arrival' : 'Departure'}</Typography>
          <TargetFields target={departureTarget} onChange={changeDepartureTarget} />
          {!value.sameWeatherTarget && <>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Arrival</Typography>
            <TargetFields target={value.arrivalWeather || DEFAULT_WEATHER_TARGET} onChange={changeArrivalTarget} />
          </>}
        </Section>
      </>}
    </Box>
    {impacts.length > 1 && <Box sx={{ p: 1.5, border: '1px solid #ddd', borderRadius: 1 }}>
      <Typography variant="subtitle1">Ranking</Typography>
      <Typography variant="caption" display="block" sx={{ mb: 1 }}>These sliders split the route score between active preferences. For example, 70% Weather / 30% ATC means weather matters more when sorting. Require still filters routes even if its slider is 0%.</Typography>
      <Section title="Score weights" open>
        {impacts.map(([key, label]) => <Importance key={key} label={label} value={Number(value[key]) || 0} share={impactTotal ? Math.round(100 * (Number(value[key]) || 0) / impactTotal) : 0} onChange={next => set(key, next)} />)}
      </Section>
    </Box>}
    {Object.keys(environment.errors).length > 0 && <Alert severity="warning">Live data unavailable: {Object.keys(environment.errors).join(', ')}. The last successful reports stay visible with their times.</Alert>}
    {atcOn && <Button size="small" disabled={environment.loading} onClick={environment.refresh}>{environment.loading ? 'Updating…' : 'Refresh live ATC'}</Button>}
  </Box>;
}
