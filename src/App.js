import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import Map from 'ol/Map';
import View from 'ol/View';
import GeoJSON from 'ol/format/GeoJSON';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import { Fill, Stroke, Style, Circle as CircleStyle, Text } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import { createEmpty, extend } from 'ol/extent';
import './App.css';

const API_URL = 'http://localhost:5000/api';

const styles = {
  highway: new Style({
    stroke: new Stroke({ color: '#5b5b5b', width: 2.9 }),
  }),
  miningAccess: new Style({
    stroke: new Stroke({ color: '#8b5a3c', width: 3.3, lineDash: [10, 6] }),
  }),
  river: new Style({
    stroke: new Stroke({ color: '#0057d9', width: 2.6 }),
    fill: new Fill({ color: 'rgba(64, 156, 255, 0.28)' }),
  }),
  school: new Style({
    image: new CircleStyle({
      radius: 4.6,
      fill: new Fill({ color: '#ff6b00' }),
      stroke: new Stroke({ color: '#fff7ed', width: 1 }),
    }),
  }),
  schoolBuffer: new Style({
    stroke: new Stroke({ color: '#ff8a1f', width: 1.6, lineDash: [6, 5] }),
    fill: new Fill({ color: 'rgba(255, 138, 31, 0.1)' }),
  }),
  miningUnconnected: new Style({
    fill: new Fill({ color: 'rgba(190, 24, 93, 0.18)' }),
    stroke: new Stroke({ color: '#be185d', width: 2 }),
    text: new Text({
      font: '12px "Segoe UI", sans-serif',
      fill: new Fill({ color: '#831843' }),
      stroke: new Stroke({ color: '#fff1f2', width: 3 }),
    }),
  }),
  miningConnected: new Style({
    fill: new Fill({ color: 'rgba(22, 163, 74, 0.22)' }),
    stroke: new Stroke({ color: '#15803d', width: 2 }),
    text: new Text({
      font: '12px "Segoe UI", sans-serif',
      fill: new Fill({ color: '#14532d' }),
      stroke: new Stroke({ color: '#f0fdf4', width: 3 }),
    }),
  }),
};

const parseGeoJsonFeatures = (geojson) =>
  new GeoJSON().readFeatures(geojson, { featureProjection: 'EPSG:3857' });

const getMiningStyle = (showLabels) => (feature) => {
  const isConnected = feature.get('is_connected');
  const style = (isConnected ? styles.miningConnected : styles.miningUnconnected).clone();
  style.getText().setText(showLabels ? String(feature.get('name') || '').slice(0, 20) : '');
  return style;
};

