import React from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Popover from '@mui/material/Popover';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FilterListIcon from '@mui/icons-material/FilterList';
import StarIcon from '@mui/icons-material/Star';

import EnvironmentSummary from '../Environment/EnvironmentSummary.js';
import { compareCoverage, compareConditions } from '../Environment/evaluate.mjs';
import { CATEGORY_COLORS, atcActive, prefersConditions } from '../Environment/defaults.mjs';
import { formatSky } from '../Environment/weather.mjs';
import { simName } from '../util/utility.js';

import IcaoSearch from './IcaoSearch.js'; 

const styles = {
  icon: {
    marginRight: 0.2
  },
  gridText: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  filtersInput: {
    width: "100%",
    mb: 1
  }
};

function filterText(sortBy, result) {
  switch(sortBy) {
    case 'conditions': return 'Score '+Math.round(result.environment?.routeScore || 0);
    case 'coverage': return 'ATC '+Math.round(result.environment?.coverageScore || 0);
    case 'weather': return 'Weather '+Math.round(result.environment?.weatherScore || 0);
    case 'payNM': return '$'+Math.round(result.payNM)+'/NM';
    case 'payLeg': return '$'+Math.round(result.payLeg)+'/leg';
    case 'payTime': return '$'+Math.round(result.payTime)+'/H';
    case 'distance': return '';
    case 'pay': return '';
    default: return '$'+result.b+' bonus';
  }
}

const cloudSymbols = { CLR: '○', SKC: '○', NSC: '○', NCD: '○', FEW: '◔', SCT: '◑', BKN: '◕', OVC: '●', VV: '⊗', OVX: '⊗', UNKNOWN: '?' };

function coverageFor(result, icao) {
  const entries = [...(result.environment?.departures || []), ...(result.environment?.arrivals || [])].filter(item => item.icao === icao);
  return entries.find(item => item.state === 'covered') || entries[0] || null;
}

function coverageStyle(coverage) {
  if (!coverage) return { sx: {}, title: '' };
  if (coverage.state === 'covered' && coverage.confidence === 'booked') return {
    sx: { borderBottom: '2px dashed #777' },
    title: `${coverage.icao}: booked ATC coverage${coverage.callsigns?.length ? ` (${coverage.callsigns.join(', ')})` : ''}`,
  };
  if (coverage.state === 'covered') return {
    sx: { borderBottom: `2px solid ${coverage.confidence === 'inferred' ? '#8a6fb0' : '#067a98'}` },
    title: `${coverage.icao}: live ATC coverage${coverage.callsigns?.length ? ` (${coverage.callsigns.join(', ')})` : ''}${coverage.confidence === 'inferred' ? ' · inferred' : ''}`,
  };
  return {
    sx: { borderBottom: `2px dotted ${coverage.state === 'unknown' ? '#aaa' : '#c62828'}` },
    title: `${coverage.icao}: ${coverage.reason || coverage.state}`,
  };
}

function weatherFor(result, icao) {
  return (result.environment?.observations || []).find(item => item.icao === icao) || null;
}

function AirportCrumb({ result, icao, goTo }) {
  const coverage = coverageFor(result, icao);
  const weather = weatherFor(result, icao);
  const coverageHint = coverageStyle(coverage);
  const color = CATEGORY_COLORS[weather?.state === 'known' ? weather.category : 'UNKNOWN'];
  const title = [coverageHint.title, weather ? `${icao}: ${formatSky(weather)}${weather.meets === false ? ' · off target' : ''}` : ''].filter(Boolean).join('\n');
  return <Link
    href="#"
    title={title}
    onClick={evt => {
      evt.stopPropagation();
      evt.preventDefault();
      goTo(icao);
    }}
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.35,
      lineHeight: 1.15,
      textDecoration: 'none',
      pb: '1px',
      ...coverageHint.sx,
    }}
  >
    <Box component="span">{icao}</Box>
    {weather && <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <Box component="span" sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', lineHeight: 1, border: '1px solid rgba(255,255,255,0.8)' }}>{cloudSymbols[weather.cloudCover] || '?'}</Box>
    </Box>}
  </Link>;
}

