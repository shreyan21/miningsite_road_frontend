import React, { useState, useEffect, useRef } from 'react';
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat } from 'ol/proj';
import { Style, Stroke, Fill, Circle, Text } from 'ol/style';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:5000/api';

// UPDATED: Polygon styles for mining sites
const styles = {
  highway: new Style({
    stroke: new Stroke({ color: '#2563eb', width: 3 })
  }),
  newRoad: new Style({
    stroke: new Stroke({ color: '#dc2626', width: 3, lineDash: [10, 5] })
  }),
  // Mining site polygons - unconnected (purple with transparency)
  miningSite: new Style({
    fill: new Fill({ color: 'rgba(124, 58, 237, 0.3)' }), // 30% opacity purple
    stroke: new Stroke({ color: '#7c3aed', width: 2 }),
    text: new Text({
      font: '10px sans-serif',
      fill: new Fill({ color: '#7c3aed' }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }),
  // Mining site polygons - connected (green with transparency)
  miningSiteConnected: new Style({
    fill: new Fill({ color: 'rgba(22, 163, 74, 0.3)' }), // 30% opacity green
    stroke: new Stroke({ color: '#16a34a', width: 2 }),
    text: new Text({
      font: '10px sans-serif',
      fill: new Fill({ color: '#16a34a' }),
      stroke: new Stroke({ color: '#fff', width: 2 })
    })
  }),
  school: new Style({
    image: new Circle({
      radius: 5,
      fill: new Fill({ color: '#ea580c' }),
      stroke: new Stroke({ color: '#fff', width: 1 })
    })
  }),
  schoolBuffer: new Style({
    stroke: new Stroke({ color: '#ea580c', width: 2, lineDash: [5, 5] }),
    fill: new Fill({ color: 'rgba(234, 88, 12, 0.1)' })
  }),
  river: new Style({
    stroke: new Stroke({ color: '#0891b2', width: 2 }),
    fill: new Fill({ color: 'rgba(8, 145, 178, 0.3)' })
  }),
  proposedRoute: new Style({
    stroke: new Stroke({ color: '#db2777', width: 4, lineDash: [8, 4] })
  })
};

// Dynamic style function for mining sites
const getMiningSiteStyle = (feature) => {
  const isConnected = feature.get('is_connected');
  const baseStyle = isConnected ? styles.miningSiteConnected : styles.miningSite;
  
  // Clone style to avoid modifying original
  const style = baseStyle.clone();
  
  // Add label with site name if available
  const name = feature.get('name');
  if (name && style.getText()) {
    style.getText().setText(name.toString().substring(0, 15));
  }
  
  return style;
};

function App() {
  const mapRef = useRef();
  const mapInstance = useRef();
  const [schoolBuffer, setSchoolBuffer] = useState(500);
  const [batchSize, setBatchSize] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [stats, setStats] = useState({});
  const [message, setMessage] = useState('');
  const [showLabels, setShowLabels] = useState(false);

  const layers = useRef({});

  useEffect(() => {
    const map = new Map({
      target: mapRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({
        center: fromLonLat([83.3732, 26.7606]),
        zoom: 11
      })
    });

    mapInstance.current = map;

    const layerConfigs = [
      { name: 'highways', style: styles.highway },
      { name: 'rivers', style: styles.river },
      { name: 'schools', style: styles.school },
      { name: 'schoolBuffers', style: styles.schoolBuffer },
      { name: 'miningSites', style: getMiningSiteStyle },
      { name: 'newRoads', style: styles.newRoad },
      { name: 'proposedRoute', style: styles.proposedRoute }
    ];

    layerConfigs.forEach(config => {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source: source,
        style: config.style,
        visible: config.name !== 'schoolBuffers'
      });
      map.addLayer(layer);
      layers.current[config.name] = { layer, source };
    });

    loadAllData();
    return () => map.setTarget(undefined);
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    setProgress('Loading...');
    try {
      await Promise.all([
        loadHighways(),
        loadRivers(),
        loadSchools(),
        loadMiningSites(),
        loadRoads(),
        loadStatistics()
      ]);
      setMessage('Data loaded');
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
    setLoading(false);
    setProgress('');
  };

  const loadHighways = async () => {
    const res = await axios.get(`${API_URL}/highways`);
    const features = new GeoJSON().readFeatures(res.data, { featureProjection: 'EPSG:3857' });
    layers.current.highways.source.clear();
    layers.current.highways.source.addFeatures(features);
  };

  const loadRivers = async () => {
    const res = await axios.get(`${API_URL}/rivers`);
    const features = new GeoJSON().readFeatures(res.data, { featureProjection: 'EPSG:3857' });
    layers.current.rivers.source.clear();
    layers.current.rivers.source.addFeatures(features);
  };

  const loadSchools = async () => {
    const res = await axios.get(`${API_URL}/schools`);
    const features = new GeoJSON().readFeatures(res.data, { featureProjection: 'EPSG:3857' });
    layers.current.schools.source.clear();
    layers.current.schools.source.addFeatures(features);
  };

  // FIXED: Load mining sites as polygons with proper styling
  const loadMiningSites = async () => {
    const res = await axios.get(`${API_URL}/mining-sites`);
    const features = new GeoJSON().readFeatures(res.data, { featureProjection: 'EPSG:3857' });
    
    // All mining sites in one layer with dynamic styling
    layers.current.miningSites.source.clear();
    layers.current.miningSites.source.addFeatures(features);
    
    // Fit view to show all sites if first load
    if (features.length > 0 && !mapInstance.current.getView().getCenter()[0]) {
      mapInstance.current.getView().fit(layers.current.miningSites.source.getExtent(), {
        padding: [50, 50, 50, 50]
      });
    }
  };

  const loadRoads = async () => {
    const res = await axios.get(`${API_URL}/roads`);
    const features = new GeoJSON().readFeatures(res.data, { featureProjection: 'EPSG:3857' });
    const highways = features.filter(f => f.get('road_type') === 'highway');
    const newRoads = features.filter(f => f.get('road_type') === 'mining_access');
    
    layers.current.highways.source.clear();
    layers.current.highways.source.addFeatures(highways);
    layers.current.newRoads.source.clear();
    layers.current.newRoads.source.addFeatures(newRoads);
  };

  const loadStatistics = async () => {
    const res = await axios.get(`${API_URL}/statistics`);
    setStats(res.data);
  };

  const handleShowBuffers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/obstacles?schoolBuffer=${schoolBuffer}`);
      const features = new GeoJSON().readFeatures(res.data, { featureProjection: 'EPSG:3857' });
      const buffers = features.filter(f => f.get('type') === 'school_buffer');
      layers.current.schoolBuffers.source.clear();
      layers.current.schoolBuffers.source.addFeatures(buffers);
      layers.current.schoolBuffers.layer.setVisible(true);
      setMessage(`School buffers: ${schoolBuffer}m`);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
    setLoading(false);
  };

  const generateAllRoads = async () => {
    const useBatchSize = batchSize ? parseInt(batchSize) : null;
    const confirmMsg = useBatchSize 
      ? `Generate roads for ${useBatchSize} sites?`
      : `Generate roads for ALL ${stats.total_mining_sites} sites? This may take several minutes.`;
    
    if (!window.confirm(confirmMsg)) return;
    
    setLoading(true);
    setProgress('Generating roads... Please wait...');
    
    try {
      const res = await axios.post(`${API_URL}/generate-all-roads`, {
        batchSize: useBatchSize
      }, { timeout: 300000 }); // 5 minute timeout for large batches
      
      const { processedCount, totalRoadLength, failedSites, totalSites } = res.data;
      
      await loadRoads();
      await loadStatistics();
      await loadMiningSites();
      
      const percent = ((processedCount / totalSites) * 100).toFixed(1);
      setMessage(
        `✓ Generated ${processedCount} roads (${percent}%). ` +
        `Total: ${(totalRoadLength / 1000).toFixed(2)} km. ` +
        `Failed: ${failedSites.length}`
      );
    } catch (err) {
      setMessage('Error: ' + (err.response?.data?.error || err.message));
    }
    setLoading(false);
    setProgress('');
  };

  const resetNetwork = async () => {
    if (!window.confirm('Reset all roads?')) return;
    setLoading(true);
    try {
      await axios.post(`${API_URL}/reset-network`);
      await loadRoads();
      await loadStatistics();
      await loadMiningSites();
      layers.current.proposedRoute.source.clear();
      setMessage('Network reset');
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
    setLoading(false);
  };

  // Toggle labels visibility
  useEffect(() => {
    if (layers.current.miningSites) {
      const currentStyle = layers.current.miningSites.layer.getStyle();
      if (typeof currentStyle === 'function') {
        // Already using function, update text visibility
        layers.current.miningSites.layer.setStyle((feature) => {
          const style = getMiningSiteStyle(feature);
          if (!showLabels && style.getText()) {
            style.getText().setText('');
          }
          return style;
        });
      }
    }
  }, [showLabels]);

  return (
    <div className="app">
      <div className="sidebar">
        <h1>Mining Road Router</h1>
        
        <div className="section">
          <h3>Configuration</h3>
          <label>
            School Buffer (m):
            <input
              type="number"
              value={schoolBuffer}
              onChange={(e) => setSchoolBuffer(Number(e.target.value))}
              min="0"
              max="5000"
            />
          </label>
          <button onClick={handleShowBuffers} disabled={loading}>Show Obstacles</button>
          <label style={{marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px'}}>
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            Show Site Names
          </label>
        </div>

        <div className="section">
          <h3>Batch Processing</h3>
          <label>
            Limit (empty = all):
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
              placeholder={`Total: ${stats.total_mining_sites || '...'}`}
              min="1"
            />
          </label>
          <button 
            onClick={generateAllRoads} 
            disabled={loading} 
            className="primary"
            style={{background: '#16a34a'}}
          >
            {loading ? progress || 'Processing...' : 'Generate All Roads'}
          </button>
          <button onClick={resetNetwork} disabled={loading} className="danger">
            Reset Network
          </button>
        </div>

        <div className="section">
          <h3>Statistics</h3>
          <div className="stats">
            <div className="stat-row">
              <span>Total Sites:</span>
              <strong>{stats.total_mining_sites}</strong>
            </div>
            <div className="stat-row">
              <span>Connected:</span>
              <strong style={{color: stats.connected_sites === stats.total_mining_sites ? '#16a34a' : '#ea580c'}}>
                {stats.connected_sites}
              </strong>
            </div>
            <div className="stat-row">
              <span>New Roads:</span>
              <strong>{stats.new_roads_count}</strong>
            </div>
            <div className="stat-row">
              <span>Total Length:</span>
              <strong>{stats.new_roads_length ? Number(stats.new_roads_length).toFixed(2) : 0} km</strong>
            </div>
          </div>
          {stats.connected_sites > 0 && stats.total_mining_sites > 0 && (
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{
                  width: `${(stats.connected_sites / stats.total_mining_sites) * 100}%`,
                  background: stats.connected_sites === stats.total_mining_sites ? '#16a34a' : '#3b82f6'
                }}
              />
              <span>{((stats.connected_sites / stats.total_mining_sites) * 100).toFixed(1)}%</span>
            </div>
          )}
        </div>

        {message && (
          <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
            {message}
          </div>
        )}
      </div>

      <div className="map-container">
        <div ref={mapRef} className="map" />
        
        <div className="legend">
          <div className="legend-item">
            <span className="color-box" style={{background: '#2563eb'}}></span>
            Highway
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#dc2626', borderStyle: 'dashed'}}></span>
            New Road
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: 'rgba(124, 58, 237, 0.3)', border: '2px solid #7c3aed'}}></span>
            Mining Site (Unconnected)
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: 'rgba(22, 163, 74, 0.3)', border: '2px solid #16a34a'}}></span>
            Mining Site (Connected)
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#ea580c'}}></span>
            School
          </div>
          <div className="legend-item">
            <span className="color-box" style={{background: '#0891b2'}}></span>
            River
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;