function App() {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const fittedRef = useRef(false);

  const [schoolBuffer, setSchoolBuffer] = useState(500);
  const [batchSize, setBatchSize] = useState('');
  const [showLabels, setShowLabels] = useState(false);
  const [showSchools, setShowSchools] = useState(false);
  const [showSchoolBuffers, setShowSchoolBuffers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [statistics, setStatistics] = useState({});
  const [failedSites, setFailedSites] = useState([]);
  const [plannerLabel, setPlannerLabel] = useState('');

  const createLayer = (style, visible = true) =>
    new VectorLayer({
      source: new VectorSource(),
      style,
      visible,
    });

  const setLayerFeatures = (name, features) => {
    const layer = layersRef.current[name];
    if (!layer) return;
    layer.getSource().clear();
    layer.getSource().addFeatures(features);
  };

  const fitToData = () => {
    if (!mapRef.current) return;
    const extent = createEmpty();
    let hasData = false;

    ['highways', 'newRoads', 'rivers', 'miningSites'].forEach((name) => {
      const layer = layersRef.current[name];
      if (!layer) return;
      const layerExtent = layer.getSource().getExtent();
      if (layerExtent.every(Number.isFinite)) {
        extend(extent, layerExtent);
        hasData = true;
      }
    });

    if (hasData) {
      mapRef.current.getView().fit(extent, {
        padding: [36, 36, 36, 36],
        duration: 250,
        maxZoom: 12,
      });
    }
  };

  const loadBaseMapData = async ({ fitView = false } = {}) => {
    const [layerResponse, statisticsResponse] = await Promise.all([
      axios.get(`${API_URL}/map-layers`, {
        params: {
          schoolBuffer,
          includeSchools: false,
          includeObstacles: false,
          includeRoadSources: false,
        },
      }),
      axios.get(`${API_URL}/statistics`),
    ]);

    const { planner, layers } = layerResponse.data;
    const roadFeatures = parseGeoJsonFeatures(layers.roads);
    const highwayFeatures = roadFeatures.filter((feature) => feature.get('road_type') !== 'mining_access');
    const miningAccessFeatures = roadFeatures.filter((feature) => feature.get('road_type') === 'mining_access');

    setLayerFeatures('highways', highwayFeatures);
    setLayerFeatures('newRoads', miningAccessFeatures);
    setLayerFeatures('rivers', parseGeoJsonFeatures(layers.rivers));
    setLayerFeatures('miningSites', parseGeoJsonFeatures(layers.miningSites));

    setStatistics(statisticsResponse.data);
    setPlannerLabel(planner?.version || '');

    if (fitView && !fittedRef.current) {
      fitToData();
      fittedRef.current = true;
    }
  };

  const loadSchoolsLayer = async () => {
    const response = await axios.get(`${API_URL}/schools`);
    setLayerFeatures('schools', parseGeoJsonFeatures(response.data));
  };

  const loadSchoolBufferLayer = async () => {
    const response = await axios.get(`${API_URL}/obstacles`, {
      params: { schoolBuffer, types: 'school_buffer' },
    });
    setLayerFeatures('schoolBuffers', parseGeoJsonFeatures(response.data));
  };

  const refreshMap = async ({ fitView = false } = {}) => {
    setLoading(true);
    try {
      await loadBaseMapData({ fitView });

      if (showSchools) {
        await loadSchoolsLayer();
      } else {
        setLayerFeatures('schools', []);
      }

      if (showSchoolBuffers) {
        await loadSchoolBufferLayer();
      } else {
        setLayerFeatures('schoolBuffers', []);
      }

      setMessage('');
    } catch (error) {
      setMessage(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const map = new Map({
      target: mapElementRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({
        center: fromLonLat([83.3732, 26.7606]),
        zoom: 10,
      }),
    });

    layersRef.current.highways = createLayer(styles.highway);
    layersRef.current.newRoads = createLayer(styles.miningAccess);
    layersRef.current.rivers = createLayer(styles.river);
    layersRef.current.schools = createLayer(styles.school, false);
    layersRef.current.schoolBuffers = createLayer(styles.schoolBuffer, false);
    layersRef.current.miningSites = createLayer(getMiningStyle(showLabels));

    Object.values(layersRef.current).forEach((layer) => map.addLayer(layer));

    mapRef.current = map;
    void refreshMap({ fitView: true });

    return () => map.setTarget(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const miningLayer = layersRef.current.miningSites;
    if (miningLayer) {
      miningLayer.setStyle(getMiningStyle(showLabels));
    }
  }, [showLabels]);

  useEffect(() => {
    const schoolsLayer = layersRef.current.schools;
    if (!schoolsLayer) return;
    schoolsLayer.setVisible(showSchools);

    if (showSchools && schoolsLayer.getSource().getFeatures().length === 0) {
      void loadSchoolsLayer().catch((error) => {
        setMessage(`Error: ${error.response?.data?.error || error.message}`);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSchools]);

  useEffect(() => {
    const schoolBufferLayer = layersRef.current.schoolBuffers;
    if (!schoolBufferLayer) return;
    schoolBufferLayer.setVisible(showSchoolBuffers);

    if (showSchoolBuffers) {
      void loadSchoolBufferLayer().catch((error) => {
        setMessage(`Error: ${error.response?.data?.error || error.message}`);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSchoolBuffers, schoolBuffer]);

  const handleGenerateRoads = async () => {
    setLoading(true);
    setMessage('');
    setFailedSites([]);

    try {
      const response = await axios.post(
        `${API_URL}/generate-all-roads`,
        {
          schoolBuffer,
          batchSize: batchSize ? Number(batchSize) : null,
        },
        { timeout: 600000 },
      );

      setFailedSites(response.data.failedDetails || []);
      setMessage(response.data.message);
      await refreshMap();
    } catch (error) {
      setMessage(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResetNetwork = async () => {
    setLoading(true);
    setFailedSites([]);
    setMessage('');

    try {
      const response = await axios.post(`${API_URL}/reset-network`);
      setMessage(response.data.message);
      await refreshMap();
    } catch (error) {
      setMessage(`Error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const completionPercent = statistics.total_mining_sites
    ? ((Number(statistics.connected_sites || 0) / Number(statistics.total_mining_sites)) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="hero">
          <p className="eyebrow">Mining Road Planner</p>
          <h1>Least-cost connection workspace</h1>
          <p className="hero-copy">
            Roads connect from each mining boundary to the active road network. If you add new road
            layers later, future runs will use them automatically.
          </p>
          <p className="hero-note">
            Current mode: <strong>{plannerLabel || 'loading'}</strong>
          </p>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2>Run settings</h2>
            <button type="button" className="ghost" onClick={() => refreshMap()} disabled={loading}>
              Refresh
            </button>
          </div>

          <label className="field">
            <span>School buffer in meters</span>
            <input
              type="number"
              min="0"
              max="10000"
              value={schoolBuffer}
              onChange={(event) => setSchoolBuffer(Number(event.target.value))}
            />
          </label>

          <label className="field">
            <span>Batch size</span>
            <input
              type="number"
              min="1"
              value={batchSize}
              onChange={(event) => setBatchSize(event.target.value)}
              placeholder={`Leave empty for all ${statistics.total_mining_sites || 0} sites`}
            />
          </label>

          <div className="toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={showLabels}
                onChange={(event) => setShowLabels(event.target.checked)}
              />
              <span>Show mining site names</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showSchools}
                onChange={(event) => setShowSchools(event.target.checked)}
              />
              <span>Show schools</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={showSchoolBuffers}
                onChange={(event) => setShowSchoolBuffers(event.target.checked)}
              />
              <span>Show school buffers</span>
            </label>
          </div>

          <div className="button-row">
            <button type="button" className="accent" onClick={handleGenerateRoads} disabled={loading}>
              {loading ? 'Working...' : 'Generate roads'}
            </button>
            <button type="button" className="danger" onClick={handleResetNetwork} disabled={loading}>
              Reset generated roads
            </button>
          </div>
        </section>

        <section className="panel compact-panel">
          <h2>Network status</h2>
          <div className="stat-grid">
            <div className="stat-card">
              <span>Total mining sites</span>
              <strong>{statistics.total_mining_sites || 0}</strong>
            </div>
            <div className="stat-card">
              <span>Connected</span>
              <strong>{statistics.connected_sites || 0}</strong>
            </div>
            <div className="stat-card">
              <span>Blocked</span>
              <strong>{statistics.blocked_sites || 0}</strong>
            </div>
            <div className="stat-card">
              <span>Generated roads</span>
              <strong>{statistics.new_roads_count || 0}</strong>
            </div>
          </div>

          <div className="progress-panel">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${completionPercent}%` }} />
            </div>
            <p>{completionPercent}% connected</p>
            <p>
              Total generated length:{' '}
              <strong>{Number(statistics.new_roads_length || 0).toFixed(2)} km</strong>
            </p>
          </div>
        </section>

        {failedSites.length > 0 && (
          <section className="panel compact-panel warning-panel">
            <h2>Blocked during last run</h2>
            <div className="failed-list">
              {failedSites.slice(0, 8).map((site) => (
                <div key={`${site.gid}-${site.code || 'x'}`} className="failed-item">
                  <strong>Site {site.gid}</strong>
                  <span>{site.code || 'BLOCKED'}</span>
                  <p>{site.reason}</p>
                </div>
              ))}
              {failedSites.length > 8 && (
                <p className="more-text">Showing first 8 blocked sites.</p>
              )}
            </div>
          </section>
        )}

        {message && (
          <section className={`flash ${message.startsWith('Error:') ? 'flash-error' : 'flash-success'}`}>
            {message}
          </section>
        )}
      </aside>

      <main className="map-panel">
        <div ref={mapElementRef} className="map-canvas" />
        <div className="legend">
          <h3>Map legend</h3>
          <div className="legend-row"><span className="swatch swatch-highway" />Active road network</div>
          <div className="legend-row"><span className="swatch swatch-access" />Generated mining road</div>
          <div className="legend-row"><span className="swatch swatch-mine" />Mining site</div>
          <div className="legend-row"><span className="swatch swatch-mine-connected" />Connected site</div>
          <div className="legend-row"><span className="swatch swatch-school" />School</div>
          <div className="legend-row"><span className="swatch swatch-river" />River</div>
        </div>
      </main>
    </div>
  );
}

export default App;