// List of results
const List = React.memo(({results, showDetail, goTo, setRoute, nbDisplay, sortBy, savedResultsUids}) => {
  return (results.slice(0, nbDisplay).map(result =>
    <Box
      sx={{
        padding: 3,
        borderBottom: "1px solid #eee",
        cursor: "pointer",
        "&:hover": {
          background: "#f9f9f9"
        },
        position: "relative"
      }}
      key={result.id}
      onClick={() => showDetail(result)}
      onMouseEnter={() => setRoute(result)}
    >
      <Breadcrumbs
        separator={<NavigateNextIcon fontSize="small" />}
        sx={{
          '& .MuiBreadcrumbs-separator': {
            marginLeft: '1px',
            marginRight: '1px'
          }
        }}
        maxItems={5}
        itemsBeforeCollapse={3}
        onClick={(evt) => {
          // Show all ICAOs and do not display the result details when clicking the ... button
          if (evt.target.closest('button')) {
            evt.stopPropagation();
          }
        }}
      >
        {result.icaos.map((icao, i) => <Box key={`${icao}:${i}`} component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
          {i === 0 && savedResultsUids.has(result.uid) && <StarIcon sx={{ color: '#f5c518', mr: 0.5, fontSize: '1.3em' }} />}
          <AirportCrumb result={result} icao={icao} goTo={goTo} />
        </Box>)}
      </Breadcrumbs>
      <Grid container spacing={1} sx={{ mt: 1, ml: -2 }}>
        <Grid size={4}>
          <Typography variant="body2" sx={styles.gridText}><AttachMoneyIcon sx={styles.icon} />{result.pay}</Typography>
        </Grid>
        <Grid size={4}>
          <Typography variant="body2" sx={styles.gridText}><SettingsEthernetIcon sx={styles.icon} />{result.distance} NM</Typography>
        </Grid>
        <Grid size={4}>
          <Typography variant="body2" sx={styles.gridText}><AccessTimeIcon sx={styles.icon} />{result.time}</Typography>
        </Grid>
      </Grid>
      <EnvironmentSummary result={result} />
      <Typography
        variant="body2"
        sx={{
          position: "absolute",
          top: 8,
          right: 8,
          color: "#aaa",
          fontSize: "0.8em"
        }}
      >
        {filterText(sortBy, result)}
      </Typography>
    </Box>));
});


const sortFunctions = {
  conditions: compareConditions,
  coverage: compareCoverage,
  weather: (a, b) => (b.environment?.weatherScore || 0) - (a.environment?.weatherScore || 0) || b.payTime - a.payTime,
  payNM: (a, b) => b.payNM - a.payNM,
  payLeg: (a, b) => b.payLeg - a.payLeg,
  payTime: (a, b) => b.payTime - a.payTime,
  pay: (a, b) => b.pay - a.pay,
  distance: (a, b) => a.distance - b.distance,
  bonus: (a, b) => b.b - a.b,
}

function parseExclusion(reason, count) {
  const match = String(reason).match(/^([A-Z0-9]{3,4}):\s*(.*)$/);
  return { reason, count, icao: match?.[1] || null, text: match?.[2] || reason };
}

function ExclusionInfo({ rejections, goTo, options, actions }) {
  const [message, setMessage] = React.useState('');
  const simData = React.useRef({});
  const rows = React.useMemo(() => Object.entries(rejections || {})
    .map(([reason, count]) => parseExclusion(reason, count))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)), [rejections]);
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const sim = options?.settings?.display?.sim || 'msfs';
  const loadSimAirport = async icao => {
    if (!simData.current[sim]) {
      const response = await fetch(`data/${sim}.json`);
      simData.current[sim] = response.ok ? await response.json() : {};
    }
    return simData.current[sim][icao];
  };
  const showAirport = async icao => {
    if (!icao) return;
    if (options?.icaodata?.[icao]) {
      goTo(icao); setMessage(`${icao} shown from FSE airports.`);
      return;
    }
    try {
      const airport = await loadSimAirport(icao);
      if (airport) {
        actions?.current?.goToGps?.(airport.lat, airport.lon);
        setMessage(`${icao} shown from ${simName(sim)} airport data.`);
      } else setMessage(`${icao} was not found in FSE or ${simName(sim)} airport data.`);
    } catch {
      setMessage(`Unable to load ${simName(sim)} airport data.`);
    }
  };
  return <Box component="details" sx={{ mt: 0.5 }}>
    <Typography component="summary" variant="caption" sx={{ cursor: 'pointer', color: 'text.secondary' }}>
      {total} environmental exclusions from completed candidates
    </Typography>
    <Box sx={{ mt: 0.5, display: 'grid', gap: 0.25 }}>
      {rows.slice(0, 20).map(row => <Typography key={row.reason} variant="caption" display="block">
        <Box component="span" sx={{ color: 'text.secondary', mr: 0.5 }}>{row.count}</Box>
        {row.icao ? <Link component="button" variant="caption" onClick={() => showAirport(row.icao)} sx={{ verticalAlign: 'baseline', p: 0 }}>{row.icao}</Link> : null}
        {row.icao ? `: ${row.text}` : row.text}
      </Typography>)}
      {rows.length > 20 && <Typography variant="caption" color="text.secondary">Showing top 20 of {rows.length} reasons.</Typography>}
      {message && <Typography variant="caption" color="text.secondary">{message}</Typography>}
    </Box>
  </Box>;
}

const Results = React.memo((props) => {
  const [filterMenu, setFilterMenu] = React.useState(null);
  const [minDist, setMinDist] = React.useState('');
  const [maxDist, setMaxDist] = React.useState('');
  const [minPay, setMinPay] = React.useState('');
  const [maxPay, setMaxPay] = React.useState('');
  const [minTime, setMinTime] = React.useState('');
  const [maxTime, setMaxTime] = React.useState('');
  const [filterIcaos, setFilterIcaos] = React.useState([]);
  const [filterExcludeIcaos, setFilterExcludeIcaos] = React.useState([]);
  const [nbDisplay, setNbDisplay] = React.useState(20);
  const initialSort = prefersConditions(props.results[0]?.environment?.policy) ? 'conditions' : 'payTime';
  const [filteredResults, setFilteredResults] = React.useState(() => [...props.results].sort(sortFunctions[initialSort]));
  const [sortBy, setSortBy] = React.useState(initialSort);
  const resultsDiv = React.useRef(null);

  const filterResults = () => {
    let minTimeNb = null;
    let maxTimeNb = null;
    if (minTime) {
      const t = minTime.split(':');
      if (t.length === 2) {
        minTimeNb = parseInt(t[0]) + parseInt(t[1])/60;
      }
      else {
        setMinTime('');
      }
    }
    if (maxTime) {
      const t = maxTime.split(':');
      if (t.length === 2) {
        maxTimeNb = parseInt(t[0]) + parseInt(t[1])/60;
      }
      else {
        setMaxTime('');
      }
    }

    const r = props.results.filter(elm => {
      return !(
           (minDist && elm.distance < minDist)
        || (maxDist && elm.distance > maxDist)
        || (minPay && elm.pay < minPay)
        || (maxPay && elm.pay > maxPay)
        || (minTimeNb && elm.timeNb < minTimeNb)
        || (maxTimeNb && elm.timeNb > maxTimeNb)
        || (filterIcaos.length && !filterIcaos.every(x => elm.icaos.includes(x.icao)))
        || (filterExcludeIcaos.length && !filterExcludeIcaos.every(x => !elm.icaos.includes(x.icao)))
      );
    })
    r.sort(sortFunctions[sortBy]);
    setFilteredResults(r);
    setFilterMenu(null);
  }

  // Scroll to top when filtering / changing sortby of results
  React.useEffect(() => {
    if (resultsDiv.current) {
      resultsDiv.current.scrollTo(0 ,0);
      setNbDisplay(20);
    }
  }, [filteredResults, resultsDiv]);

  return (
    <Box
      sx={{
        display: props.display ? 'flex' : 'none',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          background: "#fff",
          display: "flex",
          alignItems: "center"
        }}
      >
        <Box
          sx={{
            cursor: "pointer",
            height: "100%",
            "&:hover": {
              background: "#f9f9f9"
            }
          }}
          onClick={props.close}
        >
          <Typography
            variant="body2"
            sx={{
              lineHeight: 0.8,
              textAlign: "center",
              py: 2,
              px: 1.5
            }}
          >
            <ArrowBackIcon /><br />New search
          </Typography>
        </Box>
        <Box sx={{ py: 2, px: 1 }}>
          <Button
            variant="contained"
            onClick={(evt) => setFilterMenu(evt.currentTarget)}
            startIcon={<FilterListIcon />}
          >
            Filters
          </Button>
          <Popover
            anchorEl={filterMenu}
            keepMounted
            open={Boolean(filterMenu)}
            onClose={filterResults}
            sx={{
              '& .MuiPaper-root': {
                maxWidth: 300,
                py: 1,
                px: 2
              }
            }}
          >
            <Typography variant="body1" sx={{ mb: 2 }}>Route filters:</Typography>
            <Grid container spacing={1}>
              <Grid size={6}>
                <TextField
                  label="Min distance"
                  variant="outlined"
                  value={minDist}
                  onChange={(evt) => setMinDist(evt.target.value.replace(/[^0-9]/g, ''))}
                  slotProps={{
                    inputLabel: { shrink: true },
                    input: {
                      endAdornment: <InputAdornment position="end">NM</InputAdornment>
                    }
                  }}
                  size="small"
                  sx={styles.filtersInput}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Max distance"
                  variant="outlined"
                  value={maxDist}
                  onChange={(evt) => setMaxDist(evt.target.value.replace(/[^0-9]/g, ''))}
                  slotProps={{
                    inputLabel: { shrink: true },
                    input: {
                      endAdornment: <InputAdornment position="end">NM</InputAdornment>
                    }
                  }}
                  size="small"
                  sx={styles.filtersInput}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Min duration"
                  variant="outlined"
                  value={minTime}
                  placeholder="1:30"
                  onChange={(evt) => {
                    const val = evt.target.value;
                    if (val.match(/^[0-9:]*$/g)) {
                      setMinTime(val);
                    }
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  size="small"
                  sx={styles.filtersInput}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Max duration"
                  variant="outlined"
                  value={maxTime}
                  placeholder="6:30"
                  onChange={(evt) => {
                    const val = evt.target.value;
                    if (val.match(/^[0-9:]*$/g)) {
                      setMaxTime(val);
                    }
                  }}
                  slotProps={{ inputLabel: { shrink: true } }}
                  size="small"
                  sx={styles.filtersInput}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Min pay"
                  variant="outlined"
                  value={minPay}
                  onChange={(evt) => setMinPay(evt.target.value.replace(/[^0-9]/g, ''))}
                  slotProps={{
                    inputLabel: { shrink: true },
                    input: {
                      startAdornment: <InputAdornment position="start">$</InputAdornment>
                    }
                  }}
                  size="small"
                  sx={styles.filtersInput}
                />
              </Grid>
              <Grid size={6}>
                <TextField
                  label="Max pay"
                  variant="outlined"
                  value={maxPay}
                  onChange={(evt) => setMaxPay(evt.target.value.replace(/[^0-9]/g, ''))}
                  slotProps={{
                    inputLabel: { shrink: true },
                    input: {
                      startAdornment: <InputAdornment position="start">$</InputAdornment>
                    }
                  }}
                  size="small"
                  sx={styles.filtersInput}
                />
              </Grid>
              <Grid size={12}>
                <IcaoSearch
                  options={props.icaodataArr}
                  label="Include ICAO(s)"
                  inputProps={{
                    slotProps: { inputLabel: { shrink: true } },
                    size:"small",
                    sx:styles.filtersInput
                  }}
                  onChange={(evt, value) => {
                    setFilterIcaos(value);
                  }}
                  onPaste={evt => {
                    // When pasting data, check if only consituted of multiple valid ICAOs
                    // If so, update filter with all these ICAOs at once
                    const arr = evt.clipboardData.getData('Text').split(/\s/).map(e => e.toUpperCase());
                    const icaos = [];
                    for (const option of props.icaodataArr) {
                      if (arr.includes(option.icao)) {
                        icaos.push(option);
                      }
                    }
                    if (arr.length !== icaos.length) {
                      return true;
                    }
                    setFilterIcaos([...filterIcaos, ...icaos]);
                    evt.preventDefault();
                    evt.stopPropagation();
                    return false;
                  }}
                  value={filterIcaos}
                  multiple
                />
              </Grid>
              <Grid size={12}>
                <IcaoSearch
                  options={props.icaodataArr}
                  label="Exclude ICAO(s)"
                  inputProps={{
                    slotProps: { inputLabel: { shrink: true } },
                    size:"small",
                    sx:styles.filtersInput
                  }}
                  onChange={(evt, value) => {
                    setFilterExcludeIcaos(value);
                  }}
                  onPaste={evt => {
                    // When pasting data, check if only consituted of multiple valid ICAOs
                    // If so, update filter with all these ICAOs at once
                    const arr = evt.clipboardData.getData('Text').split(/\s/).map(e => e.toUpperCase());
                    const icaos = [];
                    for (const option of props.icaodataArr) {
                      if (arr.includes(option.icao)) {
                        icaos.push(option);
                      }
                    }
                    if (arr.length !== icaos.length) {
                      return true;
                    }
                    setFilterExcludeIcaos([...filterExcludeIcaos, ...icaos]);
                    evt.preventDefault();
                    evt.stopPropagation();
                    return false;
                  }}
                  value={filterExcludeIcaos}
                  multiple
                />
              </Grid>
            </Grid>
            <Button variant="contained" color="primary" onClick={filterResults} sx={{ mt: 1 }}>Apply</Button>
          </Popover>
        </Box>
        <Box sx={{ py: 2, px: 1 }}>
          <TextField
            value={sortBy}
            onChange={(evt) => {
              setFilteredResults(r => {
                return [...r].sort(sortFunctions[evt.target.value]);
              });
              setSortBy(evt.target.value);
            }}
            label="Sort by"
            variant="outlined"
            size="small"
            select
            sx={{
              width: 150,
              fontSize: "0.8em"
            }}
            slotProps={{
              inputLabel: {style:{fontSize:"1em"}},
              input: {style:{fontSize:"1em"}}
            }}
          >
            {props.results.some(r => r.environment && (atcActive(r.environment.policy) || r.environment.policy.weather !== 'off')) && <MenuItem value="conditions">Best conditions</MenuItem>}
            {props.results.some(r => r.environment && atcActive(r.environment.policy)) && <MenuItem value="coverage">Best ATC coverage</MenuItem>}
            {props.results.some(r => r.environment?.policy.weather !== 'off' && r.environment) && <MenuItem value="weather">Best weather</MenuItem>}
            <MenuItem value="payNM">Pay per NM</MenuItem>
            <MenuItem value="payLeg">Pay per leg</MenuItem>
            <MenuItem value="payTime">Pay per flight time</MenuItem>
            <MenuItem value="pay">Total pay</MenuItem>
            <MenuItem value="distance">Shortest distance</MenuItem>
            {props.type === "rent" && <MenuItem value="bonus">Plane bonus</MenuItem>}
          </TextField>
        </Box>
      </Box>
      <Box
        sx={{
          background: "#fff",
          borderBottom: "1px solid #eee",
          padding: 1
        }}
      >
        {
          filteredResults.length > 0 ?
            <Typography variant="body2">{filteredResults.length} routes found.
              <Link href="#" onClick={props.clearSavedResults} sx={{ ml: 2 }}>Clear saved routes</Link>
            </Typography>
          :
            <Typography variant="body2">No route found.
              <Link href="#" onClick={props.clearSavedResults} sx={{ ml: 2 }}>Clear saved routes</Link>
            </Typography>
          }
        <ExclusionInfo rejections={props.rejections} goTo={props.goTo} options={props.options} actions={props.actions} />
      </Box>
      <Box
        ref={resultsDiv}
        sx={{
          overflowX: "hidden",
          overflowY: "auto",
          scrollbarWidth: "thin",
          background: "#fff"
        }}
        onScroll={() => {
          if (resultsDiv.current.scrollHeight - resultsDiv.current.scrollTop - resultsDiv.current.clientHeight < 400 && nbDisplay < filteredResults.length) {
            setNbDisplay(nbDisplay + 20);
          }
        }}
      >
        <List
          results={filteredResults}
          showDetail={props.showDetail}
          goTo={props.goTo}
          setRoute={props.setRoute}
          nbDisplay={nbDisplay}
          sortBy={sortBy}
          savedResultsUids={props.savedResultsUids}
        />
      </Box>
    </Box>
  );
});

export default Results;
